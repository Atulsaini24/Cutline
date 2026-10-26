// Speech to text, all free:
//   groq   - Whisper large-v3-turbo on Groq's free tier (fast, accurate, needs a free key)
//   local  - Whisper running inside this server with transformers.js (no account, no internet after
//            the first model download; slower on a laptop CPU)
//   custom - any OpenAI-compatible /audio/transcriptions server (e.g. a self-hosted faster-whisper)
// If a cloud provider fails, local Whisper is tried; if that's unavailable, the transcript falls back
// to stretches of speech found between silences, so the editor always opens.
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config'
import { run } from '../media/ffmpeg'
import type { RawIndex, Range } from '../../../shared/types'

type Words = RawIndex['words']
export interface TranscriptResult { words: Words; source: RawIndex['source']; engine: string; note?: string }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/* ---------------- cloud: OpenAI-compatible (Groq free tier, or your own server) ---------------- */
async function cloudChunk(file: string, offsetMs: number): Promise<Words> {
  const form = new FormData()
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'audio/mpeg' }), path.basename(file))
  form.append('model', config.stt.model)
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  form.append('timestamp_granularities[]', 'segment')
  if (config.stt.language) form.append('language', config.stt.language)
  const url = config.stt.baseUrl.replace(/\/+$/, '') + '/audio/transcriptions'
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: config.stt.apiKey ? { Authorization: `Bearer ${config.stt.apiKey}` } : {}, body: form })
    if (res.ok) {
      const j = await res.json() as { words?: { word: string; start: number; end: number }[]; segments?: { start: number; end: number; text: string }[] }
      const words = (j.words ?? []).map(w => ({ text: w.word.trim(), s: Math.round(w.start * 1000) + offsetMs, e: Math.round(w.end * 1000) + offsetMs })).filter(w => w.text)
      // Word timestamps come without punctuation; recover it from the segment text when token counts line up.
      for (const seg of j.segments ?? []) {
        const s = seg.start * 1000 + offsetMs - 30, e = seg.end * 1000 + offsetMs + 30
        const inSeg = words.filter(w => w.s >= s && w.e <= e)
        const toks = seg.text.trim().split(/\s+/)
        if (toks.length === inSeg.length) inSeg.forEach((w, k) => { w.text = toks[k] })
        else if (inSeg.length) { const L = inSeg[inSeg.length - 1]; if (!/[.?!]$/.test(L.text)) L.text += '.' }
      }
      return words
    }
    const body = (await res.text()).slice(0, 300)
    if (res.status === 401 || res.status === 403) throw new Error(`Transcription key rejected (${res.status}). Check GROQ_API_KEY.`)
    // free-tier rate limit: wait as long as the server asks (up to a minute), a few times
    if (res.status === 429 && attempt < 5) { const ra = Number(res.headers.get('retry-after')); await sleep(Math.min(60, Number.isFinite(ra) && ra > 0 ? ra : 10 * attempt) * 1000); continue }
    if (res.status >= 500 && attempt < 3) { await sleep(1500 * attempt); continue }
    throw new Error(`Transcription service returned ${res.status}: ${body}`)
  }
}
async function transcribeCloud(audioFile: string, workDir: string, onProgress: (p: number) => void): Promise<Words> {
  const dir = path.join(workDir, 'chunks'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
  // Free tiers accept up to 25 MB per request: 10-minute chunks of 48 kbps mono are ~3.6 MB.
  await run('ffmpeg', ['-y', '-i', audioFile, '-f', 'segment', '-segment_time', '600', '-c', 'copy', path.join(dir, 'c%03d.mp3')])
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp3')).sort()
  const words: Words = []
  try {
    for (let k = 0; k < files.length; k++) { words.push(...await cloudChunk(path.join(dir, files[k]), k * 600_000)); onProgress((k + 1) / files.length) }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  return words
}

/* ---------------- local: Whisper via transformers.js (optional dependency) ---------------- */
let localPipe: Promise<any> | null = null
export async function localWhisperAvailable() {
  try { await import(/* @vite-ignore */ '@huggingface/transformers' as string); return true } catch { return false }
}
async function getLocalPipe() {
  if (!localPipe) {
    localPipe = (async () => {
      const name = '@huggingface/transformers'
      const mod: any = await import(/* @vite-ignore */ name)
      mod.env.cacheDir = path.join(config.storageDir, 'models')
      try { return await mod.pipeline('automatic-speech-recognition', config.stt.localModel, { dtype: config.stt.localDtype }) }
      catch (e) {
        if (config.stt.localDtype === 'fp32') throw e
        console.warn(`[transcribe] ${config.stt.localDtype} model failed to load (${(e as Error).message}); trying fp32`)
        return await mod.pipeline('automatic-speech-recognition', config.stt.localModel, { dtype: 'fp32' })
      }
    })()
    localPipe.catch(() => { localPipe = null })
  }
  return localPipe
}
/** Windows of at most ~28 s that end inside a silence, so words are never split between windows. */
export function speechWindows(silences: Range[], durationMs: number, max = 28000, min = 8000) {
  const out: Range[] = []; let start = 0
  while (start < durationMs - 200) {
    const limit = Math.min(durationMs, start + max)
    let end = limit
    if (limit < durationMs) {
      const cands = silences.map(s => (s.s + s.e) / 2).filter(m => m > start + min && m < limit)
      if (cands.length) end = Math.round(cands[cands.length - 1])
    }
    // skip windows that are entirely silence (Whisper invents text for those)
    const speech = (end - start) - silences.reduce((a, s) => a + Math.max(0, Math.min(end, s.e) - Math.max(start, s.s)), 0)
    if (speech > 400) out.push({ s: start, e: end })
    start = end
  }
  return out
}
async function pcmWindow(audioFile: string, w: Range): Promise<Float32Array> {
  const chunks: Buffer[] = []
  await run('ffmpeg', ['-ss', (w.s / 1000).toFixed(3), '-t', ((w.e - w.s) / 1000).toFixed(3), '-i', audioFile, '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'], { onStdout: b => chunks.push(b) })
  const buf = Buffer.concat(chunks)
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4)))
}
async function transcribeLocal(audioFile: string, silences: Range[], durationMs: number, onProgress: (p: number) => void): Promise<Words> {
  const asr = await getLocalPipe()
  const windows = speechWindows(silences, durationMs)
  const words: Words = []
  const inSilence = (ms: number) => silences.some(s => ms > s.s + 150 && ms < s.e - 150)
  for (let k = 0; k < windows.length; k++) {
    const w = windows[k]; const audio = await pcmWindow(audioFile, w)
    const opts: Record<string, unknown> = { return_timestamps: 'word' }
    if (config.stt.language && !/\.en$/.test(config.stt.localModel)) { opts.language = config.stt.language; opts.task = 'transcribe' }
    const out = await asr(audio, opts)
    for (const c of (out?.chunks ?? []) as { text: string; timestamp: [number, number | null] }[]) {
      const text = String(c.text ?? '').trim(); if (!text) continue
      const s = Math.round(c.timestamp[0] * 1000) + w.s
      const e = Math.min(w.e, c.timestamp[1] != null ? Math.round(c.timestamp[1] * 1000) + w.s : s + 300)
      if (e <= s || inSilence((s + e) / 2)) continue // hallucinated words in silence
      words.push({ text, s, e: Math.max(e, s + 40) })
    }
    onProgress((k + 1) / windows.length)
  }
  return words
}

