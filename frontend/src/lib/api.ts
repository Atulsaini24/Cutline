// Client for the Cutline backend: JSON requests, media URLs, resumable uploads and a WebSocket.
const BASE: string = (import.meta as any).env?.VITE_API_URL ?? '/api'
const TOKEN_KEY = 'cutline-token'
/** Absolute URL for an API path that needs no auth (public review links). */
export const apiUrl = (path: string) => BASE + path
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }
export const setToken = (t: string | null) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ } }

export class ApiError extends Error { constructor(public status: number, message: string, public data: any = {}) { super(message) } }
export async function req<T = any>(method: string, path: string, body?: unknown, opts: { signal?: AbortSignal; raw?: Blob } = {}): Promise<T> {
  const t = getToken()
  let res: Response
  try {
    res = await fetch(BASE + path, { method, signal: opts.signal, headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(opts.raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}) }, body: opts.raw ?? (body ? JSON.stringify(body) : undefined) })
  } catch (e) { if ((e as Error).name === 'AbortError') throw e; throw new ApiError(0, 'Can’t reach the Cutline server. Check that it’s running.') }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status}).`, data)
  return data as T
}
/** Media URLs carry the token as a query parameter so <video> and downloads can use them. */
export const mediaUrl = (path: string) => { const p = path.startsWith('/api') ? path.slice(4) : path; return `${BASE}${p}${p.includes('?') ? '&' : '?'}token=${encodeURIComponent(getToken() ?? '')}` }

export interface AiInfo { agent: { id: string; label: string; model: string | null; configured: boolean }; transcribe: { id: string; model: string | null; configured: boolean } }
export async function health(): Promise<{ ok: boolean; providers: { transcribe: string; agent: string }; ai?: AiInfo } | null> {
  if (location.protocol === 'file:') return null
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 1800)
  try { const r = await fetch(BASE + '/health', { signal: c.signal }); return r.ok ? await r.json() : null } catch { return null } finally { clearTimeout(t) }
}

/* ---------- realtime ---------- */
type Listener = (m: any) => void
const listeners = new Set<Listener>(); const rooms = new Set<string>()
let ws: WebSocket | null = null; let retry = 0
export const clientId = Math.random().toString(36).slice(2)
function connect() {
  const t = getToken(); if (!t || ws) return
  const url = (BASE.startsWith('http') ? BASE.replace(/^http/, 'ws').replace(/\/api$/, '') : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`) + `/ws?token=${encodeURIComponent(t)}`
  ws = new WebSocket(url)
  ws.onopen = () => { retry = 0; rooms.forEach(p => ws?.send(JSON.stringify({ type: 'subscribe', projectId: p }))) }
  ws.onmessage = e => { try { const m = JSON.parse(e.data); listeners.forEach(l => l(m)) } catch { /* ignore */ } }
  ws.onclose = () => { ws = null; if (getToken()) setTimeout(connect, Math.min(10000, 500 * 2 ** retry++)) }
}
export function subscribe(projectId: string) { rooms.add(projectId); connect(); if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'subscribe', projectId })) }
export function onEvent(l: Listener) { listeners.add(l); connect(); return () => { listeners.delete(l) } }

/* ---------- resumable upload ---------- */
export interface UploadHandle { pause: () => void; resume: () => void; dropConnection: () => void; done: Promise<string> }
export function uploadFile(projectId: string, file: File, cb: { onParts: (received: number[], total: number) => void; onStatus: (s: string, tone?: 'error' | 'ok') => void }): UploadHandle {
  let paused = false; let controllers: AbortController[] = []; let wake: (() => void) | null = null
  const key = `cutline-upload:${projectId}:${file.name}:${file.size}`
  const run = async () => {
    const init = await req<{ uploadId: string; partSize: number; partsTotal: number; received: number[]; resumed: boolean }>('POST', `/projects/${projectId}/uploads`, { fileName: file.name, size: file.size })
    try { localStorage.setItem(key, init.uploadId) } catch { /* ignore */ }
    const got = new Set(init.received); cb.onParts([...got], init.partsTotal)
    if (init.resumed) cb.onStatus(`Resuming: ${got.size} of ${init.partsTotal} parts were already stored`, 'ok')
    const sendPart = async (n: number) => {
      for (let attempt = 0; ; attempt++) {
        while (paused) await new Promise<void>(r => { wake = r })
        const c = new AbortController(); controllers.push(c)
        try {
          await req('PUT', `/uploads/${init.uploadId}/parts/${n}`, undefined, { raw: file.slice(n * init.partSize, (n + 1) * init.partSize), signal: c.signal })
          got.add(n); cb.onParts([...got], init.partsTotal); return
        } catch (e) {
          if (attempt > 6) throw e
          cb.onStatus('Connection lost. Retrying…', 'error')
          await new Promise(r => setTimeout(r, Math.min(8000, 600 * 2 ** attempt)))
          // ask the server what actually arrived before sending again
          const st = await req<{ received: number[] }>('GET', `/uploads/${init.uploadId}`).catch(() => null)
          if (st) { st.received.forEach(x => got.add(x)); cb.onParts([...got], init.partsTotal); if (got.has(n)) return; cb.onStatus(`Back online. Resumed with ${got.size} of ${init.partsTotal} parts already stored.`, 'ok') }
        } finally { controllers = controllers.filter(x => x !== c) }
      }
    }
    const queue = Array.from({ length: init.partsTotal }, (_, n) => n).filter(n => !got.has(n))
    await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) await sendPart(queue.shift()!) }))
    cb.onStatus('Assembling the file…')
    const { jobId } = await req<{ jobId: string }>('POST', `/uploads/${init.uploadId}/complete`)
    try { localStorage.removeItem(key) } catch { /* ignore */ }
    return jobId
  }
  return {
    pause: () => { paused = true }, resume: () => { paused = false; wake?.() },
    dropConnection: () => { controllers.forEach(c => c.abort()) },
    done: run(),
  }
}
/** A file picked on the Projects page, handed to the upload screen. */
export let pendingFile: File | null = null
export const setPendingFile = (f: File | null) => { pendingFile = f }
