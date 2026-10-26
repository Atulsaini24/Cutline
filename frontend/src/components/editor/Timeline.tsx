import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bookmark, Magnet, Minus, Pause, Play, Plus, Repeat, RotateCcw, Scissors, SkipBack, Trash2, Wind } from 'lucide-react'
import clsx from 'clsx'
import { pendingItems, useEditor, usePlayback } from '../../store/editor'
import { amp, BROLL, nearestBoundary, SENTS, sentAt, snippet, speaker, SRC_DUR, WORDS } from '../../lib/sample'
import { gapBefore, keptIn, seqDur, srcToTl, tlToSrc, type NewOp } from '../../lib/timeline'
import { fmt, fmtShort, secs } from '../../lib/format'
import { IconButton, Kbd } from '../ui'

const spring = { type: 'spring', stiffness: 420, damping: 40, mass: 0.8 } as const
const TRACKS = [{ id: 'v2', label: 'B-roll', h: 34 }, { id: 'v1', label: 'Video', h: 60 }, { id: 'a1', label: 'Audio', h: 46 }, { id: 'c1', label: 'Captions', h: 30 }]
const RULER = 30

const Wave = memo(function Wave({ s, e, w }: { s: number; e: number; w: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current; if (!cv) return
    const W = Math.max(2, Math.min(Math.round(w), 4000)), H = 40, dpr = Math.min(devicePixelRatio || 1, 2)
    cv.width = W * dpr; cv.height = H * dpr
    const c = cv.getContext('2d')!; c.scale(dpr, dpr)
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(160,240,205,.95)'); g.addColorStop(1, 'rgba(95,211,161,.55)'); c.fillStyle = g
    for (let x = 0; x < W; x += 2) { const ms = s + (x / W) * (e - s); const a = amp(ms) * (H / 2 - 3); c.fillRect(x, H / 2 - a, 1.3, a * 2) }
  }, [s, e, w])
  return <canvas ref={ref} className="absolute inset-0 w-full h-full" />
})

function Playhead({ pxs, scroller }: { pxs: number; scroller: React.RefObject<HTMLDivElement> }) {
  const ref = useRef<HTMLDivElement>(null); const skim = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const place = (t: number, playing: boolean, sk: number | null) => {
      const x = (t * pxs) / 1000
      if (ref.current) ref.current.style.transform = `translateX(${x}px)`
      if (skim.current) { skim.current.style.opacity = sk === null || playing ? '0' : '1'; if (sk !== null) skim.current.style.transform = `translateX(${(sk * pxs) / 1000}px)` }
      const sc = scroller.current
      if (playing && sc && (x > sc.scrollLeft + sc.clientWidth - 80 || x < sc.scrollLeft)) sc.scrollLeft = x - 80
    }
    const st = usePlayback.getState(); place(st.t, st.playing, st.skim)
    return usePlayback.subscribe(s => place(s.t, s.playing, s.skim))
  }, [pxs, scroller])
  return (<>
    <div ref={skim} className="absolute top-0 bottom-0 left-0 z-20 pointer-events-none w-px bg-fog-100/50 opacity-0" />
    <div ref={ref} className="absolute top-0 bottom-0 left-0 z-20 pointer-events-none will-change-transform">
      <div className="absolute top-0 bottom-0 -left-px w-0.5 bg-coral-500 shadow-[0_0_12px_rgba(240,103,90,.6)]" />
      <div className="absolute top-0 -left-[7px] w-3.5 h-4 bg-coral-500" style={{ clipPath: 'polygon(0 0,100% 0,100% 60%,50% 100%,0 60%)' }} />
    </div>
  </>)
}
function Timecode() {
  const t = usePlayback(s => s.t); const rate = usePlayback(s => s.rate)
  const dur = useEditor(s => seqDur(s.ranges()))
  return <span className="text-[13px] text-fog-300 w-[150px]"><b className="text-fog-100 font-semibold">{fmt(t)}</b> / {fmt(dur)}{rate !== 1 && <span className="ml-1.5 text-amber-300 font-semibold">{rate}×</span>}</span>
}

