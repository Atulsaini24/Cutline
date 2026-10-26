import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useEditor, usePlayback } from '../../store/editor'
import { drawBroll, drawCaption, drawScene, SCENE_H, SCENE_W } from '../../lib/draw'
import { isSample, sentAt, speaker } from '../../lib/sample'
import { srcToTl, tlToSrc } from '../../lib/timeline'
import { mediaUrl } from '../../lib/api'

/** Draws the current frame: the proxy video when there is one, otherwise the sample's drawn stand-in. */
export default function Preview() {
  const stage = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null)
  const video = useRef<HTMLVideoElement>(null); const scene = useRef<HTMLCanvasElement>()
  const seq = useEditor(s => s.seq); const tl = useEditor(s => s.tl); const proxy = useEditor(s => s.media.proxy)
  const vertical = seq !== 'main'
  const [box, setBox] = useState({ w: 640, h: 360 })
  const [spk, setSpk] = useState('M')
  const [buffering, setBuffering] = useState(false)

  useLayoutEffect(() => {
    const el = stage.current; if (!el) return
    const measure = () => { const ar = vertical ? 9 / 16 : 16 / 9; const W = el.clientWidth, H = el.clientHeight; let w = W, h = W / ar; if (h > H) { h = H; w = H * ar } setBox({ w: Math.floor(w), h: Math.floor(h) }) }
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect()
  }, [vertical])

  useEffect(() => {
    if (!scene.current) { const c = document.createElement('canvas'); c.width = SCENE_W; c.height = SCENE_H; scene.current = c }
    const cv = canvas.current!; const dpr = Math.min(devicePixelRatio || 1, 2)
    cv.width = Math.max(1, box.w * dpr); cv.height = Math.max(1, box.h * dpr)
    const ctx = cv.getContext('2d')!; const sctx = scene.current.getContext('2d')!
    const v = video.current; let lastSeek = 0
    const draw = (pb: { t: number; playing: boolean; rate: number; skim: number | null }) => {
      const st = useEditor.getState(); const r = st.ranges(); const W = cv.width, H = cv.height
      if (!r.length) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); v?.pause(); return }
      const t = pb.skim !== null && !pb.playing ? pb.skim : pb.t
      const src = tlToSrc(r, t)
      let br: { asset: string; p: number } | null = null
      if (!vertical) for (const b of st.tl.broll) { const a = srcToTl(r, b.anchor); if (t >= a && t < a + b.dur) br = { asset: b.asset, p: (t - a) / b.dur } }
      if (v && proxy) {
        const cur = v.currentTime * 1000
        if (pb.playing && pb.skim === null) {
          v.playbackRate = pb.rate; v.muted = !!br
          if (v.paused) v.play().catch(() => {})
          if (Math.abs(cur - src) > 220 && performance.now() - lastSeek > 120) { v.currentTime = src / 1000; lastSeek = performance.now() }
        } else { if (!v.paused) v.pause(); if (Math.abs(cur - src) > 30 && performance.now() - lastSeek > 60) { v.currentTime = src / 1000; lastSeek = performance.now() } }
      }
      if (br) drawBroll(ctx, W, H, br.asset, br.p)
      else if (v && proxy && v.readyState >= 2 && v.videoWidth) {
        const vw = v.videoWidth, vh = v.videoHeight
        if (vertical) { const cw = vh * 9 / 16; ctx.drawImage(v, Math.max(0, (vw - cw) / 2), 0, cw, vh, 0, 0, W, H) } else ctx.drawImage(v, 0, 0, W, H)
      } else if (isSample() || !proxy) {
        drawScene(sctx, src)
        if (vertical) { const s = sentAt(src).spk; const cw = SCENE_H * 9 / 16; const cx = Math.min(SCENE_W - cw, Math.max(0, (s === 'M' ? 390 : 560) - cw / 2)); ctx.drawImage(scene.current!, cx, 0, cw, SCENE_H, 0, 0, W, H) }
        else ctx.drawImage(scene.current!, 0, 0, W, H)
      } else { const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1E222A'); g.addColorStop(1, '#101217'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H) }
      if (st.tl.cap.on || vertical) drawCaption(ctx, W, H, src, r, vertical ? 'bold' : st.tl.cap.style, vertical, !vertical ? st.tl.cap.edits[sentAt(src).i] : undefined)
      const sp = sentAt(src).spk; setSpk(p => p === sp ? p : sp)
    }
    const run = () => draw(usePlayback.getState())
    run()
    const unsub = usePlayback.subscribe(s => draw(s))
    const onFrame = () => { if (!usePlayback.getState().playing) run() }
    v?.addEventListener('seeked', onFrame); v?.addEventListener('loadeddata', onFrame)
    const w = () => setBuffering(true), p = () => setBuffering(false)
    v?.addEventListener('waiting', w); v?.addEventListener('playing', p); v?.addEventListener('seeked', p)
    if (document.fonts) document.fonts.ready.then(run)
    return () => { unsub(); v?.removeEventListener('seeked', onFrame); v?.removeEventListener('loadeddata', onFrame); v?.removeEventListener('waiting', w); v?.removeEventListener('playing', p); v?.removeEventListener('seeked', p) }
  }, [box, vertical, tl, seq, proxy])

  useEffect(() => () => video.current?.pause(), [])
  const sp = speaker(spk)
  return (
    <div ref={stage} className="relative flex-1 min-h-0 grid place-items-center">
      {proxy && <video ref={video} src={mediaUrl(proxy)} preload="auto" playsInline crossOrigin="anonymous" className="hidden" />}
      <motion.div layout transition={{ type: 'spring', stiffness: 260, damping: 30 }} className="relative rounded-xl overflow-hidden bg-black shadow-[0_30px_80px_-30px_rgba(0,0,0,.9)] ring-1 ring-white/5" style={{ width: box.w, height: box.h }}>
        <canvas ref={canvas} className="block w-full h-full" />
        <div className="absolute top-2.5 left-2.5 flex gap-1.5">
          <span className="rounded-md bg-black/55 backdrop-blur px-2 py-0.5 text-[11px] font-semibold text-white/90">{vertical ? 'Short, reframed 9:16' : proxy ? 'Proxy 540p' : 'Sample preview'}</span>
          <AnimatePresence mode="wait"><motion.span key={spk} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="rounded-md bg-black/55 backdrop-blur px-2 py-0.5 text-[11px] font-semibold" style={{ color: sp.color }}>{sp.name}</motion.span></AnimatePresence>
        </div>
        {buffering && <span className="absolute inset-0 grid place-items-center pointer-events-none"><span className="w-8 h-8 rounded-full border-2 border-white/70 border-r-transparent animate-spin" /></span>}
      </motion.div>
    </div>
  )
}
