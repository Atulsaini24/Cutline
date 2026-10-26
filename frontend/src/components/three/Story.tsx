import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Edges, Float, Lightformer, RoundedBox, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import type { MotionValue } from 'framer-motion'
import { frameCanvas } from '../../lib/draw'
import { amp, SENTS, SRC_DUR } from '../../lib/sample'

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const smooth = (t: number) => t * t * (3 - 2 * t)
const seg = (p: number, a: number, b: number) => smooth(clamp((p - a) / (b - a)))
const bump = (p: number, a: number, m: number, b: number) => p < a || p > b ? 0 : p < m ? smooth((p - a) / (m - a)) : 1 - smooth((p - m) / (b - m))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function tex(cv: HTMLCanvasElement) { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t }
function verticalCanvas(src: number) {
  const full = frameCanvas(src, 640, 360); const cv = document.createElement('canvas'); cv.width = 202; cv.height = 360
  const c = cv.getContext('2d')!; c.drawImage(full, 220, 0, 202, 360, 0, 0, 202, 360)
  c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(20, 268, 162, 34); c.fillStyle = '#FFD27A'; c.fillRect(34, 280, 60, 10); c.fillStyle = '#fff'; c.fillRect(100, 280, 68, 10)
  return cv
}

/* ================= Scroll story ================= */
const N = 10
const CUT = new Set([2, 6])
const KEPT = Array.from({ length: N }, (_, i) => i).filter(i => !CUT.has(i))
const GAP = 0.64
const BARS = 120
const PHONES = [-1.9, 0, 1.9]

