import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import clsx from 'clsx'
import { Check, ChevronDown, Copy, Cpu, ExternalLink, KeyRound, Mic, Sparkles, X } from 'lucide-react'
import { useSession, transcribeLabel } from '../lib/session'
import { req } from '../lib/api'
import { Button, Modal } from '../components/ui'
import { Reveal } from '../components/fx'
import { AppShell } from '../components/site'

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={clsx('relative w-11 h-6 rounded-full transition-colors shrink-0', on ? 'bg-jade-500' : 'bg-ink-600')}>
      <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 35 }} className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow" style={{ left: on ? 22 : 2 }} />
    </button>
  )
}
function Row({ t, d, children }: { t: ReactNode; d: ReactNode; children?: ReactNode }) {
  return <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-4 border-t border-ink-750 first:border-t-0"><div className="flex-1 min-w-0"><div className="font-semibold text-[14.5px]">{t}</div><div className="text-[13px] text-fog-400 mt-0.5 max-w-[60ch]">{d}</div></div>{children}</div>
}
function Seg<T extends string>({ value, options, onChange, id }: { value: T; options: [T, string][]; onChange: (v: T) => void; id: string }) {
  return (
    <div className="relative flex rounded-xl bg-ink-800 p-1 self-start sm:self-auto" role="radiogroup">
      {options.map(([k, l]) => (
        <button key={k} role="radio" aria-checked={value === k} onClick={() => onChange(k)} className={clsx('relative px-3 h-8 text-[13px] font-semibold z-10', value === k ? 'text-ink-900' : 'text-fog-300')}>
          {value === k && <motion.span layoutId={id} className="absolute inset-0 -z-10 rounded-lg bg-fog-100" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}{l}
        </button>
      ))}
    </div>
  )
}
function Card({ title, sub, children, i }: { title: string; sub?: ReactNode; children: ReactNode; i: number }) {
  return <Reveal delay={i * 0.05} y={24}><section className="rounded-3xl border border-ink-700 bg-ink-850 p-6"><h2 className="font-display text-[20px] font-semibold tracking-tight">{title}</h2>{sub && <p className="text-[13px] text-fog-400 mt-1 max-w-[70ch]">{sub}</p>}<div className="mt-2">{children}</div></section></Reveal>
}
const Field = ({ label, ...p }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <label className="grid gap-1 text-[12.5px] text-fog-400">{label}<input {...p} className={clsx('h-10 rounded-xl bg-ink-800 border border-ink-600 px-3 text-[14px] text-fog-100 outline-none focus:border-sky-400 disabled:opacity-60', p.className)} /></label>
)

/* ---------------- free AI setup guide ---------------- */
const GUIDES = {
  gemini: { name: 'Google Gemini', tag: 'Recommended', icon: Sparkles, url: 'https://aistudio.google.com/apikey', urlLabel: 'Get a free key at Google AI Studio',
    steps: ['Sign in with any Google account and create an API key. No card needed.', 'Paste it into backend/.env and restart the server.'],
    env: 'GEMINI_API_KEY=paste-your-key-here', why: 'Big free context window, so whole transcripts fit. Best quality for the edit agent.' },
  groq: { name: 'Groq', tag: 'Fast, also transcribes', icon: Mic, url: 'https://console.groq.com/keys', urlLabel: 'Get a free key at console.groq.com',
    steps: ['Create a free account and an API key.', 'Paste it into backend/.env and restart. One key gives you both word-level Whisper transcription and an edit agent.'],
    env: 'GROQ_API_KEY=paste-your-key-here', why: 'Free Whisper large-v3 transcription with word timings. Use it with Gemini: Groq transcribes, Gemini edits.' },
  ollama: { name: 'Ollama', tag: 'Offline, no account', icon: Cpu, url: 'https://ollama.com/download', urlLabel: 'Download Ollama',
    steps: ['Install Ollama, then run:  ollama pull qwen2.5:7b', 'Add the line below to backend/.env and restart. Needs about 8 GB of RAM; slower than the cloud options.'],
    env: 'OLLAMA_MODEL=qwen2.5:7b', why: 'Everything stays on your computer. For transcription without any account: cd backend && npm install @huggingface/transformers' },
} as const
type GuideId = keyof typeof GUIDES

