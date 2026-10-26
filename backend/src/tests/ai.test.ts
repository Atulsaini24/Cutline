import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseJsonLoose, LlmError } from '../ai/llm'
import { locatePhrase, toPlan, transcriptForModel } from '../ai/agent'
import { speechWindows } from '../ai/transcribe'
import { buildIndex } from '../../../shared/analysis'
import { buildSampleRaw } from '../../../shared/sample'
import { initState } from '../../../shared/timeline'

const ix = buildIndex(buildSampleRaw())
test('parseJsonLoose handles fences, chatter and garbage', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonLoose('Here you go: {"a": {"b": 2}} hope that helps'), { a: { b: 2 } })
  assert.throws(() => parseJsonLoose('no json here'), LlmError)
})
test('transcript for the model is numbered, marks cuts, respects the word budget', () => {
  const st = initState(ix.duration)
  const full = transcriptForModel(ix, st, 100000)
  assert.match(full.text, /^S0 \[0:02.6\] Maya: Okay/m); assert.equal(full.truncated, false)
  const small = transcriptForModel(ix, st, 40); assert.ok(small.truncated); assert.match(small.text, /not shown/)
  st.v1 = [{ s: ix.sentences[1].e + 10, e: ix.duration, leftBy: null }]
  assert.match(transcriptForModel(ix, st, 100000).text, /S0 .*\{already cut\}/)
})
test('locatePhrase finds quoted words despite case and punctuation', () => {
  const s = ix.sentences.find(x => x.w.length > 6)!
  const quote = s.w.slice(2, 4).map(w => w.text.toUpperCase().replace(/[,.]/g, '')).join(' ')
  const r = locatePhrase(ix, s.i, quote)!
  assert.equal(r.s, s.w[2].s)
  assert.equal(locatePhrase(ix, s.i, 'zebra crossing'), null)
})
test('toPlan validates proposals and reports bad ones for the repair round', () => {
  const st = initState(ix.duration)
  const { plan, errors } = toPlan(ix, st, [], {
    summary: 'x', removeFillers: true, cutSentences: [{ from: 0, to: 1, group: 'Pre-roll chatter' }, { from: 999, to: 1000 }],
    cutPhrases: [{ sentence: 3, text: 'not in there' }], cutRanges: [{ from: '0:50', to: '0:40' }], shorts: [{ from: 2, to: 3, title: 't', hook: 'h', score: 50 }],
  }, ix.sentences.length - 1)
  assert.ok(plan.groups.some(g => g.name === 'Pre-roll chatter')); assert.ok(plan.groups.some(g => g.name === 'Filler words'))
  assert.equal(errors.length, 4) // bad sentence numbers, missing phrase, reversed range, Short too short
})
test('speech windows end in silences and skip silent stretches', () => {
  const sil = [{ s: 9000, e: 10000 }, { s: 20000, e: 21000 }, { s: 40000, e: 70000 }]
  const w = speechWindows(sil, 80000)
  assert.equal(w[0].e, 20500)                              // latest silence midpoint under 28 s
  assert.ok(w.every(x => x.e - x.s <= 28000))
  assert.ok(!w.some(x => x.s >= 41000 && x.e <= 69000))      // the long silence is skipped
})
