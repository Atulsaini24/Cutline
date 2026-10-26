import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Clock, Film, LayoutGrid, List, Play, RotateCcw, Search, Trash2, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from '../lib/session'
import { mediaUrl, req, setPendingFile } from '../lib/api'
import clsx from 'clsx'
import { Button, Pill } from '../components/ui'
import { Reveal, Tilt } from '../components/fx'
import { AppShell } from '../components/site'
import { frameCanvas } from '../lib/draw'
import { SENTS, SRC_DUR } from '../lib/sample'
import { fmtShort } from '../lib/format'
import { useEditor } from '../store/editor'

interface Proj { key: string; title: string; meta: string; thumb: string; status: 'ready' | 'indexing' | 'exported' | 'failed'; progress?: number; when: string; remote?: boolean; error?: string | null }
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'Just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago` }

export default function Projects() {
  const nav = useNavigate()
  const { title, log, reset } = useEditor()
  const [over, setOver] = useState(false)
  const [q, setQ] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [filter, setFilter] = useState<'all' | 'ready' | 'indexing' | 'exported'>('all')
  const fileRef = useRef<HTMLInputElement>(null)
  const thumbs = useMemo(() => [SENTS[4].s + 300, SENTS[16].s + 300, -1, SENTS[24].s + 300, SENTS[11].s + 300].map(s => (s < 0 ? frameCanvas(0, 480, 270, 'light') : frameCanvas(s, 480, 270)).toDataURL('image/jpeg', .85)), [])
  const mode = useSession(s => s.mode)
  const [remote, setRemote] = useState<Proj[] | null>(null)
  const load = () => req('GET', '/projects').then(r => setRemote(r.projects.map((p: any): Proj => ({
    key: p.id, title: p.title, remote: true, error: p.error,
    status: p.status === 'ready' ? 'ready' : p.status === 'failed' ? 'failed' : 'indexing',
    progress: Math.round(((p.job?.progress ?? 0) * 0.8 + (p.status === 'uploading' ? 0 : 0.2)) * 100),
    thumb: p.poster ? mediaUrl(p.poster) : thumbs[p.synthetic ? 0 : 4],
    meta: `${fmtShort(p.duration)} recording, ${p.edits} edit${p.edits === 1 ? '' : 's'}${p.stats ? `, ${p.stats.lines} lines` : ''}`, when: ago(p.updatedAt),
  })))).catch(e => toast.error('Couldn’t load projects', { description: e.message }))
  useEffect(() => { if (mode === 'online') load() }, [mode])
  useEffect(() => { if (!remote?.some(p => p.status === 'indexing')) return; const t = setInterval(load, 2500); return () => clearInterval(t) }, [remote])
  const del = async (p: Proj) => { if (!confirm(`Delete “${p.title}” and all its files?`)) return; await req('DELETE', `/projects/${p.key}`); toast(`Deleted “${p.title}”`); load() }
  const demo: Proj[] = [
    { key: 'main', title, meta: `${fmtShort(SRC_DUR)} recording, ${log.length} edit${log.length === 1 ? '' : 's'}`, thumb: thumbs[0], status: 'ready', when: 'Edited just now' },
    { key: 'priya', title: 'Interview with Priya, raw', meta: '1:48:20 recording', thumb: thumbs[1], status: 'indexing', progress: 64, when: 'Uploaded today' },
    { key: 'trailer', title: 'Channel trailer v2', meta: '0:58 final cut', thumb: thumbs[2], status: 'exported', when: '3 days ago' },
    { key: 'ep13', title: 'Episode 13, treating a small room', meta: '41:12 recording, 3 Shorts', thumb: thumbs[3], status: 'exported', when: 'Last week' },
    { key: 'qa', title: 'Live Q&A, March', meta: '1:02:40 recording, 22 edits', thumb: thumbs[4], status: 'ready', when: '2 weeks ago' },
  ]
  const all = mode === 'online' && remote ? remote : demo
  const list = all.filter(p => (filter === 'all' || p.status === filter) && p.title.toLowerCase().includes(q.toLowerCase()))
  const startUpload = (name: string, size = 0, file?: File) => { setPendingFile(file ?? null); nav('/upload', { state: { name, size } }) }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) startUpload(f.name, f.size, f) }
  const open = (p: Proj) => {
    if (p.remote) { if (p.status === 'ready') nav(`/editor/${p.key}`); else if (p.status === 'indexing') nav('/upload', { state: { projectId: p.key } }); else nav('/upload', { state: { projectId: p.key } }); return }
    p.status === 'indexing' ? startUpload('Interview with Priya, raw.mov') : nav('/editor')
  }

  return (
    <AppShell title="Projects" actions={<>
      {mode !== 'online' && <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => reset()}>Reset demo</Button>}
      <Button size="sm" variant="agent" icon={<UploadCloud size={14} />} onClick={() => fileRef.current?.click()}>New project</Button>
    </>}>
      <Reveal y={20}>
        <label onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop} data-cursor="Upload"
          className={clsx('relative flex flex-col md:flex-row md:items-center gap-5 rounded-3xl p-6 md:p-8 cursor-pointer overflow-hidden transition-colors', over ? 'bg-amber-400/10' : 'bg-ink-850 hover:bg-ink-800')}>
          <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
            <motion.rect x="1" y="1" rx="24" style={{ width: 'calc(100% - 2px)', height: 'calc(100% - 2px)' }} fill="none" stroke={over ? '#F7BE4A' : '#3A404D'} strokeWidth="1.5" strokeDasharray="8 7"
              animate={{ strokeDashoffset: [0, -60] }} transition={{ duration: over ? 1 : 4, repeat: Infinity, ease: 'linear' }} />
          </svg>
          <motion.span animate={{ y: over ? [0, -8, 0] : [0, -3, 0] }} transition={{ repeat: Infinity, duration: over ? 0.9 : 2.6 }}
            className="w-16 h-16 rounded-2xl grid place-items-center bg-gradient-to-br from-amber-400/25 to-ink-750 text-amber-300 shrink-0"><UploadCloud size={28} /></motion.span>
          <div>
            <div className="font-display text-[22px] font-semibold tracking-tight">{over ? 'Drop to start uploading' : 'Start a new project'}</div>
            <div className="text-fog-400 text-[14px] mt-1">Drop a video here. Long recordings are fine; uploads resume if your connection drops.</div>
          </div>
          <div className="md:ml-auto flex gap-2 flex-wrap relative">
            <Button variant="primary" onClick={e => { e.preventDefault(); fileRef.current?.click() }}>Choose a video</Button>
            <Button variant="secondary" icon={<Film size={15} />} onClick={e => { e.preventDefault(); startUpload('Episode 15, raw recording.mp4') }}>Use a sample</Button>
          </div>
          <input ref={fileRef} type="file" accept="video/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) startUpload(f.name, f.size, f); e.target.value = '' }} />
        </label>
      </Reveal>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <div className="relative flex rounded-xl bg-ink-850 border border-ink-700 p-1">
          {(['all', 'ready', 'indexing', 'exported'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={clsx('relative px-3.5 h-8 text-[13px] font-semibold capitalize z-10', filter === f ? 'text-ink-900' : 'text-fog-300')}>
              {filter === f && <motion.span layoutId="proj-filter" className="absolute inset-0 -z-10 rounded-lg bg-fog-100" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}{f}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 h-10 rounded-xl bg-ink-850 border border-ink-700 px-3 focus-within:border-sky-400 flex-1 min-w-[180px] max-w-[320px]">
          <Search size={15} className="text-fog-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search projects" className="bg-transparent outline-none text-[14px] flex-1 min-w-0" />
        </label>
        <div className="ml-auto flex gap-1">
          <button aria-label="Grid view" onClick={() => setView('grid')} className={clsx('w-9 h-9 grid place-items-center rounded-lg', view === 'grid' ? 'bg-ink-750 text-fog-100' : 'text-fog-400')}><LayoutGrid size={16} /></button>
          <button aria-label="List view" onClick={() => setView('list')} className={clsx('w-9 h-9 grid place-items-center rounded-lg', view === 'list' ? 'bg-ink-750 text-fog-100' : 'text-fog-400')}><List size={16} /></button>
        </div>
      </div>

      <motion.div layout className={clsx('mt-6', view === 'grid' ? 'grid sm:grid-cols-2 xl:grid-cols-3 gap-6' : 'grid gap-2')} style={{ perspective: 1200 }}>
        <AnimatePresence mode="popLayout">
          {list.map((p, i) => (
            <motion.div key={p.key} layout initial={{ opacity: 0, y: 24, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: .9 }} transition={{ duration: .45, delay: i * 0.05, ease: [.2, .8, .2, 1] }}>
              {view === 'grid' ? (
                <Tilt className="rounded-3xl">
                  <button onClick={() => open(p)} data-cursor={p.status === 'indexing' ? 'Progress' : 'Open'} className="group w-full text-left rounded-3xl border border-ink-700 bg-ink-850 p-3 hover:border-ink-600 transition">
                    <div className="relative aspect-video rounded-2xl overflow-hidden bg-black">
                      <img src={p.thumb} alt="" className={clsx('w-full h-full object-cover transition duration-700 group-hover:scale-[1.06]', p.status === 'indexing' && 'opacity-50 saturate-50')} />
                      <span className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent opacity-0 group-hover:opacity-100 transition" />
                      {p.remote && <span role="button" tabIndex={0} aria-label={`Delete ${p.title}`} onClick={e => { e.stopPropagation(); del(p) }} className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-black/60 backdrop-blur grid place-items-center text-fog-200 hover:text-coral-400 opacity-0 group-hover:opacity-100 transition"><Trash2 size={15} /></span>}
                      <span className="absolute right-3 bottom-3 w-11 h-11 rounded-full bg-amber-400 text-ink-950 grid place-items-center translate-y-3 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition"><Play size={18} fill="currentColor" /></span>
                      {p.status === 'indexing' && <div className="absolute inset-x-3 bottom-3 h-1.5 rounded bg-black/50 overflow-hidden"><motion.div className="h-full bg-amber-400" initial={{ width: 0 }} animate={{ width: `${p.progress}%` }} transition={{ duration: 1.2, delay: .4 }} /></div>}
                    </div>
                    <div className="px-1.5 pt-3.5 pb-1.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-display text-[17px] font-semibold tracking-tight leading-snug">{p.title}</div>
                        {p.status === 'ready' && <Pill tone="ok">Ready</Pill>}{p.status === 'indexing' && <Pill tone="agent">{p.progress}%</Pill>}{p.status === 'exported' && <Pill>Exported</Pill>}{p.status === 'failed' && <span className="inline-flex items-center gap-1 rounded-full px-2 py-px text-[11px] font-bold bg-coral-500/15 text-coral-400"><AlertTriangle size={11} />Failed</span>}
                      </div>
                      <div className="mt-1.5 text-[13px] text-fog-400 flex items-center gap-1.5"><Clock size={13} />{p.when}, {p.meta}</div>
                    </div>
                  </button>
                </Tilt>
              ) : (
                <button onClick={() => open(p)} className="w-full grid grid-cols-[96px_1fr_auto] gap-4 items-center rounded-2xl p-2 hover:bg-ink-850 text-left">
                  <img src={p.thumb} alt="" className="w-24 aspect-video rounded-lg object-cover" />
                  <div className="min-w-0"><div className="font-semibold truncate">{p.title}</div><div className="text-[13px] text-fog-400">{p.when}, {p.meta}</div></div>
                  {p.status === 'ready' ? <Pill tone="ok">Ready</Pill> : p.status === 'indexing' ? <Pill tone="agent">{p.progress}%</Pill> : <Pill>Exported</Pill>}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
      {!list.length && <div className="mt-10 text-center text-fog-400">{q ? `No projects match “${q}”. Clear the search or start a new project.` : 'No projects yet. Drop a video above to start one.'}</div>}
      {mode !== 'online' && <p className="mt-10 text-[12.5px] text-fog-500">Offline demo. Start the backend and sign in to upload real videos.</p>}
    </AppShell>
  )
}