function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="mt-3 flex items-center gap-2 rounded-xl bg-ink-950 border border-ink-700 pl-3.5 pr-1.5 py-1.5 font-mono text-[13px]">
      <code className="flex-1 overflow-x-auto whitespace-nowrap text-jade-400">{text}</code>
      <button onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) }).catch(() => toast('Copy it by hand')) }}
        className="h-8 px-2.5 rounded-lg bg-ink-800 hover:bg-ink-700 text-fog-200 inline-flex items-center gap-1.5 font-sans text-[12px] font-semibold" aria-label="Copy">
        {done ? <Check size={13} /> : <Copy size={13} />}{done ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function AiCard({ i }: { i: number }) {
  const { ai, mode, serverUp } = useSession()
  const [open, setOpen] = useState(!ai?.agent.configured)
  const [tab, setTab] = useState<GuideId>('gemini')
  const [test, setTest] = useState<{ state: 'idle' | 'run' | 'ok' | 'fail'; text?: string }>({ state: 'idle' })
  const [local, setLocal] = useState<boolean | null>(null)
  useEffect(() => { if (mode === 'online') req('GET', '/ai/status').then(d => setLocal(!!d.localWhisper)).catch(() => {}) }, [mode])
  useEffect(() => { if (ai && !ai.agent.configured) setOpen(true) }, [ai])
  const runTest = async () => {
    setTest({ state: 'run' })
    try { const r = await req('POST', '/ai/test'); setTest(r.ok ? { state: 'ok', text: `${r.provider} answered in ${(r.ms / 1000).toFixed(1)} s` } : { state: 'fail', text: r.error }) }
    catch (e) { setTest({ state: 'fail', text: (e as Error).message }) }
  }
  const g = GUIDES[tab]
  const agentOn = !!ai?.agent.configured
  const sttOn = !!ai?.transcribe.configured
  return (
    <Card i={i} title="AI & transcription" sub="Everything here can run for free. Keys live on the server in backend/.env, never in your browser.">
      <Row t={<span className="flex items-center gap-2">Edit agent <Status on={agentOn} /></span>}
        d={!serverUp ? 'The server is offline, so the demo uses the built-in planner in your browser.' : agentOn ? `${ai!.agent.label}${ai!.agent.model ? `, ${ai!.agent.model}` : ''}. Plans any instruction; every edit is checked before it lands.` : 'Built-in planner: handles cleanups, filler, pauses, time ranges, specific words and Shorts. Connect a free AI to handle any instruction.'}>
        {mode === 'online' && agentOn && <Button size="sm" variant="secondary" onClick={runTest} disabled={test.state === 'run'}>{test.state === 'run' ? 'Testing…' : 'Test connection'}</Button>}
      </Row>
      <AnimatePresence>{test.state === 'ok' || test.state === 'fail' ? (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
          <div className={clsx('mb-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px]', test.state === 'ok' ? 'bg-jade-500/10 text-jade-400' : 'bg-coral-500/10 text-coral-400')}>
            {test.state === 'ok' ? <Check size={15} className="mt-0.5 shrink-0" /> : <X size={15} className="mt-0.5 shrink-0" />}<span>{test.text}</span>
          </div>
        </motion.div>) : null}
      </AnimatePresence>
      <Row t={<span className="flex items-center gap-2">Transcription <Status on={sttOn} /></span>}
        d={!serverUp ? 'Needs the server.' : sttOn ? `${transcribeLabel(ai!.transcribe.id)}${ai!.transcribe.model ? ` (${ai!.transcribe.model})` : ''}. Fillers, retakes and captions work on every upload.` : `Speech segments only, so filler, retake and caption features can’t see words.${local === false ? ' Add a free Groq key, or install local Whisper.' : ''}`} />
      <div className="border-t border-ink-750 pt-4">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-[14px] font-semibold text-amber-300 hover:text-amber-200" aria-expanded={open}>
          <KeyRound size={15} />Set up free AI<motion.span animate={{ rotate: open ? 180 : 0 }}><ChevronDown size={15} /></motion.span>
        </button>
        <AnimatePresence initial={false}>{open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-4 grid sm:grid-cols-3 gap-2" role="tablist">
              {(Object.keys(GUIDES) as GuideId[]).map(k => { const G = GUIDES[k]; return (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={clsx('text-left rounded-2xl border p-3 transition', tab === k ? 'border-amber-400/60 bg-amber-400/10' : 'border-ink-700 bg-ink-800 hover:border-ink-600')}>
                  <G.icon size={17} className={tab === k ? 'text-amber-300' : 'text-fog-400'} />
                  <div className="mt-1.5 font-semibold text-[14px]">{G.name}</div><div className="text-[12px] text-fog-400">{G.tag}</div>
                </button>) })}
            </div>
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-2xl bg-ink-800 p-4">
              <p className="text-[13px] text-fog-300">{g.why}</p>
              <ol className="mt-3 grid gap-1.5 text-[13.5px] list-decimal pl-5 marker:text-fog-500">{g.steps.map(s => <li key={s}>{s}</li>)}</ol>
              <CopyLine text={g.env} />
              <a href={g.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-sky-400 hover:underline">{g.urlLabel}<ExternalLink size={13} /></a>
            </motion.div>
            <p className="mt-3 text-[12.5px] text-fog-500">Free tiers have rate limits. If one is reached, the editor tells you and the built-in planner takes over, so nothing breaks. After adding transcription, open a project and choose Re-index.</p>
          </motion.div>)}
        </AnimatePresence>
      </div>
    </Card>
  )
}
const Status = ({ on }: { on: boolean }) => <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-px text-[11px] font-bold', on ? 'bg-jade-500/15 text-jade-400' : 'bg-ink-700 text-fog-400')}><span className={clsx('w-1.5 h-1.5 rounded-full', on ? 'bg-jade-400' : 'bg-fog-500')} />{on ? 'Connected' : 'Built-in'}</span>

/* ---------------- page ---------------- */
type Res = '720' | '1080' | '4k' | 'source'
export default function Settings() {
  const nav = useNavigate()
  const { mode, user, refreshUser, signOut } = useSession()
  const online = mode === 'online'
  const [name, setName] = useState('Demo creator')
  const [aggr, setAggr] = useState(60)
  const [keepJokes, setKeepJokes] = useState(true)
  const [planFirst, setPlanFirst] = useState(true)
  const [cap, setCap] = useState<'clean' | 'bold' | 'boxed'>('bold')
  const [res, setRes] = useState<Res>('1080')
  const [cleanAudio, setCleanAudio] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [usage, setUsage] = useState<{ indexedMs: number; renderedMs: number; agentRuns: number; aiRequests: number; aiFallbacks: number } | null>(null)
  const [pw, setPw] = useState({ open: false, current: '', next: '', busy: false })
  const [del, setDel] = useState({ open: false, password: '', busy: false })
  const touch = <T,>(f: (v: T) => void) => (v: T) => { f(v); setDirty(true) }
  useEffect(() => {
    if (!online || !user) return
    const s = user.settings ?? {}
    setName(user.name); if (s.aggressiveness != null) setAggr(s.aggressiveness); if (s.keepJokes != null) setKeepJokes(s.keepJokes); if (s.planFirst != null) setPlanFirst(s.planFirst)
    if (s.captionStyle) setCap(s.captionStyle); if (s.resolution) setRes(s.resolution === '2160' ? '4k' : s.resolution); if (s.cleanAudio != null) setCleanAudio(s.cleanAudio)
    req('GET', '/me/usage').then(setUsage).catch(() => {})
  }, [online, user])
  const save = async () => {
    if (!online) { toast('Sign in to save settings', { description: 'In demo mode nothing is stored on a server.', action: { label: 'Sign in', onClick: () => nav('/signin') } }); return }
    setSaving(true)
    try { await req('PATCH', '/me', { name: name.trim() || user!.name, settings: { aggressiveness: aggr, keepJokes, planFirst, captionStyle: cap, resolution: res, cleanAudio } }); await refreshUser(); setDirty(false); toast.success('Settings saved') }
    catch (e) { toast.error('Couldn’t save', { description: (e as Error).message }) } finally { setSaving(false) }
  }
  const changePw = async () => {
    setPw(p => ({ ...p, busy: true }))
    try { await req('POST', '/me/password', { current: pw.current, next: pw.next }); toast.success('Password changed'); setPw({ open: false, current: '', next: '', busy: false }) }
    catch (e) { toast.error('Password not changed', { description: (e as Error).message }); setPw(p => ({ ...p, busy: false })) }
  }
  const deleteAccount = async () => {
    setDel(d => ({ ...d, busy: true }))
    try { const r = await req('DELETE', '/me', { password: del.password }); signOut(); toast.success('Account deleted', { description: `${r.projects} project${r.projects === 1 ? '' : 's'} and all files were removed.` }); nav('/') }
    catch (e) { toast.error('Not deleted', { description: (e as Error).message }); setDel(d => ({ ...d, busy: false })) }
  }
  const label = aggr < 34 ? 'Gentle: obvious filler and pauses over 2 s' : aggr < 67 ? 'Balanced: filler, retakes and pauses over 1.5 s' : 'Tight: also shortens pauses over 0.8 s'
  return (
    <AppShell title="Settings" actions={<Button size="sm" variant={dirty ? 'agent' : 'primary'} onClick={save} disabled={saving}>{saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</Button>}>
      <div className="grid gap-6 max-w-[880px]">
        <Card title="Profile" i={0}>
          <div className="flex items-center gap-5 py-4">
            <span className="w-16 h-16 shrink-0 rounded-2xl bg-gradient-to-br from-sky-400 to-jade-400 grid place-items-center text-[26px] font-display font-bold text-ink-900">{(name[0] ?? '?').toUpperCase()}</span>
            <div className="grid gap-3 flex-1 sm:grid-cols-2">
              <Field label="Name" value={name} onChange={e => { setName(e.target.value); setDirty(true) }} disabled={!online} maxLength={80} />
              <Field label="Email" value={user?.email ?? 'Not signed in'} readOnly disabled />
            </div>
          </div>
          {online && <Row t="Password" d="Use at least 8 characters.">
            <Button size="sm" variant="secondary" onClick={() => setPw(p => ({ ...p, open: !p.open }))}>{pw.open ? 'Cancel' : 'Change password'}</Button>
          </Row>}
          <AnimatePresence>{pw.open && (
            <motion.form initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden" onSubmit={e => { e.preventDefault(); void changePw() }}>
              <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end pb-2">
                <Field label="Current password" type="password" autoComplete="current-password" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} required />
                <Field label="New password" type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} required />
                <Button variant="primary" disabled={pw.busy || pw.next.length < 8 || !pw.current}>{pw.busy ? 'Saving…' : 'Update'}</Button>
              </div>
            </motion.form>)}
          </AnimatePresence>
        </Card>
        <AiCard i={1} />
        <Card title="How the AI edits" i={2} sub="Both the AI agent and the built-in planner follow these.">
          <Row t="How hard to cut" d={label}>
            <div className="w-full sm:w-56">
              <input type="range" min={0} max={100} value={aggr} onChange={e => touch(setAggr)(+e.target.value)} aria-label="Cutting strength" className="w-full accent-amber-400" />
              <div className="flex justify-between text-[11.5px] text-fog-500"><span>Gentle</span><span>Tight</span></div>
            </div>
          </Row>
          <Row t="Keep jokes and asides" d="Laughter, and the beats around it, stay in even if they are slow."><Switch label="Keep jokes" on={keepJokes} onChange={touch(setKeepJokes)} /></Row>
          <Row t="Always show a plan first" d="The AI describes what it will do and marks the cuts before anything is applied."><Switch label="Plan first" on={planFirst} onChange={touch(setPlanFirst)} /></Row>
        </Card>
        <Card title="Export defaults" i={3} sub="Pre-selected in the export dialog; you can change them per render.">
          <Row t="Caption style" d="The style new projects start with."><Seg id="s-cap" value={cap} onChange={touch(setCap)} options={[['clean', 'Clean'], ['bold', 'Bold'], ['boxed', 'Boxed']]} /></Row>
          <Row t="Resolution" d="Never upscales past the original. Shorts render at 1080×1920 (720×1280 for 720p)."><Seg id="s-res" value={res} onChange={touch(setRes)} options={[['720', '720p'], ['1080', '1080p'], ['4k', '4K'], ['source', 'Original']]} /></Row>
          <Row t="Clean up audio" d="Reduce background hiss and level the loudness to −14 LUFS, the level YouTube and Shorts play at."><Switch label="Clean up audio" on={cleanAudio} onChange={touch(setCleanAudio)} /></Row>
        </Card>
        <Card title="Usage, last 30 days" i={4}>
          {online && usage ? (
            <div className="grid sm:grid-cols-4 gap-3 py-3">
              {([['Hours indexed', (usage.indexedMs / 3600000).toFixed(2)], ['Render minutes', (usage.renderedMs / 60000).toFixed(1)], ['AI runs applied', usage.agentRuns], ['AI requests', usage.aiRequests]] as const).map(([l, v]) => (
                <div key={l} className="rounded-2xl bg-ink-800 p-4"><div className="text-[12.5px] text-fog-400">{l}</div><div className="font-display text-[26px] font-semibold mt-1">{v}</div></div>
              ))}
              {usage.aiFallbacks > 0 && <p className="sm:col-span-4 text-[12.5px] text-fog-500">{usage.aiFallbacks} request{usage.aiFallbacks === 1 ? '' : 's'} fell back to the built-in planner (free-tier limit or provider error).</p>}
            </div>
          ) : <p className="py-4 text-[13.5px] text-fog-400">{online ? 'Loading…' : 'Sign in to see your usage.'}</p>}
        </Card>
        {online && <Card title="Delete account" i={5}>
          <Row t="Delete your account and all projects" d="Uploads, proxies, transcripts, renders and review links are removed straight away. This can’t be undone.">
            <Button variant="danger" onClick={() => setDel({ open: true, password: '', busy: false })}>Delete account</Button>
          </Row>
        </Card>}
      </div>
      <Modal open={del.open} onClose={() => setDel(d => ({ ...d, open: false }))} label="Delete account">
        <form className="p-6" onSubmit={e => { e.preventDefault(); void deleteAccount() }}>
          <h2 className="font-display text-[22px] font-semibold tracking-tight">Delete your account?</h2>
          <p className="text-[13.5px] text-fog-400 mt-1.5">Every project, upload and render for <b className="text-fog-200">{user?.email}</b> is deleted permanently. Enter your password to confirm.</p>
          <div className="mt-4"><Field label="Password" type="password" autoComplete="current-password" autoFocus value={del.password} onChange={e => setDel(d => ({ ...d, password: e.target.value }))} /></div>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDel(d => ({ ...d, open: false }))}>Keep my account</Button>
            <Button variant="danger" disabled={!del.password || del.busy}>{del.busy ? 'Deleting…' : 'Delete everything'}</Button>
          </div>
        </form>
      </Modal>
    </AppShell>
  )
}
