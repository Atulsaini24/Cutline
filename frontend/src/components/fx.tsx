import { useEffect, useRef, useState, type ReactNode } from 'react'
import { animate, AnimatePresence, motion, useInView, useMotionValue, useScroll, useSpring, useTransform } from 'framer-motion'
import Lenis from 'lenis'
import clsx from 'clsx'

const ease = [0.2, 0.8, 0.2, 1] as const
const finePointer = () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* ---------------- Smooth scroll (marketing pages) ---------------- */
export function useSmoothScroll(enabled = true) {
  useEffect(() => {
    if (!enabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const lenis = new Lenis({ duration: 1.15, easing: t => 1 - Math.pow(1 - t, 3.2), smoothWheel: true })
    let raf = 0
    const loop = (t: number) => { lenis.raf(t); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    ;(window as any).__lenis = lenis
    // in-page anchor links glide too
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[href^="#"]') as HTMLAnchorElement | null
      if (!a || a.getAttribute('href')!.startsWith('#/')) return
      const el = document.querySelector(a.getAttribute('href')!); if (!el) return
      e.preventDefault(); lenis.scrollTo(el as HTMLElement, { offset: -20 })
    }
    document.addEventListener('click', onClick)
    return () => { cancelAnimationFrame(raf); lenis.destroy(); document.removeEventListener('click', onClick); (window as any).__lenis = null }
  }, [enabled])
}

/* ---------------- Custom cursor: Option 2 (The Precision Cutline) ----------------
   Editorial razor blades and timeline splicing guides that bracket interactive elements
   and slice together with a crisp cut-flash on click. */
export function Cursor() {
  const [on] = useState(finePointer)
  const x = useMotionValue(-100), y = useMotionValue(-100)
  const rx = useSpring(x, { stiffness: 480, damping: 32, mass: 0.5 })
  const ry = useSpring(y, { stiffness: 480, damping: 32, mass: 0.5 })
  const [label, setLabel] = useState<string | null>(null)
  const [mode, setMode] = useState<'default' | 'link' | 'text' | 'label'>('default')
  const [down, setDown] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!on) return
    document.documentElement.classList.add('has-cursor')
    const move = (e: PointerEvent) => {
      x.set(e.clientX); y.set(e.clientY); setHidden(false)
      const t = e.target as HTMLElement
      const tagged = t.closest('[data-cursor]') as HTMLElement | null
      if (tagged) {
        const v = tagged.dataset.cursor!
        if (v === 'text') { setMode('text'); setLabel(null) }
        else if (v === 'none') { setMode('default'); setLabel(null) }
        else { setMode('label'); setLabel(v) }
        return
      }
      if (t.closest('input,textarea,[contenteditable="true"]')) { setMode('text'); setLabel(null); return }
      if (t.closest('a,button,[role="button"],select,label,summary,[role="tab"],[role="switch"]')) { setMode('link'); setLabel(null); return }
      setMode('default'); setLabel(null)
    }
    const leave = () => setHidden(true)
    const d = () => setDown(true), u = () => setDown(false)
    window.addEventListener('pointermove', move); document.addEventListener('mouseleave', leave)
    window.addEventListener('pointerdown', d); window.addEventListener('pointerup', u)
    return () => {
      document.documentElement.classList.remove('has-cursor')
      window.removeEventListener('pointermove', move)
      document.removeEventListener('mouseleave', leave)
      window.removeEventListener('pointerdown', d)
      window.removeEventListener('pointerup', u)
    }
  }, [on])

  if (!on) return null

  // Blade separation distance from center
  const bladeGap = down ? 0 : mode === 'label' ? 54 : mode === 'link' ? 28 : mode === 'text' ? 3 : 14
  const bladeH = mode === 'label' ? 36 : mode === 'link' ? 34 : mode === 'text' ? 26 : 24

  return (
    <div aria-hidden className={clsx('pointer-events-none fixed inset-0 z-[100] transition-opacity duration-200', hidden && 'opacity-0')}>
      {/* 1. Trailing Razor Guides & Timeline Splicing Bracket */}
      <motion.div className="absolute left-0 top-0 will-change-transform" style={{ x: rx, y: ry }}>
        <div className="-translate-x-1/2 -translate-y-1/2 relative flex items-center justify-center pointer-events-none">
          {/* Dashed Timeline Cut Seam between blades */}
          <motion.div
            animate={{
              width: bladeGap * 2,
              opacity: mode === 'link' ? 0.35 : mode === 'label' ? 0.95 : 0.12,
              borderColor: mode === 'link' ? '#F7BE4A' : 'rgba(255,255,255,0.4)',
              backgroundColor: mode === 'label' ? 'rgba(20,23,29,0.94)' : 'transparent',
            }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
            className="h-7 border-t border-b border-dashed flex items-center justify-center overflow-hidden"
          >
            {mode === 'label' && (
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-[11px] font-mono tracking-wider font-bold text-amber-300 uppercase px-3 z-10 whitespace-nowrap"
              >
                ✂ {label}
              </motion.span>
            )}
          </motion.div>

          {/* Left Razor Blade */}
          <motion.div
            animate={{
              x: -bladeGap,
              height: bladeH,
              scaleY: down ? 1.25 : 1,
              borderColor: down ? '#F0675A' : mode === 'link' ? '#F7BE4A' : 'rgba(247,190,74,0.85)',
            }}
            transition={{ type: 'spring', stiffness: down ? 700 : 460, damping: down ? 22 : 28 }}
            className="absolute w-2 border-l-2 border-t border-b border-r-0 rounded-l-[2px] shadow-[0_0_8px_rgba(247,190,74,0.5)]"
          >
            {/* Blade notch tick */}
            <span className="absolute top-1/2 -left-[3px] -translate-y-1/2 w-1 h-[2px] bg-amber-300" />
          </motion.div>

          {/* Right Razor Blade */}
          <motion.div
            animate={{
              x: bladeGap,
              height: bladeH,
              scaleY: down ? 1.25 : 1,
              borderColor: down ? '#F0675A' : mode === 'link' ? '#F7BE4A' : 'rgba(247,190,74,0.85)',
            }}
            transition={{ type: 'spring', stiffness: down ? 700 : 460, damping: down ? 22 : 28 }}
            className="absolute w-2 border-r-2 border-t border-b border-l-0 rounded-r-[2px] shadow-[0_0_8px_rgba(247,190,74,0.5)]"
          >
            {/* Blade notch tick */}
            <span className="absolute top-1/2 -right-[3px] -translate-y-1/2 w-1 h-[2px] bg-amber-300" />
          </motion.div>

          {/* Top & Bottom Timeline Sprocket Guides */}
          <motion.span
            animate={{
              opacity: down ? 0 : mode === 'link' ? 0.9 : 0.4,
              scaleX: mode === 'link' ? 1.6 : 1,
            }}
            className="absolute -top-3 w-3 h-[1.5px] bg-amber-400 rounded-full"
          />
          <motion.span
            animate={{
              opacity: down ? 0 : mode === 'link' ? 0.9 : 0.4,
              scaleX: mode === 'link' ? 1.6 : 1,
            }}
            className="absolute -bottom-3 w-3 h-[1.5px] bg-amber-400 rounded-full"
          />
        </div>
      </motion.div>

      {/* 2. Direct-Tracking Aim Point (Instantaneous) */}
      <motion.div className="absolute left-0 top-0 will-change-transform pointer-events-none" style={{ x, y }}>
        {/* Cutline Diamond / Pip */}
        <motion.div
          animate={{
            scale: down ? 0.5 : mode === 'link' ? 1.3 : 1,
            rotate: mode === 'link' ? 45 : 0,
            backgroundColor: down ? '#F0675A' : mode === 'link' ? '#F7BE4A' : '#F7BE4A',
            boxShadow: mode === 'link'
              ? '0 0 10px rgba(247,190,74,0.95), 0 0 3px #FFF'
              : '0 0 6px rgba(247,190,74,0.85)',
          }}
          transition={{ duration: 0.15 }}
          className={clsx(
            '-translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5',
            mode === 'link' ? 'rounded-[1px]' : 'rounded-full'
          )}
        />

        {/* Razor Snip Cut-Line Flash (shoots horizontally on click) */}
        <AnimatePresence>
          {down && (
            <>
              {/* Horizontal laser cut beam */}
              <motion.div
                initial={{ scaleX: 0.1, opacity: 1, backgroundColor: '#FFF' }}
                animate={{ scaleX: 3.2, opacity: 0, backgroundColor: '#F0675A' }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
                className="absolute -translate-x-1/2 -translate-y-1/2 w-12 h-[2px] shadow-[0_0_8px_rgba(240,103,90,0.9)]"
              />
              {/* Scissor snip cross micro-ring */}
              <motion.div
                initial={{ scale: 0.3, opacity: 0.9, borderColor: '#F7BE4A' }}
                animate={{ scale: 2.2, opacity: 0, borderColor: '#F0675A' }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
                className="absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full border-[1.5px]"
              />
            </>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

/* ---------------- Magnetic: children drift toward the pointer ---------------- */
export function Magnetic({ children, strength = 0.35, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const x = useSpring(0, { stiffness: 250, damping: 18 }), y = useSpring(0, { stiffness: 250, damping: 18 })
  return (
    <motion.div ref={ref} className={clsx('inline-block', className)} style={{ x, y }}
      onPointerMove={e => { if (e.pointerType !== 'mouse') return; const r = ref.current!.getBoundingClientRect(); x.set((e.clientX - r.left - r.width / 2) * strength); y.set((e.clientY - r.top - r.height / 2) * strength) }}
      onPointerLeave={() => { x.set(0); y.set(0) }}>
      {children}
    </motion.div>
  )
}

/* ---------------- Split text: words rise out of a mask ---------------- */
export function SplitText({ text, className, delay = 0, as: Tag = 'h1', stagger = 0.06 }: { text: string; className?: string; delay?: number; as?: any; stagger?: number }) {
  const ref = useRef(null); const inView = useInView(ref, { once: true, margin: '-10% 0px' })
  return (
    <Tag ref={ref} className={className} aria-label={text}>
      {text.split(' ').map((w, i) => (
        <span key={i} aria-hidden className="inline-block overflow-hidden align-bottom pb-[0.08em] -mb-[0.08em]">
          <motion.span className="inline-block" initial={{ y: '110%', rotate: 6 }} animate={inView ? { y: '0%', rotate: 0 } : {}} transition={{ duration: 0.9, ease, delay: delay + i * stagger }}>
            {w}{'\u00A0'}
          </motion.span>
        </span>
      ))}
    </Tag>
  )
}

/* ---------------- Reveal on scroll ---------------- */
export function Reveal({ children, delay = 0, y = 40, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y, filter: 'blur(8px)' }} whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-12% 0px' }} transition={{ duration: 0.9, ease, delay }}>{children}</motion.div>
  )
}

/* ---------------- Parallax: move content against the scroll ---------------- */
export function Parallax({ children, speed = 0.2, className }: { children: ReactNode; speed?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], [`${speed * 100}%`, `${-speed * 100}%`])
  return <motion.div ref={ref} style={{ y }} className={className}>{children}</motion.div>
}

/* ---------------- Count up when visible ---------------- */
export function CountUp({ to, decimals = 0, suffix = '', prefix = '', duration = 1.6 }: { to: number; decimals?: number; suffix?: string; prefix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null); const inView = useInView(ref, { once: true })
  useEffect(() => {
    if (!inView) return
    const c = animate(0, to, { duration, ease, onUpdate: v => { if (ref.current) ref.current.textContent = prefix + v.toFixed(decimals) + suffix } })
    return () => c.stop()
  }, [inView])
  return <span ref={ref}>{prefix}0{suffix}</span>
}

/* ---------------- Marquee that speeds up with scroll velocity ---------------- */
export function Marquee({ items, reverse = false, className }: { items: ReactNode[]; reverse?: boolean; className?: string }) {
  const x = useMotionValue(0)
  const ref = useRef<HTMLDivElement>(null)
  const { scrollY } = useScroll()
  const last = useRef(0); const boost = useRef(0)
  useEffect(() => scrollY.on('change', v => { boost.current = Math.min(8, Math.abs(v - last.current) * 0.25); last.current = v }), [])
  useEffect(() => {
    let raf = 0, prev = performance.now()
    const loop = (t: number) => {
      const dt = (t - prev) / 1000; prev = t
      const w = (ref.current?.scrollWidth ?? 2000) / 2
      boost.current *= 0.92
      let nx = x.get() + (reverse ? 1 : -1) * (40 + boost.current * 60) * dt
      if (nx < -w) nx += w; if (nx > 0) nx -= w
      x.set(nx); raf = requestAnimationFrame(loop)
    }
    if (reverse) x.set(-1000)
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className={clsx('overflow-hidden', className)} style={{ maskImage: 'linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent)' }}>
      <motion.div ref={ref} className="flex w-max gap-4" style={{ x }}>
        {[...items, ...items].map((it, i) => <div key={i} className="shrink-0">{it}</div>)}
      </motion.div>
    </div>
  )
}

/* ---------------- Route transition: an amber splice wipes across ---------------- */
export function PageCut({ children }: { children: ReactNode }) {
  return (
    <>
      <motion.div className="h-full" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.35, delay: 0.25 } }} exit={{ opacity: 0, transition: { duration: 0.2 } }}>
        {children}
      </motion.div>
      <motion.div aria-hidden className="fixed inset-0 z-[90] pointer-events-none flex">
        {[0, 1, 2, 3, 4].map(i => (
          <motion.div key={i} className="flex-1 h-full bg-ink-950 origin-top"
            initial={{ scaleY: 1 }} animate={{ scaleY: 0, transition: { duration: 0.55, ease: [0.7, 0, 0.2, 1], delay: 0.05 * i } }}
            exit={{ scaleY: 1, transition: { duration: 0.4, ease: [0.7, 0, 0.2, 1], delay: 0.04 * i } }} style={{ transformOrigin: 'bottom' }} />
        ))}
        <motion.div className="absolute top-0 bottom-0 w-[3px] bg-amber-400 shadow-[0_0_30px_6px_rgba(247,190,74,.55)]"
          initial={{ left: '-2%' }} animate={{ left: '102%', transition: { duration: 0.7, ease: [0.7, 0, 0.2, 1] } }} exit={{ left: ['-2%', '102%'], transition: { duration: 0.5 } }} />
      </motion.div>
    </>
  )
}

/* ---------------- Scroll progress line ---------------- */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const s = useSpring(scrollYProgress, { stiffness: 200, damping: 30 })
  return <motion.div aria-hidden className="fixed top-0 left-0 right-0 h-[2px] z-[80] origin-left bg-gradient-to-r from-amber-500 via-amber-300 to-sky-400" style={{ scaleX: s }} />
}

/* ---------------- Spotlight that follows the pointer inside a section ---------------- */
export function Spotlight({ className, color = 'rgba(247,190,74,.13)', size = 620 }: { className?: string; color?: string; size?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const x = useMotionValue(50), y = useMotionValue(30)
  const sx = useSpring(x, { stiffness: 60, damping: 20 }), sy = useSpring(y, { stiffness: 60, damping: 20 })
  const bg = useTransform([sx, sy], ([a, b]) => `radial-gradient(${size}px circle at ${a}% ${b}%, ${color}, transparent 60%)`)
  useEffect(() => {
    const el = ref.current?.parentElement; if (!el) return
    const m = (e: PointerEvent) => { const r = el.getBoundingClientRect(); x.set(((e.clientX - r.left) / r.width) * 100); y.set(((e.clientY - r.top) / r.height) * 100) }
    el.addEventListener('pointermove', m); return () => el.removeEventListener('pointermove', m)
  }, [])
  return <motion.div ref={ref} aria-hidden className={clsx('pointer-events-none absolute inset-0', className)} style={{ background: bg }} />
}

/* ---------------- Tilt card ---------------- */
export function Tilt({ children, className, max = 8 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const mx = useMotionValue(0.5), my = useMotionValue(0.5)
  const rx = useSpring(useTransform(my, [0, 1], [max, -max]), { stiffness: 200, damping: 18 })
  const ry = useSpring(useTransform(mx, [0, 1], [-max, max]), { stiffness: 200, damping: 18 })
  const glare = useTransform([mx, my], ([a, b]) => `radial-gradient(500px circle at ${(a as number) * 100}% ${(b as number) * 100}%, rgba(255,255,255,.09), transparent 45%)`)
  return (
    <motion.div ref={ref} className={clsx('relative', className)} style={{ rotateX: rx, rotateY: ry, transformPerspective: 1000 }}
      onPointerMove={e => { const r = ref.current!.getBoundingClientRect(); mx.set((e.clientX - r.left) / r.width); my.set((e.clientY - r.top) / r.height) }}
      onPointerLeave={() => { mx.set(0.5); my.set(0.5) }}>
      {children}
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: glare }} />
    </motion.div>
  )
}
