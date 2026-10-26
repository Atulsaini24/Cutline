import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from 'framer-motion'
import { ArrowRight, AudioLines, Captions, History, MousePointerClick, Scissors, ShieldCheck, Smartphone, Sparkles, Undo2, UploadCloud, Wand2 } from 'lucide-react'
import { Button, Kbd } from '../components/ui'
import { CountUp, Magnetic, Marquee, Reveal, SplitText, Spotlight, Tilt } from '../components/fx'
import { MarketingLayout } from '../components/site'
import { frameCanvas } from '../lib/draw'
import { SENTS } from '../lib/sample'

const FilmRibbon = lazy(() => import('../components/three/FilmRibbon'))
const StoryScene = lazy(() => import('../components/three/Story').then(m => ({ default: m.StoryScene })))
const GlassMark = lazy(() => import('../components/three/Story').then(m => ({ default: m.GlassMark })))
const ease = [0.2, 0.8, 0.2, 1] as const

const PROMPTS = ['Tighten the first 15 seconds and remove repeated takes', 'Make three Shorts with bold captions', 'Cut the filler words, but keep the jokes', 'Find the strongest hook and open on it']

function TypedPrompt() {
  const [i, setI] = useState(0); const [n, setN] = useState(0)
  useEffect(() => {
    const full = PROMPTS[i]
    if (n < full.length) { const t = setTimeout(() => setN(n + 1), 26 + Math.random() * 40); return () => clearTimeout(t) }
    const t = setTimeout(() => { setI((i + 1) % PROMPTS.length); setN(0) }, 2400); return () => clearTimeout(t)
  }, [i, n])
  return <span>{PROMPTS[i].slice(0, n)}<motion.span className="inline-block w-[2px] h-[1.1em] align-[-3px] bg-amber-400 ml-0.5" animate={{ opacity: [1, 0, 1] }} transition={{ duration: 1, repeat: Infinity }} /></span>
}

