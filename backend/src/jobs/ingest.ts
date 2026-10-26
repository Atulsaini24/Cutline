// Indexing pipeline: probe -> proxy -> poster -> audio + peaks -> silences -> shots -> transcript.
import fs from 'node:fs'
import path from 'node:path'
import { db, json, now, type Asset, type ProjectRow } from '../db'
import { emit } from '../realtime'
import { dirs, ensure } from '../storage'
import { extractAudio, loudness, makePoster, makeProxy, peaks, probe, run, scenes, silences } from '../media/ffmpeg'
import { speechSegments, transcribe } from '../ai/transcribe'
import { onFinalFailure, register } from './queue'
import { buildIndex } from '../../../shared/analysis'
import type { RawIndex } from '../../../shared/types'

const setProject = async (pid: string, fields: Record<string, unknown>) => {
  const keys = Object.keys(fields)
  await db.prepare(`UPDATE projects SET ${keys.map(k => `${k} = @${k}`).join(', ')}, updated_at = @u WHERE id = @id`).run({ ...fields, u: now(), id: pid })
  emit(pid, { type: 'project', fields })
}

register('ingest', async ({ payload, progress, signal }) => {
  const pid: string = payload.projectId
  const p = (await db.prepare('SELECT * FROM projects WHERE id = ?').get(pid)) as ProjectRow | undefined
  if (!p) return { skipped: 'project deleted' }
  const asset = json<Asset>(p.asset_json, { fileName: 'upload' })
  const dir = ensure(dirs.project(pid)); const src = asset.original
  if (!src || !fs.existsSync(src)) throw new Error('The uploaded file is missing. Upload it again.')
  await setProject(pid, { status: 'indexing', error: null })

  progress(0.02, 'probe')
  const info = await probe(src).catch(() => { throw new Error('This file isn’t a video or audio file FFmpeg can read.') })
  if (!info.hasAudio && !info.hasVideo) throw new Error('This file has no audio or video streams.')
  if (info.duration < 1000) throw new Error('This recording is shorter than a second.')
  Object.assign(asset, { width: info.width, height: info.height, fps: info.fps, codec: info.codec, size: fs.statSync(src).size, hasAudio: info.hasAudio, hasVideo: info.hasVideo })
  await setProject(pid, { duration: info.duration, asset_json: JSON.stringify(asset) })

  const proxy = path.join(dir, 'proxy.mp4')
  await makeProxy(src, proxy, info.duration, f => progress(0.04 + f * 0.3, 'proxy'), info.hasVideo)
  asset.proxy = proxy
  if (info.hasVideo) { const poster = path.join(dir, 'poster.jpg'); await makePoster(proxy, poster, Math.min(info.duration * 0.15, 20000)).catch(() => {}); if (fs.existsSync(poster)) asset.poster = poster }
  await setProject(pid, { asset_json: JSON.stringify(asset) })

  progress(0.36, 'audio')
  let pk: number[] = [], sil: { s: number; e: number }[] = []
  if (info.hasAudio) {
    const audio = path.join(dir, 'audio.mp3'); await extractAudio(src, audio); asset.audio = audio
    pk = await peaks(audio)
    progress(0.45, 'silences'); sil = await silences(audio)
    asset.loudness = await loudness(audio, signal).catch(() => null)
  }
  progress(0.52, 'scenes')
  const sc = info.hasVideo ? await scenes(proxy).catch(() => []) : []

  progress(0.56, 'transcript')
  const t = info.hasAudio ? await transcribe(asset.audio!, dir, info.duration, sil, f => progress(0.56 + f * 0.36, 'transcript')) : { words: [], source: 'segments' as const, engine: 'none', note: 'This file has no audio track.' }
  const words = t.words.length ? t.words : speechSegments(sil, info.duration)

  progress(0.94, 'analysis')
  const raw: RawIndex = { id: pid, duration: info.duration, source: t.words.length ? t.source : 'segments', words, scenes: sc, silences: sil, peaks: pk, engine: t.engine, note: t.note }
  const ix = buildIndex(raw)
  await setProject(pid, { index_json: JSON.stringify(raw), asset_json: JSON.stringify(asset), status: 'ready' })
  progress(1, 'done')
  return { words: ix.stats.words, lines: ix.stats.lines, fillers: ix.stats.fillers, retakes: ix.stats.retakes, shots: ix.stats.shots, source: raw.source, engine: t.engine, note: t.note ?? null }
})

onFinalFailure(j => { if (j.type === 'ingest' && j.project_id) void setProject(j.project_id, { status: 'failed', error: j.error }) })

/** The sample project has no real footage; generate a test-pattern video with a running clock so renders are checkable. */
register('demo-footage', async ({ payload, progress }) => {
  const pid: string = payload.projectId
  const p = (await db.prepare('SELECT * FROM projects WHERE id = ?').get(pid)) as ProjectRow | undefined
  if (!p) return
  const asset = json<Asset>(p.asset_json, { fileName: 'sample' })
  const out = path.join(ensure(dirs.project(pid)), 'demo-footage.mp4')
  const d = (p.duration / 1000).toFixed(2)
  await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${d}`, '-f', 'lavfi', '-i', `aevalsrc='0.15*sin(2*PI*220*t)*lt(mod(t,4),3)':s=48000:d=${d}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-progress', 'pipe:1', '-nostats', out],
    { durationMs: p.duration, onProgress: f => progress(f, 'demo footage') })
  asset.demoFootage = out; asset.hasAudio = true
  await setProject(pid, { asset_json: JSON.stringify(asset) })
})
