// The media index the editor is working on. Arrays are mutated in place by loadIndex(), so every
// module that imported WORDS/SENTS sees the current project. Starts with the built-in sample episode.
import { buildIndex } from '../../../shared/analysis'
import { buildSampleRaw, sampleHash } from '../../../shared/sample'
import type { MediaIndex, RawIndex, Sentence, Word } from '../../../shared/types'
export type { Word, Sentence } from '../../../shared/types'
export type SpeakerId = string

export const WORDS: Word[] = []
export const SENTS: Sentence[] = []
export const SPEAKERS: Record<string, { name: string; color: string }> = {}
export const STATS = { speakers: 0, shots: 0, fillers: 0, retakes: 0, pauses: 0, words: 0, lines: 0 }
export let SRC_DUR = 0
export let INDEX: MediaIndex
export let PEAKS: number[] | null = null
export const hash = sampleHash

export function loadIndex(raw: RawIndex) {
  const ix = buildIndex(raw)
  INDEX = ix; SRC_DUR = ix.duration; PEAKS = raw.peaks?.length ? raw.peaks : null
  WORDS.length = 0; WORDS.push(...ix.words)
  SENTS.length = 0; SENTS.push(...ix.sentences)
  Object.keys(SPEAKERS).forEach(k => delete SPEAKERS[k])
  ix.speakers.forEach(s => { SPEAKERS[s.id] = { name: s.name, color: s.color } })
  Object.assign(STATS, ix.stats)
  return ix
}
export const SAMPLE_RAW = buildSampleRaw()
loadIndex(SAMPLE_RAW)
export const isSample = () => INDEX?.source === 'sample'
export const speaker = (id: string) => SPEAKERS[id] ?? { name: id, color: '#B3B9C6' }

export interface BrollAsset { id: string; name: string; dur: number }
export const BROLL: BrollAsset[] = [
  { id: 'blankets', name: 'Moving blankets on the wall', dur: 4000 },
  { id: 'mic', name: 'Mic close-up', dur: 3500 },
  { id: 'light', name: 'Soft light off the ceiling', dur: 4500 },
  { id: 'mat', name: 'Foam mat under the keyboard', dur: 3000 },
]

export function wordIdxAt(ms: number) {
  let lo = 0, hi = WORDS.length - 1, ans = -1
  while (lo <= hi) { const m = (lo + hi) >> 1; if (WORDS[m].s <= ms) { ans = m; lo = m + 1 } else hi = m - 1 }
  return ans
}
export function wordAt(ms: number): Word | null { const i = wordIdxAt(ms); return i >= 0 && ms < WORDS[i].e ? WORDS[i] : null }
export function sentAt(ms: number): Sentence { let a = SENTS[0]; for (const s of SENTS) { if (s.s <= ms) a = s; else break } return a ?? { i: 0, spk: 'S1', tag: null, s: 0, e: 0, w: [] } }
export function snippet(s: number, e: number) {
  const ws = WORDS.filter(w => w.s >= s - 5 && w.e <= e + 5).map(w => w.text)
  if (!ws.length) return 'pause'
  const txt = ws.join(' '); return txt.length > 38 ? txt.slice(0, 36) + '…' : txt
}
export function amp(ms: number) {
  if (PEAKS) { const k = Math.floor(ms / 50); return 0.04 + 0.9 * (PEAKS[k] ?? 0) }
  const w = wordAt(ms); const n = hash(Math.floor(ms / 45))
  if (w) { const env = Math.sin(Math.PI * (ms - w.s) / (w.e - w.s)); return 0.22 + 0.72 * env * (0.55 + 0.45 * n) }
  return 0.03 + 0.04 * n
}
/** Word boundaries near a source time, for snapping. */
export function nearestBoundary(ms: number, within: number) {
  const i = wordIdxAt(ms); let best: number | null = null, bd = within
  for (let k = Math.max(0, i - 2); k <= Math.min(WORDS.length - 1, i + 3); k++) for (const b of [WORDS[k].s, WORDS[k].e]) { const d = Math.abs(b - ms); if (d < bd) { bd = d; best = b } }
  return best
}