/* ============ 1. Hero ============ */
function Hero() {
  const nav = useNavigate()
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const textY = useTransform(scrollYProgress, [0, 1], ['0%', '-35%'])
  const textO = useTransform(scrollYProgress, [0, 0.55], [1, 0])
  const ribbonScale = useTransform(scrollYProgress, [0, 1], [1, 1.25])
  const ribbonY = useTransform(scrollYProgress, [0, 1], ['0%', '-18%'])
  const chips = [
    { t: '−43.6 s', d: 'tighter', x: '8%', y: '18%' },
    { t: '14 edits', d: 'from one instruction', x: '78%', y: '6%' },
    { t: '3 Shorts', d: 'vertical, captioned', x: '84%', y: '60%' },
  ]
  return (
    <section ref={ref} className="relative min-h-[112svh] flex flex-col overflow-hidden grain">
      <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_30%,#1F232C_0%,#14171D_70%)]" />
      <div aria-hidden className="absolute inset-0 opacity-[.35] [background-image:linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(70%_60%_at_50%_30%,#000,transparent)]" />
      <Spotlight />
      <motion.div style={{ y: textY, opacity: textO }} className="relative z-10 px-6 md:px-10 pt-[15vh] md:pt-[15vh] max-w-[1240px] w-full mx-auto">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="inline-flex items-center gap-2 rounded-full border border-ink-600 bg-ink-850/70 backdrop-blur px-3 py-1 text-[12.5px] text-fog-300">
          <span className="relative flex w-2 h-2"><span className="absolute inset-0 rounded-full bg-amber-400 animate-ping opacity-70" /><span className="relative w-2 h-2 rounded-full bg-amber-400" /></span>
          The AI proposes. You approve every cut.
        </motion.div>
        <SplitText text="Describe the edit. Review every cut." delay={0.25}
          className="mt-6 font-display font-semibold tracking-[-0.045em] text-[48px] leading-[0.95] sm:text-[68px] md:text-[88px] max-w-[14ch]" />
        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 0.75 }}
          className="mt-7 max-w-[50ch] text-[17px] md:text-[18px] leading-relaxed text-fog-300">
          Cutline reads your recording, plans the edit you ask for, and puts it on a real timeline. Every cut can be inspected, nudged, or undone in one click.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 20, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.8, ease, delay: 0.9 }}
          className="mt-9 max-w-[640px] rounded-2xl p-[1px] bg-[conic-gradient(from_var(--a),#F7BE4A22,#F7BE4A,#7CC4FF,#F7BE4A22)] [animation:spin-border_6s_linear_infinite]">
          <div className="rounded-2xl bg-ink-850/95 backdrop-blur-xl p-2 pl-4 flex items-center gap-3">
            <Sparkles size={18} className="text-amber-400 shrink-0" />
            <div className="flex-1 min-w-0 truncate text-[15px] text-fog-100 py-2" data-cursor="Try it" onClick={() => nav('/editor')}><TypedPrompt /></div>
            <Button variant="agent" onClick={() => nav('/editor')}>Plan edit</Button>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }} className="mt-6 flex flex-wrap gap-3">
          <Magnetic><Button size="lg" variant="primary" onClick={() => nav('/editor')}>Open the demo project <ArrowRight size={17} /></Button></Magnetic>
          <Magnetic><Button size="lg" variant="secondary" icon={<UploadCloud size={17} />} onClick={() => nav('/projects')}>Upload a video</Button></Magnetic>
        </motion.div>
      </motion.div>
      <motion.div style={{ scale: ribbonScale, y: ribbonY }} className="relative z-0 flex-1 min-h-[300px] -mt-10">
        <Suspense fallback={null}><FilmRibbon className="absolute inset-0" /></Suspense>
        {chips.map((c, i) => (
          <motion.div key={c.t} className="absolute hidden md:block" style={{ left: c.x, top: c.y }}
            initial={{ opacity: 0, y: 20, scale: .8 }} animate={{ opacity: 1, y: [0, -10, 0], scale: 1 }}
            transition={{ opacity: { delay: 1.4 + i * 0.15 }, scale: { delay: 1.4 + i * 0.15 }, y: { duration: 4 + i, repeat: Infinity, ease: 'easeInOut' } }}>
            <div className="rounded-xl border border-ink-600/80 bg-ink-850/70 backdrop-blur-xl px-3.5 py-2 shadow-lift">
              <div className="font-display text-[20px] font-semibold text-amber-300 leading-none">{c.t}</div>
              <div className="text-[11.5px] text-fog-400 mt-1">{c.d}</div>
            </div>
          </motion.div>
        ))}
      </motion.div>
      <motion.div style={{ opacity: textO }} className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 text-[12px] text-fog-400">
        Scroll
        <span className="w-[22px] h-[34px] rounded-full border border-ink-500 flex justify-center pt-1.5"><motion.span className="w-1 h-1.5 rounded-full bg-amber-400" animate={{ y: [0, 10, 0], opacity: [1, 0.2, 1] }} transition={{ duration: 1.6, repeat: Infinity }} /></span>
      </motion.div>
    </section>
  )
}

/* ============ 2. Instruction marquee ============ */
const ASKS = ['Tighten the first 15 seconds', 'Remove every “um” and “uh”', 'Keep the last take of each line', 'Make three Shorts', 'Add bold captions', 'Shorten pauses over 1.5 s', 'Open on the strongest hook', 'Cut the dead air before the intro']
function Asks() {
  const chip = (t: string, i: number) => (
    <span className="inline-flex items-center gap-2.5 rounded-full border border-ink-700 bg-ink-850 px-5 py-3 text-[16px] text-fog-200 whitespace-nowrap">
      <Wand2 size={16} className={i % 2 ? 'text-sky-400' : 'text-amber-400'} />{t}
    </span>
  )
  return (
    <section className="py-14 grid gap-4 border-y border-ink-750 bg-ink-900">
      <Marquee items={ASKS.map(chip)} />
      <Marquee reverse items={[...ASKS].reverse().map(chip)} />
    </section>
  )
}

