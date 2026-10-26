// WebSocket hub: clients subscribe to a project and receive job progress, new ops and agent steps.
import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import { verifyToken } from './auth'
import { db } from './db'

const rooms = new Map<string, Set<WebSocket>>()
const users = new Map<string, Set<WebSocket>>()

export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', async (ws, req) => {
    const token = new URL(req.url ?? '', 'http://x').searchParams.get('token') ?? ''
    const user = await verifyToken(token)
    if (!user) { ws.close(4401, 'unauthorized'); return }
    const mine = users.get(user.id) ?? new Set(); mine.add(ws); users.set(user.id, mine)
    const joined = new Set<string>()
    ws.on('message', async raw => {
      try {
        const m = JSON.parse(String(raw))
        if (m.type === 'subscribe' && typeof m.projectId === 'string') {
          const ok = await db.prepare('SELECT 1 FROM projects WHERE id = ? AND user_id = ?').get(m.projectId, user.id)
          if (!ok) return
          const r = rooms.get(m.projectId) ?? new Set(); r.add(ws); rooms.set(m.projectId, r); joined.add(m.projectId)
        }
        if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }))
      } catch { /* ignore malformed */ }
    })
    ws.on('close', () => { joined.forEach(p => rooms.get(p)?.delete(ws)); users.get(user.id)?.delete(ws) })
  })
}
export function emit(projectId: string, event: Record<string, unknown>) {
  const msg = JSON.stringify({ ...event, projectId })
  rooms.get(projectId)?.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg) })
}
export function emitUser(userId: string, event: Record<string, unknown>) {
  const msg = JSON.stringify(event)
  users.get(userId)?.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg) })
}
