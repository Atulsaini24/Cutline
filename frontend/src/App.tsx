import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, MotionConfig } from 'framer-motion'
import { Toaster } from 'sonner'
import { Cursor, PageCut } from './components/fx'
import { useSession } from './lib/session'
import Landing from './pages/Landing'

const Projects = lazy(() => import('./pages/Projects'))
const Ingest = lazy(() => import('./pages/Ingest'))
const Editor = lazy(() => import('./pages/Editor'))
const Exports = lazy(() => import('./pages/Exports'))
const Settings = lazy(() => import('./pages/Settings'))
const Pricing = lazy(() => import('./pages/Pricing'))
const SignIn = lazy(() => import('./pages/SignIn'))
const Share = lazy(() => import('./pages/Share'))
const NotFound = lazy(() => import('./pages/NotFound'))

const Loading = () => <div className="h-screen grid place-items-center"><span className="w-8 h-8 rounded-full border-2 border-amber-400 border-r-transparent animate-spin" /></div>
const wrap = (el: JSX.Element) => <PageCut><Suspense fallback={<Loading />}>{el}</Suspense></PageCut>

export default function App() {
  const loc = useLocation()
  const native = loc.pathname.startsWith('/editor')
  useEffect(() => { document.body.classList.toggle('native-cursor', native) }, [native])
  useEffect(() => { useSession.getState().init() }, [])
  return (
    <MotionConfig reducedMotion="user">
      {!native && <Cursor />}
      <AnimatePresence mode="wait">
        <Routes location={loc} key={loc.pathname.startsWith('/editor') ? '/editor' : loc.pathname}>
          <Route path="/" element={wrap(<Landing />)} />
          <Route path="/pricing" element={wrap(<Pricing />)} />
          <Route path="/signin" element={wrap(<SignIn />)} />
          <Route path="/projects" element={wrap(<Projects />)} />
          <Route path="/exports" element={wrap(<Exports />)} />
          <Route path="/settings" element={wrap(<Settings />)} />
          <Route path="/upload" element={wrap(<Ingest />)} />
          <Route path="/editor" element={wrap(<Editor />)} />
          <Route path="/editor/:id" element={wrap(<Editor />)} />
          <Route path="/share/:id" element={wrap(<Share />)} />
          <Route path="*" element={wrap(<NotFound />)} />
        </Routes>
      </AnimatePresence>
      <Toaster theme="dark" position="bottom-center" toastOptions={{ style: { background: '#252A33', border: '1px solid #3A404D', color: '#EEF0F5', fontFamily: 'Manrope, sans-serif' } }} />
    </MotionConfig>
  )
}
