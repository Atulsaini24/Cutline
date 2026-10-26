import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion'
import { Clapperboard, Film, FolderOpen, LogIn, LogOut, Menu, Settings, Sparkles, WifiOff, X } from 'lucide-react'
import clsx from 'clsx'
import { Button, Logo } from './ui'
import { Magnetic, ScrollProgress, useSmoothScroll } from './fx'
import { useSession } from '../lib/session'
import { req } from '../lib/api'

/* ---------------- Marketing nav: hides on scroll down, returns on scroll up ---------------- */
export function MarketingNav() {
  const nav = useNavigate()
  const { scrollY } = useScroll()
  const [hidden, setHidden] = useState(false)
  const [solid, setSolid] = useState(false)
  const [open, setOpen] = useState(false)
  const { user, mode, signOut } = useSession()
  const isAuthed = mode === 'online' && !!user
  const displayName = user?.name?.trim() || user?.email?.split('@')[0] || 'Account'

  useMotionValueEvent(scrollY, 'change', v => { const prev = scrollY.getPrevious() ?? 0; setHidden(v > prev && v > 240); setSolid(v > 30) })
  const loc = useLocation()
  const go = (h: string) => (e: React.MouseEvent) => {
    e.preventDefault(); setOpen(false)
    if (h === 'how') { if (loc.pathname === '/') { const el = document.getElementById('how'); const l = (window as any).__lenis; if (el) l ? l.scrollTo(el) : el.scrollIntoView({ behavior: 'smooth' }) } else nav('/', { state: { to: 'how' } }) }
    else nav(h)
  }
  const links = [['Product', 'how'], ['Pricing', '/pricing'], ['Projects', '/projects']]
  return (
    <>
      <ScrollProgress />
      <motion.header animate={{ y: hidden && !open ? -90 : 0 }} transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
        className="fixed top-0 inset-x-0 z-50 px-4 md:px-8 pt-3" style={{ paddingTop: 'calc(env(safe-area-inset-top,0px) + 12px)' }}>
        <div className={clsx('mx-auto max-w-[1240px] flex items-center justify-between rounded-2xl px-4 h-14 transition-all duration-500',
          solid ? 'bg-ink-850/70 backdrop-blur-xl border border-ink-700/80 shadow-lift' : 'border border-transparent')}>
          <Link to="/" aria-label="Cutline home"><Logo /></Link>
          <nav className="hidden md:flex items-center gap-1">
            {links.map(([l, h]) => (
              <a key={l} href={h === 'how' ? '#/' : '#' + h} onClick={go(h)} className="relative px-3.5 py-2 text-[14px] font-semibold text-fog-300 hover:text-fog-100 transition group">
                {l}<span className="absolute left-3.5 right-3.5 bottom-1 h-px bg-amber-400 scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-300" />
              </a>
            ))}
          </nav>
          <div className="hidden md:flex items-center gap-2">
            {isAuthed ? (
              <>
                <button
                  onClick={() => nav('/projects')}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-ink-800/80 hover:bg-ink-750 border border-ink-700 text-fog-200 hover:text-fog-100 transition text-[13px] font-semibold"
                  title={user?.email}
                >
                  <span className="w-6 h-6 rounded-full bg-gradient-to-br from-sky-400 to-jade-400 grid place-items-center font-bold text-ink-900 text-[11px]">
                    {displayName[0]?.toUpperCase()}
                  </span>
                  <span className="max-w-[120px] truncate">{displayName}</span>
                </button>
                <Magnetic><Button size="sm" variant="agent" onClick={() => nav('/projects')}>Open projects</Button></Magnetic>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => nav('/signin')}>Sign in</Button>
                <Magnetic><Button size="sm" variant="agent" onClick={() => nav('/editor')}>Open the editor</Button></Magnetic>
              </>
            )}
          </div>
          <button className="md:hidden w-10 h-10 grid place-items-center" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(o => !o)}>{open ? <X /> : <Menu />}</button>
        </div>
        <AnimatePresence>
          {open && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="md:hidden mt-2 rounded-2xl bg-ink-850/95 backdrop-blur-xl border border-ink-700 p-3 grid gap-1">
              {links.map(([l, h], i) => (
                <motion.a key={l} href={h === 'how' ? '#/' : '#' + h} onClick={go(h)} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                  className="px-3 py-3 rounded-xl font-display text-[22px] font-semibold hover:bg-ink-800">{l}</motion.a>
              ))}
              <div className="flex gap-2 mt-2">
                {isAuthed ? (
                  <>
                    <Button className="flex-1" variant="secondary" onClick={() => { setOpen(false); nav('/projects') }}>Projects</Button>
                    <Button className="flex-1" variant="ghost" onClick={() => { signOut(); setOpen(false); nav('/') }}>Sign out</Button>
                  </>
                ) : (
                  <>
                    <Button className="flex-1" onClick={() => nav('/signin')}>Sign in</Button>
                    <Button className="flex-1" variant="agent" onClick={() => nav('/editor')}>Open the editor</Button>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.header>
    </>
  )
}

export function MarketingFooter() {
  const user = useSession(s => s.user)
  const accountLinks = [
    [user ? 'Projects' : 'Sign in', user ? '/projects' : '/signin'],
    ['Exports', '/exports'],
    ['Settings', '/settings'],
  ]
  return (
    <footer className="relative overflow-hidden border-t border-ink-700 pt-16">
      <div className="max-w-[1240px] mx-auto px-6 md:px-10 grid md:grid-cols-[1.4fr_1fr_1fr_1fr] gap-10">
        <div>
          <Logo />
          <p className="mt-4 text-[14px] text-fog-400 max-w-[34ch]">An editor where the AI proposes cuts and you stay in charge of every one of them.</p>
        </div>
        {[['Product', [['Editor', '/editor'], ['Pricing', '/pricing'], ['Projects', '/projects']]], ['Account', accountLinks], ['Demo', [['Shared Short', '/share/short-8'], ['Upload flow', '/upload'], ['Lost page', '/nowhere']]]].map(([h, ls]) => (
          <div key={h as string}>
            <div className="text-[13px] font-semibold text-fog-300">{h as string}</div>
            <ul className="mt-3 grid gap-2">{(ls as string[][]).map(([l, to]) => <li key={l}><Link to={to} className="text-[14px] text-fog-400 hover:text-amber-300 transition">{l}</Link></li>)}</ul>
          </div>
        ))}
      </div>
      <motion.div initial={{ y: '40%' }} whileInView={{ y: '0%' }} viewport={{ once: true }} transition={{ duration: 1.2, ease: [0.2, 0.8, 0.2, 1] }}
        className="mt-16 select-none text-center font-display font-bold tracking-[-0.06em] leading-[0.78] text-[24vw] bg-gradient-to-b from-ink-700 to-ink-900 bg-clip-text text-transparent" aria-hidden>
        Cutline
      </motion.div>
      <div className="max-w-[1240px] mx-auto px-6 md:px-10 py-6 flex flex-wrap justify-between gap-3 text-[12.5px] text-fog-500 border-t border-ink-750">
        <span>Runs on free tools: FFmpeg, Whisper, and free-tier or local AI models.</span>
        <span>Built with React, Three.js and Framer Motion</span>
      </div>
    </footer>
  )
}

export function MarketingLayout({ children }: { children: ReactNode }) {
  useSmoothScroll()
  useEffect(() => { window.scrollTo(0, 0) }, [])
  return (<div className="relative min-h-full"><MarketingNav />{children}<MarketingFooter /></div>)
}

/* ---------------- App shell (projects, exports, settings) ---------------- */
const NAV = [
  { to: '/projects', label: 'Projects', icon: FolderOpen },
  { to: '/exports', label: 'Exports', icon: Film },
  { to: '/settings', label: 'Settings', icon: Settings },
]
export function AppShell({ children, title, actions }: { children: ReactNode; title: string; actions?: ReactNode }) {
  const nav = useNavigate()
  const { user, mode, signOut } = useSession()
  const name = user?.name ?? 'Demo creator'
  useEffect(() => { window.scrollTo(0, 0) }, [])
  return (
    <div className="min-h-full md:grid md:grid-cols-[240px_1fr]">
      <aside className="hidden md:flex flex-col sticky top-0 h-screen border-r border-ink-700 bg-ink-850/60 backdrop-blur p-4">
        <Link to="/" className="px-2 py-2"><Logo /></Link>
        <nav className="mt-6 grid gap-1">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => clsx('relative flex items-center gap-3 px-3 h-10 rounded-xl text-[14px] font-semibold transition', isActive ? 'text-fog-100' : 'text-fog-400 hover:text-fog-100 hover:bg-ink-800')}>
              {({ isActive }) => (<>
                {isActive && <motion.span layoutId="side-active" className="absolute inset-0 rounded-xl bg-ink-750 border border-ink-600" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                <n.icon size={17} className="relative" /><span className="relative">{n.label}</span>
              </>)}
            </NavLink>
          ))}
        </nav>
        <button onClick={() => nav('/editor')} className="mt-6 group relative overflow-hidden rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-400/15 to-transparent p-4 text-left">
          <Sparkles size={18} className="text-amber-300" />
          <div className="mt-2 font-display font-semibold">Try an instruction</div>
          <div className="text-[12.5px] text-fog-400 mt-0.5">“Make three Shorts” on the demo episode.</div>
          <span className="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-amber-400/20 blur-2xl group-hover:scale-150 transition-transform duration-700" />
        </button>
        <div className="mt-auto">
          <UsageBox />
          <div className="mt-3 flex items-center gap-3 px-1">
            <span className="w-9 h-9 rounded-full bg-gradient-to-br from-sky-400 to-jade-400 grid place-items-center font-bold text-ink-900">{name[0]}</span>
            <div className="min-w-0 flex-1"><div className="text-[13.5px] font-semibold truncate">{name}</div><div className="text-[12px] text-fog-500 truncate">{mode === 'online' ? user?.email : mode === 'checking' ? 'Connecting…' : 'Offline demo'}</div></div>
            <button aria-label={mode === 'online' ? 'Sign out' : 'Sign in'} title={mode === 'online' ? 'Sign out' : 'Sign in'} onClick={() => { if (mode === 'online') signOut(); nav('/signin') }} className="text-fog-400 hover:text-fog-100"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-3 px-5 md:px-10 h-16 border-b border-ink-750 bg-ink-900/75 backdrop-blur-xl">
          <Link to="/" className="md:hidden"><Logo size={24} /></Link>
          <motion.h1 key={title} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="hidden md:block font-display text-[20px] font-semibold tracking-tight">{title}</motion.h1>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </header>
        <nav className="md:hidden flex gap-1 px-4 py-2 border-b border-ink-750 overflow-x-auto">
          {NAV.map(n => <NavLink key={n.to} to={n.to} className={({ isActive }) => clsx('flex items-center gap-2 px-3 h-9 rounded-lg text-[13.5px] font-semibold whitespace-nowrap', isActive ? 'bg-ink-750 text-fog-100' : 'text-fog-400')}><n.icon size={15} />{n.label}</NavLink>)}
          <NavLink to="/editor" className="flex items-center gap-2 px-3 h-9 rounded-lg text-[13.5px] font-semibold text-amber-300 whitespace-nowrap"><Clapperboard size={15} />Editor</NavLink>
        </nav>
        <ModeBanner />
        <main className="px-5 md:px-10 py-8 max-w-[1280px]">{children}</main>
      </div>
    </div>
  )
}

