import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, Check, Eye, EyeOff, Play, ShieldCheck, Undo2 } from 'lucide-react'
import clsx from 'clsx'
import { runStatus, useEditor, usePlayback, type ChatMsg } from '../../store/editor'
import { srcToTl } from '../../lib/timeline'
import { snippet } from '../../lib/sample'
import { SUGGESTIONS } from '../../lib/agent'
import { INDEX, STATS } from '../../lib/sample'
import { ChevronRight } from 'lucide-react'
import { fmtShort, secs } from '../../lib/format'
import { Button } from '../ui'
import { AGENT_LABEL, useSession } from '../../lib/session'
import { Info } from 'lucide-react'

const AgentOrb = lazy(() => import('../three/Scenes').then(m => ({ default: m.AgentOrb })))
const ease = [0.2, 0.8, 0.2, 1] as const

function Steps({ steps }: { steps: string[] }) {
  return (
    <ul className="grid gap-1.5 my-1">
      <AnimatePresence initial={false}>
        {steps.map((s, i) => (
          <motion.li key={s} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2 text-[13px] text-fog-300">
            {i === steps.length - 1
              ? <span className="w-3.5 h-3.5 rounded-full border-2 border-amber-400 border-r-transparent animate-spin" />
              : <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-3.5 h-3.5 rounded-full bg-jade-500 grid place-items-center text-ink-900"><Check size={9} strokeWidth={4} /></motion.span>}
            {s}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}

function PlanCard({ m }: { m: ChatMsg }) {
  const { log, cursor, reverted, applyPlan, discardPlan, togglePreview, revertRun, hlRun, setHlRun, setSeq, togglePlanItem, tl } = useEditor()
  const [open, setOpen] = useState<string | null>(null)
  const jump = (s: number) => { setSeq('main'); const p = usePlayback.getState(); p.setT(Math.max(0, srcToTl(tl.v1, s) - 1500)); p.setPlaying(true) }
  const p = m.plan!
  const status = m.kind === 'run' ? runStatus(log, cursor, reverted, m.runId!) : null
  const onCount = p.items.filter(x => x.on !== false).length
  const edits = onCount + (p.shorts.length ? 1 : 0)
  const tone = m.kind === 'plan' ? 'border-l-amber-400' : status === 'applied' ? 'border-l-jade-400' : 'border-l-ink-600'
  const title = m.kind === 'plan' ? 'Proposed edit' : m.kind === 'discarded' ? 'Plan discarded' : `Run ${m.runN} ${status}`
  return (
    <motion.div layout initial={{ opacity: 0, y: 16, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .45, ease }}
      className={clsx('rounded-xl border border-ink-700 border-l-[3px] bg-ink-800/80 p-3.5 mt-1', tone, m.kind === 'discarded' && 'opacity-60')}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-display text-[15px] font-semibold tracking-tight">{title}{m.provider && m.kind === 'plan' && <span title={m.provider === 'rules' || m.provider === 'demo' ? 'Made by the built-in rule planner' : `Planned by ${AGENT_LABEL[m.provider] ?? m.provider}`} className={clsx('ml-2 align-middle rounded-full px-2 py-px text-[10.5px] font-sans font-bold', m.provider === 'rules' || m.provider === 'demo' ? 'bg-ink-700 text-fog-300' : 'bg-lilac-500/20 text-lilac-400')}>{AGENT_LABEL[m.provider] ?? m.provider}</span>}</h4>
        {m.kind === 'plan' && <span className="text-[12px] text-amber-300 font-semibold">−{secs(p.items.filter(x => x.on !== false).reduce((a, x) => a + x.e - x.s, 0))}</span>}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-fog-300">{p.summary}</p>
      {p.note && m.kind === 'plan' && <div className="mt-2 flex gap-2 rounded-lg bg-ink-850/80 px-2.5 py-2 text-[12px] leading-relaxed text-fog-400"><Info size={14} className="shrink-0 mt-px text-sky-400" /><span>{p.note}</span></div>}
      {p.groups.length > 0 && (
        <div className="mt-3 grid gap-1">
          {p.groups.map((g, i) => (
            <motion.div key={g.name} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1 + i * .07 }} className="rounded-md bg-ink-850/70">
              <button onClick={() => setOpen(open === g.name ? null : g.name)} className="w-full grid grid-cols-[14px_1fr_auto_auto] items-center gap-2 text-[13px] px-2 py-1.5 text-left">
                <motion.span animate={{ rotate: open === g.name ? 90 : 0 }}><ChevronRight size={13} className="text-fog-400" /></motion.span>
                <span>{g.name}</span><span className="text-fog-400">{g.items.filter(x => x.on !== false).length}/{g.items.length}</span><span className="text-fog-400 w-14 text-right">−{secs(g.ms)}</span>
              </button>
              <AnimatePresence initial={false}>
                {open === g.name && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="px-2 pb-2 grid gap-0.5 max-h-48 overflow-y-auto">
                      {g.items.map(it => { const idx = p.items.findIndex(x => x.s === it.s && x.e === it.e); return (
                        <div key={it.s} className="flex items-center gap-2 text-[12.5px] rounded px-1.5 py-1 hover:bg-ink-750">
                          {m.kind === 'plan' && <input type="checkbox" checked={it.on !== false} onChange={() => togglePlanItem(m.id, idx)} className="accent-amber-400" aria-label="Include this cut" />}
                          <button onClick={() => jump(it.s)} className={clsx('flex-1 min-w-0 truncate text-left', it.on === false && 'line-through text-fog-500')} title="Play around this cut">“{snippet(it.s, it.e)}”</button>
                          <span className="text-fog-500 shrink-0">{secs(it.e - it.s)}</span>
                        </div>) })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      )}
      {p.shorts.length > 0 && (
        <div className="mt-2 grid gap-1">
          {p.shorts.map((s, i) => (
            <motion.div key={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .25 + i * .07 }}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 bg-ink-850/70 text-[13px]">
              <span className="w-[14px] h-[24px] rounded-[3px] border border-fog-400/60 shrink-0" />
              <span className="flex-1 truncate">{s.title}</span>
              <span className="text-fog-400">{fmtShort(s.dur)}</span>
              {m.kind === 'run' && status === 'applied' && <button aria-label={`Watch ${s.title}`} onClick={() => { setSeq(s.id); usePlayback.getState().setT(0); usePlayback.getState().setPlaying(true) }} className="text-amber-300 hover:text-amber-200"><Play size={14} fill="currentColor" /></button>}
            </motion.div>
          ))}
        </div>
      )}
      {m.kind === 'plan' && <>
        <div className="mt-3 flex gap-2 text-[12px] text-fog-400">
          <ShieldCheck size={15} className="text-jade-400 shrink-0 mt-px" />
          <span>{p.total + (p.shorts.length ? 1 : 0)} of {p.total + (p.shorts.length ? 1 : 0)} edits pass checks against the current timeline.{p.adjusted ? ` ${p.adjusted} proposal${p.adjusted > 1 ? 's were' : ' was'} repaired after failing a check.` : ''} Open a group to untick cuts you want to keep.</span>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="agent" onClick={() => applyPlan(m.id)}>Apply {edits} edits</Button>
          <Button size="sm" variant="ghost" onClick={() => discardPlan(m.id)}>Discard</Button>
          {p.total > 0 && <button onClick={() => togglePreview(m.id)} className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-fog-400 hover:text-fog-100">
            {m.preview ? <Eye size={14} /> : <EyeOff size={14} />}{m.preview ? 'Shown on timeline' : 'Hidden'}</button>}
        </div>
      </>}
      {m.kind === 'run' && status === 'applied' && (
        <div className="mt-3 flex gap-2 flex-wrap">
          <Button size="sm" variant={hlRun === m.runId ? 'agent' : 'secondary'} onClick={() => { setSeq('main'); setHlRun(hlRun === m.runId ? null : m.runId!) }}>{hlRun === m.runId ? 'Hide changes' : 'Show changes'}</Button>
          <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} onClick={() => revertRun(m.runId!)}>Revert run</Button>
        </div>
      )}
      {m.kind === 'run' && status === 'undone' && <p className="mt-2 text-[12.5px] text-fog-400">Undone. Redo brings it back.</p>}
      {m.kind === 'run' && status === 'reverted' && <p className="mt-2 text-[12.5px] text-fog-400">Reverted. The timeline is back to how it was before this run; your later edits are kept.</p>}
    </motion.div>
  )
}

function AiLine() {
  const { ai, mode } = useSession()
  if (mode !== 'online') return <span className="block mt-1.5 text-[12px] text-fog-500">Demo mode: the built-in planner runs in your browser.</span>
  if (ai?.agent.configured) return <span className="block mt-1.5 text-[12px] text-fog-500">Planning with {ai.agent.label}{ai.agent.model ? ` (${ai.agent.model})` : ''}. Every edit is still checked before it reaches the timeline.</span>
  return <span className="block mt-1.5 text-[12px] text-fog-500">Using the built-in planner. <a href="#/settings" className="text-amber-300 hover:underline">Connect a free AI</a> to handle any instruction.</span>
}

export default function AgentPanel() {
  const { chat, busy, send } = useEditor()
  const [text, setText] = useState('')
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }) }, [chat])
  const submit = (t: string) => { if (!t.trim() || busy) return; send(t); setText('') }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-ink-700">
        <Suspense fallback={<span className="w-[34px] h-[34px] rounded-full bg-amber-400/30" />}><AgentOrb busy={busy} /></Suspense>
        <div className="min-w-0">
          <div className="font-display font-semibold tracking-tight">Editor</div>
          <AnimatePresence mode="wait">
            <motion.div key={String(busy)} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[12px] text-fog-400">{busy ? 'Planning your edit…' : 'Plans first, then edits you can revert'}</motion.div>
          </AnimatePresence>
        </div>
      </div>
      <div ref={list} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 grid content-start gap-4">
        <div className="text-[13.5px] leading-relaxed text-fog-200">
          I’ve read the whole recording: {STATS.lines} {INDEX.source === 'segments' ? 'stretches of speech' : `lines from ${STATS.speakers} speaker${STATS.speakers === 1 ? '' : 's'}, ${STATS.retakes} repeated takes, ${STATS.fillers} filler words`} and {STATS.pauses} long pauses.
          <span className="block mt-1.5 text-fog-400">Tell me what to change. I’ll show a plan first, and everything I do lands on the timeline as one run.</span>
          <AiLine />
        </div>
        <AnimatePresence initial={false}>
          {chat.map(m => m.role === 'user' ? (
            <motion.div key={m.id} layout initial={{ opacity: 0, y: 12, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .35, ease }}
              className="justify-self-end max-w-[88%] rounded-2xl rounded-br-md bg-fog-100 text-ink-900 px-3.5 py-2 text-[14px] font-medium">{m.text}</motion.div>
          ) : (
            <motion.div key={m.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .35, ease }}>
              {m.kind === 'text' && <p className="text-[13.5px] leading-relaxed text-fog-200">{m.text}</p>}
              {m.kind === 'working' && <Steps steps={m.steps ?? []} />}
              {(m.kind === 'plan' || m.kind === 'run' || m.kind === 'discarded') && <PlanCard m={m} />}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="border-t border-ink-700 p-3">
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {SUGGESTIONS.map(s => (
            <motion.button key={s} whileHover={{ y: -2 }} whileTap={{ scale: .96 }} disabled={busy} onClick={() => submit(s)}
              className="rounded-full border border-ink-600 bg-ink-800 px-3 py-1 text-[12.5px] text-fog-200 hover:border-amber-400/70 hover:text-fog-100 disabled:opacity-40">{s}</motion.button>
          ))}
        </div>
        <div className="flex items-end gap-2 rounded-2xl border border-ink-600 bg-ink-800 p-1.5 pl-3 focus-within:border-amber-400/70 focus-within:shadow-[0_0_0_4px_rgba(247,190,74,.12)] transition">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={1} placeholder="Tell the editor what to change"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(text) } }}
            className="flex-1 resize-none bg-transparent outline-none py-1.5 text-[14px] placeholder:text-fog-500 max-h-28" style={{ fieldSizing: 'content' } as any} />
          <motion.button whileTap={{ scale: .9 }} aria-label="Plan edit" disabled={busy || !text.trim()} onClick={() => submit(text)}
            className="w-9 h-9 rounded-xl bg-amber-400 text-ink-950 grid place-items-center disabled:opacity-35"><ArrowUp size={18} strokeWidth={2.5} /></motion.button>
        </div>
      </div>
    </div>
  )
}
