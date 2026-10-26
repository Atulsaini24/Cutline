import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Command, Download, Search } from 'lucide-react'
import { toast } from 'sonner'
import clsx from 'clsx'
import { useEditor } from '../../store/editor'
import { seqDur } from '../../lib/timeline'
import { fmtShort } from '../../lib/format'
import { Button, Kbd, Modal } from '../ui'
import { ExportBody } from './Overlays.export'

/* ---------------- Export ---------------- */
export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Modal open={open} onClose={onClose} label="Export">{open && <ExportBody onClose={onClose} />}</Modal>
}

/* ---------------- Command palette ---------------- */
export interface Cmd { id: string; label: string; group: string; hint?: string; run: () => void }
export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Cmd[] }) {
  const [q, setQ] = useState(''); const [i, setI] = useState(0)
  useEffect(() => { if (open) { setQ(''); setI(0) } }, [open])
  const list = useMemo(() => commands.filter(c => c.label.toLowerCase().includes(q.toLowerCase())), [q, commands])
  const run = (c?: Cmd) => { if (!c) return; onClose(); setTimeout(c.run, 60) }
  return (
    <Modal open={open} onClose={onClose} label="Commands">
      <div className="flex items-center gap-3 px-4 border-b border-ink-700">
        <Search size={17} className="text-fog-400" />
        <input autoFocus value={q} onChange={e => { setQ(e.target.value); setI(0) }} placeholder="Type a command or an instruction for the AI"
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.min(x + 1, list.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(x - 1, 0)) }
            if (e.key === 'Enter') { e.preventDefault(); if (list[i]) run(list[i]); else if (q.trim()) { onClose(); useEditor.getState().send(q) } }
          }}
          className="flex-1 h-14 bg-transparent outline-none text-[15px] placeholder:text-fog-500" />
        <Kbd>Esc</Kbd>
      </div>
      <div className="max-h-[50vh] overflow-y-auto p-2">
        {!list.length && <div className="px-3 py-6 text-[13.5px] text-fog-400">Press Enter to ask the AI: “{q}”</div>}
        {list.map((c, k) => (
          <button key={c.id} onMouseEnter={() => setI(k)} onClick={() => run(c)}
            className={clsx('relative w-full flex items-center gap-3 px-3 h-10 rounded-lg text-left text-[14px]', k === i ? 'text-fog-100' : 'text-fog-300')}>
            {k === i && <motion.span layoutId="cmd-hl" className="absolute inset-0 rounded-lg bg-ink-750" transition={{ type: 'spring', stiffness: 600, damping: 40 }} />}
            <span className="relative w-16 text-[11.5px] text-fog-500">{c.group}</span>
            <span className="relative flex-1 truncate">{c.label}</span>
            {c.hint && <span className="relative"><Kbd>{c.hint}</Kbd></span>}
          </button>
        ))}
      </div>
      <div className="px-4 py-2.5 border-t border-ink-700 flex items-center gap-2 text-[11.5px] text-fog-500"><Command size={13} /> Open this anywhere with ⌘K or Ctrl K</div>
    </Modal>
  )
}
