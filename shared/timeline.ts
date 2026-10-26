// The timeline is never edited directly. Every change, human or AI, is a typed operation in an
// append-only log; the current timeline is the result of replaying the active part of the log.
// Shared by the browser (optimistic apply) and the server (authoritative validation).
import type { Range } from './types'

export type Author = 'user' | 'agent'
export interface By { author: Author; runId: string | null; id: string; split?: boolean }
export interface Interval { s: number; e: number; leftBy: By | null }
export interface Removed { s: number; e: number; by: By }
export interface BrollClip { id: string; asset: string; anchor: number; dur: number; by?: By }
export interface Short { id: string; title: string; hook: string; score: number; ranges: Range[]; dur: number; runId?: string | null }
export type CaptionStyle = 'clean' | 'bold' | 'boxed'
export interface Marker { id: string; at: number; label: string }

export interface TimelineState {
  duration: number
  v1: Interval[]
  removed: Removed[]
  broll: BrollClip[]
  cap: { on: boolean; style: CaptionStyle; edits: Record<number, string> }
  shorts: Short[]
  markers: Marker[]
}

export type TimelineOp =
  | { type: 'cut'; p: { s: number; e: number } }
  | { type: 'deleteClip'; p: { s: number; e: number } }
  | { type: 'split'; p: { at: number } }
  | { type: 'trim'; p: { oldS: number; oldE: number; s: number; e: number } }
  | { type: 'restore'; p: { s: number; e: number } }
  | { type: 'addBroll'; p: BrollClip }
  | { type: 'removeBroll'; p: { id: string } }
  | { type: 'moveBroll'; p: { id: string; anchor: number } }
  | { type: 'captionEdit'; p: { sent: number; text: string } }
  | { type: 'captionStyle'; p: { style: CaptionStyle } }
  | { type: 'captionsOn'; p: { on: boolean } }
  | { type: 'addShorts'; p: { shorts: Short[] } }
  | { type: 'removeShort'; p: { id: string } }
  | { type: 'addMarker'; p: Marker }
  | { type: 'removeMarker'; p: { id: string } }
  | { type: 'setState'; p: { state: TimelineState } }
  | { type: 'revertRun'; p: { runId: string } }

export type OpRecord = TimelineOp & { id: string; version: number; author: Author; runId?: string | null; label: string; at: number }
export type NewOp = TimelineOp & { author: Author; runId?: string | null; label: string }

export const OP_TYPES = ['cut', 'deleteClip', 'split', 'trim', 'restore', 'addBroll', 'removeBroll', 'moveBroll', 'captionEdit', 'captionStyle', 'captionsOn', 'addShorts', 'removeShort', 'addMarker', 'removeMarker', 'setState', 'revertRun'] as const

export const initState = (duration: number): TimelineState => ({
  duration,
  v1: duration > 0 ? [{ s: 0, e: duration, leftBy: null }] : [],
  removed: [], broll: [], cap: { on: true, style: 'clean', edits: {} }, shorts: [], markers: [],
})

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o))

function cutRange(st: TimelineState, s: number, e: number, by: By) {
  const out: Interval[] = []; let did = false
  for (const iv of st.v1) {
    if (e <= iv.s || s >= iv.e) { out.push(iv); continue }
    did = true
    if (iv.s < s) out.push({ ...iv, e: s })
    if (iv.e > e) out.push({ s: e, e: iv.e, leftBy: by })
  }
  if (did) { const nx = out.find(iv => iv.s >= e); if (nx) nx.leftBy = by; st.removed.push({ s, e, by }) }
  st.v1 = out
  return did
}
function restoreRange(st: TimelineState, s: number, e: number, by: By) {
  let pieces: Range[] = [{ s, e }]
  for (const iv of st.v1) {
    const np: Range[] = []
    for (const p of pieces) { if (p.e <= iv.s || p.s >= iv.e) { np.push(p); continue } if (p.s < iv.s) np.push({ s: p.s, e: iv.s }); if (p.e > iv.e) np.push({ s: iv.e, e: p.e }) }
    pieces = np
  }
  pieces.filter(p => p.e - p.s > 20).forEach(p => st.v1.push({ s: p.s, e: p.e, leftBy: by }))
  st.v1.sort((a, b) => a.s - b.s)
  // where a restore closes a gap completely, the clips join again (deliberate splits stay split)
  const merged: Interval[] = []
  for (const iv of st.v1) {
    const L = merged[merged.length - 1]
    if (L && Math.abs(L.e - iv.s) < 2 && !iv.leftBy?.split) L.e = iv.e
    else merged.push({ ...iv })
  }
  st.v1 = merged
}

