import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Check, CloudOff, Command, Loader2, Redo2, Undo2, Upload } from 'lucide-react'
import { useSession } from '../lib/session'
import { fillerOps, useEditor, usePlayback } from '../store/editor'
import { seqDur, srcToTl } from '../lib/timeline'
import { SUGGESTIONS } from '../lib/agent'
import { Button, IconButton, Tabs } from '../components/ui'
import Preview from '../components/editor/Preview'
import Timeline from '../components/editor/Timeline'
import Transcript, { cutSelectedWords } from '../components/editor/Transcript'
import AgentPanel from '../components/editor/AgentPanel'
import { CaptionsPanel, HistoryPanel, MediaPanel } from '../components/editor/SidePanels'
import { CommandPalette, ExportDialog, type Cmd } from '../components/editor/Overlays'

type LeftTab = 'tx' | 'media' | 'caps'
type RightTab = 'agent' | 'hist'
type AnyTab = LeftTab | RightTab

function useWide() {
  const q = '(min-width: 1024px)'
  const [wide, setWide] = useState(() => window.matchMedia(q).matches)
  useEffect(() => { const m = window.matchMedia(q); const f = () => setWide(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  return wide
}

function usePlaybackLoop() {
  const playing = usePlayback(s => s.playing)
  useEffect(() => {
    if (!playing) return
    let raf = 0, last = performance.now()
    const st = usePlayback.getState()
    if (st.t >= seqDur(useEditor.getState().ranges()) - 50) st.setT(0)
    const loop = (now: number) => {
      const dt = Math.min(now - last, 100); last = now
      const p = usePlayback.getState(); const ed = useEditor.getState(); const dur = seqDur(ed.ranges())
      let t = p.t + dt * p.rate
      if (p.loop) {
        // loop the marked range, else the selected clip
        const m = ed.marks; let a: number | null = null, b: number | null = null
        if (m.in !== null && m.out !== null) { a = Math.min(m.in, m.out); b = Math.max(m.in, m.out) }
        else if (ed.sel?.kind === 'clip') { a = srcToTl(ed.tl.v1, ed.sel.s); b = a + ed.sel.e - ed.sel.s }
        if (a !== null && b !== null && b - a > 200 && t >= b) t = a
      }
      if (t >= dur) { p.setT(dur); p.setPlaying(false); return }
      p.setT(t); raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing])
}

const panelAnim = (d: number, x: number) => ({ initial: { opacity: 0, x }, animate: { opacity: 1, x: 0 }, transition: { duration: .55, ease: [.2, .8, .2, 1], delay: d } })

export default function Editor() {
  const nav = useNavigate()
  const { id } = useParams()
  const { title, setTitle, cursor, log, undo, redo, tl, seq, setSeq, hlRun, setHlRun, send, status, loadError, syncing, projectId } = useEditor()
  const mode = useSession(s => s.mode)
  useEffect(() => {
    usePlayback.getState().setT(0)
    if (id) useEditor.getState().openRemote(id); else useEditor.getState().openDemo()
  }, [id])
  const wide = useWide()
  const [left, setLeft] = useState<LeftTab>('tx')
  const [right, setRight] = useState<RightTab>('agent')
  const [mobileTab, setMobileTab] = useState<AnyTab>('agent')
  const [exportOpen, setExportOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  usePlaybackLoop()

  useEffect(() => () => usePlayback.getState().setPlaying(false), [])
  // clear the run highlight after a while
  useEffect(() => { if (!hlRun) return; const t = setTimeout(() => setHlRun(null), 6000); return () => clearTimeout(t) }, [hlRun])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen(o => !o); return }
      if (exportOpen || cmdOpen) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const pb = usePlayback.getState()
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
      const ed = useEditor.getState()
      if (e.key === 'Escape') { ed.setSel(null); ed.setSelWords(null); ed.setMarks({ in: null, out: null }); return }
      if (e.key === 'k' || e.key === 'K') { pb.setPlaying(false); return }
      if (e.key === 'l' || e.key === 'L') { if (!pb.playing) pb.setPlaying(true); else pb.setRate(pb.rate >= 2 ? 1 : pb.rate + 0.5); return }
      if (e.key === 'j' || e.key === 'J') { pb.setT(pb.t - 3000); if (!pb.playing) pb.setPlaying(true); return }
      if (e.key === 'i' || e.key === 'I') { ed.setMarks({ in: pb.t, out: ed.marks.out ?? null }); return }
      if (e.key === 'o' || e.key === 'O') { ed.setMarks({ out: pb.t, in: ed.marks.in ?? 0 }); return }
      if (e.key === 'x' || e.key === 'X') { ed.setMarks({ in: null, out: null }); return }
      if (e.key === 'm' || e.key === 'M') { (window as any).__cutline?.addMarker(); return }
      if (e.key === 'Home') { pb.setT(0); return }
      if (e.key === 'End') { pb.setT(seqDur(ed.ranges())); return }
      if (e.key === ' ') { e.preventDefault(); pb.setPlaying(!pb.playing) }
      else if (e.key === 's' || e.key === 'S') (window as any).__cutline?.split()
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (useEditor.getState().selWords) cutSelectedWords(); else (window as any).__cutline?.del() }
      else if (e.key === 'ArrowLeft') pb.setT(pb.t - (e.shiftKey ? 1000 : 33))
      else if (e.key === 'ArrowRight') pb.setT(pb.t + (e.shiftKey ? 1000 : 33))
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [exportOpen, cmdOpen, undo, redo])

  const commands: Cmd[] = useMemo(() => [
    ...SUGGESTIONS.map(s => ({ id: 'ai-' + s, group: 'Ask AI', label: s, run: () => { setRight('agent'); setMobileTab('agent'); send(s) } })),
    { id: 'play', group: 'Playback', label: 'Play or pause', hint: 'Space', run: () => { const p = usePlayback.getState(); p.setPlaying(!p.playing) } },
    { id: 'split', group: 'Edit', label: 'Split at playhead', hint: 'S', run: () => (window as any).__cutline?.split() },
    { id: 'undo', group: 'Edit', label: 'Undo', hint: '⌘Z', run: undo },
    { id: 'redo', group: 'Edit', label: 'Redo', hint: '⇧⌘Z', run: redo },
    { id: 'export', group: 'File', label: 'Export', run: () => setExportOpen(true) },
    { id: 'hist', group: 'View', label: 'Show history', run: () => { setRight('hist'); setMobileTab('hist') } },
    { id: 'caps', group: 'View', label: 'Edit captions', run: () => { setLeft('caps'); setMobileTab('caps') } },
    { id: 'main', group: 'View', label: 'Go to main edit', run: () => { setSeq('main'); usePlayback.getState().setT(0) } },
    ...tl.shorts.map((s, i) => ({ id: s.id, group: 'View', label: `Watch Short ${i + 1}: ${s.title}`, run: () => { setSeq(s.id); usePlayback.getState().setT(0); usePlayback.getState().setPlaying(true) } })),
    { id: 'projects', group: 'Go', label: 'Back to projects', run: () => nav('/projects') },
    { id: 'fillers', group: 'Edit', label: 'Remove all filler words', run: () => { const ops = fillerOps(); if (ops.length) useEditor.getState().commit(ops.map(o => ({ ...o, label: `Removed ${ops.length} filler words` }))) } },
    { id: 'marker', group: 'Edit', label: 'Add marker at playhead', hint: 'M', run: () => (window as any).__cutline?.addMarker() },
    { id: 'loop', group: 'Playback', label: 'Toggle loop', run: () => usePlayback.getState().setLoop(!usePlayback.getState().loop) },
  ], [tl.shorts, undo, redo, send])

  const leftContent = { tx: <Transcript />, media: <MediaPanel />, caps: <CaptionsPanel /> }
  const rightContent = { agent: <AgentPanel />, hist: <HistoryPanel /> }
  const histLabel = <span className="inline-flex items-center gap-1.5">History <motion.span key={log.length} initial={{ scale: 1.5 }} animate={{ scale: 1 }} className="rounded-full bg-ink-700 px-1.5 text-[10.5px] text-fog-300">{log.length}</motion.span></span>

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full flex flex-col bg-ink-900 overflow-hidden lg:overflow-hidden max-lg:overflow-y-auto max-lg:h-auto max-lg:min-h-full">
      {/* top bar */}
      <motion.header initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: .45 }}
        className="flex items-center gap-2 px-3 h-14 border-b border-ink-700 bg-ink-850 shrink-0">
        <IconButton label="Back to projects" onClick={() => nav('/projects')}><ArrowLeft size={17} /></IconButton>
        <input value={title} onChange={e => setTitle(e.target.value)} aria-label="Project name"
          className="min-w-0 w-[min(340px,40vw)] bg-transparent rounded-md px-2 py-1 font-display font-semibold tracking-tight text-[16px] border border-transparent hover:border-ink-600 focus:border-sky-400 outline-none truncate" />
        <motion.span key={cursor} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="hidden sm:inline text-[12.5px] text-fog-400 whitespace-nowrap">
          Version {cursor}{cursor < log.length ? ` of ${log.length}` : ''}
        </motion.span>
        <span className="hidden md:inline-flex items-center gap-1.5 text-[12px] text-fog-500 whitespace-nowrap" title={projectId ? 'Every edit is validated and saved on the server' : 'Demo mode: edits are kept in this browser'}>
          {projectId ? (syncing ? <><Loader2 size={13} className="animate-spin" />Saving</> : <><Check size={13} className="text-jade-400" />Saved</>) : <><CloudOff size={13} />{mode === 'online' ? 'Demo, saved in this browser' : 'Offline demo'}</>}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Undo (⌘Z)" disabled={!cursor} onClick={undo}><Undo2 size={17} /></IconButton>
          <IconButton label="Redo (⇧⌘Z)" disabled={cursor >= log.length} onClick={redo}><Redo2 size={17} /></IconButton>
          <Button size="sm" variant="ghost" className="hidden md:inline-flex" icon={<Command size={14} />} onClick={() => setCmdOpen(true)}>Commands</Button>
          <Button size="sm" variant="primary" icon={<Upload size={14} />} onClick={() => setExportOpen(true)}>Export</Button>
        </div>
      </motion.header>

      {status !== 'ready' ? (
        <div className="flex-1 grid place-items-center p-10 text-center">
          {status === 'loading' ? <div className="flex flex-col items-center gap-3 text-fog-400"><Loader2 className="animate-spin text-amber-400" size={28} />Opening the project…</div>
            : <div><div className="font-display text-[22px] font-semibold">Can’t open this project yet</div><p className="text-fog-400 mt-2 max-w-[46ch]">{loadError}</p><div className="mt-5 flex gap-2 justify-center"><Button variant="primary" onClick={() => id && useEditor.getState().openRemote(id)}>Try again</Button><Link to="/projects" className="inline-flex items-center h-9 px-4 rounded-lg bg-ink-750 border border-ink-600 font-semibold text-sm">Projects</Link></div></div>}
        </div>
      ) : wide ? (
        <div className="flex-1 min-h-0 grid grid-cols-[minmax(300px,24vw)_minmax(0,1fr)_minmax(340px,26vw)]">
          <motion.aside {...panelAnim(.1, -24)} className="min-h-0 flex flex-col border-r border-ink-700 bg-ink-850">
            <Tabs id="left" value={left} onChange={setLeft} tabs={[{ id: 'tx', label: 'Transcript' }, { id: 'media', label: 'Media' }, { id: 'caps', label: 'Captions' }]} />
            <div className="flex-1 min-h-0 overflow-y-auto">{leftContent[left]}</div>
          </motion.aside>
          <motion.main initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .6, delay: .05 }} className="min-h-0 min-w-0 flex flex-col p-5 bg-[radial-gradient(90%_70%_at_50%_40%,#1E222A,#14171D)]">
            <Preview />
            {seq !== 'main' && <div className="text-center mt-3"><Button size="sm" variant="ghost" onClick={() => { setSeq('main'); usePlayback.getState().setT(0) }}>Back to main edit</Button></div>}
          </motion.main>
          <motion.aside {...panelAnim(.15, 24)} className="min-h-0 flex flex-col border-l border-ink-700 bg-ink-850">
            <Tabs id="right" value={right} onChange={setRight} tabs={[{ id: 'agent', label: 'Edit with AI' }, { id: 'hist', label: histLabel }]} />
            <div className={right === 'agent' ? 'flex-1 min-h-0' : 'flex-1 min-h-0 overflow-y-auto'}>{rightContent[right]}</div>
          </motion.aside>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="h-[min(58vw,46vh)] flex p-3"><Preview /></div>
          <div className="overflow-x-auto bg-ink-850">
            <Tabs id="mobile" value={mobileTab} onChange={setMobileTab} tabs={[{ id: 'agent', label: 'Edit with AI' }, { id: 'tx', label: 'Transcript' }, { id: 'hist', label: histLabel }, { id: 'media', label: 'Media' }, { id: 'caps', label: 'Captions' }]} />
          </div>
          <div className={`h-[52vh] bg-ink-850 ${mobileTab === 'agent' ? '' : 'overflow-y-auto'}`}>
            {mobileTab in leftContent ? leftContent[mobileTab as LeftTab] : rightContent[mobileTab as RightTab]}
          </div>
        </div>
      )}

      {status === 'ready' && <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: .55, delay: .2, ease: [.2, .8, .2, 1] }} className="shrink-0">
        <Timeline />
      </motion.div>}

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} commands={commands} />
    </motion.div>
  )
}
