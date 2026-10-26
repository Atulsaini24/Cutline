import 'dotenv/config'
import path from 'node:path'
import crypto from 'node:crypto'

const env = (k: string, d = '') => (process.env[k] ?? d).trim()
const num = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && process.env[k] !== '' ? v : d }
const storage = path.resolve(env('STORAGE_DIR', './storage'))
const production = env('NODE_ENV') === 'production'

/* ---------------------------------------------------------------------------------------------
 * AI providers. Everything here is free to use:
 *   Edit agent (LLM):  gemini (Google AI Studio free tier), groq (free tier), openrouter (":free"
 *                      models), ollama (runs on your own computer), or any OpenAI-compatible server.
 *   Transcription:     groq (free Whisper large-v3-turbo), local (Whisper running inside this
 *                      server via transformers.js, no account at all), or any OpenAI-compatible
 *                      /audio/transcriptions server.
 * With nothing configured the app still works: rule-based planner + speech segments.
 * ------------------------------------------------------------------------------------------- */
export type LlmId = 'gemini' | 'groq' | 'openrouter' | 'ollama' | 'custom' | 'none'
export type SttId = 'groq' | 'local' | 'custom' | 'none'

const LLM_PRESETS: Record<Exclude<LlmId, 'none'>, { label: string; baseUrl: string; model: string; keyVar: string; contextWords: number }> = {
  // Gemini's OpenAI-compatible endpoint. Free tier has a very large context window, so whole
  // transcripts fit. Get a key at https://aistudio.google.com/apikey
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', keyVar: 'GEMINI_API_KEY', contextWords: 60000 },
  // Very fast; the free tier limits tokens per minute, so long transcripts are trimmed.
  // Get a key at https://console.groq.com/keys
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyVar: 'GROQ_API_KEY', contextWords: 5000 },
  // Models whose name ends in ":free" cost nothing. https://openrouter.ai/keys
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', keyVar: 'OPENROUTER_API_KEY', contextWords: 20000 },
  // Fully offline. Install https://ollama.com then `ollama pull qwen2.5:7b`.
  ollama: { label: 'Ollama (local)', baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b', keyVar: '', contextWords: 9000 },
  // Anything that speaks the OpenAI chat API (LM Studio, llama.cpp server, vLLM, ...).
  custom: { label: 'OpenAI-compatible', baseUrl: '', model: '', keyVar: 'LLM_API_KEY', contextWords: 12000 },
}

function pickLlm(): LlmId {
  const forced = env('LLM_PROVIDER').toLowerCase()
  if (forced) return (['gemini', 'groq', 'openrouter', 'ollama', 'custom', 'none'].includes(forced) ? forced : 'none') as LlmId
  if (env('GEMINI_API_KEY')) return 'gemini'
  if (env('GROQ_API_KEY')) return 'groq'
  if (env('OPENROUTER_API_KEY')) return 'openrouter'
  if (env('OLLAMA_MODEL') || env('OLLAMA_URL')) return 'ollama'
  if (env('LLM_BASE_URL')) return 'custom'
  return 'none'
}
function pickStt(): SttId {
  const forced = env('STT_PROVIDER').toLowerCase()
  if (forced) return (['groq', 'local', 'custom', 'none'].includes(forced) ? forced : 'none') as SttId
  if (env('GROQ_API_KEY')) return 'groq'
  if (env('STT_BASE_URL')) return 'custom'
  return 'local' // tried at index time; falls back to speech segments if the package isn't installed
}

const llmId = pickLlm()
const llmPreset = llmId === 'none' ? null : LLM_PRESETS[llmId]
const sttId = pickStt()

export const config = {
  production,
  port: num('PORT', 8787),
  jwtSecret: env('JWT_SECRET') || crypto.createHash('sha256').update('cutline-dev:' + storage).digest('hex'),
  jwtSecretIsDefault: !env('JWT_SECRET'),
  storageDir: storage,
  dbFile: path.join(storage, 'cutline.db'),
  databaseUrl: env('DATABASE_URL'),
  llm: {
    id: llmId,
    label: llmPreset?.label ?? 'Built-in planner',
    baseUrl: (llmId === 'ollama' ? env('OLLAMA_URL') : env('LLM_BASE_URL')) || llmPreset?.baseUrl || '',
    apiKey: llmPreset?.keyVar ? env(llmPreset.keyVar) || env('LLM_API_KEY') : env('LLM_API_KEY'),
    model: (llmId === 'ollama' ? env('OLLAMA_MODEL') : '') || env('LLM_MODEL') || llmPreset?.model || '',
    contextWords: num('LLM_CONTEXT_WORDS', llmPreset?.contextWords ?? 8000),
    timeoutMs: num('LLM_TIMEOUT_MS', llmId === 'ollama' ? 300_000 : 90_000),
  },
  stt: {
    id: sttId,
    baseUrl: sttId === 'groq' ? 'https://api.groq.com/openai/v1' : env('STT_BASE_URL'),
    apiKey: sttId === 'groq' ? env('GROQ_API_KEY') : env('STT_API_KEY'),
    model: env('STT_MODEL') || (sttId === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1'),
    // Local Whisper (transformers.js). "base" is a good speed/quality balance on a laptop CPU;
    // try Xenova/whisper-small for better accuracy or Xenova/whisper-tiny for speed.
    localModel: env('WHISPER_LOCAL_MODEL', 'Xenova/whisper-base'),
    localDtype: env('WHISPER_LOCAL_DTYPE', 'q8'),
    language: env('WHISPER_LANGUAGE'), // e.g. "en", "hi"; empty = auto-detect
  },
  renderWorkers: Math.max(1, num('RENDER_WORKERS', 3)),
  jobConcurrency: Math.max(1, num('JOB_CONCURRENCY', 2)),
  renderTtlDays: Math.max(1, num('RENDER_TTL_DAYS', 7)),
  corsOrigin: env('CORS_ORIGIN', 'http://localhost:5173').split(',').map(s => s.trim()).filter(Boolean),
  publicUrl: env('PUBLIC_URL'),
  partSize: 8 * 1024 * 1024,
  maxUpload: num('MAX_UPLOAD_GB', 20) * 1024 ** 3,
}

/** Short ids the frontend switches on; details for the Settings page. */
export const providers = (): { transcribe: SttId; agent: LlmId } => ({ transcribe: config.stt.id, agent: config.llm.id })
export const providerDetails = () => ({
  agent: { id: config.llm.id, label: config.llm.label, model: config.llm.model || null, configured: config.llm.id !== 'none' },
  transcribe: { id: config.stt.id as SttId, model: config.stt.id === 'local' ? config.stt.localModel : config.stt.id === 'none' ? null : config.stt.model, configured: config.stt.id !== 'none' } as { id: SttId; model: string | null; configured: boolean },
})
