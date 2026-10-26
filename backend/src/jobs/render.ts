// Server-side render: the timeline is compiled into segments rendered in parallel by a worker pool,
// then joined with the concat demuxer. Failed segments retry on their own. Captions are burned in last.
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config'
import { db, json, now, type Asset, type ProjectRow } from '../db'
import { emit } from '../realtime'
import { dirs, ensure } from '../storage'
import { loudness, probe, run } from '../media/ffmpeg'
import { register, onFinalFailure, onCancel } from './queue'
import { buildIndex } from '../../../shared/analysis'
import { keptIn, replay, seqDur, srcToTl, type OpRecord } from '../../../shared/timeline'
import type { Range } from '../../../shared/types'
import type { RawIndex } from '../../../shared/types'
import { rowToOp } from '../ops'

export interface RenderRow { id: string; project_id: string; user_id: string; target: string; title: string; kind: string; version: number; status: string; progress: number; segments_total: number; segments_done: number; file_path: string | null; size: number | null; duration: number | null; note: string | null; error: string | null; created_at: number; options?: string | null }
export interface RenderOptions { resolution: '720' | '1080' | '2160' | 'source'; cleanAudio: boolean }
export const DEFAULT_RENDER_OPTIONS: RenderOptions = { resolution: '1080', cleanAudio: false }
export const renderOptions = (r: Pick<RenderRow, 'options'>): RenderOptions => ({ ...DEFAULT_RENDER_OPTIONS, ...json<Partial<RenderOptions>>(r.options ?? null, {}) })
export const expiresAt = (r: Pick<RenderRow, 'created_at'>) => r.created_at + config.renderTtlDays * 86400_000
export const publicRender = (r: RenderRow) => ({ id: r.id, projectId: r.project_id, target: r.target, title: r.title, kind: r.kind, version: r.version, status: r.status, progress: r.progress, segmentsTotal: r.segments_total, segmentsDone: r.segments_done, size: r.size, duration: r.duration, note: r.note, error: r.error, createdAt: r.created_at, options: renderOptions(r), expiresAt: r.status === 'ready' ? expiresAt(r) : null })
export const update = async (rid: string, f: Record<string, unknown>) => {
  await db.prepare(`UPDATE renders SET ${Object.keys(f).map(k => `${k} = @${k}`).join(', ')}, updated_at = @u WHERE id = @id`).run({ ...f, u: now(), id: rid })
  const r = (await db.prepare('SELECT * FROM renders WHERE id = ?').get(rid)) as RenderRow
  if (r) emit(r.project_id, { type: 'render', render: publicRender(r) })
}

const assTime = (ms: number) => { const cs = Math.round(ms / 10); const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60, c = cs % 100; return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}` }
const assEsc = (t: string) => t.replace(/[{}]/g, '').replace(/\n/g, ' ')
/** Returns the ASS header and caption events in output-timeline milliseconds. */
function buildAss(raw: RawIndex, ranges: Range[], style: string, vertical: boolean, edits: Record<number, string>) {
  const ix = buildIndex(raw)
  const W = vertical ? 1080 : 1920, H = vertical ? 1920 : 1080
  const big = style === 'bold' || vertical
  const fs_ = big ? (vertical ? 92 : 78) : 52
  const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Cap,DejaVu Sans,${fs_},&H00FFFFFF,&H004AD2FF,&H00000000,&H96000000,${big ? -1 : 0},0,0,0,100,100,0,0,${style === 'boxed' ? 3 : 1},${big ? 6 : 3},${big ? 0 : 2},2,80,80,${vertical ? 560 : 70},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`
  const lines: { a: number; b: number; text: string }[] = []
  for (const s of ix.sentences) {
    const kept = s.w.filter(w => keptIn(ranges, (w.s + w.e) / 2) && w.text !== '(speech)'); if (!kept.length) continue
    if (big) {
      for (let k = 0; k < kept.length; k += 3) {
        const chunk = kept.slice(k, k + 3)
        const a = srcToTl(ranges, chunk[0].s), b = srcToTl(ranges, chunk[chunk.length - 1].e - 1)
        // karaoke highlight: each word turns amber while it is spoken
        const text = chunk.map(w => `{\\k${Math.max(1, Math.round((w.e - w.s) / 10))}}${assEsc(w.text.replace(/[,.]$/, ''))}`).join(' ')
        lines.push({ a, b: Math.max(b, a + 300), text })
      }
    } else {
      const a = srcToTl(ranges, kept[0].s), b = srcToTl(ranges, kept[kept.length - 1].e - 1)
      lines.push({ a, b: Math.max(b, a + 500), text: assEsc(edits[s.i] ?? kept.map(w => w.text).join(' ')) })
    }
  }
  return { head, lines }
}
/** The caption events that fall inside one segment, shifted so the segment starts at zero. */
const segmentAss = (ass: ReturnType<typeof buildAss>, from: number, to: number) => ass.head + ass.lines.filter(l => l.b > from && l.a < to)
  .map(l => `Dialogue: 0,${assTime(Math.max(0, l.a - from))},${assTime(Math.min(to, l.b) - from)},Cap,,0,0,0,,${l.text}`).join('\n') + '\n'

