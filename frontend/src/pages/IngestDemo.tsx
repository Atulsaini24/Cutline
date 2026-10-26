import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Check, WifiOff } from 'lucide-react'
import { Button, Logo, pageMotion } from '../components/ui'
import { SENTS, STATS } from '../lib/sample'
import { useEditor } from '../store/editor'

const IndexingScene = lazy(() => import('../components/three/Scenes').then(m => ({ default: m.IndexingScene })))

const PARTS = 40
const STEPS: { name: string; ms: number; result: string }[] = [
  { name: 'Preview proxy', ms: 2600, result: 'Proxy ready: 960×540 with a keyframe every half second.' },
  { name: 'Transcript with word timings', ms: 3400, result: `Transcript ready: ${STATS.words} words across ${STATS.lines} lines.` },
  { name: 'Who is speaking', ms: 2200, result: 'Found 2 speakers: Maya and Dev.' },
  { name: 'Shot boundaries', ms: 1800, result: `Found ${STATS.shots} shots.` },
  { name: 'Filler words and pauses', ms: 1500, result: `${STATS.fillers} filler words and ${STATS.pauses} pauses over 1.5 s.` },
  { name: 'Repeated takes', ms: 1700, result: `${STATS.retakes} lines were said twice. The later take is usually the keeper.` },
  { name: 'Frame descriptions', ms: 2400, result: '“Two people at a desk, moving blankets on the wall, soft key light.”' },
]