const fmtDur = (ms: number) => ms >= 3600000 ? `${(ms / 3600000).toFixed(1)} h` : `${Math.round(ms / 60000)} min`
let usageCache: { at: number; v: { indexedMs: number; renderedMs: number } } | null = null
/** Real numbers from the server for the last 30 days; nothing at all in demo mode. */
function UsageBox() {
  const mode = useSession(s => s.mode)
  const [u, setU] = useState(usageCache?.v ?? null)
  useEffect(() => {
    if (mode !== 'online') return
    if (usageCache && Date.now() - usageCache.at < 30000) return
    req('GET', '/me/usage').then(v => { usageCache = { at: Date.now(), v }; setU(v) }).catch(() => {})
  }, [mode])
  if (mode !== 'online' || !u) return null
  return (
    <Link to="/settings" className="block rounded-xl bg-ink-800 hover:bg-ink-750 transition p-3 text-[12px]">
      <div className="text-fog-400">Last 30 days</div>
      <div className="mt-1 flex justify-between"><span className="text-fog-300">Indexed</span><span className="font-semibold">{fmtDur(u.indexedMs)}</span></div>
      <div className="flex justify-between"><span className="text-fog-300">Rendered</span><span className="font-semibold">{fmtDur(u.renderedMs)}</span></div>
    </Link>
  )
}
/** Says plainly whether you're looking at the in-browser demo, and how to get out of it. */
function ModeBanner() {
  const { mode, serverUp } = useSession(); const nav = useNavigate()
  if (mode === 'checking' || mode === 'online') return null
  return (
    <div className={clsx('flex flex-wrap items-center gap-x-3 gap-y-2 px-5 md:px-10 py-2.5 text-[13px] border-b', serverUp ? 'bg-sky-500/10 border-sky-500/20 text-sky-300' : 'bg-amber-400/10 border-amber-400/20 text-amber-200')} role="status">
      {serverUp ? <LogIn size={15} className="shrink-0" /> : <WifiOff size={15} className="shrink-0" />}
      <span className="flex-1 min-w-[220px]">{serverUp ? 'You’re in demo mode. Sign in to upload and edit your own videos.' : 'Can’t reach the Cutline server, so this is the in-browser demo with sample data. Start the backend to upload your own videos.'}</span>
      {serverUp ? <Button size="sm" variant="secondary" onClick={() => nav('/signin')}>Sign in</Button> : <Button size="sm" variant="ghost" onClick={() => location.reload()}>Retry</Button>}
    </div>
  )
}
