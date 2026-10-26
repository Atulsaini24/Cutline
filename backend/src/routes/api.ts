import express, { Router, type Response } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { checkPassword, createUser, requireUser, signToken, type AuthedRequest } from '../auth'
import { config, providerDetails, providers } from '../config'
import { db, id, json, now, type Asset, type ProjectRow } from '../db'
import { emit } from '../realtime'
import { assembleParts, dirs, ensure } from '../storage'
import { cancelWhere, enqueue, publicJob, type JobRow } from '../jobs/queue'
import { DEFAULT_RENDER_OPTIONS, publicRender, update as updateRender, type RenderOptions, type RenderRow } from '../jobs/render'
import { commitOps, loadOps, OpError } from '../ops'
import { planEdit } from '../ai/agent'
import { pingLlm } from '../ai/llm'
import { localWhisperAvailable } from '../ai/transcribe'
import { MEDIA_EXT, rateLimit, userKey } from '../security'
import { buildIndex } from '../../../shared/analysis'
import { replay, seqDur, type NewOp } from '../../../shared/timeline'
import type { RawIndex } from '../../../shared/types'

export const api = Router()
const wrap = (fn: (req: AuthedRequest, res: Response) => unknown) => async (req: any, res: Response) => {
  try { await fn(req, res) } catch (e) {
    if (e instanceof OpError) { res.status(e.status).json({ error: e.message, ...e.extra }); return }
    if (e instanceof z.ZodError) { res.status(400).json({ error: e.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }); return }
    console.error(e); if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server. Check the server log for details.' })
  }
}
const own = async (req: AuthedRequest) => {
  const p = (await db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)) as ProjectRow | undefined
  if (!p) throw new OpError(404, 'Project not found.')
  return p
}
const ownRender = async (req: AuthedRequest) => {
  const r = (await db.prepare('SELECT * FROM renders WHERE id = ? AND user_id = ?').get(req.params.rid, req.user.id)) as RenderRow | undefined
  if (!r) throw new OpError(404, 'Render not found.')
  return r
}
const count = async (sql: string, ...p: any[]) => Number(((await db.prepare(sql).get(...p)) as any)?.n ?? 0)
const mediaUrl = (pid: string, kind: string, updated: number) => `/api/projects/${pid}/media/${kind}?v=${updated}`
async function projectSummary(p: ProjectRow) {
  const asset = json<Asset>(p.asset_json, { fileName: '' })
  const raw = json<RawIndex | null>(p.index_json, null)
  const stats = raw ? buildIndex(raw).stats : null
  const opCount = await count('SELECT COUNT(*) n FROM ops WHERE project_id = ?', p.id)
  const renders = await count("SELECT COUNT(*) n FROM renders WHERE project_id = ? AND status = 'ready'", p.id)
  const job = (await db.prepare("SELECT * FROM jobs WHERE project_id = ? AND type = 'ingest' ORDER BY created_at DESC LIMIT 1").get(p.id)) as JobRow | undefined
  return { id: p.id, title: p.title, status: p.status, duration: p.duration, head: p.head, edits: opCount, renders, error: p.error, createdAt: p.created_at, updatedAt: p.updated_at,
    poster: asset.poster ? mediaUrl(p.id, 'poster', p.updated_at) : null, synthetic: !!asset.synthetic, stats, job: job ? publicJob(job) : null,
    transcript: raw ? { source: raw.source, engine: raw.engine ?? null, note: raw.note ?? null } : null,
    asset: { fileName: asset.fileName, width: asset.width, height: asset.height, fps: asset.fps, codec: asset.codec, size: asset.size, hasVideo: asset.hasVideo !== false } }
}
async function deleteProjectFiles(pid: string) {
  await db.prepare("UPDATE jobs SET status = 'canceled' WHERE project_id = ? AND status IN ('queued', 'claimed')").run(pid)
  fs.rmSync(dirs.project(pid), { recursive: true, force: true })
}