async function pool<T>(items: T[], n: number, signal: AbortSignal, fn: (x: T, i: number) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length && !signal.aborted) { const i = next++; await fn(items[i], i) } }))
}
const pad = (i: number) => String(i).padStart(4, '0')
/** One gain for the whole render (aiming at -14 LUFS, the level YouTube and Shorts normalise to). */
const gainFor = (lufs: number | null | undefined) => (lufs == null ? 0 : Math.max(-12, Math.min(18, -14 - lufs)))

register('render', async ({ payload, progress, signal }) => {
  const r = (await db.prepare('SELECT * FROM renders WHERE id = ?').get(payload.renderId)) as RenderRow | undefined
  if (!r) return { skipped: 'render deleted' }
  if (r.status === 'canceled') return { skipped: 'canceled' }
  const p = (await db.prepare('SELECT * FROM projects WHERE id = ?').get(r.project_id)) as ProjectRow | undefined
  if (!p) return { skipped: 'project deleted' }
  const opts = renderOptions(r)
  const asset = json<Asset>(p.asset_json, { fileName: '' })
  const raw = json<RawIndex | null>(p.index_json, null)
  const src = asset.original ?? asset.demoFootage ?? asset.proxy
  if (!src || !fs.existsSync(src)) throw new Error(asset.synthetic ? 'Demo footage is still being generated. Try again in a moment.' : 'The source file is missing.')
  const ops = ((await db.prepare('SELECT * FROM ops WHERE project_id = ? AND version <= ? ORDER BY version').all(p.id, r.version)) as any[]).map(rowToOp) as OpRecord[]
  const { state } = replay(ops, ops.length, p.duration)
  const vertical = r.kind === 'short'
  const ranges = r.target === 'main' ? state.v1 : state.shorts.find(s => s.id === r.target)?.ranges
  if (!ranges?.length) throw new Error('Nothing to render: the sequence is empty.')
  // split long ranges so the work spreads across workers
  const segs: Range[] = []
  for (const iv of ranges) for (let a = iv.s; a < iv.e; a += 15000) segs.push({ s: a, e: Math.min(iv.e, a + 15000) })
  const dir = ensure(path.join(dirs.renders(p.id), r.id))
  await update(r.id, { status: 'rendering', segments_total: segs.length, segments_done: 0, progress: 0, error: null })

  const hasVideo = asset.hasVideo !== false
  const hasAudio = asset.hasAudio !== false
  const H = opts.resolution === 'source' ? 0 : Number(opts.resolution)
  const [vw, vh] = vertical ? (H && H < 1080 ? [720, 1280] : [1080, 1920]) : [0, 0]
  // video chain: crop to 9:16 for Shorts, otherwise scale down (never up) to the chosen height
  const vchain = vertical ? `crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=${vw}:${vh},setsar=1`
    : H ? `scale=-2:'min(${H},ih)',setsar=1` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1'
  // audio-only uploads (podcasts) get a waveform picture so the export is still a video
  const waveSize = vertical ? `${vw}x${vh}` : `${H ? Math.round(H * 16 / 9 / 2) * 2 : 1920}x${H || 1080}`
  let gain = 0
  if (opts.cleanAudio && hasAudio) { const lufs = asset.loudness ?? await loudness(asset.audio && fs.existsSync(asset.audio) ? asset.audio : src, signal).catch(() => null); gain = gainFor(lufs) }
  const ass = (state.cap.on || vertical) && raw && raw.source !== 'segments' ? buildAss(raw, ranges, vertical ? 'bold' : state.cap.style, vertical, state.cap.edits) : null
  let burn = !!ass; let note: string | null = null
  const offsets: number[] = []; { let acc = 0; for (const sg of segs) { offsets.push(acc); acc += sg.e - sg.s } }
  let done = 0
  await pool(segs, config.renderWorkers, signal, async (sg, i) => {
    const d = (sg.e - sg.s) / 1000; const out = `seg${pad(i)}.mp4`
    const subs = `subs${pad(i)}.ass`
    if (ass) fs.writeFileSync(path.join(dir, subs), segmentAss(ass, offsets[i], offsets[i] + sg.e - sg.s))
    const fades = `afade=t=in:d=0.012,afade=t=out:st=${Math.max(0, d - 0.012).toFixed(3)}:d=0.012`
    const achain = opts.cleanAudio ? `highpass=f=70,afftdn=nf=-25,volume=${gain.toFixed(2)}dB,alimiter=limit=0.89,${fades}` : fades
    const aout = hasAudio ? ['-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '160k'] : ['-an']
    for (let attempt = 1; ; attempt++) {
      const sub = burn ? `,subtitles=${subs}` : ''
      let args: string[]
      if (hasVideo) {
        args = ['-y', '-ss', (sg.s / 1000).toFixed(3), '-i', src, '-t', d.toFixed(3), '-vf', vchain + sub, ...(hasAudio ? ['-af', achain] : []), '-r', '30']
      } else {
        args = ['-y', '-ss', (sg.s / 1000).toFixed(3), '-i', src, '-t', d.toFixed(3), '-filter_complex',
          `[0:a]asplit[a1][a2];[a1]showwaves=s=${waveSize}:mode=cline:rate=30:colors=0xF7BE4A,format=yuv420p${sub}[v];[a2]${achain}[a]`, '-map', '[v]', '-map', '[a]']
      }
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', ...aout, out)
      try { await run('ffmpeg', args, { cwd: dir, signal }); break } catch (e) {
        if (signal.aborted) throw e
        // if caption burn-in is what failed (missing fonts), carry on without it
        if (burn && /subtitles|libass|Fontconfig|font/i.test((e as Error).message)) { burn = false; note = 'Captions could not be burned in on this machine (no fonts found); the video has no captions.'; continue }
        if (attempt >= 3) throw new Error(`Segment ${i + 1} failed 3 times: ${(e as Error).message}`)
      }
    }
    done++
    await update(r.id, { segments_done: done, progress: (done / segs.length) * 0.9 })
    progress((done / segs.length) * 0.9, `segment ${done}/${segs.length}`)
  })
  if (signal.aborted) throw new Error('Cancelled.')
  fs.writeFileSync(path.join(dir, 'list.txt'), segs.map((_, i) => `file 'seg${pad(i)}.mp4'`).join('\n'))
  const safe = (r.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 50) || 'render').replace(/\s+/g, '-')
  const finalName = `${safe}-${r.id.slice(-6)}.mp4`
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', finalName], { cwd: dir, signal })
  const final = path.join(dir, finalName)
  segs.forEach((_, i) => { fs.rmSync(path.join(dir, `seg${pad(i)}.mp4`), { force: true }); fs.rmSync(path.join(dir, `subs${pad(i)}.ass`), { force: true }) })
  fs.rmSync(path.join(dir, 'list.txt'), { force: true })
  const info = await probe(final)
  if (opts.cleanAudio && hasAudio) note = [note, `Audio cleaned and levelled (${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB).`].filter(Boolean).join(' ')
  await update(r.id, { status: 'ready', progress: 1, file_path: final, size: fs.statSync(final).size, duration: info.duration, note })
  return { file: final, expected: seqDur(ranges), duration: info.duration }
})
onFinalFailure(j => { if (j.type === 'render') void update(json<any>(j.payload, {}).renderId, { status: 'failed', error: j.error }).catch(() => {}) })
onCancel(j => {
  if (j.type !== 'render') return
  const rid = json<any>(j.payload, {}).renderId
  void (async () => {
    const r = (await db.prepare('SELECT project_id FROM renders WHERE id = ?').get(rid)) as { project_id: string } | undefined
    if (r) fs.rmSync(path.join(dirs.renders(r.project_id), rid), { recursive: true, force: true })
    await update(rid, { status: 'canceled', error: null })
  })().catch(() => {})
})

/** Delete render files past their expiry, plus abandoned upload parts. Runs hourly. */
export async function sweepStorage() {
  const cutoff = now() - config.renderTtlDays * 86400_000
  const old = (await db.prepare("SELECT * FROM renders WHERE status = 'ready' AND created_at < ?").all(cutoff)) as RenderRow[]
  for (const r of old) {
    fs.rmSync(path.join(dirs.renders(r.project_id), r.id), { recursive: true, force: true })
    await db.prepare("UPDATE renders SET status = 'expired', file_path = NULL, updated_at = ? WHERE id = ?").run(now(), r.id)
  }
  const stale = (await db.prepare("SELECT id FROM uploads WHERE status = 'open' AND created_at < ?").all(now() - 3 * 86400_000)) as { id: string }[]
  for (const u of stale) { fs.rmSync(dirs.parts(u.id), { recursive: true, force: true }); await db.prepare("UPDATE uploads SET status = 'expired' WHERE id = ?").run(u.id) }
  if (old.length || stale.length) console.log(`[sweep] removed ${old.length} expired render(s) and ${stale.length} abandoned upload(s)`)
  return { renders: old.length, uploads: stale.length }
}
