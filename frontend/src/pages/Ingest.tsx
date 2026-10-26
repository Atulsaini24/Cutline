import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Check, Pause, Play, WifiOff } from 'lucide-react'
import { Button, Logo, pageMotion } from '../components/ui'
import { transcribeLabel, useSession } from '../lib/session'
import { toast } from 'sonner'
import { onEvent, pendingFile, req, setPendingFile, subscribe, uploadFile, type UploadHandle } from '../lib/api'
import IngestDemo from './IngestDemo'

const IndexingScene = lazy(() => import('../components/three/Scenes').then(m => ({ default: m.IndexingScene })))
const STEPS: [string, string][] = [['probe', 'Reading the file'], ['proxy', 'Preview proxy'], ['audio', 'Audio and waveform'], ['silences', 'Pauses and silences'], ['scenes', 'Shot boundaries'], ['transcript', 'Transcript with word timings'], ['analysis', 'Filler words and repeated takes']]

/** Real upload + indexing against the backend; falls back to the simulated flow offline. */
export default function Ingest() {
  const mode = useSession(s => s.mode)
  const loc = useLocation() as { state?: { projectId?: string } }
  if (mode === 'checking') return <div className="h-screen grid place-items-center text-fog-400">Connecting…</div>
  if (mode !== 'online' || (!pendingFile && !loc.state?.projectId)) return <IngestDemo />
  return <RealIngest file={pendingFile} projectId={loc.state?.projectId ?? null} />
}

