import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { frameCanvas } from '../../lib/draw'
import { SENTS } from '../../lib/sample'

const N = 26
const SPACING = 1.42

/** Position on a gentle S-curve for a ribbon parameter u (in frame units, 0 = centre). */
function curve(u: number, out: THREE.Vector3) {
  const x = u * SPACING
  out.set(x, Math.sin(x * 0.18) * 0.45 - 0.05, -Math.pow(Math.abs(x) * 0.2, 1.8))
  return out
}

function useFrameTextures() {
  return useMemo(() => {
    const picks: [number, string?][] = [[SENTS[2].s + 300], [SENTS[8].s + 500], [SENTS[11].s + 200], [SENTS[16].s + 400], [0, 'blankets'], [SENTS[20].s + 200], [SENTS[25].s + 300], [0, 'light'], [SENTS[29].s + 300], [0, 'mic'], [SENTS[4].s + 900], [SENTS[30].s + 300]]
    return picks.map(([src, br]) => { const t = new THREE.CanvasTexture(frameCanvas(src, 384, 216, br)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t })
  }, [])
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256
  const g = c.getContext('2d')!
  const grd = g.createLinearGradient(0, 0, 64, 0)
  grd.addColorStop(0, 'rgba(247,190,74,0)'); grd.addColorStop(.5, 'rgba(255,214,130,1)'); grd.addColorStop(1, 'rgba(247,190,74,0)')
  g.fillStyle = grd; g.fillRect(0, 0, 64, 256)
  const v = g.createLinearGradient(0, 0, 0, 256); v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(.15, 'rgba(0,0,0,0)'); v.addColorStop(.85, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)')
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = v; g.fillRect(0, 0, 64, 256)
  return new THREE.CanvasTexture(c)
}

interface Item { pos: number; target: number; cut: number; tex: number; spin: number }

function Ribbon() {
  const texs = useFrameTextures()
  const glow = useMemo(glowTexture, [])
  const groups = useRef<(THREE.Group | null)[]>([])
  const mats = useRef<THREE.MeshBasicMaterial[]>([])
  const blade = useRef<THREE.Group>(null)
  const bladeMat = useRef<THREE.MeshBasicMaterial>(null)
  const light = useRef<THREE.PointLight>(null)
  const items = useRef<Item[]>(Array.from({ length: N }, (_, i) => ({ pos: i - N / 2, target: i - N / 2, cut: -1, tex: i % 12, spin: Math.random() > .5 ? 1 : -1 })))
  const st = useRef({ offset: 0, nextCut: 1.6, bladeT: -1, bladeX: 0 })
  const v = useMemo(() => new THREE.Vector3(), [])
  const v2 = useMemo(() => new THREE.Vector3(), [])
  const { pointer, camera } = useThree()

  const sprockets = useMemo(() => {
    const arr: [number, number][] = []
    for (let k = 0; k < 7; k++) { const x = -0.54 + k * 0.18; arr.push([x, 0.43], [x, -0.43]) }
    return arr
  }, [])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 20)
    const s = st.current
    s.offset += dt * 0.32
    // trigger a cut near centre
    s.nextCut -= dt
    if (s.nextCut <= 0) {
      s.nextCut = 2.4 + Math.random() * 1.2
      const live = items.current.filter(it => it.cut < 0)
      const cand = live.filter(it => { const u = it.pos - s.offset; return u > -1.2 && u < 1.8 }).sort((a, b) => Math.abs(a.pos - s.offset - .3) - Math.abs(b.pos - s.offset - .3))[0]
      if (cand) {
        cand.cut = 0
        s.bladeT = 0; s.bladeX = (cand.pos - s.offset) * SPACING
        items.current.forEach(it => { if (it !== cand && it.target > cand.target) it.target -= 1 })
      }
    }
    const maxTarget = () => Math.max(...items.current.filter(i => i.cut < 0).map(i => i.target))
    items.current.forEach((it, i) => {
      const g = groups.current[i]; if (!g) return
      it.pos += (it.target - it.pos) * Math.min(1, dt * 3.2)
      let u = it.pos - s.offset
      if (u < -N / 2 && it.cut < 0) { const m = maxTarget() + 1; it.pos += m - it.target; it.target = m; u = it.pos - s.offset }
      curve(u, v); curve(u + 0.05, v2)
      const ang = Math.atan2(v2.z - v.z, v2.x - v.x)
      g.position.copy(v); g.rotation.set(0, -ang, Math.sin(u * 0.5) * 0.04)
      const mat = mats.current[i]
      if (it.cut >= 0) {
        it.cut += dt / 1.25
        const k = it.cut, e = 1 - Math.pow(1 - Math.min(k, 1), 3)
        g.position.y += e * 2.6; g.position.z += e * 1.2
        g.rotation.x = -e * 0.9 * it.spin; g.rotation.z += e * 0.5 * it.spin
        g.scale.setScalar(1 - e * 0.35)
        g.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && 'opacity' in m) { m.transparent = true; (m as THREE.MeshBasicMaterial).opacity = 1 - e } })
        if (k >= 1) {
          it.cut = -1; const m = maxTarget() + 1; it.target = m; it.pos = m; it.tex = (it.tex + 5) % texs.length
          if (mat) { mat.map = texs[it.tex]; mat.needsUpdate = true }
          g.scale.setScalar(1)
          g.traverse(o => { const m2 = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined; if (m2 && 'opacity' in m2) m2.opacity = 1 })
        }
      } else g.scale.setScalar(1)
    })
    // blade
    if (blade.current && bladeMat.current && light.current) {
      if (s.bladeT >= 0) {
        s.bladeT += dt / 1.1
        const k = s.bladeT
        const grow = Math.min(1, k * 4)
        curve(s.bladeX / SPACING, v)
        blade.current.position.set(v.x, v.y, v.z + 0.25)
        blade.current.scale.set(1, grow, 1)
        const a = k < 0.6 ? 1 : Math.max(0, 1 - (k - .6) / .4)
        bladeMat.current.opacity = a
        light.current.intensity = a * 14
        light.current.position.set(v.x, v.y, v.z + 0.8)
        if (k >= 1) s.bladeT = -1
      } else { bladeMat.current.opacity = 0; light.current.intensity = 0 }
    }
    // parallax camera
    camera.position.x += (pointer.x * 0.9 - camera.position.x) * 0.04
    camera.position.y += (0.3 + pointer.y * 0.35 - camera.position.y) * 0.04
    camera.lookAt(0, 0, -1.2)
  })

  return (
    <>
      {items.current.map((it, i) => (
        <group key={i} ref={el => { groups.current[i] = el }}>
          <mesh>
            <boxGeometry args={[1.32, 1.0, 0.035]} />
            <meshStandardMaterial color="#1A1D23" roughness={0.55} metalness={0.25} transparent />
          </mesh>
          <mesh position={[0, 0, 0.019]}>
            <planeGeometry args={[1.2, 0.675]} />
            <meshBasicMaterial ref={m => { if (m) mats.current[i] = m }} map={texs[it.tex]} toneMapped={false} transparent />
          </mesh>
          {sprockets.map(([x, y], k) => (
            <mesh key={k} position={[x + 0.09, y, 0.019]}>
              <planeGeometry args={[0.07, 0.05]} />
              <meshBasicMaterial color="#454C59" transparent />
            </mesh>
          ))}
        </group>
      ))}
      <group ref={blade}>
        <mesh>
          <planeGeometry args={[0.55, 2.6]} />
          <meshBasicMaterial ref={bladeMat} map={glow} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      </group>
      <pointLight ref={light} color="#F7BE4A" distance={6} intensity={0} />
    </>
  )
}

export default function FilmRibbon({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden>
      <Canvas dpr={[1, 1.75]} camera={{ position: [0, 0.3, 4.3], fov: 42 }} gl={{ antialias: true, alpha: true }}>
        <fog attach="fog" args={['#14171D', 4.5, 12]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[3, 5, 6]} intensity={1.1} />
        <Ribbon />
        <Sparkles count={70} scale={[16, 5, 6]} size={2.2} speed={0.25} opacity={0.5} color="#F7BE4A" />
      </Canvas>
    </div>
  )
}