/* ============ 3. Scroll story with 3D flow ============ */
const STEPS = [
  { k: 'Upload', t: 'A pile of raw footage', d: 'Drop a long recording. It uploads in parts, resumes after a dropped connection, and gets transcribed word by word.', icon: UploadCloud },
  { k: 'Index', t: 'Laid out as a timeline', d: 'Speakers, shots, filler words, pauses and repeated takes are found and lined up against every word you said.', icon: AudioLines },
  { k: 'Edit', t: 'The AI cuts, you review', d: 'Ask for an edit. Proposed cuts are marked first; applied ones lift out and the timeline closes the gap. One click reverts the run.', icon: Scissors },
  { k: 'Export', t: 'One recording, many outputs', d: 'The best moments become vertical Shorts with captions and the speaker kept in frame, ready to render.', icon: Smartphone },
]
function Story() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const p = useSpring(scrollYProgress, { stiffness: 90, damping: 24, mass: 0.4 })
  const [step, setStep] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', v => setStep(v < 0.24 ? 0 : v < 0.5 ? 1 : v < 0.72 ? 2 : 3))
  const bar = useTransform(scrollYProgress, [0, 1], ['0%', '100%'])
  return (
    <section id="how" ref={ref} className="relative h-[460vh]">
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_60%_50%,#1E222A,#14171D)]" />
        <Suspense fallback={null}><StoryScene progress={p} className="absolute inset-0" /></Suspense>
        <div aria-hidden className="absolute inset-y-0 left-0 w-full md:w-[40%] bg-gradient-to-t md:bg-gradient-to-r from-ink-900 via-ink-900/60 to-transparent pointer-events-none" />
        <div className="relative z-10 h-full max-w-[1240px] mx-auto px-6 md:px-10 flex flex-col justify-end md:justify-center pb-14 md:pb-0 pointer-events-none">
          <div className="text-[13px] text-fog-400 font-semibold">How it works</div>
          <div className="mt-4 relative max-w-[400px] min-h-[240px]">
            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, y: 30, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -20, filter: 'blur(8px)' }} transition={{ duration: 0.5, ease }}>
                <div className="flex items-baseline gap-3">
                  <span className="font-display text-[64px] md:text-[88px] leading-none font-bold text-transparent [-webkit-text-stroke:1.5px_#4D5462]">{step + 1}</span>
                  <span className="text-[14px] font-semibold text-amber-300">{STEPS[step].k}</span>
                </div>
                <h3 className="mt-3 font-display text-[32px] md:text-[44px] font-semibold tracking-[-0.03em] leading-[1.02]">{STEPS[step].t}</h3>
                <p className="mt-4 text-[16px] leading-relaxed text-fog-300">{STEPS[step].d}</p>
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="mt-10 flex items-center gap-3 max-w-[400px]">
            {STEPS.map((s, i) => (
              <div key={s.k} className={`flex-1 flex items-center gap-1.5 text-[12px] font-semibold transition-colors ${i <= step ? 'text-fog-100' : 'text-fog-500'}`}><s.icon size={13} />{s.k}</div>
            ))}
          </div>
          <div className="mt-2 h-[2px] max-w-[400px] bg-ink-700 rounded overflow-hidden"><motion.div className="h-full bg-amber-400" style={{ width: bar }} /></div>
        </div>
      </div>
    </section>
  )
}

/* ============ 4. Statement that lights up word by word ============ */
function Word({ w, range, p }: { w: string; range: [number, number]; p: MotionValue<number> }) {
  const o = useTransform(p, range, [0.12, 1]); const c = useTransform(p, range, ['#6B7282', w.startsWith('*') ? '#F7BE4A' : '#EEF0F5'])
  return <motion.span style={{ opacity: o, color: c }} className="inline-block mr-[0.25em]">{w.replace('*', '')}</motion.span>
}
function Statement() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.45'] })
  const words = 'The AI never touches your video. It can only *propose small, *typed edits. Each one is *checked against your timeline, written to a history you can scroll back through, and *grouped so one click undoes a whole instruction.'.split(' ')
  return (
    <section ref={ref} className="px-6 md:px-10 py-36 max-w-[1240px] mx-auto">
      <p className="font-display text-[32px] sm:text-[44px] md:text-[60px] font-semibold tracking-[-0.03em] leading-[1.08]">
        {words.map((w, i) => <Word key={i} w={w} p={scrollYProgress} range={[i / words.length, (i + 1) / words.length]} />)}
      </p>
    </section>
  )
}