export function applyOp(st: TimelineState, op: OpRecord) {
  const by: By = { author: op.author, runId: op.runId ?? null, id: op.id }
  switch (op.type) {
    case 'cut': case 'deleteClip': cutRange(st, op.p.s, op.p.e, by); break
    case 'split': {
      const k = st.v1.findIndex(iv => iv.s < op.p.at && op.p.at < iv.e)
      if (k >= 0) { const iv = st.v1[k]; st.v1.splice(k, 1, { ...iv, e: op.p.at }, { s: op.p.at, e: iv.e, leftBy: { ...by, split: true } }) }
      break
    }
    case 'trim': {
      const { oldS, oldE, s, e } = op.p
      const iv = st.v1.find(x => x.s === oldS && x.e === oldE); if (!iv) break
      if (s > oldS) cutRange(st, oldS, s, by); else if (s < oldS) iv.s = s
      const iv2 = st.v1.find(x => x.e === oldE)
      if (iv2) { if (e < oldE) cutRange(st, e, oldE, by); else if (e > oldE) iv2.e = e }
      break
    }
    case 'restore': restoreRange(st, op.p.s, op.p.e, by); break
    case 'addBroll': st.broll.push({ ...op.p, by }); break
    case 'removeBroll': st.broll = st.broll.filter(b => b.id !== op.p.id); break
    case 'moveBroll': { const b = st.broll.find(x => x.id === op.p.id); if (b) b.anchor = op.p.anchor; break }
    case 'captionEdit': st.cap.edits[op.p.sent] = op.p.text; break
    case 'captionStyle': st.cap.style = op.p.style; break
    case 'captionsOn': st.cap.on = op.p.on; break
    case 'addShorts': op.p.shorts.forEach(x => st.shorts.push({ ...x, runId: op.runId ?? null })); break
    case 'removeShort': st.shorts = st.shorts.filter(x => x.id !== op.p.id); break
    case 'addMarker': st.markers.push(op.p); st.markers.sort((a, b) => a.at - b.at); break
    case 'removeMarker': st.markers = st.markers.filter(m => m.id !== op.p.id); break
    case 'setState': { const c = clone(op.p.state); Object.assign(st, c, { duration: st.duration }); break }
    case 'revertRun': break
  }
}

export function replay(log: OpRecord[], cursor: number, duration: number) {
  const active = log.slice(0, cursor)
  const reverted = new Set(active.filter(o => o.type === 'revertRun').map(o => (o as Extract<TimelineOp, { type: 'revertRun' }>).p.runId))
  const st = initState(duration)
  for (const op of active) { if (op.runId && reverted.has(op.runId)) continue; applyOp(st, op) }
  return { state: st, reverted }
}