function RealIngest({ file, projectId: existing }: { file: File | null; projectId: string | null }) {
  const nav = useNavigate()
  const providers = useSession(s => s.providers)
  const [pid, setPid] = useState<string | null>(existing)
  const [parts, setParts] = useState<{ got: Set<number>; total: number }>({ got: new Set(), total: 0 })
  const [status, setStatus] = useState<{ text: string; tone?: 'error' | 'ok' }>({ text: file ? 'Starting' : 'Upload finished' })
  const [uploaded, setUploaded] = useState(!file)
  const [paused, setPaused] = useState(false)
  const [job, setJob] = useState<{ status: string; progress: number; step: string | null; error: string | null; result?: any } | null>(null)
  const [feed, setFeed] = useState<{ id: number; text: string; strong?: boolean }[]>([])
  const handle = useRef<UploadHandle>()
  const fid = useRef(0)
  const push = (text: string, strong = false) => setFeed(f => [...f, { id: ++fid.current, text, strong }])
  const title = file ? file.name.replace(/\.[a-z0-9]+$/i, '') : 'Your recording'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        let id = existing
        if (!id && file) { const r = await req('POST', '/projects', { title }); id = r.project.id; setPid(id) }
        subscribe(id!)
        if (file) {
          handle.current = uploadFile(id!, file, { onParts: (got, total) => setParts({ got: new Set(got), total }), onStatus: (text, tone) => { setStatus({ text, tone }); if (tone === 'ok' && text.startsWith('Back')) push('Upload resumed. Parts already stored were not sent again.') } })
          await handle.current.done; if (cancelled) return
          setPendingFile(null); setUploaded(true); setStatus({ text: 'Uploaded', tone: 'ok' }); push('Upload complete. Indexing job queued.', true)
        } else {
          const d = await req('GET', `/projects/${id}`); if (d.project.job) setJob(d.project.job)
          if (d.project.status === 'ready') setJob({ status: 'done', progress: 1, step: 'done', error: null })
        }
      } catch (e) { setStatus({ text: (e as Error).message, tone: 'error' }) }
    })()
    return () => { cancelled = true }
  }, [])
  useEffect(() => onEvent(m => {
    if (m.type !== 'job' || m.job.type !== 'ingest' || (pid && m.projectId !== pid)) return
    setJob(prev => {
      if (m.job.step && m.job.step !== prev?.step) { const label = STEPS.find(s => s[0] === prev?.step)?.[1]; if (label) push(`${label}: done`) }
      return m.job
    })
    if (m.job.status === 'done' && m.job.result) { const r = m.job.result; push(r.source === 'whisper' ? `Transcript ready (${r.engine ?? 'Whisper'}): ${r.words} words in ${r.lines} lines, ${r.fillers} filler words, ${r.retakes} repeated takes.` : `Found ${r.lines} stretches of speech, but no words. ${r.note ?? 'Set up free transcription in Settings, then re-index.'}`, true) }
    if (m.job.status === 'queued' && m.job.error) push(`A step failed and will retry: ${m.job.error}`)
  }), [pid])

  const retry = async () => {
    if (!pid) return
    try { const r = await req('POST', `/projects/${pid}/reindex`); setFeed([]); setJob({ status: 'queued', progress: 0, step: null, error: null }); push(`Indexing queued again (${r.jobId}).`) }
    catch (e) { toast.error('Couldn’t retry', { description: (e as Error).message }) }
  }
  const stepIdx = job ? (job.status === 'done' ? STEPS.length : STEPS.findIndex(s => s[0] === job.step)) : -1
  const upFrac = parts.total ? parts.got.size / parts.total : 0
  const overall = uploaded ? 0.2 + 0.8 * (job?.progress ?? 0) : upFrac * 0.2
  const done = job?.status === 'done'
  const cells = Math.min(parts.total || 40, 120)

  return (
    <motion.div {...pageMotion} className="min-h-full">
      <header className="flex items-center gap-4 px-6 md:px-10 py-5 border-b border-ink-750">
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={15} />} onClick={() => nav('/projects')}>Projects</Button><Logo size={22} />
      </header>
      <main className="px-6 md:px-10 py-8 max-w-[1240px] mx-auto grid lg:grid-cols-[1fr_1.05fr] gap-8 items-start">
        <section>
          <h1 className="font-display text-[30px] md:text-[38px] font-semibold tracking-[-0.03em] leading-tight break-words">{file?.name ?? title}</h1>
          {file && <p className="text-fog-400 mt-1">{file.size >= 1024 ** 3 ? (file.size / 1024 ** 3).toFixed(2) + ' GB' : Math.max(1, Math.round(file.size / 1024 ** 2)) + ' MB'}, {parts.total || '…'} parts of 8 MB, three at a time</p>}
          {file && <div className="mt-7 rounded-2xl border border-ink-700 bg-ink-850 p-5">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Upload</h2><span className="font-display text-[22px] font-semibold">{Math.round(upFrac * 100)}%</span></div>
            <div className="grid gap-[3px] mt-4" style={{ gridTemplateColumns: `repeat(${Math.min(20, cells)}, minmax(0,1fr))` }}>
              {Array.from({ length: cells }).map((_, k) => { const lo = Math.floor(k * (parts.total || 1) / cells); const on = parts.got.has(lo); return <motion.span key={k} className="aspect-square rounded-[3px]" animate={{ backgroundColor: on ? '#7CC4FF' : status.tone === 'error' ? '#4a2a2a' : '#2D323D' }} transition={{ duration: .25 }} /> })}
            </div>
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <AnimatePresence mode="wait"><motion.span key={status.text} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`text-[13.5px] ${status.tone === 'error' ? 'text-coral-400' : status.tone === 'ok' ? 'text-jade-400' : 'text-fog-300'}`}>{status.text}</motion.span></AnimatePresence>
              {!uploaded && <div className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" icon={paused ? <Play size={14} /> : <Pause size={14} />} onClick={() => { paused ? handle.current?.resume() : handle.current?.pause(); setPaused(!paused); setStatus({ text: paused ? 'Uploading' : 'Paused. Close this tab if you like; the upload resumes from here.' }) }}>{paused ? 'Resume' : 'Pause'}</Button>
                <Button size="sm" variant="ghost" icon={<WifiOff size={14} />} onClick={() => handle.current?.dropConnection()}>Drop connection</Button>
              </div>}
            </div>
          </div>}
          <div className="mt-5 rounded-2xl border border-ink-700 bg-ink-850 p-5">
            <h2 className="font-semibold">Indexing on the server</h2>
            <p className="text-[13.5px] text-fog-400 mt-0.5">Transcription: {transcribeLabel(providers?.transcribe)}.</p>
            <ul className="mt-4 grid gap-3">
              {STEPS.map(([key, label], i) => {
                const st = !uploaded || stepIdx < 0 ? 'wait' : i < stepIdx ? 'done' : i === stepIdx ? 'run' : 'wait'
                return (
                  <li key={key} className="flex items-center gap-3">
                    <span className="w-[18px] h-[18px] grid place-items-center">{st === 'done' ? <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-[18px] h-[18px] rounded-full bg-jade-500 grid place-items-center text-ink-900"><Check size={12} strokeWidth={3} /></motion.span> : st === 'run' ? <span className="w-4 h-4 rounded-full border-2 border-amber-400 border-r-transparent animate-spin" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-ink-600" />}</span>
                    <span className={`text-[14px] ${st === 'wait' ? 'text-fog-400' : 'text-fog-100'}`}>{label}</span>
                  </li>
                )
              })}
            </ul>
            {job?.status === 'failed' && <div className="mt-4 rounded-xl bg-coral-500/10 border border-coral-500/20 p-3.5">
              <p className="text-[13.5px] text-coral-400">Indexing failed: {job.error}</p>
              <div className="mt-3 flex gap-2"><Button size="sm" variant="secondary" onClick={retry}>Try again</Button><Button size="sm" variant="ghost" onClick={() => nav('/projects')}>Back to projects</Button></div>
            </div>}
            {job?.status === 'queued' && job.error && <p className="mt-3 text-[12.5px] text-fog-400">A step failed and will retry automatically: {job.error}</p>}
          </div>
        </section>
        <section className="lg:sticky lg:top-6">
          <div className="relative rounded-3xl border border-ink-700 bg-[radial-gradient(70%_70%_at_50%_45%,#232833,#15181E)] overflow-hidden">
            <Suspense fallback={<div className="aspect-[4/3.3]" />}><IndexingScene progress={overall} className="aspect-[4/3.3]" /></Suspense>
            <div className="absolute left-5 top-4 text-[13px] text-fog-300"><div className="font-display text-[34px] font-semibold text-fog-100 leading-none">{Math.round(overall * 100)}%</div>{done ? 'Ready to edit' : uploaded ? STEPS[Math.max(0, stepIdx)]?.[1] ?? 'Queued' : 'Uploading'}</div>
          </div>
          <div className="mt-4 rounded-2xl border border-ink-700 bg-ink-850 p-4">
            <div className="text-[13px] font-semibold text-fog-300 mb-2">What we’re finding</div>
            <div className="grid gap-1.5 max-h-[220px] overflow-auto pr-1">
              <AnimatePresence initial={false}>{feed.map(f => <motion.div key={f.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`text-[13.5px] px-3 py-2 rounded-lg ${f.strong ? 'bg-amber-400/10 text-amber-200' : 'bg-ink-800 text-fog-200'}`}>{f.text}</motion.div>)}</AnimatePresence>
              {!feed.length && <div className="text-[13px] text-fog-500 px-1">Results appear here as each step finishes.</div>}
            </div>
            <div className="mt-4"><Button variant={done ? 'agent' : 'secondary'} disabled={!done || !pid} onClick={() => nav(`/editor/${pid}`)}>Open in editor</Button></div>
          </div>
        </section>
      </main>
    </motion.div>
  )
}
