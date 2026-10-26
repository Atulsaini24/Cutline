import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Check, MessageSquare, Pause, Play, Send } from 'lucide-react'
import { toast } from 'sonner'
import clsx from 'clsx'
import { Button, Logo } from '../components/ui'
import { drawCaption, drawScene, SCENE_H, SCENE_W } from '../lib/draw'
import { buildPlan } from '../lib/agent'
import { initStateNow, seqDur, tlToSrc } from '../lib/timeline'
import { fmt } from '../lib/format'
import { apiUrl, req } from '../lib/api'

function DemoShare({ id }: { id?: string }) {
  const short = useMemo(() => { const p = buildPlan(initStateNow(), new Set(['shorts'])); return p.shorts.find(s => s.id === id) ?? p.shorts[0] }, [id])
  const cv = useRef<HTMLCanvasElement>(null)
  const [t, setT] = useState(0); const [playing, setPlaying] = useState(true)
  const [approved, setApproved] = useState(false)
  const [comments, setComments] = useState([{ who: 'Dev', at: 4200, text: 'Love the hook. Could the caption on “mirror” stay a beat longer?' }, { who: 'Maya', at: 18800, text: 'The blanket line is the best bit, keep it.' }])
  const [text, setText] = useState('')
  const dur = seqDur(short.ranges)
  useEffect(() => {
    const scene = document.createElement('canvas'); scene.width = SCENE_W; scene.height = SCENE_H
    const c = cv.current!.getContext('2d')!; let raf = 0, last = performance.now(), tt = t
    const loop = (now: number) => {
      if (playing) { tt += now - last; if (tt >= dur) tt = 0; setT(tt) }
      last = now
      const src = tlToSrc(short.ranges, tt); drawScene(scene.getContext('2d')!, src)
      const W = cv.current!.width, H = cv.current!.height, cw = SCENE_H * 9 / 16
      c.drawImage(scene, Math.max(0, Math.min(SCENE_W - cw, 470 - cw / 2)), 0, cw, SCENE_H, 0, 0, W, H)
      drawCaption(c, W, H, src, short.ranges, 'bold', true)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf)
  }, [playing, short])
  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between px-6 md:px-10 h-16 border-b border-ink-750"><Link to="/"><Logo size={24} /></Link><span className="text-[13px] text-fog-400">Sample review link</span></header>
      <main className="max-w-[1100px] mx-auto px-6 md:px-10 py-10 grid md:grid-cols-[minmax(0,380px)_1fr] gap-10 items-start">
        <motion.div initial={{ opacity: 0, y: 30, rotateY: -12 }} animate={{ opacity: 1, y: 0, rotateY: 0 }} transition={{ duration: .8, ease: [.2, .8, .2, 1] }} style={{ transformPerspective: 1000 }}
          className="relative mx-auto w-full max-w-[340px] rounded-[38px] bg-ink-950 p-3 shadow-[0_40px_100px_-30px_rgba(0,0,0,.9)] ring-1 ring-ink-600">
          <div className="relative aspect-[9/16] rounded-[28px] overflow-hidden bg-black" data-cursor={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(p => !p)}>
            <canvas ref={cv} width={540} height={960} className="w-full h-full" />
            <AnimatePresence>{!playing && <motion.span initial={{ scale: .6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.4, opacity: 0 }} className="absolute inset-0 grid place-items-center"><span className="w-16 h-16 rounded-full bg-white/90 text-ink-900 grid place-items-center"><Play size={26} fill="currentColor" /></span></motion.span>}</AnimatePresence>
            <div className="absolute inset-x-4 bottom-4 h-1 rounded-full bg-white/25 overflow-hidden"><div className="h-full bg-amber-400" style={{ width: `${(t / dur) * 100}%` }} /></div>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .2 }}>
          <div className="text-[13px] text-amber-300 font-semibold">Short from Episode 14</div>
          <h1 className="mt-2 font-display text-[34px] md:text-[44px] font-semibold tracking-[-0.03em] leading-[1.02]">{short.title}</h1>
          <p className="mt-3 text-fog-400">{fmt(dur)} long, vertical 1080×1920, hook: {short.hook}</p>
          <div className="mt-6 flex gap-2 flex-wrap">
            <Button variant={approved ? 'secondary' : 'agent'} icon={approved ? <Check size={16} /> : undefined} onClick={() => { setApproved(a => !a); if (!approved) toast.success('Approved', { description: 'Maya will see this on the export.' }) }}>{approved ? 'Approved' : 'Approve this Short'}</Button>
            <Button variant="ghost" icon={playing ? <Pause size={15} /> : <Play size={15} />} onClick={() => setPlaying(p => !p)}>{playing ? 'Pause' : 'Play'}</Button>
          </div>
          <h2 className="mt-10 flex items-center gap-2 font-semibold"><MessageSquare size={16} />Comments</h2>
          <div className="mt-3 grid gap-2.5">
            <AnimatePresence initial={false}>
              {comments.map((c, i) => (
                <motion.div key={i} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl bg-ink-850 border border-ink-700 p-4">
                  <div className="flex items-center gap-2 text-[13px]"><span className="font-semibold">{c.who}</span><button onClick={() => setT(c.at)} className="rounded bg-ink-750 px-1.5 text-[11.5px] text-amber-300">{fmt(c.at)}</button></div>
                  <p className="mt-1.5 text-[14.5px] text-fog-200">{c.text}</p>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <form onSubmit={e => { e.preventDefault(); if (!text.trim()) return; setComments(cs => [...cs, { who: 'You', at: t, text }]); setText('') }} className="mt-3 flex gap-2 rounded-2xl border border-ink-600 bg-ink-850 p-1.5 pl-4 focus-within:border-amber-400">
            <input value={text} onChange={e => setText(e.target.value)} placeholder={`Comment at ${fmt(t)}`} className="flex-1 bg-transparent outline-none text-[14px]" />
            <button aria-label="Post comment" className="w-9 h-9 rounded-xl bg-amber-400 text-ink-950 grid place-items-center"><Send size={16} /></button>
          </form>
        </motion.div>
      </main>
    </div>
  )
}

export default function Share() {
  const { id } = useParams()
  return id?.startsWith('sh_') ? <RealShare token={id} /> : <DemoShare id={id} />
}

interface ShareData { title: string; kind: 'main' | 'short'; duration: number | null; projectTitle: string; owner: string; available: boolean; approvedBy: string | null; comments: { id: string; author: string; at: number; text: string }[] }
const NAME_KEY = 'cutline-reviewer-name'
function RealShare({ token }: { token: string }) {
  const [d, setD] = useState<ShareData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [t, setT] = useState(0)
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' } })
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const base = `/public/shares/${encodeURIComponent(token)}`
  const load = useCallback(() => req<ShareData>('GET', base).then(setD).catch(e => setErr((e as Error).message)), [base])
  useEffect(() => { void load() }, [load])
  const remember = (n: string) => { try { localStorage.setItem(NAME_KEY, n) } catch { /* ignore */ } }
  const seek = (ms: number) => { const v = video.current; if (v) { v.currentTime = ms / 1000; void v.play().catch(() => {}) } }
  const post = async () => {
    if (!name.trim()) { toast('Add your name first'); return }
    setBusy(true); remember(name.trim())
    try { await req('POST', `${base}/comments`, { author: name.trim(), text, at: Math.round(t) }); setText(''); await load() }
    catch (e) { toast.error('Comment not posted', { description: (e as Error).message }) } finally { setBusy(false) }
  }
  const approve = async () => {
    if (!name.trim()) { toast('Add your name first, so the creator knows who approved'); return }
    remember(name.trim())
    try { await req('POST', `${base}/approve`, { author: name.trim(), approved: !d?.approvedBy }); await load(); if (!d?.approvedBy) toast.success('Approved', { description: `${d?.owner} will see it on their Exports page.` }) }
    catch (e) { toast.error('Couldn’t save that', { description: (e as Error).message }) }
  }
  if (err) return (
    <div className="min-h-full grid place-items-center p-6 text-center">
      <div><span className="mx-auto w-14 h-14 rounded-2xl bg-ink-800 grid place-items-center text-coral-400"><AlertTriangle size={24} /></span>
        <h1 className="mt-4 font-display text-[26px] font-semibold">Review link unavailable</h1>
        <p className="mt-2 text-fog-400 max-w-[42ch]">{err}</p>
        <Link to="/" className="mt-5 inline-block text-amber-300 font-semibold hover:underline">Go to Cutline</Link></div>
    </div>
  )
  if (!d) return <div className="h-screen grid place-items-center"><span className="w-8 h-8 rounded-full border-2 border-amber-400 border-r-transparent animate-spin" /></div>
  const vertical = d.kind === 'short'
  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between gap-4 px-6 md:px-10 h-16 border-b border-ink-750"><Link to="/"><Logo size={24} /></Link><span className="text-[13px] text-fog-400 truncate">Review link from {d.owner}</span></header>
      <main className={clsx('max-w-[1180px] mx-auto px-6 md:px-10 py-10 grid gap-10 items-start', vertical ? 'md:grid-cols-[minmax(0,380px)_1fr]' : 'lg:grid-cols-[minmax(0,1.5fr)_1fr]')}>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className={clsx('relative mx-auto w-full', vertical && 'max-w-[340px] rounded-[38px] bg-ink-950 p-3 ring-1 ring-ink-600 shadow-[0_40px_100px_-30px_rgba(0,0,0,.9)]')}>
          {d.available
            ? <video ref={video} src={apiUrl(`${base}/video`)} controls playsInline preload="metadata" onTimeUpdate={e => setT(e.currentTarget.currentTime * 1000)} className={clsx('w-full bg-black', vertical ? 'aspect-[9/16] rounded-[28px] object-cover' : 'aspect-video rounded-2xl')} />
            : <div className={clsx('grid place-items-center bg-ink-850 text-center p-6 text-fog-400', vertical ? 'aspect-[9/16] rounded-[28px]' : 'aspect-video rounded-2xl')}>This video has expired. Ask {d.owner} to render it again.</div>}
        </motion.div>
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .15 }}>
          <div className="text-[13px] text-amber-300 font-semibold">{vertical ? 'Short' : 'Edit'} from {d.projectTitle}</div>
          <h1 className="mt-2 font-display text-[32px] md:text-[40px] font-semibold tracking-[-0.03em] leading-[1.05] break-words">{d.title}</h1>
          <p className="mt-3 text-fog-400">{d.duration ? fmt(d.duration) + ' long' : ''}{vertical ? ', vertical 9:16' : ''}</p>
          <label className="mt-6 grid gap-1 text-[12.5px] text-fog-400 max-w-[300px]">Your name<input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="So the creator knows who you are" className="h-10 rounded-xl bg-ink-850 border border-ink-600 px-3 text-[14px] text-fog-100 outline-none focus:border-amber-400" /></label>
          <div className="mt-4 flex gap-2 flex-wrap items-center">
            <Button variant={d.approvedBy ? 'secondary' : 'agent'} icon={d.approvedBy ? <Check size={16} /> : undefined} onClick={approve}>{d.approvedBy ? `Approved by ${d.approvedBy}` : 'Approve'}</Button>
            {d.approvedBy && <span className="text-[12.5px] text-fog-500">Click again to withdraw approval.</span>}
          </div>
          <h2 className="mt-10 flex items-center gap-2 font-semibold"><MessageSquare size={16} />Comments{d.comments.length ? ` (${d.comments.length})` : ''}</h2>
          <div className="mt-3 grid gap-2.5">
            {!d.comments.length && <p className="text-[13.5px] text-fog-500">No comments yet. Pause the video where you want to comment; the time is attached automatically.</p>}
            <AnimatePresence initial={false}>
              {d.comments.map(c => (
                <motion.div key={c.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl bg-ink-850 border border-ink-700 p-4">
                  <div className="flex items-center gap-2 text-[13px]"><span className="font-semibold">{c.author}</span><button onClick={() => seek(c.at)} className="rounded bg-ink-750 px-1.5 text-[11.5px] text-amber-300 hover:bg-ink-700" aria-label={`Jump to ${fmt(c.at)}`}>{fmt(c.at)}</button></div>
                  <p className="mt-1.5 text-[14.5px] text-fog-200 whitespace-pre-wrap break-words">{c.text}</p>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <form onSubmit={e => { e.preventDefault(); if (text.trim()) void post() }} className="mt-3 flex gap-2 rounded-2xl border border-ink-600 bg-ink-850 p-1.5 pl-4 focus-within:border-amber-400">
            <input value={text} onChange={e => setText(e.target.value)} maxLength={1000} placeholder={`Comment at ${fmt(t)}`} aria-label="Comment" className="flex-1 min-w-0 bg-transparent outline-none text-[14px]" />
            <button disabled={busy || !text.trim()} aria-label="Post comment" className="w-9 h-9 rounded-xl bg-amber-400 text-ink-950 grid place-items-center disabled:opacity-50"><Send size={16} /></button>
          </form>
        </motion.div>
      </main>
    </div>
  )
}