/* ---------- validation: every op, especially agent ops, is checked before it lands ---------- */
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const rangeOk = (s: number, e: number, d: number) => num(s) && num(e) && s >= 0 && e <= d + 1 && s < e
export function validateOp(st: TimelineState, op: NewOp, log: OpRecord[] = []): string | null {
  const d = st.duration
  if (!OP_TYPES.includes(op.type as any)) return `Unknown operation “${op.type}”.`
  if (typeof op.label !== 'string' || !op.label) return 'Every operation needs a label.'
  switch (op.type) {
    case 'cut': case 'deleteClip': case 'restore': {
      if (!rangeOk(op.p.s, op.p.e, d)) return `Range ${op.p.s}–${op.p.e} ms is outside the recording or empty.`
      if (op.type !== 'restore' && !st.v1.some(iv => op.p.e > iv.s && op.p.s < iv.e)) return 'That range is already cut.'
      if (op.type === 'restore' && st.v1.some(iv => iv.s <= op.p.s && iv.e >= op.p.e)) return 'That range is already on the timeline.'
      return null
    }
    case 'split': return st.v1.some(iv => iv.s < op.p.at && op.p.at < iv.e) ? null : 'Split point is not inside a clip.'
    case 'trim': {
      const k = st.v1.findIndex(x => x.s === op.p.oldS && x.e === op.p.oldE)
      if (k < 0) return 'The clip being trimmed no longer exists. The timeline changed underneath.'
      if (!rangeOk(op.p.s, op.p.e, d)) return 'Trimmed clip would be empty or outside the recording.'
      const prev = st.v1[k - 1], next = st.v1[k + 1]
      if ((prev && op.p.s < prev.e) || (next && op.p.e > next.s)) return 'Trim would overlap a neighbouring clip.'
      return null
    }
    case 'addBroll': return num(op.p.anchor) && op.p.anchor >= 0 && op.p.anchor <= d && num(op.p.dur) && op.p.dur > 0 && op.p.dur < 60000 ? null : 'B-roll needs a valid position and a length under a minute.'
    case 'moveBroll': return st.broll.some(b => b.id === op.p.id) && num(op.p.anchor) && op.p.anchor >= 0 && op.p.anchor <= d ? null : 'That B-roll clip does not exist.'
    case 'removeBroll': return st.broll.some(b => b.id === op.p.id) ? null : 'That B-roll clip does not exist.'
    case 'captionEdit': return Number.isInteger(op.p.sent) && op.p.sent >= 0 && typeof op.p.text === 'string' && op.p.text.length < 500 ? null : 'Caption edit is malformed.'
    case 'captionStyle': return ['clean', 'bold', 'boxed'].includes(op.p.style) ? null : 'Unknown caption style.'
    case 'captionsOn': return typeof op.p.on === 'boolean' ? null : 'captionsOn needs true or false.'
    case 'addShorts': return Array.isArray(op.p.shorts) && op.p.shorts.every(s => s.ranges?.length && s.ranges.every(r => rangeOk(r.s, r.e, d))) ? null : 'A Short has an invalid range.'
    case 'removeShort': return st.shorts.some(s => s.id === op.p.id) ? null : 'That Short does not exist.'
    case 'addMarker': return num(op.p.at) && op.p.at >= 0 && op.p.at <= d ? null : 'Marker is outside the recording.'
    case 'removeMarker': return st.markers.some(m => m.id === op.p.id) ? null : 'That marker does not exist.'
    case 'setState': return op.p.state && Array.isArray(op.p.state.v1) && op.p.state.v1.every(iv => rangeOk(iv.s, iv.e, d)) ? null : 'Snapshot is malformed.'
    case 'revertRun': return log.some(o => o.runId === op.p.runId) ? null : 'That AI run does not exist.'
  }
  return null
}

/* ---------- sequence mapping ---------- */
export const seqDur = (r: Range[]) => r.reduce((a, iv) => a + iv.e - iv.s, 0)
export function tlToSrc(r: Range[], t: number) {
  let acc = 0
  for (const iv of r) { const d = iv.e - iv.s; if (t < acc + d) return iv.s + (t - acc); acc += d }
  const L = r[r.length - 1]; return L ? L.e - 1 : 0
}
export function srcToTl(r: Range[], ms: number) {
  let acc = 0
  for (const iv of r) { if (ms < iv.s) return acc; if (ms < iv.e) return acc + ms - iv.s; acc += iv.e - iv.s }
  return acc
}
export function keptIn(r: Range[], ms: number) {
  for (const iv of r) { if (ms >= iv.s && ms < iv.e) return true; if (iv.s > ms) return false }
  return false
}
export function removedBy(st: TimelineState, ms: number): By | null {
  for (let k = st.removed.length - 1; k >= 0; k--) { const x = st.removed[k]; if (ms >= x.s && ms < x.e) return x.by }
  return null
}
export function keptPieces(st: TimelineState, s: number, e: number) {
  const out: Range[] = []
  for (const iv of st.v1) { const a = Math.max(s, iv.s), b = Math.min(e, iv.e); if (b - a > 40) out.push({ s: a, e: b }) }
  return out
}
/** The source gap just before clip k: what was removed at that seam. */
export function gapBefore(st: TimelineState, k: number): Range | null {
  if (k <= 0 || k >= st.v1.length) return null
  const a = st.v1[k - 1].e, b = st.v1[k].s
  return b - a > 5 ? { s: a, e: b } : null
}
