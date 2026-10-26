export const fmt = (ms: number) => { ms = Math.max(0, ms); const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, d = Math.floor(ms / 100) % 10; return `${m}:${String(s).padStart(2, '0')}.${d}` }
export const fmtShort = (ms: number) => { const t = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` }
export const secs = (ms: number) => (ms / 1000).toFixed(1) + ' s'
export const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o))
