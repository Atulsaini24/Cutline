import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { RotateCcw, Scissors, Search, Sparkles, X } from 'lucide-react'
import clsx from 'clsx'
import { fillerOps, pendingItems, useEditor, usePlayback } from '../../store/editor'
import { INDEX, SENTS, speaker, WORDS } from '../../lib/sample'
import { keptIn, removedBy, srcToTl, tlToSrc, type NewOp } from '../../lib/timeline'
import { fmt, secs } from '../../lib/format'
import { Button, Kbd } from '../ui'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { req } from '../../lib/api'

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9’']/g, '')
export function cutSelectedWords() {
  const st = useEditor.getState(); const sw = st.selWords; if (!sw || st.seq !== 'main') return
  const a = WORDS[sw.a], b = WORDS[sw.b], nx = WORDS[sw.b + 1]
  const ws = WORDS.slice(sw.a, sw.b + 1)
  const allGone = ws.every(w => !keptIn(st.tl.v1, (w.s + w.e) / 2))
  const e = nx ? (nx.sent === b.sent ? nx.s : Math.max(b.e, nx.s - 300)) : b.e
  const txt = ws.map(w => w.text).join(' '); const short = txt.length > 34 ? txt.slice(0, 32) + '…' : txt
  st.setSelWords(null); window.getSelection()?.removeAllRanges()
  st.commit([allGone ? { type: 'restore', author: 'user', label: `Restored “${short}”`, p: { s: a.s, e } } : { type: 'cut', author: 'user', label: `Cut “${short}”`, p: { s: a.s, e } }])
}