/* ---------------- entry point ---------------- */
export async function transcribe(audioFile: string, workDir: string, durationMs: number, silences: Range[], onProgress: (p: number) => void): Promise<TranscriptResult> {
  const notes: string[] = []
  if (config.stt.id === 'groq' || config.stt.id === 'custom') {
    try {
      const words = await transcribeCloud(audioFile, workDir, onProgress)
      if (words.length) return { words, source: 'whisper', engine: config.stt.id === 'groq' ? `Groq ${config.stt.model}` : config.stt.model }
      notes.push('The transcription service found no speech.')
    } catch (e) {
      console.warn('[transcribe] cloud failed:', (e as Error).message)
      notes.push(`Cloud transcription failed: ${(e as Error).message}`)
    }
  }
  if (config.stt.id !== 'none' && await localWhisperAvailable()) {
    try {
      onProgress(0)
      const words = await transcribeLocal(audioFile, silences, durationMs, onProgress)
      if (words.length) return { words, source: 'whisper', engine: `local ${config.stt.localModel}`, note: notes.join(' ') || undefined }
      notes.push('Local Whisper found no speech.')
    } catch (e) {
      const m = (e as Error).message
      console.warn('[transcribe] local Whisper failed:', m)
      notes.push(/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(m)
        ? `Local Whisper couldn’t download its model (${config.stt.localModel}, about 80 MB). It needs internet the first time only; check your connection and re-index.`
        : /onnxruntime|\.node|binding|dlopen/i.test(m)
          ? 'Local Whisper is installed but its ONNX runtime is missing. Run "npm rebuild onnxruntime-node" in backend/, then re-index.'
          : `Local Whisper failed: ${m}`)
    }
  } else if (config.stt.id === 'local') {
    notes.push('Local Whisper is not installed. Run "npm install @huggingface/transformers" in backend/, or add a free GROQ_API_KEY, then re-index.')
  }
  return { words: [], source: 'segments', engine: 'speech segments', note: notes.join(' ') || undefined }
}

/** Without a transcript: one entry per stretch of speech between silences. */
export function speechSegments(silences: { s: number; e: number }[], durationMs: number): Words {
  const out: Words = []; let cur = 0
  const push = (s: number, e: number) => {
    for (let a = s; a < e - 300; a += 6000) out.push({ text: '(speech)', s: a, e: Math.min(e, a + 6000) })
  }
  for (const si of silences) { if (si.s - cur > 300) push(cur, si.s); cur = si.e }
  if (durationMs - cur > 300) push(cur, durationMs)
  return out
}
