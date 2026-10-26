// Rule-based edit planner. Used directly when no LLM is configured (or when a free tier runs out),
// and as the deterministic engine behind the LLM agent's "remove fillers / pauses / retakes" switches.
import type { MediaIndex, Range } from './types'
import { keptPieces, seqDur, type Short, type TimelineState } from './timeline'

export type Task = 'open' | 'clean' | 'shorts' | 'pauses' | 'fillers' | 'retakes'
export interface PlanItem { group: string; s: number; e: number; reason: string; on?: boolean }
export interface PlanGroup { name: string; items: PlanItem[]; ms: number }
export interface Plan { summary: string; groups: PlanGroup[]; shorts: Short[]; items: PlanItem[]; total: number; ms: number; adjusted: number; source: 'rules' | 'llm'; note?: string }
/** Creator preferences from Settings. */
export interface Prefs { aggressiveness?: number; keepJokes?: boolean }
/** What a plain-English instruction asks for, as far as rules can tell. */
export interface Intent {
  tasks: Set<Task>
  shorts: number               // how many Shorts to make (when tasks has 'shorts')
  words: string[]              // specific words or phrases to remove everywhere
  ranges: Range[]              // explicit source ranges to cut, in ms
  lastMs: number | null        // "cut the last N seconds", resolved against the duration later
  pauseMin: number | null      // "pauses longer than N seconds"
}

export const SUGGESTIONS = ['Tighten the first 15 seconds', 'Remove repeated takes and filler', 'Make three Shorts', 'Do all three']
export const GROUP_ORDER = ['Pre-roll chatter', 'Requested cuts', 'Earlier takes', 'Requested words', 'Filler words', 'Long pauses', 'Off-topic', 'Other']

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 }
const T = String.raw`(\d+:\d{1,2}(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:ms|s|secs?|seconds?|m|mins?|minutes?)?)`
/** "1:20", "80s", "1.5 min", "45" (seconds) -> ms */
export function parseTime(t: string): number | null {
  const s = t.trim().toLowerCase()
  const mm = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(s); if (mm) return Math.round((Number(mm[1]) * 60 + Number(mm[2])) * 1000)
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|secs?|seconds?|m|mins?|minutes?)?$/.exec(s); if (!m) return null
  const v = Number(m[1]); const u = m[2] ?? 's'
  return Math.round(u === 'ms' ? v : u.startsWith('m') ? v * 60000 : v * 1000)
}

