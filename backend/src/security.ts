// Small, dependency-free protections for a public deployment.
import type { NextFunction, Request, Response } from 'express'

/** Fixed-window rate limiter kept in memory (fine for one server; use Redis when you scale out). */
export function rateLimit(name: string, max: number, windowMs: number, key: (req: Request) => string = req => req.ip ?? 'anon', opts: { failuresOnly?: boolean } = {}) {
  const hits = new Map<string, { n: number; reset: number }>()
  setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (v.reset <= t) hits.delete(k) }, Math.max(windowMs, 60_000)).unref()
  return (req: Request, res: Response, next: NextFunction) => {
    const k = key(req); const t = Date.now()
    let h = hits.get(k); if (!h || h.reset <= t) { h = { n: 0, reset: t + windowMs }; hits.set(k, h) }
    if (h.n >= max) {
      const wait = Math.ceil((h.reset - t) / 1000)
      res.setHeader('Retry-After', String(wait))
      res.status(429).json({ error: `Too many ${name} attempts. Try again in ${wait < 120 ? wait + ' s' : Math.ceil(wait / 60) + ' min'}.` })
      return
    }
    // failuresOnly: successful requests don't count, so real users never lock themselves out
    const entry = h
    if (opts.failuresOnly) res.on('finish', () => { if (res.statusCode >= 400 && res.statusCode !== 429) entry.n++ })
    else entry.n++
    res.setHeader('RateLimit-Limit', String(max)); res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.n)))
    next()
  }
}
/** Per signed-in user when we know them, else per IP. */
export const userKey = (req: Request) => (req as any).user?.id ?? req.ip ?? 'anon'

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  next()
}

/** Formats FFmpeg can index. Anything else is refused before a byte is uploaded. */
export const MEDIA_EXT = ['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.mts', '.m2ts', '.ts', '.flv', '.wmv', '.3gp', '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus']