/* ---------- health + AI status ---------- */
api.get('/health', wrap(async (_req, res) => {
  const p = providers(); const ai = providerDetails()
  // report what will actually run: "local" without the package installed means speech segments
  if (p.transcribe === 'local' && !(await localWhisperAvailable())) { p.transcribe = 'none'; ai.transcribe = { ...ai.transcribe, id: 'none', model: null, configured: false } }
  res.json({ ok: true, version: '0.3.0', providers: p, ai })
}))
api.get('/ai/status', requireUser, wrap(async (_req, res) => {
  const d = providerDetails()
  res.json({ ...d, localWhisper: await localWhisperAvailable(), contextWords: config.llm.contextWords })
}))
api.post('/ai/test', requireUser, rateLimit('AI test', 6, 60_000, userKey), wrap(async (_req, res) => {
  if (config.llm.id === 'none') { res.json({ ok: false, error: 'No AI provider is configured. Add a free key to backend/.env and restart the server.' }); return }
  try { res.json(await pingLlm()) } catch (e) { res.json({ ok: false, error: (e as Error).message }) }
}))

/* ---------- auth + account ---------- */
// failed sign-ins and password checks: 10 per 15 min per IP (successful ones are free)
const authLimit = rateLimit('sign-in', 10, 15 * 60_000, undefined, { failuresOnly: true })
const registerLimit = rateLimit('sign-up', 10, 60 * 60_000)
api.post('/auth/register', registerLimit, wrap(async (req, res) => {
  const b = z.object({ email: z.string().trim().email('Enter a valid email.'), name: z.string().trim().min(1, 'Enter your name.').max(80), password: z.string().min(8, 'Use at least 8 characters.').max(200) }).parse(req.body)
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').get(b.email.toLowerCase())) throw new OpError(409, 'An account with that email already exists. Sign in instead.')
  const u = await createUser(b.email, b.name, b.password)
  res.json({ token: signToken(u), user: u })
}))
api.post('/auth/login', authLimit, wrap(async (req, res) => {
  const b = z.object({ email: z.string().trim(), password: z.string() }).parse(req.body)
  const u = await checkPassword(b.email, b.password)
  if (!u) throw new OpError(401, 'That email and password don’t match an account.')
  res.json({ token: signToken(u), user: u })
}))
api.get('/me', requireUser, wrap((req, res) => res.json({ user: req.user })))
api.patch('/me', requireUser, wrap(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(80).optional(), settings: z.object({
    aggressiveness: z.number().min(0).max(100).optional(), keepJokes: z.boolean().optional(), planFirst: z.boolean().optional(),
    captionStyle: z.enum(['clean', 'bold', 'boxed']).optional(), resolution: z.enum(['720', '1080', '4k', '2160', 'source']).optional(),
    cleanAudio: z.boolean().optional(), notify: z.boolean().optional(),
  }).optional() }).parse(req.body)
  if (b.name) await db.prepare('UPDATE users SET name = ? WHERE id = ?').run(b.name, req.user.id)
  if (b.settings) await db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify({ ...req.user.settings, ...b.settings }), req.user.id)
  res.json({ ok: true })
}))
api.post('/me/password', requireUser, authLimit, wrap(async (req, res) => {
  const b = z.object({ current: z.string(), next: z.string().min(8, 'Use at least 8 characters.').max(200) }).parse(req.body)
  if (!(await checkPassword(req.user.email, b.current))) throw new OpError(403, 'Your current password is not right.')
  await db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await bcrypt.hash(b.next, 10), req.user.id)
  res.json({ ok: true })
}))
api.delete('/me', requireUser, authLimit, wrap(async (req, res) => {
  const b = z.object({ password: z.string() }).parse(req.body ?? {})
  if (!(await checkPassword(req.user.email, b.password))) throw new OpError(403, 'Your password is not right, so nothing was deleted.')
  const pids = ((await db.prepare('SELECT id FROM projects WHERE user_id = ?').all(req.user.id)) as { id: string }[]).map(r => r.id)
  for (const pid of pids) await deleteProjectFiles(pid)
  await db.transaction(async () => {
    await db.prepare('DELETE FROM agent_runs WHERE user_id = ?').run(req.user.id)
    await db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id) // projects, ops, renders, shares cascade
  })
  res.json({ ok: true, projects: pids.length })
}))
api.get('/me/usage', requireUser, wrap(async (req, res) => {
  const since = now() - 30 * 86400_000
  const indexed = ((await db.prepare("SELECT COALESCE(SUM(duration),0) d FROM projects WHERE user_id = ? AND status = 'ready' AND created_at > ?").get(req.user.id, since)) as any).d
  const rendered = ((await db.prepare("SELECT COALESCE(SUM(duration),0) d FROM renders WHERE user_id = ? AND status IN ('ready', 'expired') AND created_at > ?").get(req.user.id, since)) as any).d
  const runs = await count("SELECT COUNT(DISTINCT o.run_id) n FROM ops o JOIN projects p ON p.id = o.project_id WHERE p.user_id = ? AND o.run_id IS NOT NULL AND o.at > ?", req.user.id, since)
  const ai = (await db.prepare('SELECT COUNT(*) n, COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o, COALESCE(AVG(ms),0) ms, COALESCE(SUM(CASE WHEN ok = 1 THEN 0 ELSE 1 END),0) fails FROM agent_runs WHERE user_id = ? AND created_at > ?').get(req.user.id, since)) as any
  res.json({ indexedMs: Number(indexed), renderedMs: Number(rendered), agentRuns: runs, aiRequests: Number(ai.n), aiTokensIn: Number(ai.i), aiTokensOut: Number(ai.o), aiAvgMs: Math.round(Number(ai.ms)), aiFallbacks: Number(ai.fails) })
}))