export function parseIntent(text: string): Intent {
  let t = ' ' + text.toLowerCase().replace(/[’']/g, "'") + ' '
  const intent: Intent = { tasks: new Set(), shorts: 3, words: [], ranges: [], lastMs: null, pauseMin: null }
  const eat = (re: RegExp) => { t = t.replace(re, ' ') }
  // explicit time ranges: "cut from 1:20 to 1:45", "remove 0:30-0:50"
  for (const m of t.matchAll(new RegExp(String.raw`(?:from|between)?\s*${T}\s*(?:to|and|-|–|until)\s*${T}`, 'g'))) {
    if (!/\b(cut|remove|delete|drop|trim|skip|lose)\b/.test(t)) break
    const a = parseTime(m[1]), b = parseTime(m[2])
    if (a !== null && b !== null && b > a && (m[1].includes(':') || m[2].includes(':') || /[a-z]/.test(m[1] + m[2]))) { intent.ranges.push({ s: a, e: b }); eat(new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))) }
  }
  // "cut the first 30 seconds", "remove the last minute"
  const fl = new RegExp(String.raw`\b(?:cut|remove|delete|drop|trim|skip|lose)\s+(?:off\s+)?(?:the\s+)?(first|last)\s+(?:(\d+(?:\.\d+)?|${Object.keys(NUM).join('|')})\s*)?(seconds?|secs?|s|minutes?|mins?|m)\b`)
  const flm = fl.exec(t)
  if (flm) {
    const n = flm[2] ? (NUM[flm[2]] ?? Number(flm[2])) : 1
    const ms = Math.round(n * (flm[3].startsWith('m') ? 60000 : 1000))
    if (flm[1] === 'first') intent.ranges.push({ s: 0, e: ms }); else intent.lastMs = ms
    eat(fl)
  }
  // specific words: remove every "basically" / cut the word actually
  for (const m of text.matchAll(/(?:remove|cut|delete|drop)\s+(?:every|all|each|any)?\s*(?:instances?\s+of\s+|mentions?\s+of\s+|the\s+words?\s+|times\s+i\s+say\s+)?["“'‘]([^"”'’]{1,40})["”'’]/gi)) intent.words.push(m[1].trim().toLowerCase())
  for (const m of t.matchAll(/\bthe\s+words?\s+([a-z][a-z'-]{1,30})\b/g)) if (!intent.words.includes(m[1])) intent.words.push(m[1])
  // "pauses longer than 2 seconds"
  const pm = /(?:pauses?|silences?|gaps?|dead air)\s+(?:that are\s+)?(?:longer|more|over|above|greater|bigger)\s+(?:than\s+)?(\d+(?:\.\d+)?)\s*(ms|s|secs?|seconds?)?/.exec(t)
  if (pm) { intent.pauseMin = Math.round(Number(pm[1]) * (pm[2] === 'ms' ? 1 : 1000)); intent.tasks.add('pauses') }
  // how many Shorts
  const sc = new RegExp(String.raw`\b(\d+|${Object.keys(NUM).join('|')})\s+(?:\w+\s+)?(?:vertical\s+)?(?:shorts|short clips?|short videos?|reels?|tiktoks?|clips|highlights?)\b`).exec(t)
  if (sc) { intent.shorts = Math.max(1, Math.min(10, NUM[sc[1]] ?? Number(sc[1]))); intent.tasks.add('shorts') }

  if (/all three|everything|do all|full clean|the works/.test(t)) { ['open', 'clean', 'shorts'].forEach(x => intent.tasks.add(x as Task)); return intent }
  if (/repeat|retake|false start|clean|tidy|polish/.test(t)) intent.tasks.add('clean')
  if (/filler|\bums?\b|\buhs?\b|\berm\b/.test(t) && !intent.tasks.has('clean')) intent.tasks.add('fillers')
  if (/pause|silence|dead air|gaps?\b|faster|pacing|speed (it )?up|snappier/.test(t) && !intent.tasks.has('clean')) intent.tasks.add('pauses')
  if (/tight|open|intro|first|hook|beginning|start/.test(t)) intent.tasks.add('open')
  if (/\bshorts\b|\ba short\b|\bshort (clip|video)s?\b|reels?|tiktoks?|vertical|highlights?/.test(t)) intent.tasks.add('shorts')
  return intent
}
/** Older callers only need the task list. */
export const parseTasks = (text: string): Set<Task> => parseIntent(text).tasks
export const intentIsEmpty = (i: Intent) => !i.tasks.size && !i.words.length && !i.ranges.length && i.lastMs === null

const JOKE = /\b(ha(ha)+|lol|lmao|\(laughs?\)|\[laughter\]|\[laughs?\])\b|😂/i
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9']/g, '')

export function fillerRanges(ix: MediaIndex, f: (si: number) => boolean) {
  const out: Range[] = []
  ix.words.forEach(w => {
    if (!w.filler || !f(w.sent)) return
    const nx = ix.words[w.i + 1]; const r = { s: w.s, e: nx && nx.sent === w.sent ? nx.s : w.e }
    const L = out[out.length - 1]; if (L && Math.abs(L.e - r.s) < 5) L.e = r.e; else out.push(r)
  })
  return out
}
export const retakeRanges = (ix: MediaIndex, f: (si: number) => boolean) =>
  ix.sentences.filter(s => s.tag === 'retake' && f(s.i) && ix.sentences[s.i + 1]).map(s => ({ s: s.s, e: ix.sentences[s.i + 1].s }))
/** Silence between sentences longer than `min`, keeping 300 ms of air before and 250 ms after. */
export function pauseRanges(ix: MediaIndex, min: number, f: (si: number) => boolean) {
  const out: Range[] = []; const S = ix.sentences
  for (let i = 1; i < S.length; i++) { const g = S[i].s - S[i - 1].e; if (g > min && f(i)) out.push({ s: S[i - 1].e + 300, e: S[i].s - 250 }) }
  return out.filter(r => r.e - r.s > 40)
}
/** Every occurrence of a word or short phrase, with the gap to the next word in the sentence. */
export function wordRanges(ix: MediaIndex, phrase: string) {
  const target = phrase.split(/\s+/).map(norm).filter(Boolean); const out: Range[] = []
  if (!target.length) return out
  for (let i = 0; i + target.length <= ix.words.length; i++) {
    if (!target.every((t, k) => norm(ix.words[i + k].text) === t)) continue
    const last = ix.words[i + target.length - 1]; const nx = ix.words[last.i + 1]
    out.push({ s: ix.words[i].s, e: nx && nx.sent === last.sent ? nx.s : last.e })
  }
  return out
}

export function makeShort(ix: MediaIndex, a: number, b: number, title: string, hook: string, score: number): Short {
  const S = ix.sentences
  let r: Range[] = [{ s: Math.max(0, S[a].s - 150), e: Math.min(ix.duration, S[b].e + 350) }]
  const sub = (s: number, e: number) => { const o: Range[] = []; r.forEach(iv => { if (e <= iv.s || s >= iv.e) { o.push(iv); return } if (iv.s < s) o.push({ s: iv.s, e: s }); if (iv.e > e) o.push({ s: e, e: iv.e }) }); r = o }
  const inR = (i: number) => i >= a && i <= b
  retakeRanges(ix, inR).forEach(x => sub(x.s, x.e))
  fillerRanges(ix, inR).forEach(x => sub(x.s, x.e))
  pauseRanges(ix, 700, i => i > a && i <= b).forEach(x => sub(x.s + 100, x.e - 50))
  r = r.filter(iv => iv.e - iv.s > 40)
  return { id: `short-${a}-${b}`, title, hook, score, ranges: r, dur: seqDur(r) }
}

const HOOK = /\b(never|always|secret|mistake|biggest|best|worst|only|nobody|everyone|cheap|free|\$?\d+|dollars?|rupees?|why|how|stop|truth|actually)\b/i
/** Score windows of consecutive sentences 20–60 s long and pick the best non-overlapping ones. */
export function findShorts(ix: MediaIndex, count = 3): Short[] {
  if (ix.shortsHints?.length) return ix.shortsHints.slice(0, count).map(h => makeShort(ix, h.a, h.b, h.title, h.hook, h.score))
  const S = ix.sentences.filter(s => s.tag !== 'retake' && s.tag !== 'preroll' && s.w.length && s.w[0].text !== '(speech)')
  // prefix sums make each window O(1), so hour-long recordings stay fast
  const hookPre = [0]; S.forEach(s => hookPre.push(hookPre[hookPre.length - 1] + (HOOK.test(s.w.map(w => w.text).join(' ')) ? 1 : 0)))
  const cands: { a: number; b: number; score: number }[] = []
  for (let i = 0; i < S.length; i++) {
    for (let j = i; j < S.length; j++) {
      const len = S[j].e - S[i].s; if (len > 60000) break; if (len < 20000) continue
      const nWords = S[j].w[S[j].w.length - 1].i - S[i].w[0].i + 1
      const density = nWords / (len / 1000)
      const hooks = hookPre[j + 1] - hookPre[i]
      const q = /\?$/.test(S[i].w[S[i].w.length - 1]?.text ?? '') ? 1 : 0
      cands.push({ a: S[i].i, b: S[j].i, score: density * 10 + hooks * 6 + q * 8 - Math.abs(len - 35000) / 4000 })
    }
  }
  cands.sort((x, y) => y.score - x.score)
  const picked: typeof cands = []
  for (const c of cands) { if (picked.length >= count) break; if (picked.some(p => !(c.b < p.a || c.a > p.b))) continue; picked.push(c) }
  const max = picked[0]?.score || 1
  return picked.sort((x, y) => x.a - y.a).map(c => {
    const first = ix.sentences[c.a].w.map(w => w.text).join(' ').replace(/[,.]$/, '')
    const title = first.length > 48 ? first.slice(0, 46) + '…' : first
    const hookS = ix.sentences.slice(c.a, c.b + 1).find(s => HOOK.test(s.w.map(w => w.text).join(' '))) ?? ix.sentences[c.a]
    return makeShort(ix, c.a, c.b, title, `“${hookS.w.map(w => w.text).join(' ')}”`, Math.round(70 + 25 * c.score / max))
  })
}

/** Thresholds that follow the "How hard to cut" slider in Settings. */
export function strength(prefs: Prefs = {}) {
  const a = prefs.aggressiveness ?? 60
  return a < 34 ? { pause: 2000, openPause: 1200, label: 'gentle' } : a < 67 ? { pause: 1500, openPause: 900, label: 'balanced' } : { pause: 800, openPause: 600, label: 'tight' }
}
const fmtT = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

/** Remove pieces already covered by earlier candidates or already cut, then group. */
export function finalizeItems(st: TimelineState, cands: PlanItem[]) {
  const covered: Range[] = []
  const subCovered = (p: Range) => {
    let ps = [p]
    covered.forEach(c => { const o: Range[] = []; ps.forEach(x => { if (c.e <= x.s || c.s >= x.e) { o.push(x); return } if (x.s < c.s) o.push({ s: x.s, e: c.s }); if (x.e > c.e) o.push({ s: c.e, e: x.e }) }); ps = o })
    return ps.filter(x => x.e - x.s > 40)
  }
  const items: PlanItem[] = []
  cands.forEach(c => keptPieces(st, c.s, c.e).forEach(p => subCovered(p).forEach(q => { items.push({ ...c, s: Math.round(q.s), e: Math.round(q.e), on: true }); covered.push(q) })))
  const groups = GROUP_ORDER.map(g => ({ name: g, items: items.filter(x => x.group === g) })).filter(g => g.items.length).map(g => ({ ...g, ms: g.items.reduce((a, x) => a + x.e - x.s, 0) }))
  return { items, groups, ms: items.reduce((a, x) => a + x.e - x.s, 0) }
}

export function buildPlan(ix: MediaIndex, st: TimelineState, what: Set<Task> | Intent, prefs: Prefs = {}): Plan {
  const intent: Intent = what instanceof Set ? { tasks: what, shorts: 3, words: [], ranges: [], lastMs: null, pauseMin: null } : what
  const { tasks } = intent
  const k = strength(prefs)
  const jokeBefore = (i: number) => !!prefs.keepJokes && i > 0 && JOKE.test(ix.sentences[i - 1]?.w.map(w => w.text).join(' ') ?? '')
  const notJoke = (si: number) => !(prefs.keepJokes && JOKE.test(ix.sentences[si]?.w.map(w => w.text).join(' ') ?? ''))
  const cands: PlanItem[] = []
  const add = (group: string, list: Range[], reason: string) => list.forEach(r => cands.push({ group, s: r.s, e: r.e, reason }))
  const openEnd = ix.sentences.findIndex(s => s.s > 20000)
  const inOpen = (i: number) => i <= (openEnd < 0 ? ix.sentences.length : openEnd)

  const ranges = [...intent.ranges]
  if (intent.lastMs) ranges.push({ s: Math.max(0, ix.duration - intent.lastMs), e: ix.duration })
  add('Requested cuts', ranges.map(r => ({ s: Math.max(0, r.s), e: Math.min(ix.duration, r.e) })).filter(r => r.e > r.s), 'You asked for this range to go')
  intent.words.forEach(w => add('Requested words', wordRanges(ix, w), `Removed “${w}” as asked`))

  if (tasks.has('open')) {
    const pre = ix.sentences.filter(s => s.tag === 'preroll'); const after = ix.sentences[(pre[pre.length - 1]?.i ?? -1) + 1]
    if (pre.length && after) add('Pre-roll chatter', [{ s: 0, e: after.s - 150 }], 'Talk before the real intro')
    else if (ix.sentences[0] && ix.sentences[0].s > 1200) add('Pre-roll chatter', [{ s: 0, e: ix.sentences[0].s - 250 }], 'Dead air before the first word')
    add('Earlier takes', retakeRanges(ix, inOpen), 'Kept the later, complete take')
    add('Filler words', fillerRanges(ix, i => inOpen(i) && notJoke(i)), 'Filler in the opening')
    add('Long pauses', pauseRanges(ix, k.openPause, i => inOpen(i) && i > 0 && !jokeBefore(i)), 'Dead air in the opening')
  }
  if (tasks.has('clean') || tasks.has('retakes')) add('Earlier takes', retakeRanges(ix, () => true), 'Kept the later, complete take')
  if (tasks.has('clean') || tasks.has('fillers')) add('Filler words', fillerRanges(ix, notJoke), 'Filler word')
  if (tasks.has('clean') || tasks.has('pauses')) {
    const min = intent.pauseMin ?? (tasks.has('clean') ? k.pause : Math.min(1200, k.pause))
    add('Long pauses', pauseRanges(ix, min, i => !jokeBefore(i)), `Pause longer than ${(min / 1000).toFixed(1)} s`)
  }

  const { items, groups, ms } = finalizeItems(st, cands)
  let shorts: Short[] = []
  if (tasks.has('shorts')) { const have = new Set(st.shorts.map(x => x.id)); shorts = findShorts(ix, intent.shorts).filter(x => !have.has(x.id)) }
  const parts: string[] = []
  if (ranges.length) parts.push(`cut ${ranges.map(r => `${fmtT(r.s)}–${fmtT(Math.min(r.e, ix.duration))}`).join(', ')}`)
  if (intent.words.length) parts.push(`remove every ${intent.words.map(w => `“${w}”`).join(' and ')}`)
  if (tasks.has('open')) parts.push('start on the real intro, drop false starts and tighten the pauses in the first 15 seconds')
  if (tasks.has('clean')) parts.push(`keep the last complete version of each repeated line, remove filler words, and shorten pauses longer than ${(k.pause / 1000).toFixed(1)} seconds`)
  if (tasks.has('retakes') && !tasks.has('clean')) parts.push('keep only the last complete take of repeated lines')
  if (tasks.has('fillers') && !tasks.has('clean')) parts.push('remove filler words like “um” and “uh”')
  if (tasks.has('pauses') && !tasks.has('clean')) parts.push(`shorten pauses longer than ${((intent.pauseMin ?? Math.min(1200, k.pause)) / 1000).toFixed(1)} seconds`)
  if (tasks.has('shorts')) parts.push(`cut ${shorts.length || 'no new'} vertical Short${shorts.length === 1 ? '' : 's'} from the strongest self-contained moments`)
  if (prefs.keepJokes && (tasks.has('clean') || tasks.has('pauses') || tasks.has('fillers'))) parts.push('leave the beats around laughs alone')
  return { summary: 'I’ll ' + parts.join('; then ') + '.', groups, shorts, items, total: items.length, ms, adjusted: 0, source: 'rules' }
}

export const RULES_HELP = 'I can tighten the opening, remove repeated takes, filler words and long pauses, cut specific words (remove every “basically”) or time ranges (cut 1:20 to 1:45, remove the first 10 seconds), and make vertical Shorts (make 5 Shorts). Connect a free AI provider in Settings to handle any instruction.'
