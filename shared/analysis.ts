// Turns raw word timings into sentences, filler labels and repeated-take labels.
import type { MediaIndex, RawIndex, Sentence, Speaker, Word } from './types'

const PALETTE = ['#7CC4FF', '#5FD3A1', '#F7A6C9', '#C7A6FF', '#FFB86B', '#8FE3E8']
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9']/g, '')
const FILLERS = new Set(['um', 'uh', 'erm', 'er', 'ah', 'hmm', 'mm'])

export function similarity(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0
  const A = new Set(a), B = new Set(b); let inter = 0
  A.forEach(x => { if (B.has(x)) inter++ })
  return inter / Math.min(A.size, B.size)
}

export function buildIndex(raw: RawIndex): MediaIndex {
  const words: Word[] = raw.words.map((w, i) => ({ i, text: w.text, s: Math.round(w.s), e: Math.round(Math.max(w.e, w.s + 40)), sent: 0, spk: w.spk ?? 'S1', filler: false }))
  // sentences: explicit starts, else split on end punctuation, long gaps or speaker changes
  const starts = new Set<number>(raw.sentenceStarts ?? [])
  if (!raw.sentenceStarts) words.forEach((w, i) => {
    if (i === 0) { starts.add(0); return }
    const p = words[i - 1]
    if (/[.?!]["”’]?$/.test(p.text) || w.s - p.e > 900 || w.spk !== p.spk) starts.add(i)
  })
  const sentences: Sentence[] = []
  words.forEach((w, i) => {
    if (starts.has(i) || !sentences.length) sentences.push({ i: sentences.length, spk: w.spk, tag: null, s: w.s, e: w.e, w: [] })
    const S = sentences[sentences.length - 1]; w.sent = S.i; S.w.push(w); S.e = w.e
  })
  // fillers: um/uh, "like," between commas, "you know,"
  words.forEach((w, k) => {
    const c = norm(w.text)
    if (FILLERS.has(c)) w.filler = true
    if (w.text.toLowerCase() === 'like,' && k > 0 && /,$/.test(words[k - 1].text)) w.filler = true
    if (c === 'you' && words[k + 1]?.text.toLowerCase() === 'know,') { w.filler = true; words[k + 1].filler = true }
  })
  // tags: explicit, else detect repeated takes (a line restarted right after with the same opening)
  if (raw.tags) Object.entries(raw.tags).forEach(([k, v]) => { if (sentences[+k]) sentences[+k].tag = v })
  else for (let i = 0; i < sentences.length - 1; i++) {
    const a = sentences[i].w.filter(w => !w.filler).map(w => norm(w.text)).filter(Boolean)
    const b = sentences[i + 1].w.filter(w => !w.filler).map(w => norm(w.text)).filter(Boolean)
    if (a.length < 3 || b.length < 3) continue
    const sameOpening = a.slice(0, 3).join(' ') === b.slice(0, 3).join(' ')
    if ((sameOpening && similarity(a, b) > 0.55) || (similarity(a, b) > 0.8 && a.length <= b.length + 2)) sentences[i].tag = 'retake'
  }
  const ids = [...new Set(words.map(w => w.spk))]
  const speakers: Speaker[] = raw.speakers?.length ? raw.speakers : ids.map((id, k) => ({ id, name: ids.length === 1 ? 'Speaker' : `Speaker ${k + 1}`, color: PALETTE[k % PALETTE.length] }))
  const stats = {
    speakers: speakers.length,
    shots: raw.scenes?.length ? raw.scenes.length + 1 : sentences.reduce((a, s, i) => a + (i === 0 || sentences[i - 1].spk !== s.spk ? 1 : 0), 0),
    fillers: words.filter(w => w.filler).length,
    retakes: sentences.filter(s => s.tag === 'retake').length,
    pauses: sentences.slice(1).filter((s, i) => s.s - sentences[i].e > 1500).length,
    words: words.length, lines: sentences.length,
  }
  return { ...raw, words, sentences, speakers, stats }
}
