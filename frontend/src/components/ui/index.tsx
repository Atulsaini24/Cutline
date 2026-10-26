import { forwardRef, useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'agent' | 'danger'
const variants: Record<Variant, string> = {
  primary: 'bg-fog-100 text-ink-900 hover:bg-white',
  secondary: 'bg-ink-750 text-fog-100 border border-ink-600 hover:bg-ink-700',
  ghost: 'text-fog-200 hover:bg-ink-750 hover:text-fog-100',
  agent: 'bg-amber-400 text-ink-950 hover:bg-amber-300 shadow-[0_8px_24px_-8px_rgba(247,190,74,.6)]',
  danger: 'bg-coral-500/15 text-coral-400 border border-coral-500/30 hover:bg-coral-500/25',
}
export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode }
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'secondary', size = 'md', icon, className, children, ...rest }, ref) {
  return (
    <button ref={ref} {...rest}
      className={clsx('inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-[background,transform,opacity,box-shadow] active:scale-[.97] disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' && 'h-8 px-3 text-[13px]', size === 'md' && 'h-9 px-4 text-sm', size === 'lg' && 'h-12 px-6 text-[15px] rounded-xl',
        variants[variant], className)}>
      {icon}{children}
    </button>
  )
})

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button aria-label={label} title={label} {...rest}
      className={clsx('grid place-items-center w-9 h-9 rounded-lg text-fog-200 hover:bg-ink-750 hover:text-fog-100 transition active:scale-95 disabled:opacity-30 disabled:pointer-events-none', className)}>
      {children}
    </button>
  )
}

export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="inline-grid place-items-center min-w-[20px] h-5 px-1.5 rounded border border-ink-600 bg-ink-800 text-[11px] text-fog-300 font-sans">{children}</kbd>
)

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5 font-display font-bold text-[19px] tracking-tight">
      <span className="relative rounded-[8px] bg-fog-100 overflow-hidden" style={{ width: size, height: size }}>
        <span className="absolute inset-y-0 bg-amber-400" style={{ left: size * 0.42, width: size * 0.16 }} />
        <span className="absolute inset-y-[22%] left-[14%] w-[20%] rounded-sm bg-ink-900/80" />
        <span className="absolute inset-y-[22%] right-[14%] w-[20%] rounded-sm bg-ink-900/80" />
      </span>
      Cutline
    </span>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange, id }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; id: string }) {
  return (
    <div role="tablist" className="flex gap-1 px-2 pt-2 border-b border-ink-700">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={clsx('relative px-3 pt-1.5 pb-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors', value === t.id ? 'text-fog-100' : 'text-fog-400 hover:text-fog-200')}>
          {t.label}
          {value === t.id && <motion.span layoutId={'tab-' + id} className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-fog-100" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
        </button>
      ))}
    </div>
  )
}

export const Pill = ({ tone = 'neutral', children }: { tone?: 'agent' | 'user' | 'ok' | 'neutral'; children: ReactNode }) => (
  <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-px text-[11px] font-bold',
    tone === 'agent' && 'bg-amber-400/15 text-amber-300', tone === 'user' && 'bg-sky-400/15 text-sky-300',
    tone === 'ok' && 'bg-jade-400/15 text-jade-400', tone === 'neutral' && 'bg-ink-700 text-fog-300')}>{children}</span>
)

export const pageMotion = {
  initial: { opacity: 0, y: 14, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: .45, ease: [.2, .8, .2, 1] } },
  exit: { opacity: 0, y: -10, filter: 'blur(6px)', transition: { duration: .25 } },
}

/** Accessible dialog: Escape and backdrop click close it. */
export function Modal({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-start md:place-items-center p-4 pt-[12vh] md:pt-4 bg-black/55 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
          <motion.div role="dialog" aria-modal="true" aria-label={label} initial={{ opacity: 0, y: 24, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="w-full max-w-[560px] max-h-[86vh] overflow-y-auto mx-auto rounded-2xl border border-ink-600 bg-ink-850 shadow-lift">
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

