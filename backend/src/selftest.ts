// End-to-end check against a running server: auth, resumable upload, indexing, op validation,
// conflicts, the agent, and a real render. Run with the server up: npm test
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import ffprobe from 'ffprobe-static'

const BASE = process.env.API ?? 'http://localhost:8787/api'
let token = ''
const ok = (m: string) => console.log('  ✓ ' + m)
async function call(method: string, url: string, body?: unknown, raw?: Buffer) {
  const res = await fetch(BASE + url, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}) }, body: raw ?? (body ? JSON.stringify(body) : undefined) })
  const j = res.headers.get('content-type')?.includes('json') ? await res.json() : null
  return { status: res.status, j: j as any }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until<T>(label: string, f: () => Promise<T | null | undefined>, ms = 180000) {
  const t0 = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('Timed out: ' + label); await sleep(700) }
}
const durOf = (f: string) => Math.round(Number(execFileSync(ffprobe.path, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString()) * 1000)

console.log('Cutline self-test against ' + BASE)
const h = await call('GET', '/health'); if (!h.j?.ok) throw new Error('server not healthy'); ok(`health, providers ${JSON.stringify(h.j.providers)}`)
const email = `test${Date.now()}@example.com`
const reg = await call('POST', '/auth/register', { email, name: 'Test', password: 'password123' }); token = reg.j.token; ok('register')
const bad = await call('POST', '/auth/login', { email, password: 'nope' }); if (bad.status !== 401) throw new Error('bad login accepted'); ok('wrong password rejected')

// 24 s clip: tone bursts with gaps of silence so silence detection has something to find
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutline-')); const src = path.join(tmp, 'test.mp4')
execFileSync(ffmpegPath as unknown as string, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=24', '-f', 'lavfi', '-i', "aevalsrc='0.4*sin(2*PI*300*t)*lt(mod(t,6),4)':s=44100:d=24", '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', src], { stdio: 'ignore' })
const file = fs.readFileSync(src)
const proj = (await call('POST', '/projects', { title: 'Self-test' })).j.project
const partSize = 256 * 1024
let up = (await call('POST', `/projects/${proj.id}/uploads`, { fileName: 'test.mp4', size: file.length, partSize })).j
const total = up.partsTotal
await call('PUT', `/uploads/${up.uploadId}/parts/0`, undefined, file.subarray(0, partSize))
up = (await call('POST', `/projects/${proj.id}/uploads`, { fileName: 'test.mp4', size: file.length, partSize })).j
if (!up.resumed || up.received.length !== 1) throw new Error('resume did not report the stored part'); ok(`resumable upload: ${total} parts, resumed with part 0 already stored`)
const early = await call('POST', `/uploads/${up.uploadId}/complete`); if (early.status !== 409) throw new Error('completed with missing parts'); ok('completing with missing parts is refused')
for (let n = 1; n < total; n++) await call('PUT', `/uploads/${up.uploadId}/parts/${n}`, undefined, file.subarray(n * partSize, (n + 1) * partSize))
await call('POST', `/uploads/${up.uploadId}/complete`)
const full = await until('indexing', async () => { const r = await call('GET', `/projects/${proj.id}`); if (r.j.project.status === 'failed') throw new Error(r.j.project.error); return r.j.project.status === 'ready' ? r.j : null })
ok(`indexed: ${full.project.duration} ms, ${full.index.words.length} ${full.index.source === 'segments' ? 'speech segments' : `words (${full.index.engine})`}, ${full.index.silences.length} silences, ${full.index.peaks.length} waveform peaks`)
const proxy = await fetch(BASE.replace('/api', '') + full.media.proxy + `&token=${token}`, { headers: { Range: 'bytes=0-1023' } })
if (proxy.status !== 206) throw new Error('proxy range request failed ' + proxy.status); ok('proxy streams with range requests')

const cut = await call('POST', `/projects/${proj.id}/ops`, { baseHead: 0, ops: [{ type: 'cut', author: 'user', label: 'Cut first second', p: { s: 0, e: 1000 } }] })
if (cut.status !== 200 || cut.j.head !== 1) throw new Error('valid cut rejected: ' + JSON.stringify(cut.j)); ok('valid op accepted (head 1)')
const invalid = await call('POST', `/projects/${proj.id}/ops`, { baseHead: 1, ops: [{ type: 'cut', author: 'agent', label: 'Out of range', p: { s: 5000, e: 999999 } }] })
if (invalid.status !== 422) throw new Error('invalid op accepted'); ok(`invalid op rejected: “${invalid.j.error}”`)
const stale = await call('POST', `/projects/${proj.id}/ops`, { baseHead: 0, ops: [{ type: 'cut', author: 'user', label: 'Stale', p: { s: 2000, e: 3000 } }] })
if (stale.status !== 409) throw new Error('stale write accepted'); ok('stale write rejected with 409 conflict')

const plan = (await call('POST', `/projects/${proj.id}/agent`, { instruction: 'Remove the long pauses' })).j
if (!plan.plan.items.length) throw new Error('agent proposed nothing'); ok(`agent (${plan.provider}) proposed ${plan.plan.items.length} cuts, −${(plan.plan.ms / 1000).toFixed(1)} s`)
const applied = await call('POST', `/projects/${proj.id}/ops`, { baseHead: plan.baseHead, ops: plan.plan.items.map((x: any) => ({ type: 'cut', author: 'agent', runId: 'run1', label: x.group, p: { s: x.s, e: x.e } })) })
if (applied.status !== 200) throw new Error('applying plan failed ' + JSON.stringify(applied.j)); ok(`plan applied as run1, head ${applied.j.head}`)
const undo = await call('PATCH', `/projects/${proj.id}/head`, { head: 1 }); if (undo.j.head !== 1) throw new Error('undo failed'); ok('undo moves head back to 1')
await call('PATCH', `/projects/${proj.id}/head`, { head: applied.j.head }); ok('redo')

const rr = (await call('POST', `/projects/${proj.id}/renders`, { targets: ['main'] })).j
const r = await until('render', async () => { const l = (await call('GET', '/renders')).j.renders.find((x: any) => x.id === rr.renders[0].id); if (l?.status === 'failed') throw new Error(l.error); return l?.status === 'ready' ? l : null })
const dl = await fetch(`${BASE}/renders/${r.id}/file?token=${token}`); const out = path.join(tmp, 'out.mp4'); fs.writeFileSync(out, Buffer.from(await dl.arrayBuffer()))
const got = durOf(out); const exp = rr.expected[0]
if (Math.abs(got - exp) > 400) throw new Error(`render length ${got} ms, expected ${exp} ms`)
ok(`rendered ${r.segmentsTotal} segments in parallel; output ${got} ms vs timeline ${exp} ms`)

/* ---------- AI provider path (run the server against src/dev/mock-ai.ts to exercise it) ---------- */
const mock = h.j.ai?.agent?.model === 'mock'
const agent = async (instruction: string) => (await call('POST', `/projects/${proj.id}/agent`, { instruction })).j
if (mock) {
  await call('PATCH', `/projects/${proj.id}/head`, { head: 1 }) // undo run1 so the LLM sees the uncut lines again
  const ix = full.index
  if (ix.source !== 'whisper' || ix.words.length < 20) throw new Error('cloud transcription did not produce words: ' + ix.source)
  ok(`cloud transcription (OpenAI-compatible API): ${ix.words.length} words, engine “${ix.engine}”`)
  const t = (await call('POST', '/ai/test')).j; if (!t.ok) throw new Error('AI test failed: ' + t.error); ok(`AI connection test ok in ${t.ms} ms`)
  const a = await agent('Clean it up and make a short')
  const names = a.plan.groups.map((g: any) => g.name)
  if (a.provider !== 'custom' || !names.includes('Earlier takes') || !names.includes('Off-topic') || a.plan.shorts.length !== 1) throw new Error('LLM plan wrong: ' + JSON.stringify({ p: a.provider, names, shorts: a.plan.shorts.length, note: a.plan.note }))
  ok(`LLM plan parsed from a fenced reply: ${names.join(', ')} + ${a.plan.shorts.length} Short, ${a.usage.input} tokens in`)
  const bad = await agent('MOCK_BAD tidy the ending')
  if (bad.provider !== 'custom' || bad.plan.adjusted < 1 || !bad.plan.items.length) throw new Error('repair round failed: ' + JSON.stringify(bad.plan))
  ok(`invalid proposals repaired in a second round (${bad.plan.adjusted} fixed, ${bad.plan.items.length} cuts)`)
  const rl = await agent('MOCK_RATELIMIT remove filler words')
  if (rl.provider !== 'rules' || !/limit/i.test(rl.plan.note ?? '') || !rl.plan.items.length) throw new Error('rate-limit fallback failed: ' + JSON.stringify(rl))
  ok(`free-tier rate limit falls back to the built-in planner: “${rl.plan.note.slice(0, 60)}…”`)
  const gb = await agent('MOCK_GARBAGE remove the pauses')
  if (gb.provider !== 'rules' || !gb.plan.items.length) throw new Error('garbage fallback failed'); ok('non-JSON model reply falls back to the built-in planner')
  const usage = (await call('GET', '/me/usage')).j
  if (usage.aiRequests < 4 || usage.aiFallbacks < 2) throw new Error('usage not tracked ' + JSON.stringify(usage)); ok(`AI usage tracked: ${usage.aiRequests} requests, ${usage.aiFallbacks} fallbacks, ${usage.aiTokensIn} tokens in`)
} else {
  const rg = await agent('cut 0:13 to 0:15')
  if (!rg.plan.groups.some((g: any) => g.name === 'Requested cuts')) throw new Error('rules did not parse a time range'); ok('built-in planner understands “cut 0:13 to 0:15”')
}

/* ---------- render options, cancel, review links ---------- */
const rid2 = (await call('POST', `/projects/${proj.id}/renders`, { targets: ['main'], resolution: '720', cleanAudio: true })).j.renders[0].id
const r2 = await until('render 2', async () => { const l = (await call('GET', '/renders')).j.renders.find((x: any) => x.id === rid2); if (l?.status === 'failed') throw new Error(l.error); return l?.status === 'ready' ? l : null })
if (!/Audio cleaned/.test(r2.note ?? '') || r2.options.resolution !== '720') throw new Error('render options not applied: ' + JSON.stringify(r2)); ok(`render options applied: 720p cap, ${r2.note}`)
const rid3 = (await call('POST', `/projects/${proj.id}/renders`, { targets: ['main'] })).j.renders[0].id
await call('POST', `/renders/${rid3}/cancel`)
await until('cancel', async () => (await call('GET', '/renders')).j.renders.find((x: any) => x.id === rid3)?.status === 'canceled' || null, 30000); ok('render cancelled')
const sh = (await call('POST', `/renders/${r.id}/share`)).j.token; if (!sh) throw new Error('no share token')
const saved = token; token = ''
const pub = (await call('GET', `/public/shares/${sh}`)).j; if (!pub.available) throw new Error('public share not available')
const vid = await fetch(`${BASE}/public/shares/${sh}/video`, { headers: { Range: 'bytes=0-99' } }); if (vid.status !== 206) throw new Error('public video ' + vid.status)
await call('POST', `/public/shares/${sh}/comments`, { author: 'Reviewer', text: 'Nice cut at the start', at: 1200 })
await call('POST', `/public/shares/${sh}/approve`, { author: 'Reviewer' })
const pub2 = (await call('GET', `/public/shares/${sh}`)).j
if (pub2.comments.length !== 1 || pub2.approvedBy !== 'Reviewer') throw new Error('comment/approve not stored')
token = saved; ok('review link plays without signing in; comment and approval stored')
await call('DELETE', `/renders/${r.id}/share`); token = ''
if ((await call('GET', `/public/shares/${sh}`)).status !== 404) throw new Error('revoked link still works'); token = saved; ok('review link revoked')

/* ---------- uploads: file type check, audio-only podcast ---------- */
const exe = await call('POST', `/projects/${proj.id}/uploads`, { fileName: 'virus.exe', size: 1000 }); if (exe.status !== 415) throw new Error('exe accepted'); ok('non-media upload refused before any bytes are sent')
const wav = path.join(tmp, 'pod.wav'); execFileSync(ffmpegPath as unknown as string, ['-y', '-f', 'lavfi', '-i', "aevalsrc='0.4*sin(2*PI*220*t)*lt(mod(t,5),3)':s=16000:d=12", wav], { stdio: 'ignore' })
const wbuf = fs.readFileSync(wav); const pod = (await call('POST', '/projects', { title: 'Podcast' })).j.project
const wu = (await call('POST', `/projects/${pod.id}/uploads`, { fileName: 'pod.wav', size: wbuf.length })).j
await call('PUT', `/uploads/${wu.uploadId}/parts/0`, undefined, wbuf); await call('POST', `/uploads/${wu.uploadId}/complete`)
await until('podcast index', async () => { const x = (await call('GET', `/projects/${pod.id}`)).j; if (x.project.status === 'failed') throw new Error(x.project.error); return x.project.status === 'ready' || null })
const pr = (await call('POST', `/projects/${pod.id}/renders`, { targets: ['main'], resolution: '720' })).j.renders[0].id
const prr = await until('podcast render', async () => { const l = (await call('GET', '/renders')).j.renders.find((x: any) => x.id === pr); if (l?.status === 'failed') throw new Error(l.error); return l?.status === 'ready' ? l : null })
const pdl = await fetch(`${BASE}/renders/${prr.id}/file?token=${token}`); const pout = path.join(tmp, 'pod.mp4'); fs.writeFileSync(pout, Buffer.from(await pdl.arrayBuffer()))
const streams = execFileSync(ffprobe.path, ['-v', 'error', '-show_entries', 'stream=codec_type,height', '-of', 'csv=p=0', pout]).toString()
if (!/video,720/.test(streams) || !/audio/.test(streams)) throw new Error('podcast render streams: ' + streams); ok('audio-only upload renders as a 720p waveform video')

/* ---------- account ---------- */
const pw = await call('POST', '/me/password', { current: 'password123', next: 'newpassword456' }); if (pw.status !== 200) throw new Error('password change failed')
if ((await call('POST', '/auth/login', { email, password: 'newpassword456' })).status !== 200) throw new Error('new password rejected'); ok('password changed')
if ((await call('DELETE', '/me', { password: 'wrong' })).status !== 403) throw new Error('deleted with wrong password')
const del = await call('DELETE', '/me', { password: 'newpassword456' }); if (del.status !== 200 || del.j.projects !== 2) throw new Error('account delete failed ' + JSON.stringify(del.j))
token = ''; if ((await call('POST', '/auth/login', { email, password: 'newpassword456' })).status !== 401) throw new Error('deleted account can still sign in')
ok('account deleted with its 2 projects')

fs.rmSync(tmp, { recursive: true, force: true })
console.log('All checks passed.')