/* ---------- projects ---------- */
api.get('/projects', requireUser, wrap(async (req, res) => {
  const rows = (await db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id)) as ProjectRow[]
  res.json({ projects: await Promise.all(rows.map(projectSummary)) })
}))
api.post('/projects', requireUser, wrap(async (req, res) => {
  const b = z.object({ title: z.string().trim().min(1).max(140) }).parse(req.body)
  const pid = id('p_')
  await db.prepare('INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(pid, req.user.id, b.title, 'uploading', now(), now())
  const p = (await db.prepare('SELECT * FROM projects WHERE id = ?').get(pid)) as ProjectRow
  res.json({ project: await projectSummary(p) })
}))
api.get('/projects/:id', requireUser, wrap(async (req, res) => {
  const p = await own(req)
  const snaps = ((await db.prepare('SELECT id, name, version, state, created_at FROM snapshots WHERE project_id = ? ORDER BY created_at DESC').all(p.id)) as any[]).map(s => ({ id: s.id, name: s.name, v: s.version, state: JSON.parse(s.state), at: s.created_at }))
  const asset = json<Asset>(p.asset_json, { fileName: '' })
  res.json({ project: await projectSummary(p), index: json(p.index_json, null), ops: await loadOps(p.id), head: p.head, snapshots: snaps,
    media: { proxy: asset.proxy && !asset.synthetic ? mediaUrl(p.id, 'proxy', p.updated_at) : null, poster: asset.poster ? mediaUrl(p.id, 'poster', p.updated_at) : null, hasVideo: asset.hasVideo !== false } })
}))
api.patch('/projects/:id', requireUser, wrap(async (req, res) => {
  const p = await own(req); const b = z.object({ title: z.string().trim().min(1).max(140) }).parse(req.body)
  await db.prepare('UPDATE projects SET title = ?, updated_at = ? WHERE id = ?').run(b.title, now(), p.id); res.json({ ok: true })
}))
api.delete('/projects/:id', requireUser, wrap(async (req, res) => {
  const p = await own(req); await deleteProjectFiles(p.id)
  await db.prepare('DELETE FROM projects WHERE id = ?').run(p.id); res.json({ ok: true })
}))
api.get('/projects/:id/media/:kind', requireUser, wrap(async (req, res) => {
  const p = await own(req); const a = json<Asset>(p.asset_json, { fileName: '' })
  const f = req.params.kind === 'proxy' ? a.proxy : req.params.kind === 'poster' ? a.poster : undefined
  if (!f || !fs.existsSync(f)) throw new OpError(404, 'Not ready yet.')
  res.sendFile(f, { headers: { 'Cache-Control': 'private, max-age=3600' } })
}))

/* ---------- resumable uploads ---------- */
const partPath = (uid: string, n: number) => path.join(dirs.parts(uid), String(n))
const expectedSize = (u: any, n: number) => (n === u.parts_total - 1 ? u.size - n * u.part_size : u.part_size)
/** Parts on disk with the right size. The files are the source of truth, so parallel parts can't race. */
function partsOnDisk(u: any): number[] {
  const dir = dirs.parts(u.id); if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < u.parts_total)
    .filter(n => { try { return fs.statSync(partPath(u.id, n)).size === expectedSize(u, n) } catch { return false } }).sort((a, b) => a - b)
}
api.post('/projects/:id/uploads', requireUser, wrap(async (req, res) => {
  const p = await own(req)
  const b = z.object({ fileName: z.string().min(1).max(255), size: z.number().int().positive(), partSize: z.number().int().min(256 * 1024).max(64 * 1024 ** 2).optional() }).parse(req.body)
  if (b.size > config.maxUpload) throw new OpError(413, `That file is ${(b.size / 1024 ** 3).toFixed(1)} GB; the limit is ${(config.maxUpload / 1024 ** 3).toFixed(0)} GB.`)
  const ext = path.extname(b.fileName).toLowerCase()
  if (!MEDIA_EXT.includes(ext)) throw new OpError(415, `“${ext || 'no extension'}” files can’t be edited. Upload a video (MP4, MOV, MKV, WebM…) or audio (MP3, WAV, M4A…).`)
  // resume an unfinished upload of the same file instead of starting again
  const existing = (await db.prepare("SELECT * FROM uploads WHERE project_id = ? AND file_name = ? AND size = ? AND status = 'open'").get(p.id, b.fileName, b.size)) as any
  if (existing) { res.json({ uploadId: existing.id, partSize: existing.part_size, partsTotal: existing.parts_total, received: partsOnDisk(existing), resumed: true }); return }
  const partSize = b.partSize ?? config.partSize; const total = Math.ceil(b.size / partSize); const uid = id('up_')
  await db.prepare('INSERT INTO uploads (id, project_id, file_name, size, part_size, parts_total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uid, p.id, b.fileName, b.size, partSize, total, now())
  ensure(dirs.parts(uid))
  res.json({ uploadId: uid, partSize, partsTotal: total, received: [], resumed: false })
}))
const upload = async (req: AuthedRequest) => {
  const u = (await db.prepare('SELECT u.* FROM uploads u JOIN projects p ON p.id = u.project_id WHERE u.id = ? AND p.user_id = ?').get(req.params.uid, req.user.id)) as any
  if (!u) throw new OpError(404, 'Upload not found.')
  return u
}
api.get('/uploads/:uid', requireUser, wrap(async (req, res) => { const u = await upload(req); res.json({ uploadId: u.id, partSize: u.part_size, partsTotal: u.parts_total, received: partsOnDisk(u), status: u.status }) }))
api.put('/uploads/:uid/parts/:n', requireUser, express.raw({ type: '*/*', limit: 65 * 1024 ** 2 }), wrap(async (req, res) => {
  const u = await upload(req); const n = Number(req.params.n)
  if (u.status !== 'open') throw new OpError(409, 'This upload is already finished.')
  if (!Number.isInteger(n) || n < 0 || n >= u.parts_total) throw new OpError(400, 'Part number out of range.')
  const body = req.body as Buffer; const expected = expectedSize(u, n)
  if (!Buffer.isBuffer(body) || body.length !== expected) throw new OpError(400, `Part ${n} should be ${expected} bytes, got ${body?.length ?? 0}.`)
  // write then rename, so a half-written part is never counted
  const tmp = partPath(u.id, n) + '.tmp-' + Math.random().toString(36).slice(2)
  ensure(dirs.parts(u.id)); fs.writeFileSync(tmp, body); fs.renameSync(tmp, partPath(u.id, n))
  const got = partsOnDisk(u)
  await db.prepare('UPDATE uploads SET received = ? WHERE id = ?').run(JSON.stringify(got), u.id)
  res.json({ received: got.length, total: u.parts_total })
}))
api.post('/uploads/:uid/complete', requireUser, wrap(async (req, res) => {
  const u = await upload(req); const got = partsOnDisk(u)
  if (u.status === 'done') { res.json({ jobId: null, alreadyDone: true }); return }
  if (got.length !== u.parts_total) throw new OpError(409, `Still missing ${u.parts_total - got.length} part(s).`, { received: got })
  const ext = path.extname(u.file_name).toLowerCase() || '.mp4'
  const dest = path.join(ensure(dirs.project(u.project_id)), 'original' + ext)
  await db.prepare("UPDATE uploads SET status = 'done' WHERE id = ?").run(u.id)
  try { await assembleParts(u.id, u.parts_total, dest) } catch (e) { await db.prepare("UPDATE uploads SET status = 'open' WHERE id = ?").run(u.id); throw e }
  const asset: Asset = { fileName: u.file_name, original: dest, size: u.size }
  await db.prepare("UPDATE projects SET asset_json = ?, status = 'indexing', error = NULL, updated_at = ? WHERE id = ?").run(JSON.stringify(asset), now(), u.project_id)
  const jobId = await enqueue('ingest', u.project_id, { projectId: u.project_id }, 2)
  res.json({ jobId })
}))
api.post('/projects/:id/reindex', requireUser, wrap(async (req, res) => {
  const p = await own(req); const a = json<Asset>(p.asset_json, { fileName: '' })
  if (a.synthetic) throw new OpError(400, 'The sample project has no real footage to index.')
  if (!a.original || !fs.existsSync(a.original)) throw new OpError(409, 'The original upload is missing, so it can’t be indexed again. Upload the file again.')
  if (await count("SELECT COUNT(*) n FROM jobs WHERE project_id = ? AND type = 'ingest' AND status IN ('queued', 'claimed', 'running')", p.id)) throw new OpError(409, 'This project is already being indexed.')
  await db.prepare("UPDATE projects SET status = 'indexing', error = NULL, updated_at = ? WHERE id = ?").run(now(), p.id)
  res.json({ jobId: await enqueue('ingest', p.id, { projectId: p.id }, 2) })
}))

/* ---------- op log ---------- */
const opSchema = z.object({ type: z.string(), author: z.enum(['user', 'agent']), runId: z.string().max(60).nullish(), label: z.string().min(1).max(200), p: z.any() })
api.post('/projects/:id/ops', requireUser, wrap(async (req, res) => {
  const p = await own(req)
  const b = z.object({ baseHead: z.number().int().min(0), ops: z.array(opSchema).min(1).max(500), clientId: z.string().max(40).optional() }).parse(req.body)
  const out = await commitOps(p, b.baseHead, b.ops as NewOp[])
  emit(p.id, { type: 'ops', head: out.head, records: out.records, clientId: b.clientId })
  res.json(out)
}))
api.patch('/projects/:id/head', requireUser, wrap(async (req, res) => {
  const p = await own(req); const b = z.object({ head: z.number().int().min(0), clientId: z.string().optional() }).parse(req.body)
  if (b.head > await count('SELECT COUNT(*) n FROM ops WHERE project_id = ?', p.id)) throw new OpError(400, 'Version does not exist.')
  await db.prepare('UPDATE projects SET head = ?, updated_at = ? WHERE id = ?').run(b.head, now(), p.id)
  emit(p.id, { type: 'head', head: b.head, clientId: b.clientId })
  res.json({ head: b.head })
}))
api.post('/projects/:id/snapshots', requireUser, wrap(async (req, res) => {
  const p = await own(req); const b = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body)
  const ops = await loadOps(p.id); const { state } = replay(ops, p.head, p.duration)
  const sid = id('s_'); await db.prepare('INSERT INTO snapshots (id, project_id, name, version, state, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(sid, p.id, b.name, p.head, JSON.stringify(state), now())
  res.json({ snapshot: { id: sid, name: b.name, v: p.head, state, at: now() } })
}))

/* ---------- agent ---------- */
api.post('/projects/:id/agent', requireUser, rateLimit('AI', 30, 60 * 60_000, userKey), wrap(async (req, res) => {
  const p = await own(req); const b = z.object({ instruction: z.string().trim().min(1).max(2000), requestId: z.string().max(40).optional() }).parse(req.body)
  const raw = json<RawIndex | null>(p.index_json, null); if (!raw) throw new OpError(409, 'This project is still being indexed.')
  const ix = buildIndex(raw); const ops = (await loadOps(p.id)).slice(0, p.head); const { state } = replay(ops, ops.length, p.duration)
  const s = req.user.settings as any
  const t0 = Date.now()
  const out = await planEdit(ix, state, ops, b.instruction, { aggressiveness: s.aggressiveness, keepJokes: s.keepJokes }, step => emit(p.id, { type: 'agent.step', requestId: b.requestId, step }))
  const ms = Date.now() - t0
  await db.prepare('INSERT INTO agent_runs (id, user_id, project_id, provider, model, instruction, input_tokens, output_tokens, ms, ok, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id('ar_'), req.user.id, p.id, out.provider, out.model, b.instruction.slice(0, 500), out.usage?.input ?? 0, out.usage?.output ?? 0, ms, out.error ? 0 : 1, out.error ?? null, now())
  res.json({ plan: out.plan, baseHead: p.head, ms, provider: out.provider, model: out.model, usage: out.usage })
}))

/* ---------- renders ---------- */
const resolutionFrom = (v: unknown): RenderOptions['resolution'] => (v === '720' ? '720' : v === '4k' || v === '2160' ? '2160' : v === 'source' ? 'source' : '1080')
api.post('/projects/:id/renders', requireUser, rateLimit('render', 40, 60 * 60_000, userKey), wrap(async (req, res) => {
  const p = await own(req)
  const b = z.object({ targets: z.array(z.string()).min(1).max(10), resolution: z.enum(['720', '1080', '2160', '4k', 'source']).optional(), cleanAudio: z.boolean().optional() }).parse(req.body)
  const s = req.user.settings as any
  const options: RenderOptions = { resolution: resolutionFrom(b.resolution ?? s.resolution ?? DEFAULT_RENDER_OPTIONS.resolution), cleanAudio: b.cleanAudio ?? !!s.cleanAudio }
  const { state } = replay(await loadOps(p.id), p.head, p.duration)
  const out: ReturnType<typeof publicRender>[] = []
  for (const t of b.targets) {
    const short = state.shorts.find(x => x.id === t)
    if (t !== 'main' && !short) throw new OpError(400, `Unknown sequence ${t}.`)
    const rid = id('r_')
    await db.prepare('INSERT INTO renders (id, project_id, user_id, target, title, kind, version, options, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(rid, p.id, req.user.id, t, t === 'main' ? 'Main edit' : short!.title, t === 'main' ? 'main' : 'short', p.head, JSON.stringify(options), now(), now())
    await enqueue('render', p.id, { renderId: rid }, 2)
    out.push(publicRender((await db.prepare('SELECT * FROM renders WHERE id = ?').get(rid)) as RenderRow))
  }
  res.json({ renders: out, expected: b.targets.map(t => t === 'main' ? seqDur(state.v1) : seqDur(state.shorts.find(x => x.id === t)!.ranges)) })
}))
api.get('/renders', requireUser, wrap(async (req, res) => {
  const rows = (await db.prepare('SELECT r.*, p.title AS project_title, s.token AS share_token, s.approved_by AS approved_by, (SELECT COUNT(*) FROM comments c WHERE c.share_token = s.token) AS comment_count FROM renders r JOIN projects p ON p.id = r.project_id LEFT JOIN shares s ON s.render_id = r.id WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 200').all(req.user.id)) as any[]
  res.json({ renders: rows.map(r => ({ ...publicRender(r), projectTitle: r.project_title, shareToken: r.share_token ?? null, approvedBy: r.approved_by ?? null, comments: Number(r.comment_count ?? 0) })) })
}))
api.get('/renders/:rid/file', requireUser, wrap(async (req, res) => {
  const r = await ownRender(req)
  if (!r.file_path || !fs.existsSync(r.file_path)) throw new OpError(404, r.status === 'expired' ? 'This render expired and its file was removed. Render it again from the editor.' : 'This render is not ready.')
  const name = `${r.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'render'}.mp4`
  if (req.query.inline) res.sendFile(r.file_path); else res.download(r.file_path, name)
}))
api.post('/renders/:rid/retry', requireUser, wrap(async (req, res) => {
  const r = await ownRender(req)
  if (['queued', 'rendering'].includes(r.status)) throw new OpError(409, 'This render is still running.')
  await db.prepare("UPDATE renders SET status = 'queued', error = NULL, progress = 0, segments_done = 0, updated_at = ? WHERE id = ?").run(now(), r.id)
  await enqueue('render', r.project_id, { renderId: r.id }, 2); res.json({ ok: true })
}))
api.post('/renders/:rid/cancel', requireUser, wrap(async (req, res) => {
  const r = await ownRender(req)
  if (!['queued', 'rendering'].includes(r.status)) throw new OpError(409, 'Only queued or running renders can be cancelled.')
  const n = await cancelWhere('render', { renderId: r.id })
  if (!n) await updateRender(r.id, { status: 'canceled' })
  res.json({ ok: true })
}))
api.delete('/renders/:rid', requireUser, wrap(async (req, res) => {
  const r = await ownRender(req)
  await cancelWhere('render', { renderId: r.id })
  fs.rmSync(path.join(dirs.renders(r.project_id), r.id), { recursive: true, force: true })
  await db.prepare('DELETE FROM renders WHERE id = ?').run(r.id); res.json({ ok: true })
}))

/* ---------- review links: private by default, public only via an unguessable token ---------- */
api.post('/renders/:rid/share', requireUser, wrap(async (req, res) => {
  const r = await ownRender(req)
  if (r.status !== 'ready') throw new OpError(409, 'Only finished renders can be shared.')
  const existing = (await db.prepare('SELECT token FROM shares WHERE render_id = ?').get(r.id)) as { token: string } | undefined
  const token = existing?.token ?? id('sh_') + id('')
  if (!existing) await db.prepare('INSERT INTO shares (token, render_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(token, r.id, req.user.id, now())
  res.json({ token })
}))
api.delete('/renders/:rid/share', requireUser, wrap(async (req, res) => {
  const r = await ownRender(req); await db.prepare('DELETE FROM shares WHERE render_id = ?').run(r.id); res.json({ ok: true })
}))
const shareByToken = async (token: string) => {
  const s = (await db.prepare('SELECT s.*, r.title, r.kind, r.duration, r.status AS render_status, r.file_path, r.created_at AS render_created, p.title AS project_title, u.name AS owner FROM shares s JOIN renders r ON r.id = s.render_id JOIN projects p ON p.id = r.project_id JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token)) as any
  if (!s) throw new OpError(404, 'This review link doesn’t exist or was turned off.')
  return s
}
const publicLimit = rateLimit('review', 30, 60_000)
api.get('/public/shares/:token', publicLimit, wrap(async (req, res) => {
  const s = await shareByToken(req.params.token)
  const comments = ((await db.prepare('SELECT id, author, at_ms, body, created_at FROM comments WHERE share_token = ? ORDER BY at_ms, created_at').all(s.token)) as any[]).map(c => ({ id: c.id, author: c.author, at: Number(c.at_ms), text: c.body, createdAt: Number(c.created_at) }))
  res.json({ title: s.title, kind: s.kind, duration: s.duration, projectTitle: s.project_title, owner: s.owner, available: s.render_status === 'ready' && !!s.file_path && fs.existsSync(s.file_path), approvedBy: s.approved_by, approvedAt: s.approved_at, comments })
}))
api.get('/public/shares/:token/video', wrap(async (req, res) => {
  const s = await shareByToken(req.params.token)
  if (s.render_status !== 'ready' || !s.file_path || !fs.existsSync(s.file_path)) throw new OpError(410, 'This video expired.')
  res.sendFile(s.file_path, { headers: { 'Cache-Control': 'private, max-age=600' } })
}))
const nameSchema = z.string().trim().min(1, 'Add your name.').max(60)
api.post('/public/shares/:token/comments', rateLimit('comment', 10, 60_000), wrap(async (req, res) => {
  const s = await shareByToken(req.params.token)
  const b = z.object({ author: nameSchema, text: z.string().trim().min(1).max(1000), at: z.number().min(0).max(24 * 3600_000) }).parse(req.body)
  if (await count('SELECT COUNT(*) n FROM comments WHERE share_token = ?', s.token) >= 500) throw new OpError(429, 'This review link has too many comments.')
  const cid = id('c_')
  await db.prepare('INSERT INTO comments (id, share_token, author, at_ms, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(cid, s.token, b.author, Math.round(b.at), b.text, now())
  res.json({ comment: { id: cid, author: b.author, at: Math.round(b.at), text: b.text, createdAt: now() } })
}))
api.post('/public/shares/:token/approve', rateLimit('approve', 10, 60_000), wrap(async (req, res) => {
  const s = await shareByToken(req.params.token)
  const b = z.object({ author: nameSchema, approved: z.boolean().default(true) }).parse(req.body)
  await db.prepare('UPDATE shares SET approved_by = ?, approved_at = ? WHERE token = ?').run(b.approved ? b.author : null, b.approved ? now() : null, s.token)
  res.json({ ok: true })
}))
