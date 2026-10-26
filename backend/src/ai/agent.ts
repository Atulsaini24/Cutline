// The edit agent. A free LLM (Gemini, Groq, OpenRouter or a local Ollama model) reads the transcript
// and answers in JSON: which sentences or quoted phrases to cut, which Shorts to make, and switches
// for the mechanical jobs (fillers, pauses, retakes) that deterministic code does more precisely.
// This code turns every proposal into exact millisecond ranges and validates each one against the
// timeline. Bad proposals get one repair round. If the provider is missing, rate-limited or down,
// the rule planner answers instead, so the editor never dead-ends.
import { config } from '../config'
import { chatJSON, LlmError } from './llm'
import {
  buildPlan, fillerRanges, finalizeItems, GROUP_ORDER, intentIsEmpty, makeShort, parseIntent, parseTime, pauseRanges, retakeRanges, RULES_HELP, strength,
  type Plan, type PlanItem, type Prefs,
} from '../../../shared/planner'
import { applyOp, validateOp, type OpRecord, type TimelineState, type Short } from '../../../shared/timeline'
import type { MediaIndex, Range } from '../../../shared/types'

export interface AgentResult { plan: Plan; provider: string; model: string | null; usage: { input: number; output: number } | null; llmMs: number; error?: string }

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${Math.floor(ms / 100) % 10}`
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
const LLM_GROUPS = ['Pre-roll chatter', 'Earlier takes', 'Off-topic', 'Requested cuts', 'Other']

/** Compact, numbered transcript. Already-cut words become ✂ so the model doesn't propose them again. */
export function transcriptForModel(ix: MediaIndex, st: TimelineState, budgetWords: number) {
  const kept = (ms: number) => st.v1.some(iv => ms >= iv.s && ms < iv.e)
  const lines: string[] = []; let used = 0; let shownUntil = -1
  for (const s of ix.sentences) {
    if (used + s.w.length > budgetWords && lines.length) break
    const gap = s.i > 0 ? s.s - ix.sentences[s.i - 1].e : s.s
    if (gap >= 1000) lines.push(`  (pause ${(gap / 1000).toFixed(1)}s)`)
    const parts: string[] = []
    for (const w of s.w) { if (kept((w.s + w.e) / 2)) parts.push(w.text); else if (parts[parts.length - 1] !== '✂') parts.push('✂') }
    const allCut = parts.length === 1 && parts[0] === '✂'
    const spk = ix.speakers.find(x => x.id === s.spk)?.name ?? s.spk
    const tag = allCut ? ' {already cut}' : s.tag === 'retake' ? ` {earlier take of S${s.i + 1}}` : s.tag === 'preroll' ? ' {before the intro}' : ''
    lines.push(`S${s.i} [${fmt(s.s)}] ${spk}: ${allCut ? '' : parts.join(' ')}${tag}`)
    used += s.w.length; shownUntil = s.i
  }
  const hidden = ix.sentences.length - 1 - shownUntil
  if (hidden > 0) lines.push(`… (S${shownUntil + 1}–S${ix.sentences.length - 1} not shown: transcript trimmed to fit the model's free limits)`)
  return { text: lines.join('\n'), shownUntil, truncated: hidden > 0 }
}

