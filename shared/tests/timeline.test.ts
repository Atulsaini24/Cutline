import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyOp, initState, keptPieces, replay, seqDur, srcToTl, tlToSrc, validateOp, type NewOp, type OpRecord } from '../timeline'

let n = 0
const rec = (op: NewOp): OpRecord => ({ ...op, id: 'op' + ++n, version: n, at: 0 } as OpRecord)
const cut = (s: number, e: number, runId: string | null = null): NewOp => ({ type: 'cut', author: runId ? 'agent' : 'user', runId, label: 'cut', p: { s, e } })
const D = 10_000

test('cut removes a range and remembers who removed it', () => {
  const st = initState(D); applyOp(st, rec(cut(2000, 3000)))
  assert.deepEqual(st.v1.map(x => [x.s, x.e]), [[0, 2000], [3000, 10000]])
  assert.equal(st.removed.length, 1); assert.equal(st.removed[0].by.author, 'user')
  assert.equal(seqDur(st.v1), 9000)
})
test('restore closes the gap and rejoins clips, but deliberate splits stay split', () => {
  const st = initState(D); applyOp(st, rec(cut(2000, 3000)))
  applyOp(st, rec({ type: 'restore', author: 'user', label: 'r', p: { s: 2000, e: 3000 } }))
  assert.deepEqual(st.v1.map(x => [x.s, x.e]), [[0, 10000]])
  applyOp(st, rec({ type: 'split', author: 'user', label: 's', p: { at: 5000 } }))
  applyOp(st, rec(cut(7000, 8000))); applyOp(st, rec({ type: 'restore', author: 'user', label: 'r', p: { s: 7000, e: 8000 } }))
  assert.deepEqual(st.v1.map(x => [x.s, x.e]), [[0, 5000], [5000, 10000]])
})
test('trim shortens and extends a clip without touching neighbours', () => {
  const st = initState(D); applyOp(st, rec(cut(4000, 6000)))
  applyOp(st, rec({ type: 'trim', author: 'user', label: 't', p: { oldS: 0, oldE: 4000, s: 500, e: 4000 } }))
  assert.deepEqual(st.v1.map(x => [x.s, x.e]), [[500, 4000], [6000, 10000]])
  const err = validateOp(st, { type: 'trim', author: 'user', label: 't', p: { oldS: 500, oldE: 4000, s: 500, e: 7000 } })
  assert.match(err ?? '', /overlap/)
})
test('validation rejects bad ranges, double cuts and stale trims', () => {
  const st = initState(D)
  assert.match(validateOp(st, cut(5000, 99999)) ?? '', /outside/)
  assert.match(validateOp(st, cut(3000, 3000)) ?? '', /outside|empty/)
  applyOp(st, rec(cut(1000, 2000)))
  assert.match(validateOp(st, cut(1200, 1800)) ?? '', /already cut/)
  assert.match(validateOp(st, { type: 'trim', author: 'user', label: 't', p: { oldS: 0, oldE: 10000, s: 0, e: 9000 } }) ?? '', /no longer exists/)
  assert.match(validateOp(st, { type: 'bogus' as any, author: 'user', label: 'x', p: {} } as any) ?? '', /Unknown/)
  assert.equal(validateOp(st, cut(3000, 4000)), null)
})
test('revertRun undoes one AI run and keeps later user edits', () => {
  const log = [rec(cut(1000, 2000, 'run1')), rec(cut(3000, 4000, 'run1')), rec(cut(6000, 7000))]
  log.push(rec({ type: 'revertRun', author: 'user', label: 'rev', p: { runId: 'run1' } }))
  const { state, reverted } = replay(log, log.length, D)
  assert.ok(reverted.has('run1'))
  assert.deepEqual(state.v1.map(x => [x.s, x.e]), [[0, 6000], [7000, 10000]])
  assert.match(validateOp(state, { type: 'revertRun', author: 'user', label: 'x', p: { runId: 'nope' } }, log) ?? '', /does not exist/)
})
test('replay to an earlier cursor is undo', () => {
  const log = [rec(cut(1000, 2000)), rec(cut(3000, 4000))]
  assert.equal(seqDur(replay(log, 1, D).state.v1), 9000)
  assert.equal(seqDur(replay(log, 0, D).state.v1), 10000)
})
test('timeline/source mapping round-trips across cuts', () => {
  const st = initState(D); applyOp(st, rec(cut(2000, 5000)))
  assert.equal(srcToTl(st.v1, 6000), 3000)
  assert.equal(tlToSrc(st.v1, 3000), 6000)
  for (let t = 0; t < seqDur(st.v1); t += 250) assert.equal(srcToTl(st.v1, tlToSrc(st.v1, t)), t)
  assert.deepEqual(keptPieces(st, 1000, 6000), [{ s: 1000, e: 2000 }, { s: 5000, e: 6000 }])
})
