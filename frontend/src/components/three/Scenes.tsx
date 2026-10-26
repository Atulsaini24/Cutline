import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float, MeshDistortMaterial, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { amp, sentAt, SRC_DUR } from '../../lib/sample'

/* ---------------- Indexing: a ring of audio bars lit up as the scan passes ---------------- */
const BARS = 180
function WaveRing({ progress }: { progress: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const arm = useRef<THREE.Group>(null)
  const group = useRef<THREE.Group>(null)
  const core = useRef<THREE.Mesh>(null)
  const data = useMemo(() => Array.from({ length: BARS }, (_, i) => {
    const ms = (i / BARS) * SRC_DUR
    let a = 0; for (let k = 0; k < 6; k++) a = Math.max(a, amp(ms + k * 90))
    return { h: 0.15 + a * 1.6, spk: sentAt(ms).spk }
  }), [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const col = useMemo(() => new THREE.Color(), [])
  const shown = useRef(0)
  const M = new THREE.Color('#7CC4FF'), D = new THREE.Color('#5FD3A1'), dim = new THREE.Color('#3A404D'), hot = new THREE.Color('#FFD27A')

  useFrame((st, dt) => {
    shown.current += (progress - shown.current) * Math.min(1, dt * 4)
    const p = shown.current, t = st.clock.elapsedTime
    if (group.current) group.current.rotation.y = Math.sin(t * 0.15) * 0.25
    if (arm.current) arm.current.rotation.z = -p * Math.PI * 2
    if (core.current) { const s = 0.55 + Math.sin(t * 2) * 0.03 + (p < 1 ? 0.04 : 0); core.current.scale.setScalar(s) }
    if (!mesh.current) return
    data.forEach((d, i) => {
      const f = i / BARS, ang = -f * Math.PI * 2 + Math.PI / 2
      const done = f <= p
      const near = Math.max(0, 1 - Math.abs(f - p) * 40)
      const h = done ? d.h * (1 + near * 0.6) : 0.12 + Math.sin(t * 3 + i) * 0.03
      const r = 2.2
      dummy.position.set(Math.cos(ang) * (r + h / 2), Math.sin(ang) * (r + h / 2), 0)
      dummy.rotation.set(0, 0, ang - Math.PI / 2)
      dummy.scale.set(1, h, 1)
      dummy.updateMatrix(); mesh.current!.setMatrixAt(i, dummy.matrix)
      col.copy(done ? (d.spk === 'M' ? M : D) : dim); if (near > 0) col.lerp(hot, near)
      mesh.current!.setColorAt(i, col)
    })
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
  })
  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[undefined, undefined, BARS]}>
        <boxGeometry args={[0.045, 1, 0.08]} />
        <meshStandardMaterial roughness={0.35} metalness={0.2} toneMapped={false} />
      </instancedMesh>
      <group ref={arm}>
        <mesh position={[0, 2.25, 0.05]}>
          <planeGeometry args={[0.03, 4.2]} />
          <meshBasicMaterial color="#F7BE4A" transparent opacity={0.85} toneMapped={false} />
        </mesh>
      </group>
      <Float speed={2} floatIntensity={0.6} rotationIntensity={0.6}>
        <mesh ref={core}>
          <icosahedronGeometry args={[1, 12]} />
          <MeshDistortMaterial color={progress >= 1 ? '#5FD3A1' : '#F7BE4A'} distort={progress >= 1 ? 0.2 : 0.42} speed={progress >= 1 ? 1 : 3} roughness={0.15} metalness={0.3} emissive={progress >= 1 ? '#1d4b38' : '#5a3a06'} />
        </mesh>
      </Float>
    </group>
  )
}

export function IndexingScene({ progress, className }: { progress: number; className?: string }) {
  return (
    <div className={className} aria-hidden>
      <Canvas dpr={[1, 1.75]} camera={{ position: [0, 0, 11.5], fov: 40 }} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={0.6} />
        <pointLight position={[3, 3, 5]} intensity={40} color="#ffffff" />
        <pointLight position={[-4, -2, 3]} intensity={25} color="#7CC4FF" />
        <WaveRing progress={progress} />
        <Sparkles count={40} scale={[9, 9, 3]} size={2} speed={0.3} opacity={0.4} color="#F7BE4A" />
      </Canvas>
    </div>
  )
}

/* ---------------- Agent orb: idles calmly, churns while planning ---------------- */
function Orb({ busy }: { busy: boolean }) {
  const ref = useRef<THREE.Mesh>(null)
  const mat = useRef<any>(null)
  useFrame((st, dt) => {
    if (ref.current) { ref.current.rotation.y += dt * (busy ? 1.6 : 0.3); ref.current.rotation.x += dt * (busy ? 0.7 : 0.1) }
    if (mat.current) { mat.current.distort += ((busy ? 0.55 : 0.25) - mat.current.distort) * Math.min(1, dt * 3); mat.current.speed = busy ? 5 : 1.5 }
  })
  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[1, 10]} />
      <MeshDistortMaterial ref={mat} color="#F7BE4A" emissive="#6b4304" roughness={0.2} metalness={0.4} distort={0.25} speed={1.5} />
    </mesh>
  )
}
export function AgentOrb({ busy, size = 34 }: { busy: boolean; size?: number }) {
  return (
    <div style={{ width: size, height: size }} aria-hidden>
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 3.1], fov: 45 }} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={0.6} />
        <pointLight position={[2, 2, 3]} intensity={30} />
        <pointLight position={[-2, -1, 2]} intensity={12} color="#7CC4FF" />
        <Orb busy={busy} />
      </Canvas>
    </div>
  )
}