export default function IngestDemo() {
  const nav = useNavigate()
  const loc = useLocation() as { state?: { name?: string; size?: number } }
  const name = loc.state?.name ?? 'Episode 15, raw recording.mp4'
  const size = loc.state?.size || 2.4 * 1024 ** 3
  const reset = useEditor(s => s.reset)

  const [done, setDone] = useState(0)
  const [failed, setFailed] = useState<number | null>(null)
  const [status, setStatus] = useState('Starting')
  const [stepP, setStepP] = useState<number[]>(STEPS.map(() => 0))
  const [feed, setFeed] = useState<{ id: number; html: string; strong?: boolean }[]>([])
  const paused = useRef(false)
  const doneRef = useRef(0)
  const fid = useRef(0)
  const push = (html: string, strong = false) => setFeed(f => [...f, { id: ++fid.current, html, strong }])

  // upload
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const tick = () => {
      if (paused.current) { t = setTimeout(tick, 120); return }
      doneRef.current++; setDone(doneRef.current)
      setStatus(doneRef.current < PARTS ? `Part ${doneRef.current} of ${PARTS}` : 'Uploaded')
      if (doneRef.current < PARTS) t = setTimeout(tick, 70)
      else push('Upload complete. Indexing jobs queued.', true)
    }
    t = setTimeout(tick, 400)
    return () => clearTimeout(t)
  }, [])

  // indexing: two lanes in parallel once upload finishes
  useEffect(() => {
    if (done < PARTS) return
    let cancelled = false
    const run = (i: number) => {
      if (i >= STEPS.length || cancelled) return
      const t0 = performance.now()
      const anim = () => {
        if (cancelled) return
        const p = Math.min(1, (performance.now() - t0) / STEPS[i].ms)
        setStepP(prev => { const n = [...prev]; n[i] = p; return n })
        if (p < 1) requestAnimationFrame(anim)
        else { push(STEPS[i].result); if (i === 1) push(`First line: “${SENTS[2].w.map(w => w.text).join(' ')}”`); run(i + 2) }
      }
      requestAnimationFrame(anim)
    }
    run(0); const t = setTimeout(() => run(1), 450)
    return () => { cancelled = true; clearTimeout(t) }
  }, [done >= PARTS])

  const allDone = stepP.every(p => p >= 1)
  useEffect(() => { if (allDone) push('Indexing finished. Your project is ready.', true) }, [allDone])
  const transcriptReady = stepP[1] >= 1
  const overall = (done / PARTS) * 0.25 + (stepP.reduce((a, b) => a + b, 0) / STEPS.length) * 0.75

  const dropConnection = () => {
    if (paused.current || doneRef.current >= PARTS) return
    paused.current = true; const at = doneRef.current; setFailed(at)
    setStatus('Connection lost. Retrying…')
    setTimeout(() => {
      setStatus(`Back online. Resumed from part ${at + 1}; ${at} parts were already stored.`)
      push(`Upload resumed from part ${at + 1} of ${PARTS}. Nothing was sent twice.`)
      setFailed(null); paused.current = false
    }, 1700)
  }
  const open = () => { reset(name.replace(/\.[a-z0-9]+$/i, '')); nav('/editor') }
  const gb = size / 1024 ** 3

  return (
    <motion.div {...pageMotion} className="min-h-full">
      <header className="flex items-center gap-4 px-6 md:px-10 py-5 border-b border-ink-750">
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={15} />} onClick={() => nav('/projects')}>Projects</Button>
        <Logo size={22} />
      </header>
      <main className="px-6 md:px-10 py-8 max-w-[1240px] mx-auto grid lg:grid-cols-[1fr_1.05fr] gap-8 items-start">
        <section>
          <h1 className="font-display text-[30px] md:text-[38px] font-semibold tracking-[-0.03em] leading-tight break-words">{name}</h1>
          <p className="text-fog-400 mt-1">{gb >= 1 ? gb.toFixed(1) + ' GB' : Math.round(size / 1024 ** 2) + ' MB'}, sent in {PARTS} parts straight to storage</p>

          <div className="mt-7 rounded-2xl border border-ink-700 bg-ink-850 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Upload</h2>
              <span className="font-display text-[22px] font-semibold">{Math.round(done / PARTS * 100)}%</span>
            </div>
            <div className="grid grid-cols-20 gap-[3px] mt-4" style={{ gridTemplateColumns: 'repeat(20, minmax(0, 1fr))' }}>
              {Array.from({ length: PARTS }).map((_, k) => (
                <motion.span key={k} className="aspect-square rounded-[3px]"
                  animate={{ backgroundColor: failed === k ? '#F0675A' : k < done ? '#7CC4FF' : '#2D323D', scale: k === done - 1 ? [1, 1.35, 1] : 1 }}
                  transition={{ duration: 0.25 }} />
              ))}
            </div>
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <AnimatePresence mode="wait">
                <motion.span key={status} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`text-[13.5px] ${failed !== null ? 'text-coral-400' : 'text-fog-300'}`}>{status}</motion.span>
              </AnimatePresence>
              <Button size="sm" variant="ghost" className="ml-auto" icon={<WifiOff size={14} />} disabled={done >= PARTS || failed !== null} onClick={dropConnection}>Simulate a dropped connection</Button>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-ink-700 bg-ink-850 p-5">
            <h2 className="font-semibold">Indexing</h2>
            <p className="text-[13.5px] text-fog-400 mt-0.5">Runs in the background. The editor opens as soon as the transcript is ready.</p>
            <ul className="mt-4 grid gap-3.5">
              {STEPS.map((s, i) => {
                const p = stepP[i]; const state = p >= 1 ? 'done' : p > 0 ? 'run' : 'wait'
                return (
                  <li key={s.name} className="grid grid-cols-[22px_1fr_auto] items-center gap-x-3 gap-y-1.5">
                    <span className="w-[18px] h-[18px] grid place-items-center">
                      {state === 'done' ? <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-[18px] h-[18px] rounded-full bg-jade-500 grid place-items-center text-ink-900"><Check size={12} strokeWidth={3} /></motion.span>
                        : state === 'run' ? <span className="w-4 h-4 rounded-full border-2 border-amber-400 border-r-transparent animate-spin" />
                          : <span className="w-3.5 h-3.5 rounded-full border-2 border-ink-600" />}
                    </span>
                    <span className={`text-[14px] ${state === 'wait' ? 'text-fog-400' : 'text-fog-100'}`}>{s.name}</span>
                    <span className="text-[12px] text-fog-500">{state === 'done' ? 'Done' : state === 'run' ? Math.round(p * 100) + '%' : 'Waiting'}</span>
                    <span className="col-start-2 col-span-2 h-[3px] rounded bg-ink-750 overflow-hidden"><span className="block h-full bg-amber-400 transition-[width] duration-100" style={{ width: `${p * 100}%` }} /></span>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>

        <section className="lg:sticky lg:top-6">
          <div className="relative rounded-3xl border border-ink-700 bg-[radial-gradient(70%_70%_at_50%_45%,#232833,#15181E)] overflow-hidden">
            <Suspense fallback={<div className="aspect-[4/3.3]" />}><IndexingScene progress={overall} className="aspect-[4/3.3]" /></Suspense>
            <div className="absolute left-5 top-4 text-[13px] text-fog-300">
              <div className="font-display text-[34px] font-semibold text-fog-100 leading-none">{Math.round(overall * 100)}%</div>
              {allDone ? 'Everything indexed' : done < PARTS ? 'Uploading' : 'Reading your recording'}
            </div>
            <div className="absolute right-5 top-5 flex gap-3 text-[12px] text-fog-300">
              <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-sky-400" />Maya</span>
              <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-jade-400" />Dev</span>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-ink-700 bg-ink-850 p-4">
            <div className="text-[13px] font-semibold text-fog-300 mb-2">What we’re finding</div>
            <div className="grid gap-1.5 max-h-[220px] overflow-auto pr-1">
              <AnimatePresence initial={false}>
                {feed.map(f => (
                  <motion.div key={f.id} layout initial={{ opacity: 0, y: 10, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                    className={`text-[13.5px] px-3 py-2 rounded-lg ${f.strong ? 'bg-amber-400/10 text-amber-200' : 'bg-ink-800 text-fog-200'}`}>{f.html}</motion.div>
                ))}
              </AnimatePresence>
              {!feed.length && <div className="text-[13px] text-fog-500 px-1">Results appear here as each worker finishes.</div>}
            </div>
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <Button variant={transcriptReady ? 'agent' : 'secondary'} disabled={!transcriptReady} onClick={open}>Open in editor</Button>
              <span className="text-[12.5px] text-fog-500">This prototype previews with a sample recording.</span>
            </div>
          </div>
        </section>
      </main>
    </motion.div>
  )
}
