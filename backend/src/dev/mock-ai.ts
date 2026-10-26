// A stand-in for Gemini / Groq / OpenRouter / Whisper that speaks the same OpenAI-compatible HTTP API,
// so the whole AI path (requests, JSON parsing, validation, repair round, rate-limit fallback,
// cloud transcription) can be tested offline and in CI without any key. Only the answers are canned.
//
//   npx tsx src/dev/mock-ai.ts            (listens on :9911)
//   STT_PROVIDER=custom STT_BASE_URL=http://localhost:9911/v1 \
//   LLM_PROVIDER=custom LLM_BASE_URL=http://localhost:9911/v1 LLM_MODEL=mock npm start
//
// Instruction keywords pick a behaviour: MOCK_BAD (invalid first answer, valid repair),
// MOCK_RATELIMIT (429 with a long Retry-After), MOCK_GARBAGE (not JSON). Anything else gets a sensible plan.
import http from 'node:http'

const PORT = Number(process.env.MOCK_AI_PORT || 9911)
export const stats = { chat: 0, transcribe: 0 }

/** Words spoken during the self-test clip's tone bursts (0–4 s, 6–10 s, 12–16 s, 18–22 s). */
const LINES = [
  'Um so today we test the editor.',
  'So today we test the editor properly.',
  'Uh this part is off topic honestly.',
  'That is the end of the test.',
]
function transcript(durationHint = 24) {
  const words: { word: string; start: number; end: number }[] = []; const segments: { start: number; end: number; text: string }[] = []
  LINES.forEach((line, k) => {
    const t0 = k * 6 + 0.3, t1 = k * 6 + 3.7; if (t0 > durationHint) return
    const toks = line.split(' '); const step = (t1 - t0) / toks.length
    toks.forEach((tok, i) => words.push({ word: tok.replace(/[.,]$/, ''), start: +(t0 + i * step).toFixed(2), end: +(t0 + (i + 0.85) * step).toFixed(2) }))
    segments.push({ start: t0, end: t1, text: ' ' + line })
  })
  return { text: LINES.join(' '), words, segments }
}

function plan(instruction: string, repair: boolean) {
  if (instruction.includes('MOCK_BAD') && !repair) return {
    summary: 'I’ll cut a few things.',
    cutSentences: [{ from: 99, to: 100, group: 'Off-topic', reason: 'does not exist' }],
    cutPhrases: [{ sentence: 3, text: 'words that are not there', group: 'Other', reason: 'bad quote' }],
  }
  if (instruction.includes('MOCK_BAD')) return {
    summary: 'I’ll trim the closing line.',
    cutPhrases: [{ sentence: 3, text: 'of the test', group: 'Other', reason: 'tighter ending' }],
    cutSentences: [{ from: 2, to: 2, group: 'Off-topic', reason: 'off topic' }],
  }
  return {
    summary: 'I’ll keep the complete take, drop the off-topic line and the filler, and tighten the pauses.',
    removeFillers: true, removeRetakes: true, shortenPausesOver: 1,
    cutSentences: [{ from: 2, to: 2, group: 'Off-topic', reason: 'Off-topic aside' }],
    cutPhrases: [],
    shorts: /short/i.test(instruction) ? [{ from: 0, to: 3, title: 'Testing the editor', hook: 'So today we test the editor', score: 88 }] : [],
  }
}

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
    if (req.method === 'POST' && req.url?.endsWith('/audio/transcriptions')) {
      stats.transcribe++
      const form = Buffer.concat(chunks).toString('latin1')
      if (!/name="response_format"\r\n\r\nverbose_json/.test(form) || !/timestamp_granularities/.test(form)) return send(400, { error: { message: 'mock: expected verbose_json with word timestamps' } })
      return send(200, transcript())
    }
    if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) {
      stats.chat++
      let body: any; try { body = JSON.parse(Buffer.concat(chunks).toString()) } catch { return send(400, { error: { message: 'bad json' } }) }
      const msgs: { role: string; content: string }[] = body.messages ?? []
      const firstUser = msgs.find(m => m.role === 'user')?.content ?? ''
      const instruction = /Instruction from the creator: “([^”]*)”/.exec(firstUser)?.[1] ?? firstUser
      if (instruction.includes('MOCK_RATELIMIT')) return send(429, { error: { message: 'Rate limit reached for model on tokens per day (TPD)' } }, { 'retry-after': '120' })
      const repair = msgs.length > 2
      let content: string
      if (/exact JSON: \{"ok": true\}/.test(firstUser)) content = '{"ok": true}'
      else if (instruction.includes('MOCK_GARBAGE')) content = 'Sure! I would love to help with that edit.'
      // wrap in a code fence like many free models do, to exercise the lenient parser
      else content = '```json\n' + JSON.stringify(plan(instruction, repair), null, 2) + '\n```'
      return send(200, { id: 'mock', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: Math.round(JSON.stringify(msgs).length / 4), completion_tokens: Math.round(content.length / 4) } })
    }
    if (req.url === '/stats') return send(200, stats)
    send(404, { error: { message: 'mock: no such route' } })
  })
})
server.listen(PORT, () => console.log(`Mock AI server on http://localhost:${PORT}/v1`))