function systemPrompt(prefs: Prefs) {
  const k = strength(prefs)
  return `You are a careful assistant video editor. You never touch the video. You read a numbered transcript and propose edits as JSON, and a program checks every edit before the creator sees it.

Transcript format: "S12 [1:02.3] Name: words". "(pause 1.4s)" lines show silence. ✂ marks words that are already cut. {earlier take of S13} marks a false start that is repeated next. {before the intro} marks chatter before the real start.

Reply with ONE JSON object and nothing else, in this shape:
{
  "summary": "One or two plain sentences to the creator, starting with I'll",
  "removeFillers": false,
  "removeRetakes": false,
  "shortenPausesOver": null,
  "cutSentences": [ { "from": 3, "to": 4, "group": "Off-topic", "reason": "short reason" } ],
  "cutPhrases": [ { "sentence": 12, "text": "exact words copied from S12", "group": "Other", "reason": "short reason" } ],
  "cutRanges": [ { "from": "1:20", "to": "1:45", "reason": "only when the creator gives times" } ],
  "shorts": [ { "from": 30, "to": 38, "title": "catchy title", "hook": "the opening line", "score": 85 } ]
}
Field meanings:
- removeFillers: true removes every um, uh and "you know" (code finds them precisely).
- removeRetakes: true removes every sentence marked {earlier take of ...}.
- shortenPausesOver: a number of seconds (for example 1.5) to shorten every longer pause, or null.
- "group" is one of: ${LLM_GROUPS.join(', ')}.
Rules:
- Use cutSentences for whole sentences and cutPhrases for part of one sentence. Copy phrase text exactly; never paraphrase.
- Do only what the instruction asks. Use the switches instead of listing fillers or pauses one by one.
- Never cut words marked ✂ again. Keep the meaning intact.${prefs.keepJokes ? ' Keep jokes, laughter and asides that land.' : ''}
- Cutting strength is ${k.label}: when asked to tighten or clean up, shorten pauses over ${(k.pause / 1000).toFixed(1)}s.
- A Short is a self-contained 20 to 60 second stretch of consecutive sentences that opens on a strong line. Score it 0 to 100.
- If the instruction can't be done with cuts and Shorts, return empty lists and explain why in the summary.`
}

interface Proposal { summary?: string; removeFillers?: boolean; removeRetakes?: boolean; shortenPausesOver?: number | null; cutSentences?: any[]; cutPhrases?: any[]; cutRanges?: any[]; shorts?: any[] }
const arr = (x: unknown) => (Array.isArray(x) ? x : [])

function sentenceSpan(ix: MediaIndex, a: number, b: number): Range {
  const A = ix.sentences[a], B = ix.sentences[b], N = ix.sentences[b + 1]
  return { s: A.s, e: N ? Math.max(B.e, N.s - 250) : B.e }
}
/** Find the quoted words inside a sentence (or its neighbours), tolerant of punctuation and case. */
export function locatePhrase(ix: MediaIndex, sentence: number, text: string): Range | null {
  const target = String(text ?? '').split(/\s+/).map(norm).filter(Boolean); if (!target.length) return null
  for (const si of [sentence, sentence + 1, sentence - 1]) {
    const S = ix.sentences[si]; if (!S) continue
    const toks = S.w.map(w => norm(w.text))
    for (let i = 0; i + target.length <= toks.length; i++) {
      if (!target.every((t, k) => toks[i + k] === t)) continue
      if (i === 0 && i + target.length === toks.length) return sentenceSpan(ix, si, si)
      const first = S.w[i], last = S.w[i + target.length - 1], nx = ix.words[last.i + 1]
      return { s: first.s, e: nx && nx.sent === last.sent ? nx.s : last.e }
    }
  }
  return null
}

