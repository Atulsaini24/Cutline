import { create } from 'zustand'
import { getToken, health, req, setToken, type AiInfo } from './api'

export interface SessionUser { id: string; email: string; name: string; settings: Record<string, any> }
interface Session {
  mode: 'checking' | 'online' | 'offline'
  /** offline because the server isn't reachable (true) or just because nobody is signed in (false) */
  serverUp: boolean
  user: SessionUser | null
  providers: { transcribe: string; agent: string } | null
  ai: AiInfo | null
  init: () => Promise<void>
  refreshUser: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  signOut: () => void
}
/** online = backend reachable and signed in; offline = local demo (no server, not signed in, or opened from a file). */
export const useSession = create<Session>((set, get) => ({
  mode: 'checking', serverUp: false, user: null, providers: null, ai: null,
  init: async () => {
    const h = await health()
    if (!h) { set({ mode: 'offline', serverUp: false }); return }
    set({ providers: h.providers, ai: h.ai ?? null, serverUp: true })
    if (!getToken()) { set({ mode: 'offline' }); return }
    try { const { user } = await req('GET', '/me'); set({ user, mode: 'online' }) } catch { setToken(null); set({ mode: 'offline' }) }
  },
  refreshUser: async () => { if (get().mode !== 'online') return; try { const { user } = await req('GET', '/me'); set({ user }) } catch { /* ignore */ } },
  signIn: async (email, password) => { const r = await req('POST', '/auth/login', { email, password }); setToken(r.token); set({ user: r.user, mode: 'online', serverUp: true }) },
  register: async (name, email, password) => { const r = await req('POST', '/auth/register', { name, email, password }); setToken(r.token); set({ user: r.user, mode: 'online', serverUp: true }) },
  signOut: () => { setToken(null); set({ user: null, mode: 'offline' }) },
}))
export const isOnline = () => useSession.getState().mode === 'online'

/** Human labels for provider ids, shared by the editor, upload and settings screens. */
export const AGENT_LABEL: Record<string, string> = { gemini: 'Gemini', groq: 'Groq', openrouter: 'OpenRouter', ollama: 'Ollama', custom: 'AI', rules: 'Built-in', demo: 'Demo', none: 'Built-in' }
export function transcribeLabel(id?: string | null) {
  return id === 'groq' ? 'Whisper on Groq, word-level' : id === 'local' ? 'Whisper on this server, word-level' : id === 'custom' ? 'Whisper, word-level' : 'speech segments only (connect free transcription in Settings for words)'
}
