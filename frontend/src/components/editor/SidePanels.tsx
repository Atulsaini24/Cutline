import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bookmark, ChevronRight, Plus } from 'lucide-react'
import clsx from 'clsx'
import { useEditor, usePlayback } from '../../store/editor'
import { BROLL, SENTS, SRC_DUR, STATS } from '../../lib/sample'
import { keptIn, srcToTl, tlToSrc, type CaptionStyle, type OpRecord } from '../../lib/timeline'
import { frameCanvas } from '../../lib/draw'
import { fmtShort, secs } from '../../lib/format'
import { Button, Pill } from '../ui'

/* ---------------- History ---------------- */
export function HistoryPanel() {
  const { log, cursor, reverted, snaps, goto, restoreSnapshot, saveSnapshot } = useEditor()
  const [open, setOpen] = useState<string | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const groups = useMemo(() => {
    const g: { runId: string | null; ops: { o: OpRecord; i: number }[] }[] = []
    log.forEach((o, i) => { const L = g[g.length - 1]; if (o.runId && L && L.runId === o.runId) L.ops.push({ o, i }); else g.push({ runId: o.runId ?? null, ops: [{ o, i }] }) })
    return g.reverse()
  }, [log])

  return (
    <div className="pb-10">
      <section className="p-4 border-b border-ink-700">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">Snapshots</h3>
          {naming === null && <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setNaming(cursor ? `Version ${cursor}` : 'Before editing')}>Save</Button>}
        </div>
        <AnimatePresence>
          {naming !== null && (
            <motion.form initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden"
              onSubmit={e => { e.preventDefault(); if (naming.trim()) saveSnapshot(naming.trim()); setNaming(null) }}>
              <div className="flex gap-2 mt-3">
                <input autoFocus value={naming} onChange={e => setNaming(e.target.value)} aria-label="Snapshot name" className="flex-1 h-8 rounded-lg bg-ink-800 border border-ink-600 px-2.5 text-[13px] outline-none focus:border-sky-400" />
                <Button size="sm" variant="primary" type="submit">Save</Button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
        {!snaps.length && naming === null && <p className="mt-2 text-[12.5px] text-fog-400">Save one before a big change, then restore it any time.</p>}
        <div className="mt-2 grid gap-1">
          {snaps.map((s, i) => (
            <motion.div key={s.at} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2 text-[13px] py-1">
              <Bookmark size={14} className="text-amber-300" /><span className="flex-1 truncate">{s.name}</span><span className="text-fog-500 text-[12px]">v{s.v}</span>
              <Button size="sm" variant="ghost" onClick={() => restoreSnapshot(i)}>Restore</Button>
            </motion.div>
          ))}
        </div>
      </section>
      <section className="pt-4">
        <h3 className="px-4 text-[13px] font-semibold">Every change, newest first</h3>
        <p className="px-4 text-[12.5px] text-fog-400 mb-2">Click a version to see the timeline at that point.</p>
        <div className="relative">
          <span className="absolute left-[29px] top-2 bottom-2 w-px bg-ink-700" />
          <AnimatePresence initial={false}>
            {groups.map(g => {
              const last = g.ops[g.ops.length - 1].i; const undone = g.ops[0].i >= cursor; const head = last === cursor - 1
              const isRun = !!g.runId; const rev = isRun && reverted.has(g.runId!)
              const key = g.runId ?? g.ops[0].o.id
              return (
                <motion.div key={key} layout initial={{ opacity: 0, y: -10 }} animate={{ opacity: undone ? .45 : 1, y: 0 }} exit={{ opacity: 0 }}>
                  <div className={clsx('relative grid grid-cols-[30px_1fr_auto] items-center gap-2 px-4 py-2 text-[13px] hover:bg-ink-800 cursor-pointer', head && 'bg-ink-800')}
                    onClick={() => goto(last + 1)}>
                    <span className={clsx('relative z-10 w-[11px] h-[11px] rounded-full ml-2 ring-4 ring-ink-850', isRun ? 'bg-amber-400' : 'bg-sky-400', head && 'scale-125')} />
                    <span className={clsx('truncate', rev && 'line-through text-fog-400')}>
                      {isRun ? `AI run ${g.runId!.replace('run', '')}: ${g.ops.length} edits` : g.ops[0].o.label}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-[11px] text-fog-500">v{last + 1}</span>
                      {isRun ? <button aria-label="Show edits" onClick={e => { e.stopPropagation(); setOpen(open === key ? null : key) }} className="text-fog-400 hover:text-fog-100"><motion.span animate={{ rotate: open === key ? 90 : 0 }} className="block"><ChevronRight size={15} /></motion.span></button> : <Pill tone="user">You</Pill>}
                    </span>
                  </div>
                  <AnimatePresence>
                    {open === key && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="pl-[52px] pr-4 pb-2 grid gap-1 text-[12px] text-fog-400">{g.ops.map(x => <span key={x.o.id} className="truncate">{x.o.label}</span>)}</div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </AnimatePresence>
          <div className={clsx('relative grid grid-cols-[30px_1fr_auto] items-center gap-2 px-4 py-2 text-[13px] hover:bg-ink-800 cursor-pointer', cursor === 0 && 'bg-ink-800')} onClick={() => goto(0)}>
            <span className="relative z-10 w-[11px] h-[11px] rounded-full ml-2 ring-4 ring-ink-850 bg-fog-400" />
            <span>Original recording</span><span className="text-[11px] text-fog-500">v0</span>
          </div>
        </div>
      </section>
    </div>
  )
}

/* ---------------- Media ---------------- */
export function MediaPanel() {
  const { title, seq, tl, commit, opN } = useEditor()
  const thumbs = useMemo(() => ({
    raw: frameCanvas((SENTS[Math.min(8, SENTS.length - 1)]?.s ?? 0) + 400, 160, 90).toDataURL(),
    ...Object.fromEntries(BROLL.map(b => [b.id, frameCanvas(0, 160, 90, b.id).toDataURL()])),
  }) as Record<string, string>, [])
  const insert = (id: string) => {
    const a = BROLL.find(x => x.id === id)!
    const anchor = tlToSrc(tl.v1, usePlayback.getState().t)
    commit([{ type: 'addBroll', author: 'user', label: `Added B-roll “${a.name}”`, p: { id: 'b' + (opN + 1), asset: a.id, anchor, dur: a.dur } }])
  }
  const stats = [[STATS.speakers, 'Speakers'], [STATS.shots, 'Shots'], [STATS.retakes, 'Repeated takes'], [STATS.fillers, 'Filler words'], [STATS.pauses, 'Pauses over 1.5 s'], [STATS.words, 'Timed words']]
  return (
    <div className="p-4 grid gap-6 pb-10">
      <section>
        <h3 className="text-[13px] font-semibold mb-2">Recording</h3>
        <div className="flex gap-3 items-center">
          <img src={thumbs.raw} alt="" className="w-24 aspect-video rounded-lg object-cover" />
          <div className="min-w-0"><div className="text-[13.5px] font-semibold truncate">{title}</div><div className="text-[12px] text-fog-400">{fmtShort(SRC_DUR)}, 1920×1080, 29.97 fps</div><div className="mt-1"><Pill tone="ok">Indexed</Pill></div></div>
        </div>
      </section>
      <section>
        <h3 className="text-[13px] font-semibold mb-2">What indexing found</h3>
        <div className="grid grid-cols-3 gap-2">
          {stats.map(([n, l], i) => (
            <motion.div key={l} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }} className="rounded-lg bg-ink-800 p-2.5">
              <div className="font-display text-[22px] font-semibold leading-none">{n}</div><div className="text-[11.5px] text-fog-400 mt-1">{l}</div>
            </motion.div>
          ))}
        </div>
      </section>
      <section>
        <h3 className="text-[13px] font-semibold mb-2">B-roll library</h3>
        <div className="grid grid-cols-2 gap-2.5">
          {BROLL.map(b => (
            <motion.button key={b.id} whileHover={{ y: -3 }} whileTap={{ scale: .97 }} disabled={seq !== 'main'} onClick={() => insert(b.id)}
              className="group text-left rounded-xl bg-ink-800 p-1.5 disabled:opacity-40">
              <div className="relative overflow-hidden rounded-lg"><img src={thumbs[b.id]} alt="" className="w-full aspect-video object-cover transition group-hover:scale-105" />
                <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 group-hover:opacity-100 transition text-[12px] font-semibold">Add at playhead</span></div>
              <div className="px-1 pt-1.5 text-[12px] font-semibold truncate">{b.name}</div>
              <div className="px-1 text-[11px] text-fog-400">{secs(b.dur)}</div>
            </motion.button>
          ))}
        </div>
        <p className="text-[12px] text-fog-500 mt-2">B-roll stays attached to its moment when you cut around it.</p>
      </section>
    </div>
  )
}

/* ---------------- Captions ---------------- */
export function CaptionsPanel() {
  const { tl, commit } = useEditor()
  const setStyle = (style: CaptionStyle) => style !== tl.cap.style && commit([{ type: 'captionStyle', author: 'user', label: `Caption style: ${style}`, p: { style } }])
  return (
    <div className="p-4 pb-10">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2.5 text-[13.5px] font-semibold cursor-pointer">
          <button role="switch" aria-checked={tl.cap.on} onClick={() => commit([{ type: 'captionsOn', author: 'user', label: tl.cap.on ? 'Turned captions off' : 'Turned captions on', p: { on: !tl.cap.on } }])}
            className={clsx('relative w-9 h-5 rounded-full transition', tl.cap.on ? 'bg-jade-500' : 'bg-ink-600')}>
            <motion.span layout className="absolute top-0.5 w-4 h-4 rounded-full bg-white" style={{ left: tl.cap.on ? 18 : 2 }} />
          </button>
          Captions
        </label>
        <div className="relative flex rounded-lg bg-ink-800 p-0.5">
          {(['clean', 'bold', 'boxed'] as CaptionStyle[]).map(s => (
            <button key={s} onClick={() => setStyle(s)} className={clsx('relative px-3 py-1 text-[12.5px] font-semibold capitalize z-10', tl.cap.style === s ? 'text-ink-900' : 'text-fog-300')}>
              {tl.cap.style === s && <motion.span layoutId="capstyle" className="absolute inset-0 -z-10 rounded-md bg-fog-100" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}{s}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[12.5px] text-fog-400 mt-3 mb-2">Generated from the transcript. Fix wording here; cuts update captions automatically.</p>
      <div className="grid">
        {SENTS.map(s => {
          const kept = s.w.filter(w => keptIn(tl.v1, (w.s + w.e) / 2)).map(w => w.text).join(' ')
          const edited = tl.cap.edits[s.i]; const text = edited ?? kept
          if (!text) return null
          return (
            <div key={s.i} className="grid grid-cols-[46px_1fr] gap-2 py-1.5 border-t border-ink-750">
              <span className="pt-1.5 text-[11.5px] text-fog-500">{fmtShort(srcToTl(tl.v1, s.s))}{edited != null && <span className="block mt-1"><Pill tone="user">Edited</Pill></span>}</span>
              <textarea defaultValue={text} key={text} rows={1} aria-label={`Caption ${s.i + 1}`}
                onBlur={e => { const v = e.target.value.trim(); if (v !== text) commit([{ type: 'captionEdit', author: 'user', label: `Edited caption “${v.slice(0, 28)}${v.length > 28 ? '…' : ''}”`, p: { sent: s.i, text: v } }]) }}
                className="w-full resize-none rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-[13px] leading-snug hover:border-ink-600 focus:border-sky-400 focus:bg-ink-800 outline-none" style={{ fieldSizing: 'content' } as any} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