export function toPlan(ix: MediaIndex, st: TimelineState, log: OpRecord[], input: Proposal, shownUntil: number) {
  const errors: string[] = []; const cands: PlanItem[] = []
  const grp = (g: unknown) => (typeof g === 'string' && GROUP_ORDER.includes(g) ? g : 'Other')
  const inShown = (i: number) => Number.isInteger(i) && i >= 0 && i <= shownUntil
  for (const c of arr(input.cutSentences)) {
    const a = Number(c?.from), b = Number(c?.to ?? c?.from)
    if (!inShown(a) || !inShown(b) || b < a) { errors.push(`cutSentences S${c?.from}–S${c?.to}: sentence numbers out of range`); continue }
    const r = sentenceSpan(ix, a, b); cands.push({ group: grp(c.group), s: r.s, e: r.e, reason: String(c.reason ?? '').slice(0, 140) })
  }
  for (const c of arr(input.cutPhrases)) {
    const si = Number(c?.sentence)
    if (!inShown(si)) { errors.push(`cutPhrases S${c?.sentence}: sentence number out of range`); continue }
    const r = locatePhrase(ix, si, c.text)
    if (!r) { errors.push(`cutPhrases S${si}: the words “${String(c.text).slice(0, 60)}” are not in that sentence`); continue }
    cands.push({ group: grp(c.group), s: r.s, e: r.e, reason: String(c.reason ?? '').slice(0, 140) })
  }
  for (const c of arr(input.cutRanges)) {
    const a = parseTime(String(c?.from ?? '')), b = parseTime(String(c?.to ?? ''))
    if (a === null || b === null || b <= a || a >= ix.duration) { errors.push(`cutRanges ${c?.from}–${c?.to}: not a valid time range`); continue }
    cands.push({ group: 'Requested cuts', s: a, e: Math.min(b, ix.duration), reason: String(c.reason ?? 'Requested range').slice(0, 140) })
  }
  if (input.removeRetakes === true) retakeRanges(ix, () => true).forEach(r => cands.push({ group: 'Earlier takes', ...r, reason: 'Kept the later, complete take' }))
  if (input.removeFillers === true) fillerRanges(ix, () => true).forEach(r => cands.push({ group: 'Filler words', ...r, reason: 'Filler word' }))
  const pz = Number(input.shortenPausesOver)
  if (input.shortenPausesOver != null && Number.isFinite(pz) && pz > 0) {
    const min = Math.max(400, Math.round(pz * 1000))
    pauseRanges(ix, min, () => true).forEach(r => cands.push({ group: 'Long pauses', ...r, reason: `Pause longer than ${(min / 1000).toFixed(1)} s` }))
  }
  // dedupe against each other and the current timeline, then check each cut in order like the server will
  const fin = finalizeItems(st, cands)
  const work: TimelineState = JSON.parse(JSON.stringify(st)); const items: PlanItem[] = []
  for (const it of fin.items) {
    const op = { type: 'cut' as const, author: 'agent' as const, label: it.group, p: { s: it.s, e: it.e } }
    const err = validateOp(work, op, log)
    if (err) { errors.push(`${it.group} ${fmt(it.s)}: ${err}`); continue }
    applyOp(work, { ...op, id: 'tmp', version: 0, at: 0 }); items.push(it)
  }
  const have = new Set(st.shorts.map(x => x.id))
  const shorts: Short[] = arr(input.shorts).flatMap((x: any) => {
    const a = Number(x?.from), b = Number(x?.to)
    if (!inShown(a) || !inShown(b) || b < a) { errors.push(`short S${x?.from}–S${x?.to}: sentence numbers out of range`); return [] }
    const sh = makeShort(ix, a, b, String(x.title ?? 'Short').slice(0, 80), String(x.hook ?? '').slice(0, 160), Math.max(0, Math.min(100, Math.round(Number(x.score) || 70))))
    if (sh.dur < 8000 || sh.dur > 90000) { errors.push(`short S${a}–S${b}: ${Math.round(sh.dur / 1000)} s is outside 8–90 s`); return [] }
    return have.has(sh.id) ? [] : [sh]
  })
  const groups = GROUP_ORDER.map(g => ({ name: g, items: items.filter(x => x.group === g) })).filter(g => g.items.length).map(g => ({ ...g, ms: g.items.reduce((a, x) => a + x.e - x.s, 0) }))
  const summary = typeof input.summary === 'string' && input.summary.trim() ? input.summary.trim().slice(0, 600) : 'I’ll make the edits below.'
  const plan: Plan = { summary, groups, shorts, items, total: items.length, ms: items.reduce((a, x) => a + x.e - x.s, 0), adjusted: 0, source: 'llm' }
  return { plan, errors }
}

