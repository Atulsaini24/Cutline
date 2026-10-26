import { db, isPostgres, now } from './db'
import { applyOp, replay, validateOp, type NewOp, type OpRecord } from '../../shared/timeline'
import type { ProjectRow } from './db'

export const rowToOp = (r: any): OpRecord => ({ id: r.id, version: r.version, author: r.author, runId: r.run_id, label: r.label, type: r.type, p: JSON.parse(r.payload), at: r.at } as OpRecord)
export const loadOps = async (pid: string) => ((await db.prepare('SELECT * FROM ops WHERE project_id = ? ORDER BY version').all(pid)) as any[]).map(rowToOp)

export class OpError extends Error { constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message) } }

/** Validate a batch against the state at `baseHead`; on success, discard any redo branch and append. */
export async function commitOps(p: ProjectRow, baseHead: number, ops: NewOp[]) {
  if (baseHead !== p.head) throw new OpError(409, 'The timeline changed in another tab or window. Reloaded the latest version.', { head: p.head })
  const log = (await loadOps(p.id)).slice(0, p.head)
  const { state, reverted } = replay(log, log.length, p.duration)
  const work = { log: [...log], state }
  const records: OpRecord[] = []
  for (const [k, op] of ops.entries()) {
    const err = validateOp(work.state, op, work.log)
    if (err) throw new OpError(422, `Edit ${k + 1} (“${op.label}”) was rejected: ${err}`, { index: k })
    const rec = { ...op, id: `op_${p.id.slice(-4)}_${p.head + k + 1}_${Math.random().toString(36).slice(2, 6)}`, version: p.head + k + 1, at: now() } as OpRecord
    work.log.push(rec); records.push(rec)
    // apply in place (O(1) per op); only a revert needs a full replay, because it rewrites history
    if (rec.type === 'revertRun') { reverted.add(rec.p.runId); work.state = replay(work.log, work.log.length, p.duration).state }
    else if (!(rec.runId && reverted.has(rec.runId))) applyOp(work.state, rec)
  }
  await db.transaction(async () => {
    // re-check inside the transaction so two simultaneous requests can't both append at the same head
    const cur = (await db.prepare(`SELECT head FROM projects WHERE id = ?${isPostgres ? ' FOR UPDATE' : ''}`).get(p.id)) as { head: number } | undefined
    if (!cur || cur.head !== p.head) throw new OpError(409, 'The timeline changed in another tab or window. Reloaded the latest version.', { head: cur?.head })
    await db.prepare('DELETE FROM ops WHERE project_id = ? AND version > ?').run(p.id, p.head)
    const ins = db.prepare('INSERT INTO ops (project_id, version, id, author, run_id, label, type, payload, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    for (const r of records) await ins.run(p.id, r.version, r.id, r.author, r.runId ?? null, r.label, r.type, JSON.stringify(r.p), r.at)
    await db.prepare('UPDATE projects SET head = ?, updated_at = ? WHERE id = ?').run(p.head + records.length, now(), p.id)
  })
  return { head: p.head + records.length, records }
}
