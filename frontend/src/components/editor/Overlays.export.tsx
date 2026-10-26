import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Download, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { useEditor } from '../../store/editor'
import { seqDur } from '../../lib/timeline'
import { fmtShort } from '../../lib/format'
import { mediaUrl, onEvent, req } from '../../lib/api'
import { Button } from '../ui'
import { useSession } from '../../lib/session'
import clsx from 'clsx'

interface Job { id: string; name: string; desc: string; on: boolean; segs: number[]; renderId?: string; status?: string; note?: string | null; error?: string | null }
export function ExportBody({ onClose }: { onClose: () => void }) {
  const { tl, cursor, projectId, syncing } = useEditor()
  const [jobs, setJobs] = useState<Job[]>(() => [{ id: 'main', name: 'Main edit', desc: `Landscape, ${fmtShort(seqDur(tl.v1))}`, on: true, segs: Array(12).fill(0) },
    ...tl.shorts.map((s, i) => ({ id: s.id, name: `Short ${i + 1}: ${s.title}`, desc: `Vertical 9:16 with captions, ${fmtShort(s.dur)}`, on: true, segs: Array(12).fill(0) }))])
  const [phase, setPhase] = useState<'pick' | 'run' | 'done'>('pick')
  const prefs = useSession(s => s.user?.settings) ?? {}
  const [res, setRes] = useState<string>(prefs.resolution === '4k' ? '2160' : prefs.resolution ?? '1080')
  const [cleanAudio, setCleanAudio] = useState<boolean>(!!prefs.cleanAudio)
  const timer = useRef<ReturnType<typeof setInterval>>()
  useEffect(() => () => clearInterval(timer.current), [])

  const startRemote = async (active: Job[]) => {
    if (syncing) await new Promise(r => setTimeout(r, 700))
    const r = await req('POST', `/projects/${projectId}/renders`, { targets: active.map(j => j.id), resolution: res, cleanAudio })
    const withIds = active.map((j, i) => ({ ...j, renderId: r.renders[i].id, status: 'queued' }))
    setJobs(withIds); setPhase('run')
    const off = onEvent(m => {
      if (m.type !== 'render') return
      setJobs(prev => {
        const next = prev.map(j => {
          if (j.renderId !== m.render.id) return j
          const total = Math.max(1, m.render.segmentsTotal || 12); const doneSegs = m.render.status === 'ready' ? total : m.render.segmentsDone
          const cells = Array.from({ length: Math.min(total, 24) }, (_, k) => (k + 1) / Math.min(total, 24) <= doneSegs / total ? 2 : m.render.status === 'rendering' && k < Math.min(total, 24) * ((doneSegs + 3) / total) ? 1 : 0)
          return { ...j, segs: cells, status: m.render.status, note: m.render.note, error: m.render.error }
        })
        if (next.every(j => j.status === 'ready' || j.status === 'failed')) { setPhase('done'); off() }
        return next
      })
    })
  }
  const startDemo = (active: Job[]) => {
    setJobs(active); setPhase('run')
    const q: [number, number][] = []; active.forEach((j, ji) => j.segs.forEach((_, si) => q.push([ji, si])))
    const workers: ([number, number] | null)[] = [null, null, null, null]
    timer.current = setInterval(() => {
      setJobs(prev => {
        const next = prev.map(j => ({ ...j, segs: [...j.segs] }))
        workers.forEach((w, wi) => { if (w && Math.random() < .5) { next[w[0]].segs[w[1]] = 2; workers[wi] = null } if (!workers[wi] && q.length) { const n = q.shift()!; next[n[0]].segs[n[1]] = 1; workers[wi] = n } })
        if (!q.length && workers.every(w => !w)) { clearInterval(timer.current); setTimeout(() => setPhase('done'), 250) }
        return next
      })
    }, 150)
  }
  const start = () => { const active = jobs.filter(j => j.on); if (!active.length) return; if (projectId) startRemote(active).catch(e => toast.error('Couldn’t start the render', { description: (e as Error).message })); else startDemo(active) }

  return (
    <div className="p-6">
      <h2 className="font-display text-[22px] font-semibold tracking-tight">{phase === 'done' ? 'Your renders are ready' : 'Export'}</h2>
      <p className="text-[13.5px] text-fog-400 mt-1">
        {phase === 'pick' ? (projectId ? 'Rendered on the server from the current version. Each render is split into segments that run in parallel.' : 'Demo mode simulates the render. Run the backend to produce real files.')
          : phase === 'run' ? `Rendering version ${cursor}. You can keep editing meanwhile.` : `Rendered from version ${cursor}.`}
      </p>
      <div className="mt-5 grid gap-2">
        {jobs.map((j, i) => {
          const d = j.segs.filter(s => s === 2).length; const pct = Math.round(d / j.segs.length * 100)
          const ready = j.status ? j.status === 'ready' : d === j.segs.length
          return (
            <motion.div key={j.id} layout className="rounded-xl bg-ink-800 p-3.5">
              <div className="flex items-center gap-3">
                {phase === 'pick' ? <input type="checkbox" checked={j.on} onChange={e => setJobs(js => js.map((x, k) => k === i ? { ...x, on: e.target.checked } : x))} className="w-4 h-4 accent-amber-400" aria-label={j.name} />
                  : j.status === 'failed' ? <span className="w-5 h-5 rounded-full bg-coral-500 grid place-items-center text-ink-900 text-[12px] font-bold">!</span>
                  : ready ? <motion.span initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} className="w-5 h-5 rounded-full bg-jade-500 grid place-items-center text-ink-900"><Check size={12} strokeWidth={3} /></motion.span>
                  : <span className="w-4 h-4 rounded-full border-2 border-amber-400 border-r-transparent animate-spin" />}
                <div className="flex-1 min-w-0"><div className="text-[14px] font-semibold truncate">{j.name}</div><div className="text-[12px] text-fog-400">{j.error ?? j.note ?? j.desc}</div></div>
                {phase !== 'pick' && !ready && j.status !== 'failed' && <span className="text-[12.5px] text-fog-300 w-10 text-right">{j.status === 'queued' ? 'Queued' : pct + '%'}</span>}
                {ready && j.renderId && <div className="flex gap-1">
                  <a href={mediaUrl(`/renders/${j.renderId}/file?inline=1`)} target="_blank" rel="noreferrer" className="w-8 h-8 grid place-items-center rounded-lg hover:bg-ink-700" aria-label="Open in a new tab"><ExternalLink size={15} /></a>
                  <a href={mediaUrl(`/renders/${j.renderId}/file`)} className="w-8 h-8 grid place-items-center rounded-lg bg-amber-400 text-ink-950" aria-label="Download"><Download size={15} /></a>
                </div>}
              </div>
              {phase !== 'pick' && <div className="grid gap-[3px] mt-3" style={{ gridTemplateColumns: `repeat(${j.segs.length},1fr)` }}>
                {j.segs.map((s, k) => <motion.span key={k} className="h-2 rounded-sm" animate={{ backgroundColor: s === 2 ? '#38B984' : s === 1 ? '#F7BE4A' : '#2D323D', opacity: s === 1 ? [.5, 1, .5] : 1 }} transition={s === 1 ? { opacity: { repeat: Infinity, duration: .8 } } : { duration: .2 }} />)}
              </div>}
            </motion.div>
          )
        })}
      </div>
      {phase === 'pick' && !tl.shorts.length && <p className="text-[12.5px] text-fog-500 mt-3">Ask the editor to “Make three Shorts” to export vertical versions too.</p>}
      {phase === 'pick' && projectId && (
        <div className="mt-5 grid gap-3 rounded-xl border border-ink-700 p-3.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[13.5px] font-semibold">Resolution</span>
            <div className="flex rounded-lg bg-ink-800 p-0.5" role="radiogroup" aria-label="Resolution">
              {([['720', '720p'], ['1080', '1080p'], ['2160', '4K'], ['source', 'Original']] as const).map(([k, l]) => (
                <button key={k} role="radio" aria-checked={res === k} onClick={() => setRes(k)} className={clsx('px-2.5 h-7 rounded-md text-[12.5px] font-semibold', res === k ? 'bg-fog-100 text-ink-900' : 'text-fog-300 hover:text-fog-100')}>{l}</button>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={cleanAudio} onChange={e => setCleanAudio(e.target.checked)} className="mt-0.5 w-4 h-4 accent-amber-400" />
            <span><span className="text-[13.5px] font-semibold">Clean up audio</span><span className="block text-[12px] text-fog-400">Reduce hiss and level loudness for YouTube and Shorts. Never upscales video.</span></span>
          </label>
        </div>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{phase === 'done' ? 'Close' : phase === 'run' ? 'Hide' : 'Cancel'}</Button>
        {phase === 'pick' && <Button variant="primary" onClick={start} disabled={!jobs.some(j => j.on)}>Start render</Button>}
        {phase === 'done' && !projectId && <Button variant="agent" icon={<Download size={15} />} onClick={() => toast('Demo mode', { description: 'Run the backend to render real files.' })}>Download</Button>}
      </div>
    </div>
  )
}