export function rulesFallback(ix: MediaIndex, st: TimelineState, instruction: string, prefs: Prefs, why?: string): Plan {
  const intent = parseIntent(instruction)
  if (intentIsEmpty(intent)) return { summary: why ? `${why} ${RULES_HELP}` : RULES_HELP, groups: [], shorts: [], items: [], total: 0, ms: 0, adjusted: 0, source: 'rules' }
  const plan = buildPlan(ix, st, intent, prefs)
  return why ? { ...plan, note: `${why} The built-in planner made this plan instead.` } : plan
}

export async function planEdit(ix: MediaIndex, st: TimelineState, log: OpRecord[], instruction: string, prefs: Prefs, step: (s: string) => void): Promise<AgentResult> {
  const base = { provider: 'rules', model: null, usage: null, llmMs: 0 }
  step('Reading the transcript, shots and speakers')
  if (config.llm.id === 'none') {
    step('Planning the edit with the built-in planner'); step('Checking each edit against the current timeline')
    return { ...base, plan: rulesFallback(ix, st, instruction, prefs) }
  }
  if (ix.source === 'segments' || !ix.words.length || ix.words.every(w => w.text === '(speech)')) {
    step('No word transcript yet, using the built-in planner')
    return { ...base, plan: rulesFallback(ix, st, instruction, prefs, 'This recording has no word-level transcript yet, so the AI can’t read it.') }
  }
  const tr = transcriptForModel(ix, st, config.llm.contextWords)
  const user = `Recording: ${fmt(ix.duration)} long, ${ix.sentences.length} sentences.\n\n${tr.text}\n\nInstruction from the creator: “${instruction}”\n\nReply with the JSON object only.`
  const messages = [{ role: 'system' as const, content: systemPrompt(prefs) }, { role: 'user' as const, content: user }]
  const usage = { input: 0, output: 0 }; let llmMs = 0
  const track = (r: { usage: { input: number; output: number } | null; ms: number }) => { if (r.usage) { usage.input += r.usage.input; usage.output += r.usage.output } llmMs += r.ms }
  try {
    step(`Planning the edit with ${config.llm.label} (${config.llm.model})`)
    const first = await chatJSON(messages); track(first)
    step('Checking each edit against the current timeline')
    let { plan, errors } = toPlan(ix, st, log, first.data ?? {}, tr.shownUntil)
    if (errors.length) {
      step(`Repairing ${errors.length} edit${errors.length > 1 ? 's' : ''} that failed checks`)
      try {
        const second = await chatJSON([...messages, { role: 'assistant', content: first.text }, { role: 'user', content: `These proposals failed the program's checks:\n${errors.slice(0, 25).join('\n')}\nReply with the complete corrected JSON object (all edits, not only the fixed ones).` }])
        track(second)
        const repaired = toPlan(ix, st, log, second.data ?? {}, tr.shownUntil)
        plan = { ...repaired.plan, adjusted: Math.max(0, errors.length - repaired.errors.length) }
      } catch (e) {
        // keep the edits that did pass; the repair round is a bonus, not a requirement
        plan = { ...plan, note: `${errors.length} proposal${errors.length > 1 ? 's' : ''} failed checks and ${errors.length > 1 ? 'were' : 'was'} left out.` }
        console.warn('[agent] repair round failed:', (e as Error).message)
      }
    }
    if (tr.truncated) plan = { ...plan, note: [plan.note, `The transcript was trimmed to fit ${config.llm.label}'s free limits; fillers, pauses and retakes still apply to the whole recording.`].filter(Boolean).join(' ') }
    return { plan, provider: config.llm.id, model: config.llm.model, usage, llmMs }
  } catch (e) {
    const err = e as Error
    const why = e instanceof LlmError ? err.message : `The AI provider failed (${err.message}).`
    console.warn(`[agent] ${config.llm.label} failed, falling back to rules:`, err.message)
    step('AI provider unavailable, using the built-in planner')
    return { plan: rulesFallback(ix, st, instruction, prefs, why), provider: 'rules', model: null, usage: usage.input ? usage : null, llmMs, error: err.message }
  }
}
