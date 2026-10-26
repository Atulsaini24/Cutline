import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Minus, Plus } from 'lucide-react'
import clsx from 'clsx'
import { Button } from '../components/ui'
import { Magnetic, Reveal, SplitText, Spotlight, Tilt } from '../components/fx'
import { MarketingLayout } from '../components/site'
import { useSession } from '../lib/session'

const PLANS = [
  { id: 'free', name: 'Free', m: 0, y: 0, d: 'Try the editor on short recordings.', f: ['1 hour indexed per month', '20 AI instructions', '720p exports with a small watermark', 'Full history and undo'], cta: 'Start free' },
  { id: 'creator', name: 'Creator', m: 19, y: 15, d: 'For weekly shows and channels.', f: ['10 hours indexed per month', '200 AI instructions', '1080p and vertical Shorts', 'Caption styles and B-roll library', 'Review links for collaborators'], cta: 'Choose Creator', hot: true },
  { id: 'studio', name: 'Studio', m: 49, y: 39, d: 'For teams publishing every day.', f: ['40 hours indexed per month', 'Unlimited AI instructions', '4K exports and priority render workers', 'Shared projects and roles', 'Usage and quality reports'], cta: 'Choose Studio' },
]
const FAQ = [
  ['Does the AI change my original video?', 'No. Your upload is never modified. The AI only adds typed edits to a timeline, and every one of them can be undone.'],
  ['What counts as an AI instruction?', 'Each message you send to the editor that produces a plan, whether you apply it or not. Manual edits are always free.'],
  ['How long can recordings be?', 'Uploads resume after interruptions, so multi-hour recordings are fine. Indexing time counts toward your monthly hours.'],
  ['Can I cancel any time?', 'Yes. Your projects stay readable after cancelling, and you can export what you already rendered.'],
]

export default function Pricing() {
  const nav = useNavigate()
  const user = useSession(s => s.user)
  const [yearly, setYearly] = useState(true)
  const [open, setOpen] = useState<number | null>(0)
  return (
    <MarketingLayout>
      <section className="relative pt-40 pb-20 px-6 md:px-10 overflow-hidden">
        <Spotlight />
        <div className="relative max-w-[1240px] mx-auto text-center">
          <SplitText text="Pay for hours of footage, not for features" className="mx-auto font-display text-[42px] md:text-[72px] font-semibold tracking-[-0.04em] leading-[0.98] max-w-[15ch]" />
          <Reveal delay={0.3}><p className="mt-5 text-fog-300 text-[17px] max-w-[52ch] mx-auto">Every plan includes the full editor, the review flow and unlimited undo.</p></Reveal>
          <Reveal delay={0.4}>
            <div className="mt-8 inline-flex items-center gap-1 rounded-2xl bg-ink-850 border border-ink-700 p-1">
              {[false, true].map(y => (
                <button key={String(y)} onClick={() => setYearly(y)} className={clsx('relative px-5 h-10 text-[14px] font-semibold z-10', yearly === y ? 'text-ink-900' : 'text-fog-300')}>
                  {yearly === y && <motion.span layoutId="bill" className="absolute inset-0 -z-10 rounded-xl bg-fog-100" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                  {y ? 'Yearly' : 'Monthly'}{y && <span className="ml-2 text-[11.5px] text-jade-400">save 20%</span>}
                </button>
              ))}
            </div>
          </Reveal>
        </div>
        <div className="relative max-w-[1240px] mx-auto mt-14 grid md:grid-cols-3 gap-5 items-stretch" style={{ perspective: 1400 }}>
          {PLANS.map((p, i) => (
            <Reveal key={p.id} delay={0.15 + i * 0.1} className="h-full">
              <Tilt max={6} className={clsx('h-full rounded-[28px] p-[1px]', p.hot ? 'bg-[conic-gradient(from_var(--a),#F7BE4A,#7CC4FF,#F7BE4A)] [animation:spin-border_5s_linear_infinite]' : 'bg-ink-700')}>
                <div className="h-full rounded-[27px] bg-ink-850 p-7 flex flex-col">
                  <div className="flex items-center justify-between"><h3 className="font-display text-[22px] font-semibold">{p.name}</h3>{p.hot && <span className="rounded-full bg-amber-400 text-ink-950 text-[11.5px] font-bold px-2.5 py-0.5">Most picked</span>}</div>
                  <p className="text-fog-400 text-[14px] mt-1">{p.d}</p>
                  <div className="mt-6 flex items-end gap-1.5 h-[64px]">
                    <span className="font-display text-[56px] font-semibold tracking-[-0.04em] leading-none">$</span>
                    <AnimatePresence mode="popLayout"><motion.span key={yearly ? p.y : p.m} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -30, opacity: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }} className="font-display text-[56px] font-semibold tracking-[-0.04em] leading-none">{yearly ? p.y : p.m}</motion.span></AnimatePresence>
                    <span className="text-fog-400 text-[14px] mb-1.5">per month{p.m && yearly ? ', billed yearly' : ''}</span>
                  </div>
                  <ul className="mt-6 grid gap-2.5">{p.f.map(f => <li key={f} className="flex gap-2.5 text-[14px] text-fog-200"><Check size={17} className="text-jade-400 shrink-0 mt-0.5" />{f}</li>)}</ul>
                  <div className="mt-auto pt-8"><Magnetic className="w-full"><Button className="w-full" size="lg" variant={p.hot ? 'agent' : 'secondary'} onClick={() => nav(user ? '/projects' : '/signin')}>{user ? 'Open projects' : p.cta}</Button></Magnetic></div>
                </div>
              </Tilt>
            </Reveal>
          ))}
        </div>
      </section>
      <section className="px-6 md:px-10 pb-32 max-w-[860px] mx-auto">
        <SplitText as="h2" text="Questions" className="font-display text-[36px] md:text-[48px] font-semibold tracking-[-0.03em]" />
        <div className="mt-8 grid gap-3">
          {FAQ.map(([q, a], i) => (
            <Reveal key={q} delay={i * 0.06}>
              <div className="rounded-2xl border border-ink-700 bg-ink-850 overflow-hidden">
                <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left font-semibold text-[16px]" aria-expanded={open === i}>
                  {q}<motion.span animate={{ rotate: open === i ? 180 : 0 }}>{open === i ? <Minus size={18} /> : <Plus size={18} />}</motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {open === i && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .35, ease: [.2, .8, .2, 1] }}><p className="px-6 pb-5 text-fog-300 text-[15px] leading-relaxed">{a}</p></motion.div>}
                </AnimatePresence>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
    </MarketingLayout>
  )
}
