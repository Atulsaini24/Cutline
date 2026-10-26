// One small client for every free LLM option. Gemini, Groq, OpenRouter and custom servers all speak
// the OpenAI chat-completions dialect; Ollama uses its native API so we can raise the context size
// (its default window is too small for a transcript). We ask for JSON instead of tool calls because
// JSON mode works on far more free and local models than tool calling does.
import { config } from '../config'

export type LlmErrorKind = 'rate_limit' | 'too_large' | 'auth' | 'unreachable' | 'model' | 'bad_output' | 'other'
export class LlmError extends Error {
  constructor(message: string, public kind: LlmErrorKind, public status?: number) { super(message) }
}
export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }
export interface LlmResult { data: any; text: string; usage: { input: number; output: number } | null; ms: number }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Pull a JSON object out of a model reply, tolerating ``` fences and chatter around it. */
export function parseJsonLoose(text: string): any {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try { return JSON.parse(t) } catch { /* fall through */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)) } catch { /* fall through */ } }
  throw new LlmError('The model did not return valid JSON.', 'bad_output')
}

function classify(status: number, body: string): LlmError {
  const msg = body.replace(/\s+/g, ' ').slice(0, 280)
  const low = msg.toLowerCase()
  if (status === 401 || status === 403) return new LlmError(`${config.llm.label} rejected the API key (${status}). Check the key in backend/.env.`, 'auth', status)
  if (status === 413 || /too large|context length|maximum context|tokens per minute|reduce the length|request too large/.test(low)) return new LlmError(`The transcript is too long for ${config.llm.label}'s free limits.`, 'too_large', status)
  if (status === 429 || /rate limit|quota|resource_exhausted/.test(low)) return new LlmError(`${config.llm.label}'s free-tier limit was reached. Wait a minute and try again.`, 'rate_limit', status)
  if (status === 404 || /model .*not found|does not exist|unknown model/.test(low)) return new LlmError(`Model "${config.llm.model}" is not available on ${config.llm.label}. ${config.llm.id === 'ollama' ? `Run: ollama pull ${config.llm.model}` : 'Set LLM_MODEL to a model your account can use.'}`, 'model', status)
  return new LlmError(`${config.llm.label} returned ${status}: ${msg}`, 'other', status)
}

async function post(url: string, body: unknown, headers: Record<string, string>, signal: AbortSignal) {
  try {
    return await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new LlmError(`${config.llm.label} took too long to answer.`, 'unreachable')
    throw new LlmError(config.llm.id === 'ollama' ? `Can't reach Ollama at ${config.llm.baseUrl}. Is "ollama serve" running?` : `Can't reach ${config.llm.label}: ${(e as Error).message}`, 'unreachable')
  }
}

async function openaiCompatible(messages: ChatMsg[], maxTokens: number, signal: AbortSignal) {
  const url = config.llm.baseUrl.replace(/\/+$/, '') + '/chat/completions'
  const headers: Record<string, string> = {}
  if (config.llm.apiKey) headers.authorization = `Bearer ${config.llm.apiKey}`
  if (config.llm.id === 'openrouter') { headers['HTTP-Referer'] = config.publicUrl || 'http://localhost'; headers['X-Title'] = 'Cutline' }
  let jsonMode = true
  for (let attempt = 0; attempt < 3; attempt++) {
    const body: Record<string, unknown> = { model: config.llm.model, messages, temperature: 0.2, max_tokens: maxTokens }
    if (jsonMode) body.response_format = { type: 'json_object' }
    const res = await post(url, body, headers, signal)
    const raw = await res.text()
    if (res.ok) {
      let j: any
      try { j = JSON.parse(raw) } catch { throw new LlmError(`${config.llm.label} sent an unreadable response.`, 'bad_output') }
      const text: string = j.choices?.[0]?.message?.content ?? ''
      if (!text) throw new LlmError(`${config.llm.label} returned an empty answer.`, 'bad_output')
      return { text, usage: j.usage ? { input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0 } : null }
    }
    // some models/providers don't support JSON mode: retry once without it, the prompt still asks for JSON
    if (res.status === 400 && jsonMode && /response_format|json_object|json mode|not supported/i.test(raw)) { jsonMode = false; continue }
    // short rate-limit waits are worth sitting out once
    const retryAfter = Number(res.headers.get('retry-after'))
    if (res.status === 429 && attempt === 0 && Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 20) { await sleep(retryAfter * 1000); continue }
    throw classify(res.status, raw)
  }
  throw new LlmError(`${config.llm.label} could not complete the request.`, 'other')
}

async function ollama(messages: ChatMsg[], maxTokens: number, signal: AbortSignal) {
  const url = config.llm.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '') + '/api/chat'
  // ~1.4 tokens per transcript word plus the instructions; Ollama silently truncates beyond num_ctx
  const numCtx = Math.min(32768, Math.max(8192, Math.ceil((config.llm.contextWords * 1.5 + 2500) / 1024) * 1024))
  const res = await post(url, { model: config.llm.model, messages, stream: false, format: 'json', options: { temperature: 0.2, num_ctx: numCtx, num_predict: maxTokens } }, {}, signal)
  const raw = await res.text()
  if (!res.ok) throw classify(res.status, raw)
  const j = JSON.parse(raw)
  return { text: String(j.message?.content ?? ''), usage: { input: j.prompt_eval_count ?? 0, output: j.eval_count ?? 0 } }
}

/** Send a chat and parse the reply as JSON. Throws LlmError with a kind the caller can act on. */
export async function chatJSON(messages: ChatMsg[], opts: { maxTokens?: number } = {}): Promise<LlmResult> {
  if (config.llm.id === 'none') throw new LlmError('No AI provider is configured.', 'auth')
  if (config.llm.id !== 'ollama' && config.llm.id !== 'custom' && !config.llm.apiKey) throw new LlmError(`Set ${config.llm.id.toUpperCase()}_API_KEY in backend/.env.`, 'auth')
  if (!config.llm.baseUrl || !config.llm.model) throw new LlmError('Set LLM_BASE_URL and LLM_MODEL in backend/.env.', 'auth')
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), config.llm.timeoutMs)
  const t0 = Date.now()
  try {
    const maxTokens = opts.maxTokens ?? (config.llm.id === 'gemini' ? 8192 : 3000)
    const r = config.llm.id === 'ollama' ? await ollama(messages, maxTokens, ctl.signal) : await openaiCompatible(messages, maxTokens, ctl.signal)
    return { data: parseJsonLoose(r.text), text: r.text, usage: r.usage, ms: Date.now() - t0 }
  } finally { clearTimeout(timer) }
}

/** Tiny round trip used by the Settings page "Test connection" button. */
export async function pingLlm() {
  const r = await chatJSON([
    { role: 'system', content: 'You reply with JSON only.' },
    { role: 'user', content: 'Reply with this exact JSON: {"ok": true}' },
  ], { maxTokens: config.llm.id === 'gemini' ? 1024 : 50 })
  return { ok: r.data?.ok === true, ms: r.ms, model: config.llm.model, provider: config.llm.label }
}
