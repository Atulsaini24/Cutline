import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Eye, EyeOff, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Button, Logo } from '../components/ui'
import { SplitText } from '../components/fx'
import { useSession } from '../lib/session'

const OrbitScene = lazy(() => import('../components/three/Story').then(m => ({ default: m.OrbitScene })))
const MarkLazy = lazy(() => import('../components/three/Story').then(m => ({ default: () => <m.Mark /> })))

export default function SignIn() {
  const nav = useNavigate()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('demo@cutline.dev')
  const [password, setPassword] = useState('demo1234')
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const session = useSession()
  const server = !!session.providers
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email)) { setErr('Enter an email address like name@example.com.'); return }
    setErr(''); setBusy(true)
    if (!server) { setTimeout(() => nav('/projects'), 700); return }
    try { if (mode === 'in') await session.signIn(email, password); else await session.register(name || email.split('@')[0], email, password); nav('/projects') }
    catch (x) { setErr((x as Error).message); setBusy(false) }
  }
  const field = 'h-12 rounded-xl bg-ink-800 border border-ink-600 px-4 text-[15px] outline-none focus:border-amber-400 focus:shadow-[0_0_0_4px_rgba(247,190,74,.12)] transition w-full'
  return (
    <div className="min-h-full grid lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden lg:block overflow-hidden bg-[radial-gradient(70%_70%_at_50%_50%,#232833,#14171D)]">
        <Suspense fallback={null}><OrbitScene className="absolute inset-0"><Suspense fallback={null}><MarkLazy /></Suspense></OrbitScene></Suspense>
        <div className="absolute left-10 bottom-10 right-10">
          <SplitText as="p" text="Every cut stays yours." className="font-display text-[44px] font-semibold tracking-[-0.035em] leading-none" delay={0.4} />
          <p className="mt-3 text-fog-400 max-w-[42ch]">Sign in to pick up where you left off. Your history, snapshots and renders are waiting.</p>
        </div>
      </div>
      <div className="relative flex flex-col px-6 md:px-14 py-8">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2 text-[14px] text-fog-400 hover:text-fog-100"><ArrowLeft size={16} />Home</Link>
          <Logo size={24} />
        </div>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6, delay: .2 }} className="my-auto w-full max-w-[400px] mx-auto py-12">
          <div className="relative flex rounded-xl bg-ink-850 border border-ink-700 p-1 w-fit">
            {([['in', 'Sign in'], ['up', 'Create account']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)} className={clsx('relative px-4 h-9 text-[13.5px] font-semibold z-10', mode === k ? 'text-ink-900' : 'text-fog-300')}>
                {mode === k && <motion.span layoutId="auth-tab" className="absolute inset-0 -z-10 rounded-lg bg-fog-100" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}{l}
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.h1 key={mode} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="mt-7 font-display text-[36px] font-semibold tracking-[-0.03em] leading-tight">
              {mode === 'in' ? 'Welcome back' : 'Start editing in a minute'}
            </motion.h1>
          </AnimatePresence>
          <button onClick={() => { if (server) { setErr('Google sign-in needs OAuth credentials on the server. Use email for now.'); return } setBusy(true); setTimeout(() => nav('/projects'), 900) }} className="mt-7 w-full h-12 rounded-xl border border-ink-600 bg-ink-850 hover:bg-ink-800 flex items-center justify-center gap-3 font-semibold transition">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            Continue with Google
          </button>
          <div className="my-6 flex items-center gap-3 text-[12.5px] text-fog-500"><span className="h-px flex-1 bg-ink-700" />or with email<span className="h-px flex-1 bg-ink-700" /></div>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <AnimatePresence initial={false}>
              {mode === 'up' && <motion.label initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="grid gap-1.5 text-[13px] text-fog-300 overflow-hidden">Name<input className={field} value={name} onChange={e => setName(e.target.value)} placeholder="Your name" /></motion.label>}
            </AnimatePresence>
            <label className="grid gap-1.5 text-[13px] text-fog-300">Email<input className={clsx(field, err && 'border-coral-500')} value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" /></label>
            {err && <motion.p initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }} className="text-[13px] text-coral-400 -mt-2">{err}</motion.p>}
            <label className="grid gap-1.5 text-[13px] text-fog-300">Password
              <span className="relative"><input className={field} type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
                <button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-fog-400 hover:text-fog-100">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
            </label>
            <Button type="submit" size="lg" variant="agent" className="mt-2" disabled={busy}>{busy ? <Loader2 size={18} className="animate-spin" /> : mode === 'in' ? 'Sign in' : 'Create account'}</Button>
          </form>
          <p className="mt-6 text-[12.5px] text-fog-500">{server ? 'Connected to your Cutline server. The demo account is demo@cutline.dev / demo1234.' : 'No server running: you’ll continue in the offline demo.'}</p>
        </motion.div>
      </div>
    </div>
  )
}