export default function Transcript() {
  const { tl, seq, chat, hlRun, selWords, setSelWords, commit } = useEditor()
  const ranges = useEditor(s => s.ranges())
  const isShort = seq !== 'main'
  const box = useRef<HTMLDivElement>(null)
  const [find, setFind] = useState<string | null>(null)
  const pend = pendingItems(isShort ? [] : chat)
  const segmentsOnly = INDEX.source === 'segments'

  const matches = useMemo(() => {
    const q = (find ?? '').trim().split(/\s+/).map(norm).filter(Boolean); if (!q.length) return [] as { a: number; b: number }[]
    const out: { a: number; b: number }[] = []
    for (let i = 0; i + q.length <= WORDS.length; i++) { if (q.every((t, k) => norm(WORDS[i + k].text) === t || (k === q.length - 1 && norm(WORDS[i + k].text).startsWith(t)))) out.push({ a: i, b: i + q.length - 1 }) }
    return out
  }, [find, tl])
  const matchSet = useMemo(() => { const s = new Set<number>(); matches.forEach(m => { for (let i = m.a; i <= m.b; i++) s.add(i) }); return s }, [matches])
  const keptMatches = matches.filter(m => keptIn(tl.v1, (WORDS[m.a].s + WORDS[m.a].e) / 2))
  const fillerCount = useMemo(() => isShort ? 0 : fillerOps().length, [tl, isShort])

  const classes = useMemo(() => WORDS.map(w => {
    const mid = (w.s + w.e) / 2; const c = ['word']
    if (w.filler) c.push('filler')
    if (!keptIn(ranges, mid)) {
      c.push('cut')
      if (isShort) c.push('cut-out')
      else { const by = removedBy(tl, mid); c.push(by?.author === 'agent' ? 'cut-agent' : by ? 'cut-user' : 'cut-out'); if (hlRun && by?.runId === hlRun) c.push('hl') }
    } else if (pend.some(x => mid >= x.s && mid < x.e)) c.push('pending')
    if (selWords && w.i >= selWords.a && w.i <= selWords.b) c.push('selected')
    if (matchSet.has(w.i)) c.push('found')
    return c.join(' ')
  }), [ranges, tl, isShort, pend, hlRun, selWords, matchSet])

  useEffect(() => {
    let last = -1
    const update = (t: number, playing: boolean) => {
      const r = useEditor.getState().ranges(); if (!r.length) return
      const src = tlToSrc(r, t)
      let idx = -1; for (const w of WORDS) { if (w.s <= src && src < w.e) { idx = w.i; break } if (w.s > src) break }
      if (idx === last) return
      box.current?.querySelector(`[data-w="${last}"]`)?.classList.remove('now'); last = idx
      if (idx >= 0) {
        const el = box.current?.querySelector(`[data-w="${idx}"]`) as HTMLElement | null; el?.classList.add('now')
        const pane = box.current?.parentElement?.parentElement
        if (playing && el && pane) { const top = el.offsetTop - pane.scrollTop; if (top < 90 || top > pane.clientHeight - 50) pane.scrollTo({ top: el.offsetTop - pane.clientHeight / 3, behavior: 'smooth' }) }
      }
    }
    const s = usePlayback.getState(); update(s.t, false)
    return usePlayback.subscribe(st => update(st.t, st.playing))
  }, [classes])

  const onUp = (e: React.MouseEvent | React.TouchEvent) => {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && box.current?.contains(sel.anchorNode)) {
      const el = (n: Node | null) => (n?.nodeType === 3 ? n.parentElement : (n as HTMLElement | null))?.closest('[data-w]') as HTMLElement | null
      const a = el(sel.anchorNode), b = el(sel.focusNode); if (!a || !b) return
      let i = +a.dataset.w!, j = +b.dataset.w!; if (i > j) [i, j] = [j, i]
      setSelWords({ a: i, b: j }); return
    }
    if (selWords) setSelWords(null)
    const w = (e.target as HTMLElement).closest('[data-w]') as HTMLElement | null
    if (w) { const wd = WORDS[+w.dataset.w!]; if (keptIn(ranges, (wd.s + wd.e) / 2)) usePlayback.getState().setT(srcToTl(ranges, wd.s)) }
  }
  const onDouble = (e: React.MouseEvent) => {
    const w = (e.target as HTMLElement).closest('[data-w]') as HTMLElement | null; if (!w) return
    const s = SENTS[WORDS[+w.dataset.w!].sent]; window.getSelection()?.removeAllRanges(); setSelWords({ a: s.w[0].i, b: s.w[s.w.length - 1].i })
  }
  const cutMatches = () => {
    const ops: NewOp[] = keptMatches.map(m => { const nx = WORDS[m.b + 1]; const e = nx && nx.sent === WORDS[m.b].sent ? nx.s : WORDS[m.b].e; return { type: 'cut', author: 'user', label: `Cut ${keptMatches.length} × “${find}”`, p: { s: WORDS[m.a].s, e } } })
    if (ops.length) commit(ops); setFind(null)
  }
  const selInfo = selWords && (() => { const ws = WORDS.slice(selWords.a, selWords.b + 1); return { n: ws.length, gone: ws.every(w => !keptIn(tl.v1, (w.s + w.e) / 2)) } })()
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && !isShort) { e.preventDefault(); setFind(f => f ?? '') } }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [isShort])

  return (
    <div className="relative">
      <div className="sticky top-0 z-10 bg-ink-850/90 backdrop-blur border-b border-ink-700 px-3 min-h-12 py-2 flex items-center gap-2 text-[12.5px]">
        <AnimatePresence mode="wait" initial={false}>
          {isShort ? <motion.span key="short" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-fog-400">Showing what this Short keeps. Grey words are outside it.</motion.span>
          : find !== null ? (
            <motion.div key="find" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2 w-full">
              <label className="flex-1 flex items-center gap-2 h-8 rounded-lg bg-ink-800 border border-ink-600 px-2.5 focus-within:border-sky-400">
                <Search size={14} className="text-fog-400" /><input autoFocus value={find} onChange={e => setFind(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setFind(null); if (e.key === 'Enter') cutMatches() }} placeholder="Find words, e.g. “basically”" className="flex-1 min-w-0 bg-transparent outline-none text-[13px]" />
                <span className="text-fog-500">{matches.length || ''}</span>
              </label>
              <Button size="sm" variant="primary" disabled={!keptMatches.length} onClick={cutMatches}>Cut {keptMatches.length || ''}</Button>
              <button aria-label="Close search" onClick={() => setFind(null)} className="text-fog-400 hover:text-fog-100"><X size={16} /></button>
            </motion.div>
          ) : selInfo ? (
            <motion.div key="sel" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="flex items-center gap-2 w-full">
              {selInfo.gone ? <Button size="sm" icon={<RotateCcw size={14} />} onClick={cutSelectedWords}>Restore {selInfo.n} word{selInfo.n > 1 ? 's' : ''}</Button>
                : <Button size="sm" variant="primary" icon={<Scissors size={14} />} onClick={cutSelectedWords}>Cut {selInfo.n} word{selInfo.n > 1 ? 's' : ''}</Button>}
              {!selInfo.gone && <Kbd>Del</Kbd>}
              <button className="ml-auto text-fog-400 hover:text-fog-100" aria-label="Clear selection" onClick={() => { setSelWords(null); window.getSelection()?.removeAllRanges() }}><X size={16} /></button>
            </motion.div>
          ) : (
            <motion.div key="legend" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="flex items-center gap-2 w-full text-fog-400">
              <span className="flex items-center gap-1.5"><i className="w-2.5 h-[3px] rounded bg-amber-400" />AI</span>
              <span className="flex items-center gap-1.5"><i className="w-2.5 h-[3px] rounded bg-sky-400" />You</span>
              <div className="ml-auto flex gap-1">
                {fillerCount > 0 && <motion.button initial={{ scale: .9 }} animate={{ scale: 1 }} onClick={() => commit(fillerOps().map(o => ({ ...o, label: `Removed ${fillerCount} filler words` })))} className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-amber-400/12 text-amber-300 hover:bg-amber-400/20 font-semibold"><Sparkles size={13} />Remove {fillerCount} fillers</motion.button>}
                <button onClick={() => setFind('')} aria-label="Find in transcript (Ctrl/⌘ F)" title="Find in transcript (Ctrl/⌘ F)" className="w-7 h-7 grid place-items-center rounded-lg hover:bg-ink-750 text-fog-300"><Search size={14} /></button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {segmentsOnly && <div className="mx-3 mt-3 rounded-lg bg-ink-800 px-3 py-2 text-[12.5px] text-fog-400">No word transcript yet: these are stretches of speech found between silences. {INDEX.note ? INDEX.note + ' ' : ''}Set up free transcription in <a href="#/settings" className="text-amber-300 hover:underline">Settings</a>, then re-index for word-level editing.<ReindexButton /></div>}
      <div ref={box} className="px-4 pb-16 pt-2 select-text" onMouseUp={onUp} onDoubleClick={onDouble} onTouchEnd={e => setTimeout(() => onUp(e), 30)}>
        {SENTS.map((s, i) => {
          const gap = i > 0 ? s.s - SENTS[i - 1].e : 0
          const gapGone = gap > 1500 && !isShort && !keptIn(ranges, (SENTS[i - 1].e + s.s) / 2)
          const sp = speaker(s.spk)
          return (
            <div key={i}>
              {gap > 1500 && <div className={clsx('flex items-center gap-2 my-1 text-[11.5px]', gapGone ? 'text-amber-400/80 line-through' : 'text-fog-500')}><span className="h-px flex-1 bg-ink-700" />Pause {secs(gap)}<span className="h-px flex-1 bg-ink-700" /></div>}
              <div className="py-2">
                <div className="flex items-center gap-2 text-[12px] mb-0.5">
                  <span className="font-bold" style={{ color: sp.color }}>{sp.name}</span>
                  <span className="text-fog-500">{fmt(s.s)}</span>
                  {s.tag === 'retake' && <span className="rounded border border-ink-600 px-1.5 text-[10.5px] text-fog-400">Earlier take</span>}
                  {s.tag === 'preroll' && <span className="rounded border border-ink-600 px-1.5 text-[10.5px] text-fog-400">Before intro</span>}
                </div>
                <p className="text-[15px] leading-[1.75] text-fog-100">{s.w.map(w => <span key={w.i}><span data-w={w.i} className={classes[w.i]}>{w.text}</span> </span>)}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ReindexButton() {
  const pid = useEditor(s => s.projectId); const nav = useNavigate(); const [busy, setBusy] = useState(false)
  if (!pid) return null
  return <button disabled={busy} onClick={async () => {
    setBusy(true)
    try { await req('POST', `/projects/${pid}/reindex`); nav('/upload', { state: { projectId: pid } }) }
    catch (e) { toast.error('Couldn’t re-index', { description: (e as Error).message }); setBusy(false) }
  }} className="ml-1 font-semibold text-amber-300 hover:underline disabled:opacity-50">{busy ? 'Starting…' : 'Re-index now'}</button>
}
