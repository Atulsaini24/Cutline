import type { NextFunction, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { config } from './config'
import { db, id, json, now } from './db'

export interface User { id: string; email: string; name: string; settings: Record<string, unknown> }
export type AuthedRequest = Request & { user: User }

export function signToken(u: { id: string }) { return jwt.sign({ sub: u.id }, config.jwtSecret, { expiresIn: '30d' }) }
export async function verifyToken(token: string): Promise<User | null> {
  try {
    const p = jwt.verify(token, config.jwtSecret) as { sub: string }
    const row = (await db.prepare('SELECT id, email, name, settings FROM users WHERE id = ?').get(p.sub)) as any
    return row ? { ...row, settings: json(row.settings, {}) } : null
  } catch { return null }
}
/** Bearer header for API calls; ?token= for media URLs used in <video> and downloads. */
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization
  const token = h?.startsWith('Bearer ') ? h.slice(7) : typeof req.query.token === 'string' ? req.query.token : ''
  const u = token ? await verifyToken(token) : null
  if (!u) { res.status(401).json({ error: 'Sign in to continue.' }); return }
  ;(req as AuthedRequest).user = u
  next()
}
export async function createUser(email: string, name: string, password: string) {
  const uid = id('u_')
  await db.prepare('INSERT INTO users (id, email, name, pass_hash, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uid, email.toLowerCase(), name, await bcrypt.hash(password, 10), JSON.stringify({ captionStyle: 'bold', aggressiveness: 60, keepJokes: true, planFirst: true, resolution: '1080' }), now())
  return (await verifyToken(signToken({ id: uid })))!
}
export async function checkPassword(email: string, password: string) {
  const row = (await db.prepare('SELECT id, pass_hash FROM users WHERE email = ?').get(email.toLowerCase())) as { id: string; pass_hash: string } | undefined
  if (!row || !(await bcrypt.compare(password, row.pass_hash))) return null
  return await verifyToken(signToken({ id: row.id }))
}