function StoryContent({ progress }: { progress: MotionValue<number> }) {
  const textures = useMemo(() => Array.from({ length: N }, (_, i) => tex(frameCanvas(SENTS[Math.min(SENTS.length - 1, 2 + i * 2)].s + 400, 384, 216, i === 6 ? 'blankets' : i === 11 ? 'light' : undefined))), [])
  const vtex = useMemo(() => [SENTS[9].s + 300, SENTS[19].s + 300, SENTS[26].s + 300].map(s => tex(verticalCanvas(s))), [])
  const clips = useRef<(THREE.Mesh | null)[]>([])
  const blades = useRef<(THREE.Mesh | null)[]>([])
  const phones = useRef<(THREE.Group | null)[]>([])
  const bars = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const look = useMemo(() => new THREE.Vector3(), [])
  const { camera, pointer, size } = useThree()
  const offset = size.width > 768 ? 1.15 : 0
  const sideMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1C1F26', roughness: .5, metalness: .3, transparent: true }), [])
  const mats = useMemo(() => textures.map(t => {
    const front = new THREE.MeshBasicMaterial({ map: t, toneMapped: false, transparent: true })
    const side = sideMat.clone()
    return [side, side, side, side, front, side] as THREE.Material[]
  }), [textures])
  const barH = useMemo(() => Array.from({ length: BARS }, (_, i) => { let a = 0; for (let k = 0; k < 5; k++) a = Math.max(a, amp((i / BARS) * SRC_DUR + k * 80)); return 0.06 + a * 0.5 }), [])

  useFrame((st, dt) => {
    const p = progress.get(), t = st.clock.elapsedTime
    const tAB = seg(p, 0.1, 0.3), tBC = seg(p, 0.4, 0.56), tCD = seg(p, 0.7, 0.86)
    clips.current.forEach((m, i) => {
      if (!m) return
      // A: a messy stack of raw footage
      const ax = Math.sin(i * 1.7) * 0.12, ay = -0.9 + i * 0.075, az = Math.cos(i * 1.3) * 0.1
      // B: laid out as a timeline
      const bx = (i - (N - 1) / 2) * GAP, by = 0.35, bz = 0
      // C: cut clips lift away, kept clips close the gap
      const k = KEPT.indexOf(i), cut = k < 0
      const cx = cut ? bx : (k - (KEPT.length - 1) / 2) * GAP, cy = cut ? by + 2.6 : by, cz = cut ? 1.4 : 0
      // D: kept clips fly into the phones
      const ph = PHONES[cut ? 1 : k % 3]
      const dx = ph, dy = 0.1, dz = 0.3
      let x = lerp(ax, bx, tAB), y = lerp(ay, by, tAB), z = lerp(az, bz, tAB)
      x = lerp(x, cx, tBC); y = lerp(y, cy, tBC); z = lerp(z, cz, tBC)
      x = lerp(x, dx, tCD); y = lerp(y, dy, tCD); z = lerp(z, dz, tCD)
      const hover = (1 - tAB) * Math.sin(t * 0.8 + i) * 0.02 + tAB * (1 - tBC) * Math.sin(t * 1.2 + i * 0.6) * 0.03
      m.position.set(x, y + hover, z)
      const rxA = -1.25 + Math.sin(i) * 0.05, rzA = Math.sin(i * 2.1) * 0.25
      m.rotation.set(lerp(rxA, 0, tAB) + (cut ? -tBC * 0.9 : 0), (cut ? tBC * 0.6 * (i % 2 ? 1 : -1) : 0), lerp(rzA, 0, tAB) + (cut ? tBC * 0.4 : 0))
      const s = lerp(1.15, 0.38, tAB) * (1 - tCD * 0.85)
      m.scale.setScalar(Math.max(0.001, s))
      const op = cut ? 1 - tBC : 1 - seg(p, 0.8, 0.9)
      ;(m.material as THREE.Material[]).forEach(mm => { (mm as THREE.MeshBasicMaterial).opacity = op })
      ;((m.material as THREE.Material[])[4] as THREE.MeshBasicMaterial).color.setRGB(1, 1 - (cut ? tBC * 0.25 : 0), 1 - (cut ? tBC * 0.7 : 0))
      m.visible = op > 0.01
    })
    // amber blades slice where the cuts happen
    blades.current.forEach((b, j) => {
      if (!b) return
      const i = [...CUT][j]; const a = bump(p, 0.38, 0.45, 0.56)
      b.position.set((i - (N - 1) / 2) * GAP, 0.35, 0.3); b.scale.set(1, Math.max(0.001, seg(p, 0.38, 0.44)), 1)
      ;(b.material as THREE.MeshBasicMaterial).opacity = a
    })
    // waveform under the timeline
    if (bars.current) {
      const vis = tAB * (1 - seg(p, 0.66, 0.76))
      bars.current.visible = vis > 0.03
      const width = lerp(N * GAP, KEPT.length * GAP, tBC)
      for (let i = 0; i < BARS; i++) {
        const f = i / (BARS - 1); const h = barH[i] * vis * (0.85 + 0.15 * Math.sin(t * 6 + i))
        dummy.position.set((f - 0.5) * width, -0.12, 0); dummy.scale.set(1, Math.max(0.001, h), 1); dummy.updateMatrix()
        bars.current.setMatrixAt(i, dummy.matrix)
      }
      bars.current.instanceMatrix.needsUpdate = true
    }
    // phones assemble
    phones.current.forEach((g, j) => {
      if (!g) return
      const a = seg(p, 0.72 + j * 0.04, 0.88 + j * 0.03)
      g.scale.setScalar(Math.max(0.001, a)); g.position.set(PHONES[j], lerp(-1.5, 0, a), 0)
      g.rotation.set(0, (1 - a) * 1.4 * (j - 1 || 0.6) + Math.sin(t * 0.6 + j) * 0.12 * a, 0)
      g.visible = a > 0.01
    })
    // camera: from above the stack, to front-on, to the phones
    const camA = [0, 3.1, 5.2], camB = [0, 0.4, 8.2], camD = [0, 0.1, 7.2]
    const cx = lerp(lerp(camA[0], camB[0], tAB), camD[0], tCD) + pointer.x * 0.5
    const cy = lerp(lerp(camA[1], camB[1], tAB), camD[1], tCD) + pointer.y * 0.3
    const cz = lerp(lerp(camA[2], camB[2], tAB), camD[2], tCD)
    camera.position.x += (cx - camera.position.x) * Math.min(1, dt * 5)
    camera.position.y += (cy - camera.position.y) * Math.min(1, dt * 5)
    camera.position.z += (cz - camera.position.z) * Math.min(1, dt * 5)
    look.set(0, lerp(-0.4, 0.1, tAB), 0); camera.lookAt(look)
  })

  return (
    <group position-x={offset}>
      {Array.from({ length: N }).map((_, i) => (
        <mesh key={i} ref={el => { clips.current[i] = el }} material={mats[i]}>
          <boxGeometry args={[1.6, 0.9, 0.04]} />
        </mesh>
      ))}
      {[...CUT].map((_, j) => (
        <mesh key={j} ref={el => { blades.current[j] = el }}>
          <planeGeometry args={[0.06, 1.6]} />
          <meshBasicMaterial color="#FFD27A" transparent opacity={0} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
      <instancedMesh ref={bars} args={[undefined, undefined, BARS]}>
        <boxGeometry args={[0.028, 1, 0.028]} />
        <meshStandardMaterial color="#5FD3A1" emissive="#1f6b4f" toneMapped={false} />
      </instancedMesh>
      {PHONES.map((x, j) => (
        <group key={j} ref={el => { phones.current[j] = el }} position={[x, 0, 0]}>
          <RoundedBox args={[1.25, 2.3, 0.12]} radius={0.12} smoothness={6}>
            <meshStandardMaterial color="#0f1115" roughness={0.25} metalness={0.7} />
          </RoundedBox>
          <mesh position={[0, 0, 0.065]}>
            <planeGeometry args={[1.1, 2.1]} />
            <meshBasicMaterial map={vtex[j]} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.98, 0.07]}><planeGeometry args={[0.3, 0.05]} /><meshBasicMaterial color="#000" /></mesh>
        </group>
      ))}
    </group>
  )
}

export function StoryScene({ progress, className }: { progress: MotionValue<number>; className?: string }) {
  return (
    <div className={className} aria-hidden>
      <Canvas dpr={[1, 1.75]} camera={{ position: [0, 3.1, 5.2], fov: 40 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 6, 5]} intensity={1.4} />
        <pointLight position={[-4, 1, 3]} color="#7CC4FF" intensity={18} />
        <pointLight position={[4, -1, 3]} color="#F7BE4A" intensity={18} />
        <StoryContent progress={progress} />
        <Sparkles count={60} scale={[14, 6, 6]} size={2} speed={0.2} opacity={0.35} color="#F7BE4A" />
      </Canvas>
    </div>
  )
}

/* ================= Glass logo mark ================= */
function Mark() {
  const g = useRef<THREE.Group>(null)
  const { pointer } = useThree()
  useFrame((st, dt) => {
    if (!g.current) return
    g.current.rotation.y += ((pointer.x * 0.7 + Math.sin(st.clock.elapsedTime * 0.4) * 0.25) - g.current.rotation.y) * Math.min(1, dt * 3)
    g.current.rotation.x += ((-pointer.y * 0.4) - g.current.rotation.x) * Math.min(1, dt * 3)
  })
  return (
    <group ref={g}>
      <Float speed={1.6} floatIntensity={0.8} rotationIntensity={0.3}>
        <RoundedBox args={[2.2, 2.2, 0.7]} radius={0.32} smoothness={8}>
          <meshPhysicalMaterial color="#dfe6f2" roughness={0.08} metalness={0.1} clearcoat={1} clearcoatRoughness={0.05} transparent opacity={0.3} envMapIntensity={2.2} depthWrite={false} />
          <Edges color="#8E95A4" threshold={20} />
        </RoundedBox>
        <mesh position={[0, 0, 0]}><boxGeometry args={[0.34, 2.5, 0.25]} /><meshStandardMaterial color="#F7BE4A" emissive="#F7BE4A" emissiveIntensity={1.4} toneMapped={false} /></mesh>
        {[-0.62, 0.62].map(x => <mesh key={x} position={[x, 0, 0]}><boxGeometry args={[0.38, 1.25, 0.2]} /><meshStandardMaterial color="#20242c" roughness={0.4} metalness={0.5} /></mesh>)}
      </Float>
    </group>
  )
}
export function GlassMark({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden>
      <Canvas dpr={[1, 1.75]} camera={{ position: [0, 0, 6], fov: 38 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.4} />
        <Environment resolution={256}>
          <Lightformer intensity={3} position={[0, 4, 3]} scale={[8, 1, 1]} />
          <Lightformer intensity={2} color="#F7BE4A" position={[-5, 0, 2]} scale={[1, 6, 1]} />
          <Lightformer intensity={2} color="#7CC4FF" position={[5, 0, 2]} scale={[1, 6, 1]} />
          <Lightformer intensity={1} position={[0, -4, -2]} scale={[8, 1, 1]} />
        </Environment>
        <Mark />
        <Sparkles count={50} scale={[8, 6, 4]} size={2.5} speed={0.3} opacity={0.5} color="#FFD27A" />
      </Canvas>
    </div>
  )
}

/* ================= Orbit: frames circling a core (sign-in, 404) ================= */
function Orbit({ count = 10 }: { count?: number }) {
  const g = useRef<THREE.Group>(null)
  const texs = useMemo(() => Array.from({ length: count }, (_, i) => tex(frameCanvas(SENTS[(i * 3 + 2) % SENTS.length].s + 300, 256, 144, i % 4 === 3 ? ['blankets', 'mic', 'light', 'mat'][i % 4] : undefined))), [count])
  const { pointer } = useThree()
  useFrame((st, dt) => {
    if (!g.current) return
    g.current.rotation.y += dt * 0.18
    g.current.rotation.x += ((pointer.y * 0.25 + 0.25) - g.current.rotation.x) * Math.min(1, dt * 2)
  })
  return (
    <group ref={g}>
      {texs.map((t, i) => {
        const a = (i / count) * Math.PI * 2, r = 3
        return (
          <Float key={i} speed={1 + (i % 3) * 0.4} floatIntensity={0.6} rotationIntensity={0.2}>
            <mesh position={[Math.cos(a) * r, Math.sin(i * 1.3) * 0.5, Math.sin(a) * r]} rotation={[0, -a + Math.PI / 2, 0]}>
              <planeGeometry args={[1.28, 0.72]} />
              <meshBasicMaterial map={t} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
          </Float>
        )
      })}
    </group>
  )
}
export function OrbitScene({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div className={className} aria-hidden>
      <Canvas dpr={[1, 1.75]} camera={{ position: [0, 1.2, 8], fov: 42 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.6} />
        <pointLight position={[3, 3, 5]} intensity={40} />
        <pointLight position={[-4, -2, 3]} intensity={25} color="#7CC4FF" />
        <Environment resolution={128}>
          <Lightformer intensity={2} position={[0, 4, 3]} scale={[8, 1, 1]} />
          <Lightformer intensity={2} color="#F7BE4A" position={[-5, 0, 2]} scale={[1, 6, 1]} />
        </Environment>
        <Orbit />
        {children}
        <Sparkles count={70} scale={[10, 6, 10]} size={2} speed={0.25} opacity={0.45} color="#F7BE4A" />
      </Canvas>
    </div>
  )
}
export { Mark }
