import { useEffect, useMemo, useState } from 'react'
import { useSession } from '../lib/session'
import { mediaUrl, req } from '../lib/api'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Clapperboard, Download, Link2, MessageSquare, Play, RefreshCw, Square, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import clsx from 'clsx'
import { Button, Pill } from '../components/ui'
import { Tilt } from '../components/fx'
import { AppShell } from '../components/site'
import { frameCanvas } from '../lib/draw'
import { SENTS } from '../lib/sample'

type Kind = 'main' | 'short'
type Status = 'ready' | 'rendering' | 'queued' | 'failed' | 'canceled' | 'expired'
interface Render {
  remote?: boolean; id: string; title: string; project: string; kind: Kind; dur: string; size: string; status: Status; progress?: number; when: string; src: number
  error?: string | null; note?: string | null; shareToken?: string | null; approvedBy?: string | null; comments?: number; expiresAt?: number | null; resolution?: string; segs?: string
}
const DEMO: Render[] = [
  { id: 'r1', title: 'Main edit', project: 'Episode 14', kind: 'main', dur: '3:03', size: '412 MB', status: 'ready', when: 'Today, 14:20', src: SENTS[4].s + 300 },
  { id: 'short-8', title: 'Your room is the biggest microphone you own', project: 'Episode 14', kind: 'short', dur: '0:35', size: '48 MB', status: 'ready', when: 'Today, 14:21', src: SENTS[9].s + 300, shareToken: 'short-8', comments: 2 },
  { id: 'r3', title: 'A $60 mic beat our condenser', project: 'Episode 14', kind: 'short', dur: '0:37', size: '51 MB', status: 'rendering', progress: 72, when: 'Rendering now', src: SENTS[19].s + 300 },
  { id: 'r4', title: 'Stop looking like a crime documentary', project: 'Episode 14', kind: 'short', dur: '0:27', size: '—', status: 'failed', when: 'Today, 14:22', error: 'Segment 9 failed 3 times', src: SENTS[26].s + 300 },
]
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}`
const when = (t: number) => { const d = Date.now() - t; return d < 60000 ? 'Just now' : d < 3600000 ? `${Math.round(d / 60000)} min ago` : d < 86400000 ? `${Math.round(d / 3600000)} h ago` : new Date(t).toLocaleDateString() }
const RES: Record<string, string> = { '720': '720p', '1080': '1080p', '2160': '4K', source: 'Original' }
const shareUrl = (token: string) => `${location.origin}${location.pathname}#/share/${token}`

