import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildIndex } from '../analysis'
import { buildPlan, findShorts, intentIsEmpty, parseIntent, parseTime, strength, wordRanges } from '../planner'
import { buildSampleRaw } from '../sample'
import { initState } from '../timeline'

const ix = buildIndex(buildSampleRaw())
const st = () => initState(ix.duration)

test('parseTime understands the ways people write times', () => {
  assert.equal(parseTime('1:20'), 80000); assert.equal(parseTime('90s'), 90000)
  assert.equal(parseTime('1.5 min'), 90000); assert.equal(parseTime('45'), 45000); assert.equal(parseTime('soon'), null)
})
test('parseIntent: shorts count, ranges, first/last, words, pause threshold', () => {
  assert.equal(parseIntent('make 5 shorts').shorts, 5)
  assert.equal(parseIntent('Make three vertical reels').shorts, 3)
  assert.deepEqual(parseIntent('cut from 1:20 to 1:45').ranges, [{ s: 80000, e: 105000 }])
  assert.deepEqual(parseIntent('remove the first 10 seconds').ranges, [{ s: 0, e: 10000 }])
  assert.equal(parseIntent('trim the last 30 seconds').lastMs, 30000)
  assert.deepEqual(parseIntent('remove every "basically"').words, ['basically'])
  assert.deepEqual(parseIntent('cut the word honestly').words, ['honestly'])
  const p = parseIntent('shorten pauses longer than 2 seconds'); assert.equal(p.pauseMin, 2000); assert.ok(p.tasks.has('pauses'))
  assert.ok(parseIntent('Tighten the first 15 seconds').tasks.has('open'))
  assert.equal(parseIntent('Tighten the first 15 seconds').ranges.length, 0)
  assert.ok(intentIsEmpty(parseIntent('add a lens flare')))
})
test('analysis finds the sample’s fillers and repeated takes', () => {
  assert.ok(ix.stats.fillers >= 5); assert.ok(ix.stats.retakes >= 2)
  assert.ok(ix.sentences.some(s => s.tag === 'preroll'))
})
test('clean plan: groups, no overlaps, nothing outside the recording', () => {
  const plan = buildPlan(ix, st(), parseIntent('Remove repeated takes and filler'))
  assert.ok(plan.total > 5)
  assert.deepEqual(plan.groups.map(g => g.name).filter(n => ['Earlier takes', 'Filler words', 'Long pauses'].includes(n)).length, plan.groups.length)
  const items = [...plan.items].sort((a, b) => a.s - b.s)
  items.forEach((x, i) => { assert.ok(x.s >= 0 && x.e <= ix.duration && x.e > x.s); if (i) assert.ok(items[i - 1].e <= x.s, 'items overlap') })
})
test('cutting strength changes how many pauses are cut', () => {
  const gentle = buildPlan(ix, st(), parseIntent('remove pauses'), { aggressiveness: 10 })
  const tight = buildPlan(ix, st(), parseIntent('clean it up'), { aggressiveness: 90 })
  const balanced = buildPlan(ix, st(), parseIntent('clean it up'), { aggressiveness: 50 })
  assert.ok(strength({ aggressiveness: 90 }).pause < strength({ aggressiveness: 10 }).pause)
  assert.ok(tight.ms > balanced.ms); assert.ok(gentle.items.length >= 0)
})
test('word and range requests land in their own groups', () => {
  const plan = buildPlan(ix, st(), parseIntent('remove the first 5 seconds and remove every "basically"'))
  assert.ok(plan.groups.some(g => g.name === 'Requested cuts'))
  const w = wordRanges(ix, 'basically'); assert.equal(plan.groups.find(g => g.name === 'Requested words')?.items.length ?? 0, w.length)
})
test('shorts: requested count, 8–90 s, non-overlapping', () => {
  const s = findShorts(ix, 2); assert.equal(s.length, 2)
  s.forEach(x => assert.ok(x.dur >= 8000 && x.dur <= 90000))
  assert.ok(s[0].ranges[s[0].ranges.length - 1].e <= s[1].ranges[0].s)
})
test('planning twice proposes nothing new once applied', () => {
  const state = st(); const plan = buildPlan(ix, state, parseIntent('remove filler words'))
  plan.items.forEach(x => { state.v1 = state.v1.flatMap(iv => x.e <= iv.s || x.s >= iv.e ? [iv] : [...(iv.s < x.s ? [{ ...iv, e: x.s }] : []), ...(iv.e > x.e ? [{ ...iv, s: x.e }] : [])]) })
  assert.equal(buildPlan(ix, state, parseIntent('remove filler words')).total, 0)
})
