import { lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button, Logo } from '../components/ui'
import { Magnetic } from '../components/fx'

const OrbitScene = lazy(() => import('../components/three/Story').then(m => ({ default: m.OrbitScene })))

export default function NotFound() {
  const nav = useNavigate()
  return (
    <div className="relative min-h-full overflow-hidden grid place-items-center bg-[radial-gradient(60%_60%_at_50%_50%,#232833,#14171D)]">
      <Suspense fallback={null}><OrbitScene className="absolute inset-0 opacity-70" /></Suspense>
      <div className="absolute top-6 left-6"><Logo size={24} /></div>
      <div className="relative text-center px-6">
        <motion.div initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 120, damping: 14 }}
          className="font-display font-bold text-[30vw] md:text-[220px] leading-none tracking-[-0.06em] text-transparent [-webkit-text-stroke:2px_#F7BE4A] select-none">
          4<motion.span className="inline-block" animate={{ y: [0, -14, 0], rotate: [0, -6, 0] }} transition={{ duration: 3, repeat: Infinity }}>0</motion.span>4
        </motion.div>
        <h1 className="font-display text-[30px] md:text-[40px] font-semibold tracking-tight">This scene was cut</h1>
        <p className="mt-2 text-fog-400 max-w-[40ch] mx-auto">The page you opened doesn’t exist. It may have been moved, or the link is missing a part.</p>
        <div className="mt-7 flex gap-3 justify-center flex-wrap">
          <Magnetic><Button size="lg" variant="agent" onClick={() => nav('/')}>Go to the home page</Button></Magnetic>
          <Magnetic><Button size="lg" variant="secondary" onClick={() => nav('/projects')}>Open projects</Button></Magnetic>
        </div>
      </div>
    </div>
  )
}
