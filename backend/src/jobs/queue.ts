// Persistent job queue backed by the database (SQLite or Postgres). Jobs survive restarts, retry with
// exponential backoff, can be cancelled, and stream progress to subscribed clients.
import { db, id, json, now } from '../db'
import { config } from '../config'
import { emit } from '../realtime'
import { Cancelled } from '../media/ffmpeg'

export interface JobRow { id: string; type: string; project_id: string | null; payload: string; status: string; attempts: number; max_attempts: number; progress: number; step: string | null; error: string | null; result: string | null }
export interface JobCtx { job: JobRow; payload: any; signal: AbortSignal; progress: (p: number, step?: string) => void }
type Handler = (ctx: JobCtx) => Promise<unknown>
const handlers = new Map<string, Handler>()
const controllers = new Map<string, AbortController>()
let running = 0
let ticking = false

export const register = (type: string, h: Handler) => handlers.set(type, h)
export async function enqueue(type: string, projectId: string | null, payload: object, maxAttempts = 3) {
  const jid = id('j_')
  await db.prepare('INSERT INTO jobs (id, type, project_id, payload, max_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(jid, type, projectId, JSON.stringify(payload), maxAttempts, now(), now())
  setImmediate(() => { void tick() })
  return jid
}
export const publicJob = (j: JobRow) => ({ id: j.id, type: j.type, status: j.status, progress: j.progress, step: j.step, error: j.error, attempts: j.attempts, result: json(j.result, null), payload: json(j.payload, {}) })
function broadcast(j: JobRow) { if (j.project_id) emit(j.project_id, { type: 'job', job: publicJob(j) }) }
const get = async (jid: string) => (await db.prepare('SELECT * FROM jobs WHERE id = ?').get(jid)) as JobRow | undefined

/** Stop a job: queued jobs never start, running ones get their AbortSignal fired (FFmpeg is killed). */
export async function cancelJob(jid: string) {
  await db.prepare("UPDATE jobs SET status = 'canceled', updated_at = ? WHERE id = ? AND status IN ('queued', 'claimed', 'running')").run(now(), jid)
  controllers.get(jid)?.abort()
}
/** Cancel every unfinished job of a type whose payload matches exactly. */
export async function cancelWhere(type: string, payload: object) {
  const rows = (await db.prepare("SELECT id FROM jobs WHERE type = ? AND payload = ? AND status IN ('queued', 'claimed', 'running')").all(type, JSON.stringify(payload))) as { id: string }[]
  for (const r of rows) await cancelJob(r.id)
  return rows.length
}

async function runJob(j: JobRow) {
  running++
  const ctl = new AbortController(); controllers.set(j.id, ctl)
  try {
    await db.prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1, error = NULL, updated_at = ? WHERE id = ?").run(now(), j.id)
    const fresh0 = await get(j.id); if (fresh0) broadcast(fresh0)
    let last = 0
    const ctx: JobCtx = {
      job: j, payload: json(j.payload, {}), signal: ctl.signal,
      progress: (p, step) => {
        void (async () => {
          await db.prepare("UPDATE jobs SET progress = ?, step = COALESCE(?, step), updated_at = ? WHERE id = ? AND status = 'running'").run(Math.max(0, Math.min(1, p)), step ?? null, now(), j.id)
          if (step || Date.now() - last > 200) { last = Date.now(); const cur = await get(j.id); if (cur) broadcast(cur) }
        })().catch(() => {})
      },
    }
    try {
      const h = handlers.get(j.type); if (!h) throw new Error(`No handler for job type ${j.type}`)
      const result = await h(ctx)
      if (ctl.signal.aborted) throw new Cancelled()
      await db.prepare("UPDATE jobs SET status = 'done', progress = 1, result = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(result ?? null), now(), j.id)
    } catch (e) {
      const cur = await get(j.id)
      if (e instanceof Cancelled || ctl.signal.aborted || cur?.status === 'canceled') {
        await db.prepare("UPDATE jobs SET status = 'canceled', updated_at = ? WHERE id = ?").run(now(), j.id)
        cancelHooks.forEach(f => f({ ...(cur ?? j), status: 'canceled' }))
        return
      }
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[job ${j.type} ${j.id}] attempt ${cur?.attempts ?? 1} failed:`, msg)
      if (cur && cur.attempts < cur.max_attempts) await db.prepare("UPDATE jobs SET status = 'queued', error = ?, run_after = ?, updated_at = ? WHERE id = ?").run(msg, now() + 2000 * 2 ** cur.attempts, now(), j.id)
      else {
        await db.prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(msg, now(), j.id)
        const failed = await get(j.id)
        if (failed) failHooks.forEach(f => f(failed))
      }
    }
  } finally {
    running--; controllers.delete(j.id)
    const done = await get(j.id).catch(() => undefined)
    if (done) broadcast(done)
    setImmediate(() => { void tick() })
  }
}
const failHooks: ((j: JobRow) => void)[] = []
const cancelHooks: ((j: JobRow) => void)[] = []
export const onFinalFailure = (f: (j: JobRow) => void) => failHooks.push(f)
export const onCancel = (f: (j: JobRow) => void) => cancelHooks.push(f)

async function tick() {
  if (ticking) return // one claimer at a time, so JOB_CONCURRENCY is never exceeded
  ticking = true
  try {
    const free = config.jobConcurrency - running; if (free <= 0) return
    const rows = (await db.prepare("SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY CASE type WHEN 'ingest' THEN 0 ELSE 1 END, created_at LIMIT ?").all(now(), free)) as JobRow[]
    for (const r of rows) {
      const res = await db.prepare("UPDATE jobs SET status = 'claimed' WHERE id = ? AND status = 'queued'").run(r.id)
      if (res.changes > 0) void runJob(r)
    }
  } catch (e) { console.error('[queue] tick failed:', (e as Error).message) } finally { ticking = false }
}
export async function startQueue() {
  await db.prepare("UPDATE jobs SET status = 'queued', run_after = 0 WHERE status IN ('running', 'claimed')").run()
  setInterval(() => { void tick() }, 500)
  void tick()
}
export const queueStats = () => ({ running, concurrency: config.jobConcurrency })