export default function Exports() {
  const nav = useNavigate()
  const mode = useSession(s => s.mode)
  const online = mode === 'online'
  const [tab, setTab] = useState<'all' | Kind>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [remote, setRemote] = useState<Render[] | null>(null)
  const thumbs = useMemo(() => Object.fromEntries(DEMO.map(r => [r.id, frameCanvas(r.src, r.kind === 'short' ? 640 : 480, r.kind === 'short' ? 360 : 270).toDataURL('image/jpeg', .85)])), [])
  const load = () => req('GET', '/renders').then(d => setRemote(d.renders.map((r: any): Render => ({
    remote: true, id: r.id, title: r.title, project: r.projectTitle, kind: r.kind, src: 0, error: r.error, note: r.note,
    dur: r.duration ? mmss(r.duration) : '—', size: r.size ? `${(r.size / 1024 ** 2).toFixed(1)} MB` : '—', status: r.status, progress: Math.round(r.progress * 100),
    when: when(r.createdAt), shareToken: r.shareToken, approvedBy: r.approvedBy, comments: r.comments, expiresAt: r.expiresAt, resolution: RES[r.options?.resolution] ?? '', segs: r.segmentsTotal ? `${r.segmentsDone}/${r.segmentsTotal} segments` : '',
  })))).catch(e => toast.error('Couldn’t load renders', { description: (e as Error).message }))
  useEffect(() => { if (online) void load() }, [online])
  useEffect(() => { if (!remote?.some(r => r.status === 'rendering' || r.status === 'queued')) return; const t = setInterval(load, 1500); return () => clearInterval(t) }, [remote])
  const act = async (r: Render, what: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(r.id + what)
    try { await fn(); if (done) toast.success(done); await load() } catch (e) { toast.error('That didn’t work', { description: (e as Error).message }) } finally { setBusy(null) }
  }
  const share = async (r: Render) => {
    if (!r.remote) { navigator.clipboard?.writeText(shareUrl('short-8')).catch(() => {}); toast.success('Demo review link copied'); return }
    await act(r, 'share', async () => {
      const token = r.shareToken ?? (await req('POST', `/renders/${r.id}/share`)).token
      await navigator.clipboard?.writeText(shareUrl(token)).catch(() => {})
      toast.success('Review link copied', { description: 'Anyone with the link can watch, comment and approve. No account needed.', action: { label: 'Open', onClick: () => nav(`/share/${token}`) } })
    })
  }
  const source = online && remote ? remote : DEMO
  const list = source.filter(r => tab === 'all' || r.kind === tab)
  const live = (s: Status) => s === 'rendering' || s === 'queued'
  return (
    <AppShell title="Exports" actions={<Button size="sm" variant="secondary" onClick={() => nav('/projects')}>Projects</Button>}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[30px] md:text-[36px] font-semibold tracking-[-0.03em]">Renders</h2>
          <p className="text-fog-400 mt-1 text-[14px]">{online ? 'Newest first. Files are kept for 7 days, then removed to save space; you can always render again.' : 'Sample renders. Sign in to see yours.'}</p>
        </div>
        <div className="relative flex rounded-xl bg-ink-850 border border-ink-700 p-1">
          {([['all', 'All'], ['main', 'Full edits'], ['short', 'Shorts']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={clsx('relative px-3.5 h-8 text-[13px] font-semibold z-10', tab === k ? 'text-ink-900' : 'text-fog-300')}>
              {tab === k && <motion.span layoutId="exp-tab" className="absolute inset-0 -z-10 rounded-lg bg-fog-100" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}{l}
            </button>
          ))}
        </div>
      </div>
      {online && remote && !list.length && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-10 rounded-3xl border border-dashed border-ink-600 p-10 text-center">
          <span className="mx-auto w-14 h-14 rounded-2xl bg-ink-800 grid place-items-center text-amber-300"><Clapperboard size={24} /></span>
          <h3 className="mt-4 font-display text-[20px] font-semibold">{tab === 'all' ? 'No renders yet' : tab === 'short' ? 'No Shorts rendered yet' : 'No full edits rendered yet'}</h3>
          <p className="mt-1 text-[14px] text-fog-400 max-w-[46ch] mx-auto">Open a project, make your edits, then press Export. Renders run on the server, so you can close the tab while they work.</p>
          <Button className="mt-5" variant="agent" onClick={() => nav('/projects')}>Go to projects</Button>
        </motion.div>
      )}
      <motion.div layout className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
        <AnimatePresence mode="popLayout">
          {list.map((r, i) => (
            <motion.div key={r.id} layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .9 }} transition={{ delay: Math.min(i, 8) * 0.04 }}>
              <Tilt max={4} className="rounded-3xl">
                <div className="rounded-3xl border border-ink-700 bg-ink-850 p-3 group">
                  <div className={clsx('relative rounded-2xl overflow-hidden bg-black', r.kind === 'short' ? 'aspect-[4/5]' : 'aspect-video')}>
                    {r.remote ? (r.status === 'ready'
                      ? <video src={mediaUrl(`/renders/${r.id}/file?inline=1`)} muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover" onMouseEnter={e => e.currentTarget.play().catch(() => {})} onMouseLeave={e => { e.currentTarget.pause() }} aria-label={`Preview of ${r.title}`} />
                      : <div className="absolute inset-0 bg-gradient-to-br from-ink-700 to-ink-900" />)
                      : <img src={thumbs[r.id]} alt="" className={clsx('absolute inset-0 w-full h-full object-cover transition duration-700 group-hover:scale-105', r.status !== 'ready' && 'opacity-40 grayscale')} />}
                    <span className="absolute top-2.5 left-2.5 rounded-md bg-black/60 backdrop-blur px-2 py-0.5 text-[11px] font-semibold">{r.kind === 'short' ? '9:16' : '16:9'}{r.resolution ? `, ${r.resolution}` : ''}, {r.dur}</span>
                    {r.approvedBy && <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-md bg-jade-500/90 text-ink-950 px-2 py-0.5 text-[11px] font-bold"><CheckCircle2 size={12} />Approved</span>}
                    {r.status === 'ready' && !r.remote && <span className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition"><span className="w-12 h-12 rounded-full bg-white/90 text-ink-900 grid place-items-center"><Play size={18} fill="currentColor" /></span></span>}
                    {live(r.status) && <div className="absolute inset-x-4 bottom-4">
                      <div className="flex justify-between text-[12px] mb-1.5"><span>{r.status === 'queued' ? 'Waiting for a worker' : r.segs || 'Rendering'}</span><span>{r.progress ?? 0}%</span></div>
                      <div className="h-1.5 rounded-full bg-ink-600 overflow-hidden"><motion.div className="h-full bg-gradient-to-r from-jade-500 to-amber-400" animate={{ width: `${r.progress ?? 0}%` }} transition={{ duration: .4 }} /></div>
                    </div>}
                  </div>
                  <div className="px-1.5 pt-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-display text-[16px] font-semibold leading-snug break-words min-w-0">{r.title}</div>
                      <StatusPill s={r.status} />
                    </div>
                    <div className="text-[12.5px] text-fog-400 mt-1">{r.project}, {r.when}{r.status === 'ready' ? `, ${r.size}` : ''}{r.status === 'ready' && r.expiresAt ? `, kept ${Math.max(0, Math.ceil((r.expiresAt - Date.now()) / 86400000))} more day${Math.ceil((r.expiresAt - Date.now()) / 86400000) === 1 ? '' : 's'}` : ''}</div>
                    {(r.error || r.note) && <div className={clsx('text-[12px] mt-1', r.error ? 'text-coral-400' : 'text-fog-500')}>{r.error ?? r.note}</div>}
                    {!!r.comments && <button onClick={() => r.shareToken && nav(`/share/${r.shareToken}`)} className="mt-1 inline-flex items-center gap-1 text-[12px] text-sky-400 hover:underline"><MessageSquare size={12} />{r.comments} comment{r.comments === 1 ? '' : 's'}</button>}
                    <div className="mt-3 flex flex-wrap gap-1.5 pb-1">
                      {r.status === 'ready' && <>
                        {r.remote ? <a href={mediaUrl(`/renders/${r.id}/file`)} className="inline-flex items-center gap-2 h-8 px-3 rounded-lg bg-amber-400 text-ink-950 text-[13px] font-semibold hover:bg-amber-300"><Download size={14} />Download</a>
                          : <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={() => toast('Demo mode', { description: 'Sign in and render a project to get real files.' })}>Download</Button>}
                        <Button size="sm" variant="ghost" icon={<Link2 size={14} />} disabled={busy === r.id + 'share'} onClick={() => share(r)}>{r.shareToken ? 'Copy link' : 'Share'}</Button>
                        {r.remote && r.shareToken && <Button size="sm" variant="ghost" onClick={() => act(r, 'unshare', () => req('DELETE', `/renders/${r.id}/share`), 'Review link turned off')}>Stop sharing</Button>}
                      </>}
                      {live(r.status) && r.remote && <Button size="sm" variant="ghost" icon={<Square size={13} />} disabled={busy === r.id + 'cancel'} onClick={() => act(r, 'cancel', () => req('POST', `/renders/${r.id}/cancel`), 'Render cancelled')}>Cancel</Button>}
                      {(r.status === 'failed' || r.status === 'canceled' || r.status === 'expired') && <Button size="sm" variant={r.status === 'failed' ? 'danger' : 'secondary'} icon={<motion.span animate={busy === r.id + 'retry' ? { rotate: 360 } : {}} transition={{ repeat: Infinity, duration: .8, ease: 'linear' }}><RefreshCw size={14} /></motion.span>}
                        onClick={() => r.remote ? act(r, 'retry', () => req('POST', `/renders/${r.id}/retry`), 'Queued again') : toast('Queued again', { description: 'Demo mode: nothing is rendered.' })}>{r.status === 'expired' ? 'Render again' : 'Retry'}</Button>}
                      {r.remote && !live(r.status) && <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`Delete ${r.title}`} disabled={busy === r.id + 'del'} onClick={() => { if (confirm(`Delete “${r.title}”? The file and its review link are removed.`)) void act(r, 'del', () => req('DELETE', `/renders/${r.id}`), 'Render deleted') }} className="ml-auto" />}
                    </div>
                  </div>
                </div>
              </Tilt>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </AppShell>
  )
}
function StatusPill({ s }: { s: Status }) {
  if (s === 'ready') return <Pill tone="ok">Ready</Pill>
  if (s === 'rendering') return <Pill tone="agent">Rendering</Pill>
  if (s === 'queued') return <Pill>Queued</Pill>
  const tone = s === 'failed' ? 'bg-coral-500/15 text-coral-400' : 'bg-ink-700 text-fog-400'
  return <span className={clsx('inline-flex shrink-0 rounded-full px-2 py-px text-[11px] font-bold', tone)}>{s === 'failed' ? 'Failed' : s === 'canceled' ? 'Cancelled' : 'Expired'}</span>
}
