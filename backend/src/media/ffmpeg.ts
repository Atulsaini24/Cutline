// Thin, typed wrappers around the bundled ffmpeg/ffprobe binaries.
import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'
import ffprobe from 'ffprobe-static'

const FFMPEG = (ffmpegPath as unknown as string) || 'ffmpeg'
const FFPROBE = ffprobe.path || 'ffprobe'

export class Cancelled extends Error { constructor() { super('Cancelled.') } }
export function run(bin: 'ffmpeg' | 'ffprobe', args: string[], opts: { cwd?: string; onStderr?: (s: string) => void; onStdout?: (b: Buffer) => void; durationMs?: number; onProgress?: (p: number) => void; signal?: AbortSignal } = {}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    if (opts.signal?.aborted) { reject(new Cancelled()); return }
    const p = spawn(bin === 'ffmpeg' ? FFMPEG : FFPROBE, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: opts.cwd })
    const onAbort = () => { p.kill('SIGKILL') }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    let out = '', err = ''
    p.stdout.on('data', (b: Buffer) => {
      if (opts.onStdout) opts.onStdout(b); else out += b.toString()
      if (opts.onProgress && opts.durationMs) { const m = /out_time_ms=(\d+)/.exec(b.toString()); if (m) opts.onProgress(Math.min(1, Number(m[1]) / 1000 / opts.durationMs)) }
    })
    p.stderr.on('data', (b: Buffer) => { const s = b.toString(); err += s; if (err.length > 400_000) err = err.slice(-200_000); opts.onStderr?.(s) })
    p.on('error', e => { opts.signal?.removeEventListener('abort', onAbort); reject(e) })
    p.on('close', code => { opts.signal?.removeEventListener('abort', onAbort); if (opts.signal?.aborted) { reject(new Cancelled()); return } code === 0 ? resolve({ stdout: out, stderr: err }) : reject(new Error(`${bin} exited with ${code}: ${err.split('\n').filter(Boolean).slice(-3).join(' | ')}`)) })
  })
}

export async function probe(file: string) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])
  const j = JSON.parse(stdout)
  const v = j.streams.find((s: any) => s.codec_type === 'video' && !s.disposition?.attached_pic); const a = j.streams.find((s: any) => s.codec_type === 'audio')
  const [n, d] = String(v?.avg_frame_rate || '0/1').split('/').map(Number)
  return { duration: Math.round(Number(j.format.duration || 0) * 1000), width: v?.width ?? 0, height: v?.height ?? 0, fps: d ? +(n / d).toFixed(2) : 0, codec: v?.codec_name ?? 'none', hasAudio: !!a, hasVideo: !!v }
}

export const makeProxy = (src: string, dest: string, durationMs: number, onProgress: (p: number) => void, hasVideo = true) => run('ffmpeg', [
  '-y', '-i', src, ...(hasVideo ? ['-vf', 'scale=-2:540', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-g', '15', '-pix_fmt', 'yuv420p'] : ['-vn']),
  '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', dest,
], { durationMs, onProgress })

export const makePoster = (src: string, dest: string, atMs: number) => run('ffmpeg', ['-y', '-ss', String(atMs / 1000), '-i', src, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', dest])
export const extractAudio = (src: string, dest: string) => run('ffmpeg', ['-y', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', dest])

/** Audio peaks every 50 ms, normalised to 0..1, for the waveform. */
export async function peaks(src: string): Promise<number[]> {
  const chunks: Buffer[] = []
  await run('ffmpeg', ['-i', src, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], { onStdout: b => chunks.push(b) })
  const buf = Buffer.concat(chunks); const per = 400; const out: number[] = []
  for (let i = 0; i + 1 < buf.length; i += per * 2) {
    let m = 0; for (let k = i; k < Math.min(buf.length - 1, i + per * 2); k += 2) m = Math.max(m, Math.abs(buf.readInt16LE(k)))
    out.push(m / 32768)
  }
  // a loop, not Math.max(...out): spreading 100k+ values overflows the call stack on long recordings
  let max = 0.05; for (const v of out) if (v > max) max = v
  return out.map(v => +(v / max).toFixed(3))
}

export async function silences(src: string, noiseDb = -35, minSec = 0.6) {
  const { stderr } = await run('ffmpeg', ['-i', src, '-vn', '-af', `silencedetect=noise=${noiseDb}dB:d=${minSec}`, '-f', 'null', '-'])
  const out: { s: number; e: number }[] = []; let start: number | null = null
  for (const line of stderr.split('\n')) {
    const a = /silence_start: ([\d.]+)/.exec(line); if (a) start = Number(a[1]) * 1000
    const b = /silence_end: ([\d.]+)/.exec(line); if (b && start !== null) { out.push({ s: Math.round(start), e: Math.round(Number(b[1]) * 1000) }); start = null }
  }
  return out
}

export async function scenes(src: string, threshold = 0.35) {
  const { stderr } = await run('ffmpeg', ['-i', src, '-an', '-vf', `fps=5,scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'])
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map(m => Math.round(Number(m[1]) * 1000))
}

/** Integrated loudness (LUFS) of a file's audio, measured once so every render segment gets the same gain. */
export async function loudness(src: string, signal?: AbortSignal): Promise<number | null> {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', src, '-vn', '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { signal })
  const m = /"input_i"\s*:\s*"(-?[\d.]+|-inf)"/.exec(stderr)
  if (!m || m[1] === '-inf') return null
  const v = Number(m[1]); return Number.isFinite(v) ? v : null
}