type Menu = { x: number; y: number; idx: number } | null
type SeamPop = { idx: number; x: number } | null

export default function Timeline() {
  const { tl, seq, sel, setSel, commit, chat, hlRun, setSeq, marks, setMarks, cutTimelineRange } = useEditor()
  const ranges = useEditor(s => s.ranges())
  const playing = usePlayback(s => s.playing); const loop = usePlayback(s => s.loop)
  const { setPlaying, setT, setSkim, setLoop } = usePlayback.getState()
  const isShort = seq !== 'main'
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [zoom, setZoom] = useState(0)
  const [snap, setSnap] = useState(true)
  const [drag, setDrag] = useState<{ idx: number; s: number; e: number; snapAt: number | null } | null>(null)
  const [menu, setMenu] = useState<Menu>(null)
  const [seamPop, setSeamPop] = useState<SeamPop>(null)

  useLayoutEffect(() => { const el = scroller.current; if (!el) return; const ro = new ResizeObserver(() => setWidth(el.clientWidth)); ro.observe(el); setWidth(el.clientWidth); return () => ro.disconnect() }, [])
  const dur = seqDur(ranges)
  const fit = Math.max(1, (width - 30) / (Math.max(dur, 1000) / 1000))
  const pxs = zoom === 0 ? fit : fit * Math.pow(Math.max(80 / fit, 1.5), zoom / 100) * (1 + zoom / 30)
  const k = pxs / 1000
  const innerW = Math.max(dur * k + 60, width)
  const pend = pendingItems(isShort ? [] : chat)

  // ctrl/⌘ + wheel zooms around the pointer; shift + wheel scrolls sideways
  useEffect(() => {
    const el = scroller.current; if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const r = el.getBoundingClientRect(); const tAt = (e.clientX - r.left + el.scrollLeft) / k
        setZoom(z => { const nz = Math.max(0, Math.min(100, z - e.deltaY * 0.15)); requestAnimationFrame(() => { const nk = (zoomPxs(nz)) / 1000; el.scrollLeft = tAt * nk - (e.clientX - r.left) }); return nz })
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { el.scrollLeft += e.deltaX || e.deltaY; e.preventDefault() }
    }
    el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel)
  })
  const zoomPxs = (z: number) => z === 0 ? fit : fit * Math.pow(Math.max(80 / fit, 1.5), z / 100) * (1 + z / 30)

  const clips = useMemo(() => {
    let acc = 0
    return ranges.map((iv, idx) => {
      const d = iv.e - iv.s; const left = acc; acc += d
      const words = WORDS.filter(x => x.e > iv.s && x.s < iv.e).slice(0, 9).map(x => x.text).join(' ')
      return { iv, idx, left, d, words, spk: sentAt(iv.s + 1).spk, leftBy: 'leftBy' in iv ? (iv as any).leftBy : null }
    })
  }, [ranges])
  const captions = useMemo(() => {
    if (!tl.cap.on && !isShort) return []
    return SENTS.map(s => {
      const kept = s.w.filter(w => keptIn(ranges, (w.s + w.e) / 2) && w.text !== '(speech)'); if (!kept.length) return null
      const a = srcToTl(ranges, kept[0].s), b = srcToTl(ranges, kept[kept.length - 1].e - 1)
      return { i: s.i, a, b, text: !isShort && tl.cap.edits[s.i] != null ? tl.cap.edits[s.i] : kept.map(w => w.text).join(' ') }
    }).filter(Boolean) as { i: number; a: number; b: number; text: string }[]
  }, [ranges, tl.cap, isShort])
  const stepS = [1, 2, 5, 10, 15, 30, 60, 120, 300].find(s => s * pxs >= 74) || 600
  const ticks: number[] = []; for (let s = 0; s * 1000 <= dur + 1; s += stepS) ticks.push(s)

  /* ---------- actions ---------- */
  const isSelected = (iv: { s: number; e: number }) => sel?.kind === 'clip' && ((sel.s === iv.s && sel.e === iv.e) || !!sel.multi?.some(m => m.s === iv.s && m.e === iv.e))
  const split = () => {
    if (isShort) return
    const src = tlToSrc(tl.v1, usePlayback.getState().t)
    if (tl.v1.find(x => x.s + 80 < src && src < x.e - 80)) commit([{ type: 'split', author: 'user', label: `Split at ${fmt(usePlayback.getState().t)}`, p: { at: Math.round(src) } }])
  }
  const del = () => {
    const m = useEditor.getState().marks
    if (m.in !== null && m.out !== null && !isShort) { cutTimelineRange(Math.min(m.in, m.out), Math.max(m.in, m.out), `Cut ${fmt(Math.min(m.in, m.out))} to ${fmt(Math.max(m.in, m.out))}`); setMarks({ in: null, out: null }); return }
    if (!sel || isShort) return
    if (sel.kind === 'clip') {
      const list = sel.multi?.length ? sel.multi : [{ s: sel.s, e: sel.e }]
      commit(list.map(r => ({ type: 'deleteClip', author: 'user', label: list.length > 1 ? `Deleted ${list.length} clips` : `Deleted clip “${snippet(r.s, r.e)}”`, p: r })) as NewOp[])
    } else commit([{ type: 'removeBroll', author: 'user', label: 'Removed B-roll', p: { id: sel.id } }])
    setSel(null)
  }
  const addMarker = () => {
    const t = usePlayback.getState().t; const at = Math.round(tlToSrc(ranges, t))
    commit([{ type: 'addMarker', author: 'user', label: `Marker at ${fmt(t)}`, p: { id: 'm' + Date.now().toString(36), at, label: `Marker ${tl.markers.length + 1}` } }])
  }
  const restoreGap = (idx: number) => { const g = gapBefore(tl, idx); if (g) commit([{ type: 'restore', author: 'user', label: `Restored ${secs(g.e - g.s)} “${snippet(g.s, g.e)}”`, p: g }]); setSeamPop(null) }
  const removePausesIn = (idx: number) => {
    const iv = tl.v1[idx]; const ws = WORDS.filter(w => w.s >= iv.s && w.e <= iv.e); const ops: NewOp[] = []
    for (let i = 1; i < ws.length; i++) { const g = ws[i].s - ws[i - 1].e; if (g > 800) ops.push({ type: 'cut', author: 'user', label: `Shortened ${ops.length + 1} pause${ops.length ? 's' : ''} in clip`, p: { s: ws[i - 1].e + 250, e: ws[i].s - 200 } }) }
    if (ops.length) commit(ops.map(o => ({ ...o, label: `Shortened ${ops.length} pause${ops.length > 1 ? 's' : ''} in clip` }))); else usePlayback.getState().setT(usePlayback.getState().t)
    setMenu(null)
  }
  useEffect(() => { (window as any).__cutline = { split, del, addMarker } })

  /* ---------- pointer ---------- */
  const toT = (clientX: number) => { const r = scroller.current!.getBoundingClientRect(); return Math.max(0, (clientX - r.left + scroller.current!.scrollLeft) / k) }
  const onMove = (e: RPE<HTMLDivElement>) => { if (e.buttons === 0 && e.pointerType === 'mouse') setSkim(Math.min(dur, toT(e.clientX))) }
  const onDown = (e: RPE<HTMLDivElement>) => {
    if (e.button === 2) return
    setMenu(null); setSeamPop(null)
    const target = e.target as HTMLElement
    const seam = target.closest('[data-seam]') as HTMLElement | null
    if (seam && !isShort) { const idx = +seam.dataset.seam!; setSeamPop({ idx, x: clips[idx].left * k }); return }
    const marker = target.closest('[data-marker]') as HTMLElement | null
    if (marker) { setT(srcToTl(ranges, +marker.dataset.marker!)); return }
    const handle = target.closest('[data-handle]') as HTMLElement | null
    const clipEl = target.closest('[data-clip]') as HTMLElement | null
    const brEl = target.closest('[data-broll]') as HTMLElement | null
    if (handle && clipEl && !isShort) {
      e.preventDefault(); e.stopPropagation()
      const idx = +clipEl.dataset.clip!; const iv = tl.v1[idx]; const prev = tl.v1[idx - 1], next = tl.v1[idx + 1]
      const side = handle.dataset.handle; const x0 = e.clientX; const phSrc = tlToSrc(tl.v1, usePlayback.getState().t)
      let ns = iv.s, ne = iv.e
      const snapTo = (ms: number, alt: boolean) => {
        if (!snap || alt) return { v: ms, at: null as number | null }
        const within = 9 / k; const cands = [nearestBoundary(ms, within), Math.abs(phSrc - ms) < within ? phSrc : null].filter((x): x is number => x !== null)
        if (!cands.length) return { v: ms, at: null }
        const best = cands.sort((a, b) => Math.abs(a - ms) - Math.abs(b - ms))[0]; return { v: best, at: best }
      }
      setDrag({ idx, s: iv.s, e: iv.e, snapAt: null })
      const mv = (ev: PointerEvent) => {
        const dms = (ev.clientX - x0) / k; let at: number | null = null
        if (side === 'l') { const r = snapTo(iv.s + dms, ev.altKey); at = r.at; ns = Math.round(Math.max(prev ? prev.e : 0, Math.min(iv.e - 200, r.v))) }
        else { const r = snapTo(iv.e + dms, ev.altKey); at = r.at; ne = Math.round(Math.min(next ? next.s : SRC_DUR, Math.max(iv.s + 200, r.v))) }
        setDrag({ idx, s: ns, e: ne, snapAt: at })
      }
      const up = () => {
        window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); setDrag(null)
        if (ns !== iv.s || ne !== iv.e) {
          setSel({ kind: 'clip', s: ns, e: ne })
          const delta = side === 'l' ? ns - iv.s : ne - iv.e
          commit([{ type: 'trim', author: 'user', label: `Trimmed clip ${side === 'l' ? 'start' : 'end'} ${delta > 0 ? '+' : '−'}${secs(Math.abs(delta))}`, p: { oldS: iv.s, oldE: iv.e, s: ns, e: ne } }])
        }
      }
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
      return
    }
    if (brEl && !isShort) {
      // drag B-roll to move it; click to select
      const id = brEl.dataset.broll!; const b = tl.broll.find(x => x.id === id)!; const x0 = e.clientX; let moved = false; const startTl = srcToTl(tl.v1, b.anchor)
      setSel({ kind: 'broll', id })
      const mv = (ev: PointerEvent) => { const dx = ev.clientX - x0; if (Math.abs(dx) > 3) moved = true; brEl.style.transform = `translateX(${dx}px)` }
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); brEl.style.transform = ''
        if (moved) { const nt = Math.max(0, startTl + (ev.clientX - x0) / k); commit([{ type: 'moveBroll', author: 'user', label: `Moved B-roll to ${fmt(nt)}`, p: { id, anchor: Math.round(tlToSrc(tl.v1, nt)) } }]) }
      }
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
      return
    }
    if (clipEl && !isShort) {
      const iv = tl.v1[+clipEl.dataset.clip!]
      if (e.shiftKey && sel?.kind === 'clip') { const list = [...(sel.multi ?? [{ s: sel.s, e: sel.e }])]; const at = list.findIndex(m => m.s === iv.s); if (at >= 0) list.splice(at, 1); else list.push({ s: iv.s, e: iv.e }); setSel(list.length ? { kind: 'clip', s: list[0].s, e: list[0].e, multi: list } : null) }
      else setSel({ kind: 'clip', s: iv.s, e: iv.e })
      setT(toT(e.clientX)); return
    }
    // ruler or empty track: shift-drag marks a range, plain drag scrubs
    setSel(null)
    const t0 = toT(e.clientX)
    if (e.shiftKey && !isShort) setMarks({ in: t0, out: t0 }); else setT(t0)
    const mv = (ev: PointerEvent) => { const t = Math.min(dur, toT(ev.clientX)); if (e.shiftKey && !isShort) setMarks({ out: t }); else setT(t) }
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); const m = useEditor.getState().marks; if (m.in !== null && m.out !== null && Math.abs(m.out - m.in) < 100) setMarks({ in: null, out: null }) }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
  }
  const onContext = (e: React.MouseEvent) => {
    const clipEl = (e.target as HTMLElement).closest('[data-clip]') as HTMLElement | null
    if (!clipEl || isShort) return
    e.preventDefault(); const idx = +clipEl.dataset.clip!; const iv = tl.v1[idx]
    if (!isSelected(iv)) setSel({ kind: 'clip', s: iv.s, e: iv.e })
    setSeamPop(null)
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 250), y: Math.max(10, Math.min(e.clientY, window.innerHeight - 320)), idx })
  }

  const runLabel = (runId: string | null) => runId ? `AI run ${runId.replace(/\D/g, '')}` : 'you'
  const mk = marks.in !== null && marks.out !== null ? { a: Math.min(marks.in, marks.out), b: Math.max(marks.in, marks.out) } : null
  const info = isShort ? `Vertical 1080×1920, ${fmtShort(dur)}`
    : mk ? `Range ${fmt(mk.a)} to ${fmt(mk.b)}, ${secs(mk.b - mk.a)}. Delete cuts it.`
      : sel?.kind === 'clip' ? (sel.multi && sel.multi.length > 1 ? `${sel.multi.length} clips selected` : `Clip ${fmt(sel.s)} to ${fmt(sel.e)} in the source, ${secs(sel.e - sel.s)}`)
        : `${ranges.length} clip${ranges.length === 1 ? '' : 's'}, ${fmtShort(dur)} of ${fmtShort(SRC_DUR)} kept`
  const menuIv = menu ? tl.v1[menu.idx] : null
  const pop = seamPop ? { g: gapBefore(tl, seamPop.idx), by: clips[seamPop.idx]?.leftBy } : null

  return (
    <section aria-label="Timeline" className="border-t border-ink-700 bg-ink-850 flex flex-col select-none relative">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-ink-700 flex-wrap">
        <IconButton label="Back to start (Home)" onClick={() => setT(0)}><SkipBack size={16} /></IconButton>
        <motion.button whileTap={{ scale: .9 }} onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'} className="w-9 h-9 rounded-full bg-fog-100 text-ink-900 grid place-items-center hover:bg-white">
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
        </motion.button>
        <Timecode />
        <span className="w-px h-6 bg-ink-700 mx-1" />
        <select value={seq} onChange={e => { setSeq(e.target.value); setT(0); setZoom(0) }} aria-label="Sequence" className="h-8 max-w-[240px] rounded-lg bg-ink-800 border border-ink-600 px-2 text-[13px] font-semibold">
          <option value="main">Main edit, 16:9</option>
          {tl.shorts.map((s, i) => <option key={s.id} value={s.id}>Short {i + 1}: {s.title}</option>)}
        </select>
        <IconButton label="Split at playhead (S)" disabled={isShort} onClick={split}><Scissors size={16} /></IconButton>
        <IconButton label="Delete selection or marked range (Delete)" disabled={isShort || (!sel && !mk)} onClick={del}><Trash2 size={16} /></IconButton>
        <IconButton label="Add marker (M)" disabled={isShort} onClick={addMarker}><Bookmark size={16} /></IconButton>
        <IconButton label={snap ? 'Snapping on: trims stick to word edges (hold Alt to bypass)' : 'Snapping off'} onClick={() => setSnap(s => !s)} className={snap ? 'text-amber-300' : ''}><Magnet size={16} /></IconButton>
        <IconButton label={loop ? 'Loop on: plays the marked range or selected clip again' : 'Loop off'} onClick={() => setLoop(!loop)} className={loop ? 'text-amber-300' : ''}><Repeat size={16} /></IconButton>
        <span className="hidden lg:inline text-[12.5px] text-fog-400 ml-2 truncate max-w-[46ch]">{info}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <IconButton label="Zoom out" onClick={() => setZoom(z => Math.max(0, z - 20))}><Minus size={15} /></IconButton>
          <input type="range" min={0} max={100} value={zoom} onChange={e => setZoom(+e.target.value)} aria-label="Zoom" className="w-24 accent-fog-100" />
          <IconButton label="Zoom in (Ctrl/⌘ + scroll)" onClick={() => setZoom(z => Math.min(100, z + 20))}><Plus size={15} /></IconButton>
        </div>
      </div>

      <div className="grid grid-cols-[80px_minmax(0,1fr)] relative">
        <div className="border-r border-ink-700 text-[12px] text-fog-400">
          <div style={{ height: RULER }} className="border-b border-ink-700" />
          {TRACKS.map(t => <div key={t.id} style={{ height: t.h }} className="flex items-center pl-3 border-b border-ink-750">{t.label}</div>)}
        </div>
        <div ref={scroller} className="overflow-x-auto overflow-y-hidden relative" onPointerDown={onDown} onPointerMove={onMove} onPointerLeave={() => setSkim(null)} onContextMenu={onContext} style={{ touchAction: 'pan-y' }}>
          <div className="relative" style={{ width: innerW, height: RULER + TRACKS.reduce((a, t) => a + t.h, 0) }}>
            <div className="relative border-b border-ink-700 cursor-pointer" style={{ height: RULER }} title="Click to seek. Shift-drag to mark a range.">
              {ticks.map(s => <div key={s} className="absolute top-0 bottom-0 border-l border-ink-600 pl-1 pt-1 text-[10.5px] text-fog-500" style={{ left: s * 1000 * k }}>{fmtShort(s * 1000)}</div>)}
              {!isShort && tl.markers.map(m => keptIn(ranges, m.at) && (
                <motion.button key={m.id} data-marker={m.at} initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} title={`${m.label} at ${fmt(srcToTl(ranges, m.at))}`}
                  className="absolute top-0 z-10 -ml-[6px] w-3 h-4 bg-lilac-400" style={{ left: srcToTl(ranges, m.at) * k, clipPath: 'polygon(0 0,100% 0,100% 70%,50% 100%,0 70%)' }} />
              ))}
            </div>
            {mk && <div className="absolute z-10 pointer-events-none bg-sky-400/10 border-x-2 border-sky-400" style={{ left: mk.a * k, width: (mk.b - mk.a) * k, top: 0, bottom: 0 }}><div className="h-[6px] bg-sky-400/70" /></div>}

            <div className="relative border-b border-ink-750 bg-ink-900/40" style={{ height: 34 }}>
              <AnimatePresence>
                {!isShort && tl.broll.map(b => {
                  const a = srcToTl(ranges, b.anchor); const asset = BROLL.find(x => x.id === b.asset)
                  return (
                    <motion.div key={b.id} data-broll={b.id} layout transition={spring} initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .8 }}
                      className={clsx('absolute top-1 bottom-1 rounded-md px-2 text-[11px] font-semibold flex items-center truncate cursor-grab active:cursor-grabbing bg-gradient-to-b from-[#B07A3E] to-[#8C5F2E] text-white', sel?.kind === 'broll' && sel.id === b.id && 'ring-2 ring-white')}
                      style={{ left: a * k, width: b.dur * k }}>{asset?.name ?? 'B-roll'}</motion.div>
                  )
                })}
              </AnimatePresence>
            </div>

            <div className="relative border-b border-ink-750 bg-ink-900/40" style={{ height: 60 }}>
              {!ranges.length && <div className="absolute left-3 top-5 text-[13px] text-fog-400">Everything is cut. Undo, or restore words in the transcript.</div>}
              <AnimatePresence initial={false}>
                {clips.map(c => {
                  const d = drag && drag.idx === c.idx ? drag : null
                  const left = d ? c.left + (d.s - c.iv.s) : c.left; const w = d ? d.e - d.s : c.d
                  const color = speaker(c.spk).color
                  return (
                    <motion.div key={c.iv.s} data-clip={c.idx} layout={!drag} transition={spring}
                      initial={{ opacity: 0, scaleY: .6 }} animate={{ opacity: 1, scaleY: 1 }} exit={{ opacity: 0, scaleY: .3, transition: { duration: .25 } }}
                      className={clsx('group absolute top-1 bottom-1 rounded-lg overflow-hidden cursor-pointer text-white', isSelected(c.iv) && !isShort ? 'ring-2 ring-white shadow-[0_0_0_4px_rgba(238,240,245,.15)]' : 'ring-1 ring-white/10')}
                      style={{ left: left * k, width: Math.max(w * k, 2), background: `linear-gradient(180deg, ${color}cc, ${color}77)` }}>
                      <span className="absolute inset-x-2 top-1.5 text-[11.5px] font-semibold truncate pointer-events-none [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">{c.words || 'Room tone'}</span>
                      {w * k > 60 && <span className="absolute left-2 bottom-1.5 text-[10.5px] opacity-80 pointer-events-none">{secs(w)}</span>}
                      {!isShort && w * k > 24 && <>
                        <span data-handle="l" className="absolute left-0 inset-y-0 w-2.5 cursor-ew-resize group-hover:bg-white/35 transition" />
                        <span data-handle="r" className="absolute right-0 inset-y-0 w-2.5 cursor-ew-resize group-hover:bg-white/35 transition" />
                      </>}
                    </motion.div>
                  )
                })}
              </AnimatePresence>
              {!isShort && clips.map(c => c.idx > 0 && c.leftBy && !c.leftBy.split ? (
                <motion.button key={'seam' + c.iv.s} data-seam={c.idx} layout={!drag} transition={spring} title={`Cut by ${runLabel(c.leftBy.runId)}. Click to see what was removed.`}
                  initial={{ scaleY: 0 }} animate={{ scaleY: 1, opacity: hlRun && c.leftBy.runId !== hlRun ? .35 : 1 }} whileHover={{ scaleX: 2.2 }}
                  className={clsx('absolute -top-0.5 -bottom-0.5 z-10 rounded-full', c.leftBy.author === 'agent' ? 'bg-amber-400' : 'bg-sky-400', hlRun && c.leftBy.runId === hlRun ? 'w-[5px] -ml-[2.5px] shadow-glow animate-pulse' : 'w-[4px] -ml-[2px]')}
                  style={{ left: c.left * k }} />
              ) : null)}
              <AnimatePresence>
                {pend.map((x, i) => { const a = srcToTl(ranges, x.s), b = srcToTl(ranges, x.e); if (b <= a) return null
                  return <motion.div key={'p' + x.s} initial={{ opacity: 0, scaleY: 0 }} animate={{ opacity: 1, scaleY: 1 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(i * 0.03, .6) }} className="absolute top-0 bottom-0 z-10 hatch rounded border border-amber-400 pointer-events-none" style={{ left: a * k, width: Math.max((b - a) * k, 3) }} /> })}
              </AnimatePresence>
              {drag?.snapAt != null && <div className="absolute -top-2 -bottom-[120px] z-30 w-px bg-amber-300 pointer-events-none shadow-[0_0_8px_#F7BE4A]" style={{ left: (clips[drag.idx].left + (drag.snapAt - clips[drag.idx].iv.s)) * k }} />}
            </div>

            <div className="relative border-b border-ink-750 bg-ink-900/40" style={{ height: 46 }}>
              <AnimatePresence initial={false}>
                {clips.map(c => { const d = drag && drag.idx === c.idx ? drag : null; const left = d ? c.left + (d.s - c.iv.s) : c.left; const w = d ? d.e - d.s : c.d
                  return <motion.div key={c.iv.s} layout={!drag} transition={spring} exit={{ opacity: 0 }} className="absolute top-1 bottom-1 rounded-md overflow-hidden bg-[#1F4D41] ring-1 ring-white/5" style={{ left: left * k, width: Math.max(w * k, 2) }}><Wave s={d ? d.s : c.iv.s} e={d ? d.e : c.iv.e} w={Math.max(w * k, 2)} /></motion.div> })}
              </AnimatePresence>
            </div>
            <div className="relative border-b border-ink-750 bg-ink-900/40" style={{ height: 30 }}>
              <AnimatePresence initial={false}>
                {captions.map(c => <motion.div key={c.i} layout transition={spring} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} title={c.text} className="absolute top-1 bottom-1 rounded-md bg-lilac-500/70 text-white text-[10.5px] font-semibold px-1.5 flex items-center overflow-hidden whitespace-nowrap" style={{ left: c.a * k, width: Math.max((c.b - c.a) * k, 3) }}>{c.text}</motion.div>)}
              </AnimatePresence>
            </div>
            <Playhead pxs={pxs} scroller={scroller} />
          </div>
        </div>

        <AnimatePresence>
          {menu && menuIv && (
            <motion.div key="menu" initial={{ opacity: 0, scale: .95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .95 }} transition={{ duration: .12 }}
              className="fixed z-[60] w-60 rounded-xl border border-ink-600 bg-ink-800/95 backdrop-blur p-1.5 shadow-lift text-[13px]" style={{ left: menu.x, top: menu.y }} onPointerDown={e => e.stopPropagation()}>
              {[
                { l: 'Play this clip', k: '', f: () => { setT(srcToTl(tl.v1, menuIv.s)); setPlaying(true) } },
                { l: 'Split at playhead', k: 'S', f: split },
                { l: sel?.kind === 'clip' && sel.multi && sel.multi.length > 1 ? `Delete ${sel.multi.length} clips` : 'Delete clip', k: 'Del', f: del },
                { l: 'Restore the cut before', k: '', f: () => restoreGap(menu.idx), off: !gapBefore(tl, menu.idx) },
                { l: 'Restore the cut after', k: '', f: () => restoreGap(menu.idx + 1), off: !gapBefore(tl, menu.idx + 1) },
                { l: 'Shorten pauses inside', k: '', f: () => removePausesIn(menu.idx) },
                { l: 'Mark this clip as a range', k: 'I / O', f: () => { const a = srcToTl(tl.v1, menuIv.s); setMarks({ in: a, out: a + menuIv.e - menuIv.s }) } },
                { l: 'Add marker at playhead', k: 'M', f: addMarker },
              ].map(it => (
                <button key={it.l} disabled={it.off} onClick={() => { setMenu(null); it.f() }} className="w-full flex items-center justify-between px-2.5 h-8 rounded-lg hover:bg-ink-700 disabled:opacity-35 disabled:hover:bg-transparent text-left">{it.l}{it.k && <Kbd>{it.k}</Kbd>}</button>
              ))}
            </motion.div>
          )}
          {pop?.g && seamPop && (
            <motion.div key="seam" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onPointerDown={e => e.stopPropagation()}
              className="absolute z-40 w-72 rounded-xl border border-ink-600 bg-ink-800/95 backdrop-blur p-3.5 shadow-lift" style={{ left: Math.max(90, Math.min(80 + seamPop.x - (scroller.current?.scrollLeft ?? 0) - 140, width - 220)), bottom: 150 }}>
              <div className="text-[12px] font-semibold" style={{ color: pop.by?.author === 'agent' ? '#F7BE4A' : '#7CC4FF' }}>Removed by {runLabel(pop.by?.runId ?? null)}</div>
              <div className="mt-1 text-[14px] leading-snug">“{snippet(pop.g.s, pop.g.e)}”</div>
              <div className="text-[12px] text-fog-400 mt-0.5">{secs(pop.g.e - pop.g.s)} from {fmt(pop.g.s)} in the source</div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => restoreGap(seamPop.idx)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-fog-100 text-ink-900 text-[13px] font-semibold"><RotateCcw size={14} />Restore</button>
                <button onClick={() => { setT(Math.max(0, clips[seamPop.idx].left - 2000)); setPlaying(true); setSeamPop(null) }} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-ink-700 text-[13px] font-semibold"><Wind size={14} />Play across the cut</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="hidden lg:flex gap-4 px-3 py-1.5 border-t border-ink-750 text-[11.5px] text-fog-500 flex-wrap">
        <span><Kbd>Space</Kbd> play</span><span><Kbd>J</Kbd><Kbd>K</Kbd><Kbd>L</Kbd> shuttle</span><span><Kbd>S</Kbd> split</span><span><Kbd>I</Kbd><Kbd>O</Kbd> mark range</span><span><Kbd>M</Kbd> marker</span><span><Kbd>⌘Z</Kbd> undo</span><span><Kbd>⌘K</Kbd> commands</span>
        <span className="ml-auto">Right-click a clip for more. Click an amber or blue seam to see or restore what was cut.</span>
      </div>
    </section>
  )
}