/* ============ 5. Bento features ============ */
function MiniTranscript() {
  const words = 'Most people think a home studio costs, uh, thousands of dollars.'.split(' ')
  return (
    <p className="text-[15px] leading-8 text-fog-200">
      {words.map((w, k) => {
        const cut = w === 'uh,'
        return <span key={k} className="relative mr-1.5 inline-block">
          <motion.span className="inline-block" animate={cut ? { opacity: [1, 1, 0.45, 0.45, 1], color: ['#EEF0F5', '#EEF0F5', '#F7BE4A', '#F7BE4A', '#EEF0F5'] } : {}} transition={{ duration: 4, repeat: Infinity, times: [0, .25, .35, .85, 1] }}>{w}</motion.span>
          {cut && <motion.span className="absolute left-0 right-0 top-1/2 h-[2px] bg-amber-400 origin-left" animate={{ scaleX: [0, 0, 1, 1, 0] }} transition={{ duration: 4, repeat: Infinity, times: [0, .25, .35, .85, 1] }} />}
        </span>
      })}
    </p>
  )
}
function MiniUndo() {
  const [on, setOn] = useState(true)
  useEffect(() => { const t = setInterval(() => setOn(o => !o), 2000); return () => clearInterval(t) }, [])
  const clips = on ? [[0, 30], [30, 52], [52, 100]] : [[0, 30], [30, 41, 1], [41, 63], [63, 75, 1], [75, 100]]
  return (
    <div>
      <div className="relative h-11 rounded-lg bg-ink-800 overflow-hidden">
        {clips.map(([a, b, x], k) => <motion.div key={(on ? 'a' : 'b') + k} className={`absolute top-1.5 bottom-1.5 rounded-md ${x ? 'bg-amber-400/40 border border-amber-400' : 'bg-sky-500/70'}`} initial={{ opacity: 0 }} animate={{ opacity: 1, left: `${a}%`, width: `${b - a - 1}%` }} transition={{ duration: 0.6, ease }} />)}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[13px] text-fog-300"><Kbd>⌘Z</Kbd> {on ? 'Run applied' : 'Whole run undone'}</div>
    </div>
  )
}
function MiniCaptions() {
  const w = ['Your', 'room', 'is', 'the', 'biggest', 'mic']
  const [i, setI] = useState(0)
  useEffect(() => { const t = setInterval(() => setI(x => (x + 1) % w.length), 420); return () => clearInterval(t) }, [])
  const s = Math.floor(i / 3) * 3
  return (
    <div className="h-24 rounded-xl bg-gradient-to-b from-[#2f3540] to-[#191c22] grid place-items-center">
      <div className="font-display font-extrabold text-[26px] tracking-tight [text-shadow:0_2px_0_#000]">
        {w.slice(s, s + 3).map((x, k) => <motion.span key={x} animate={{ color: s + k === i ? '#FFD27A' : '#ffffff', scale: s + k === i ? 1.1 : 1 }} className="inline-block mx-1">{x}</motion.span>)}
      </div>
    </div>
  )
}
function MiniUpload() {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(12,1fr)' }}>
      {Array.from({ length: 36 }).map((_, k) => <motion.span key={k} className="aspect-square rounded-[3px]" animate={{ backgroundColor: k === 21 ? ['#2D323D', '#F0675A', '#F0675A', '#7CC4FF', '#7CC4FF'] : ['#2D323D', '#7CC4FF', '#7CC4FF'] }} transition={{ duration: 5, repeat: Infinity, delay: k * 0.06 + (k > 21 ? 0.7 : 0), times: k === 21 ? [0, .1, .3, .4, 1] : [0, .08, 1] }} />)}
    </div>
  )
}
function MiniHistory() {
  const rows = [['v4', 'Trimmed clip end', 'sky'], ['v3', 'AI run 1: 14 edits', 'amber'], ['v2', 'Added B-roll', 'sky'], ['v1', 'Cut “so, um,”', 'sky']]
  return (
    <div className="relative grid gap-1.5">
      <span className="absolute left-[5px] top-2 bottom-2 w-px bg-ink-600" />
      {rows.map(([v, l, c], i) => <motion.div key={v} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.12 }} className="relative flex items-center gap-3 text-[13px]"><span className={`w-[11px] h-[11px] rounded-full ring-4 ring-ink-850 ${c === 'amber' ? 'bg-amber-400' : 'bg-sky-400'}`} /><span className="text-fog-500 w-6">{v}</span><span className="text-fog-200">{l}</span></motion.div>)}
    </div>
  )
}
function MiniValidate() {
  return (
    <div className="grid gap-1.5 text-[13px]">
      {['cut 0:00.0 to 0:15.6', 'cut 0:20.7 to 0:28.2', 'trim clip 4 end'].map((t, i) => (
        <motion.div key={t} className="flex items-center gap-2 rounded-lg bg-ink-800 px-3 py-2" initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.2 }}>
          <motion.span initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.4 + i * 0.2, type: 'spring' }}><ShieldCheck size={15} className="text-jade-400" /></motion.span>
          <span className="text-fog-200">{t}</span><span className="ml-auto text-[11.5px] text-jade-400">valid</span>
        </motion.div>
      ))}
    </div>
  )
}
const BENTO = [
  { t: 'Edit by deleting words', d: 'Select words in the transcript and press Delete. The video follows.', c: <MiniTranscript />, cls: 'md:col-span-2', icon: MousePointerClick },
  { t: 'Undo a whole instruction', d: 'Every AI run is grouped, so one undo puts all of it back.', c: <MiniUndo />, cls: 'md:col-span-2', icon: Undo2 },
  { t: 'Captions that keep up', d: 'Generated from word timings, styled for Shorts, and editable.', c: <MiniCaptions />, cls: '', icon: Captions },
  { t: 'Checked before applied', d: 'Each proposed edit is validated against the current timeline first.', c: <MiniValidate />, cls: '', icon: ShieldCheck },
  { t: 'Uploads that survive', d: 'Hours of footage upload in parts and resume where they stopped.', c: <MiniUpload />, cls: '', icon: UploadCloud },
  { t: 'A history you can walk back', d: 'Jump to any version, save snapshots, restore them later.', c: <MiniHistory />, cls: '', icon: History },
]
function Bento() {
  return (
    <section className="px-6 md:px-10 pb-32 max-w-[1240px] mx-auto">
      <SplitText as="h2" text="Everything you need to trust the cut" className="font-display text-[36px] md:text-[56px] font-semibold tracking-[-0.035em] leading-[1] max-w-[16ch]" />
      <div className="mt-12 grid md:grid-cols-4 gap-4" style={{ perspective: 1400 }}>
        {BENTO.map((b, i) => (
          <Reveal key={b.t} delay={(i % 4) * 0.08} className={b.cls}>
            <Tilt max={5} className="h-full rounded-3xl border border-ink-700 bg-gradient-to-b from-ink-800 to-ink-850 p-6 flex flex-col overflow-hidden group">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 shrink-0 rounded-xl bg-ink-750 border border-ink-600 grid place-items-center text-amber-300 group-hover:rotate-[-8deg] group-hover:scale-110 transition"><b.icon size={17} /></span>
                <h3 className="font-display text-[19px] font-semibold tracking-tight leading-tight">{b.t}</h3>
              </div>
              <p className="mt-2.5 text-[14px] text-fog-400 leading-relaxed">{b.d}</p>
              <div className="mt-auto pt-7">{b.c}</div>
            </Tilt>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

/* ============ 6. Horizontal outputs ============ */
function Outputs() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const x = useTransform(scrollYProgress, [0, 1], ['2%', '-58%'])
  const [thumbs] = useState(() => [SENTS[4].s + 300, SENTS[9].s + 300, SENTS[19].s + 300, SENTS[26].s + 300, SENTS[29].s + 300].map(s => frameCanvas(s, 480, 270).toDataURL('image/jpeg', .85)))
  const cards = [
    { t: 'Main edit', d: '16:9, 1080p, 3:03', v: false, img: thumbs[0], cap: '' },
    { t: 'Your room is the biggest microphone you own', d: 'Short, 0:35, hook score 92', v: true, img: thumbs[1], cap: 'Every flat wall' },
    { t: 'A $60 mic beat our condenser', d: 'Short, 0:37, hook score 88', v: true, img: thumbs[2], cap: 'Sixty dollars' },
    { t: 'Stop looking like a crime documentary', d: 'Short, 0:27, hook score 84', v: true, img: thumbs[3], cap: 'One soft light' },
    { t: 'Chapters', d: 'Coming next: auto chapters and B-roll suggestions', v: false, img: thumbs[4], cap: '' },
  ]
  return (
    <section ref={ref} className="relative h-[300vh]">
      <div className="sticky top-0 h-[100svh] overflow-hidden flex flex-col justify-center">
        <div className="px-6 md:px-10 max-w-[1240px] w-full mx-auto">
          <SplitText as="h2" text="One recording. Many outputs." className="font-display text-[36px] md:text-[56px] font-semibold tracking-[-0.035em] leading-[1]" />
          <p className="mt-3 text-fog-400 max-w-[48ch]">From the same timeline: the long cut for YouTube and vertical Shorts for everywhere else.</p>
        </div>
        <motion.div style={{ x }} className="mt-10 flex gap-6 pl-6 md:pl-10 items-end">
          {cards.map((c, i) => (
            <motion.div key={c.t} whileHover={{ y: -12 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }} data-cursor={i === 4 ? 'Soon' : 'Watch'}
              className={`shrink-0 rounded-3xl border border-ink-700 bg-ink-850 p-3 ${c.v ? 'w-[210px] md:w-[240px]' : 'w-[min(520px,80vw)]'}`}>
              <div className={`relative rounded-2xl overflow-hidden bg-black ${c.v ? 'aspect-[9/16]' : 'aspect-video'}`}>
                <img src={c.img} alt="" className={`absolute inset-0 w-full h-full object-cover ${i === 4 ? 'opacity-40 grayscale' : ''}`} />
                {c.v && <div className="absolute inset-x-3 bottom-8 text-center font-display font-extrabold text-[19px] [text-shadow:0_2px_0_#000,0_0_12px_#000]">{c.cap.split(' ').map((w, k, a) => <span key={k} className={k === a.length - 1 ? 'text-amber-300' : ''}>{w} </span>)}</div>}
                <span className="absolute top-2.5 left-2.5 rounded-md bg-black/55 backdrop-blur px-2 py-0.5 text-[11px] font-semibold">{c.v ? '9:16' : i === 4 ? 'Soon' : '16:9'}</span>
              </div>
              <div className="px-1.5 pt-3 pb-1"><div className="font-display font-semibold text-[16px] leading-snug">{c.t}</div><div className="text-[12.5px] text-fog-400 mt-1">{c.d}</div></div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}

/* ============ 7. Numbers ============ */
function Numbers() {
  const items = [
    { n: 14, s: '', l: 'edits planned from one sentence in the demo' },
    { n: 43.6, s: ' s', d: 1, l: 'of dead air and retakes removed' },
    { n: 3, s: '', l: 'vertical Shorts found in a 3:47 recording' },
    { n: 1, s: ' click', l: 'to revert everything an instruction did' },
  ]
  return (
    <section className="px-6 md:px-10 py-28 max-w-[1240px] mx-auto">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 border-y border-ink-700">
        {items.map((it, i) => (
          <Reveal key={it.l} delay={i * 0.1} className="p-7 border-ink-700 lg:border-r lg:last:border-r-0">
            <div className="font-display text-[56px] md:text-[64px] font-semibold tracking-[-0.04em] leading-none"><CountUp to={it.n} decimals={it.d ?? 0} suffix={it.s} /></div>
            <p className="mt-3 text-[14px] text-fog-400 max-w-[24ch]">{it.l}</p>
          </Reveal>
        ))}
      </div>
      <p className="mt-4 text-[12.5px] text-fog-500">Numbers from the built-in sample episode. Real benchmarks get published once the evaluation set runs in CI.</p>
    </section>
  )
}

/* ============ 8. Final CTA ============ */
function FinalCTA() {
  const nav = useNavigate()
  return (
    <section className="relative px-6 md:px-10 pb-32 max-w-[1240px] mx-auto">
      <div className="relative overflow-hidden rounded-[36px] border border-ink-700 bg-[radial-gradient(80%_100%_at_70%_50%,#262B35,#16191F)] grid md:grid-cols-[1.1fr_1fr] items-center min-h-[480px]">
        <Spotlight color="rgba(124,196,255,.10)" />
        <div className="relative z-10 p-8 md:p-14">
          <SplitText as="h2" text="Your next edit is one sentence away." className="font-display text-[40px] md:text-[60px] font-semibold tracking-[-0.04em] leading-[0.98] max-w-[12ch]" />
          <p className="mt-5 text-fog-300 max-w-[40ch]">Open the demo episode and ask for an edit. Nothing to install, nothing to upload.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Magnetic strength={0.5}><Button size="lg" variant="agent" onClick={() => nav('/editor')}>Open the editor <ArrowRight size={17} /></Button></Magnetic>
            <Magnetic><Button size="lg" variant="secondary" onClick={() => nav('/pricing')}>See pricing</Button></Magnetic>
          </div>
        </div>
        <Suspense fallback={<div className="h-[380px]" />}><GlassMark className="relative h-[380px] md:h-full md:min-h-[480px]" /></Suspense>
      </div>
    </section>
  )
}

export default function Landing() {
  const loc = useLocation() as { state?: { to?: string } }
  useEffect(() => {
    if (loc.state?.to) setTimeout(() => { const el = document.getElementById(loc.state!.to!); const l = (window as any).__lenis; if (el) l ? l.scrollTo(el) : el.scrollIntoView() }, 600)
  }, [])
  return (
    <MarketingLayout>
      <Hero />
      <Asks />
      <Story />
      <Statement />
      <Bento />
      <Outputs />
      <Numbers />
      <FinalCTA />
    </MarketingLayout>
  )
}
