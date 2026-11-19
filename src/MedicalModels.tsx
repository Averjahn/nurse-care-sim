import { useMemo, useRef, useEffect } from 'react'
import { Line } from '@react-three/drei'
import { createPortal, useFrame } from '@react-three/fiber'
import { CanvasTexture, Group, LinearFilter, MathUtils } from 'three'
import { useSimulationStore } from './store'
import { useSceneEditor } from './sceneEditorStore'
import { drawMonitor, pulseWave } from './pulseWave'
import type { ObjectId } from './scenario'

function Box({ size, at = [0, 0, 0], color = '#e3edeb' }: { size: [number, number, number]; at?: [number, number, number]; color?: string }) {
  return <mesh position={at}><boxGeometry args={size}/><meshStandardMaterial color={color} roughness={.65}/></mesh>
}
function Rod({ at, height, radius = .018, color = '#a6b8b7' }: { at: [number, number, number]; height: number; radius?: number; color?: string }) {
  return <mesh position={at}><cylinderGeometry args={[radius, radius, height, 10]}/><meshStandardMaterial color={color} metalness={.35}/></mesh>
}
function DeviceReadout({ value, width, depth, y }: { value: string; width: number; depth: number; y: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128
    return new CanvasTexture(canvas)
  }, [])
  useEffect(() => {
    const ctx = (texture.image as HTMLCanvasElement).getContext('2d')!
    ctx.fillStyle = '#102e34'; ctx.fillRect(0, 0, 256, 128)
    ctx.fillStyle = '#a5f7d4'; ctx.font = 'bold 48px monospace'; ctx.textAlign = 'center'
    ctx.fillText(value, 128, 83)
    // Three.js owns this mutable GPU resource.
    // eslint-disable-next-line react/immutability
    texture.needsUpdate = true
  }, [texture, value])
  useEffect(() => () => texture.dispose(), [texture])
  return <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[width, depth]}/><meshBasicMaterial map={texture} toneMapped={false}/></mesh>
}
function ECGPaper() {
  const points = useMemo(() => Array.from({ length: 120 }, (_, i) => [-.11 + i / 119 * .22, .085, .29 - pulseWave(i / 119 * 2, 80) * .045] as [number, number, number]), [])
  return <group><Box size={[.27, .005, .34]} at={[.17, .08, .29]} color="#fff1eb"/><group position={[.17, 0, 0]}><Line points={points} color="#a65369" lineWidth={1}/></group></group>
}
export function MonitorScreen() {
  const attempt = useSimulationStore(s => s.attempt)
  const editor = useSceneEditor(s => s.open)
  const time = useRef(0), redraw = useRef(0)
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 560; canvas.height = 170
    const map = new CanvasTexture(canvas); map.minFilter = LinearFilter; map.generateMipmaps = false
    return map
  }, [])
  useEffect(() => () => texture.dispose(), [texture])
  useFrame((_, dt) => {
    if (!editor && !attempt?.paused) time.current += dt
    redraw.current += dt
    if (redraw.current < 1 / 30) return
    redraw.current = 0
    const ctx = (texture.image as HTMLCanvasElement).getContext('2d')!
    const connected = !!attempt?.completed.includes('connect-monitor')
    drawMonitor(ctx, 560, 170, time.current, attempt?.patient.pulse ?? 0, connected, attempt?.completed.includes('saturation') && attempt.patient.pulse > 0 ? Math.round(attempt.patient.spo2) : undefined, attempt?.measurement?.sbp)
    // Three.js owns this mutable GPU resource.
    // eslint-disable-next-line react/immutability
    texture.needsUpdate = true
  })
  return <mesh position={[0, .04, .122]}><planeGeometry args={[.46, .2]}/><meshBasicMaterial map={texture} toneMapped={false}/></mesh>
}
export function MedicalModel({ id }: { id: ObjectId }) {
  const attempt = useSimulationStore(s => s.attempt)
  const done = (action: string) => !!attempt?.completed.some(id => id === action)
  if (id === 'medications') return <group><Box size={[.42, .035, .3]} at={[0, -.05, 0]} color="#729999"/>{[-.12, .02, .14].map((x, i) => <group key={x}><Rod at={[x, .025, 0]} height={.11} radius={.034} color={['#bd9373', '#eef0d9', '#d0dfdb'][i]}/><Rod at={[x, .09, 0]} height={.025} radius={.037} color="#eff0e5"/><Box size={[.046, .03, .006]} at={[x, .03, .034]} color={["#cc8a72", "#76a9b8", "#bca76b"][i]}/></group>)}</group>
  if (id === 'oxygen') return <group><Rod at={[0, -.18, 0]} height={.56} radius={.095} color="#d3e5df"/><Rod at={[0, .15, 0]} height={.1} radius={.035}/><Rod at={[.14, .05, 0]} height={.16} radius={.046} color="#b4d9e0"/><Box size={[.14, .025, .025]} at={[.07, .14, 0]} color="#719b98"/><mesh position={[.09, .19, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.045, .045, .02, 12]}/><meshStandardMaterial color={done('oxygen') ? '#64c798' : '#edf0e5'}/></mesh><mesh position={[-.13, -.37, .1]} scale={[.7, .45, 1]}><sphereGeometry args={[.1, 12, 8]}/><meshStandardMaterial color="#aed9dc" transparent opacity={.75}/></mesh></group>
  if (id === 'monitor') return <group><Box size={[.54, .34, .24]}/><MonitorScreen/><Box size={[.28, .035, .28]} at={[0, -.187, 0]} color="#617f85"/><Box size={[.07, .025, .03]} at={[.19, -.105, .13]} color={done('connect-monitor') ? '#3edb8b' : '#8a9f9e'}/><mesh position={[-.25, -.08, .16]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.065, .018, 6, 16]}/><meshStandardMaterial color="#657f91"/></mesh></group>
  if (id === 'thermometer') return <group><Box size={[.29, .045, .055]}/><group position={[.025, 0, 0]}><DeviceReadout value={attempt?.temperatureMeasurement?.value.toFixed(1) ?? '--'} width={.095} depth={.035} y={.026}/></group><Box size={[.07, .023, .025]} at={[-.17, 0, 0]} color="#b5c4ca"/></group>
  if (id === 'pulseox') return <group><Box size={[.1, .07, .16]} color="#6d9db0"/><Box size={[.085, .028, .14]} at={[0, -.052, .012]}/><DeviceReadout value={done('saturation') && attempt!.patient.pulse > 0 ? `${Math.round(attempt!.patient.spo2)}%` : '--'} width={.075} depth={.09} y={.038}/></group>
  if (id === 'ecg-device') return <group><Box size={[.65, .15, .42]}/><Box size={[.28, .09, .22]} at={[-.12, .11, -.06]} color="#284d59"/>{[-.12, -.04, .04, .12].map(x => <Box key={x} size={[.03, .01, .03]} at={[x, .08, .13]} color="#719b9c"/>)}{done('ecg') && <ECGPaper/>}</group>
  if (id === 'shock-kit') return <group><Box size={[.56, .14, .32]} color="#ba5452"/><group position={[0, .07, -.16]} rotation={[done('adrenaline') ? -1.3 : -.15, 0, 0]}><Box size={[.56, .04, .32]} at={[0, .02, .16]} color="#ca6961"/><Box size={[.16, .005, .045]} at={[0, .043, .16]}/><Box size={[.045, .005, .16]} at={[0, .043, .16]}/></group>{[-.16, -.06, .06, .16].map(x => <Rod key={x} at={[x, .1, .03]} height={.1} radius={.017} color="#d4e2d9"/>)}</group>
  if (id === 'iv-stand') return <group><Rod at={[0, 1.25, 0]} height={2.1}/>{[0, 1, 2, 3, 4].map(i => <group key={i} rotation={[0, i * Math.PI * .4, 0]}><Box size={[.045, .045, .65]} at={[0, .25, .2]} color="#8baba9"/><mesh position={[0, .14, .43]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.07, .07, .045, 12]}/><meshStandardMaterial color="#4c656b"/></mesh></group>)}<Box size={[.43, .025, .025]} at={[0, 2.3, 0]}/><Box size={[.22, .35, .09]} at={[.18, 1.99, 0]} color="#c8e5e4"/><Box size={[.24, .22, .14]} at={[0, 1.45, 0]} color="#e3ece8"/><Box size={[.13, .08, .012]} at={[0, 1.46, .08]} color={done('stop-infusion') ? '#bd755f' : '#62ada7'}/><Rod at={[.18, 1.35, 0]} height={.92} radius={.006} color="#bed6d6"/></group>
  if (id === 'ice-pack') return <group><mesh scale={[1, .4, 1]}><sphereGeometry args={[.18, 16, 10]}/><meshStandardMaterial color="#7caac5"/></mesh><Rod at={[0, .09, 0]} height={.045} radius={.05} color="#d9e7e5"/></group>
  if (id === 'analgesics') return <group><Box size={[.22, .065, .13]} color="#e9ebe1"/>{[-.06, .02, .07].map(x => <mesh key={x} position={[x, .036, 0]}><sphereGeometry args={[.017, 8, 6]}/><meshStandardMaterial color="#d2b5a7"/></mesh>)}</group>
  if (id === 'enema-kit') return <group><mesh scale={[1, 1.3, .7]}><sphereGeometry args={[.09, 12, 8]}/><meshStandardMaterial color="#aa85aa"/></mesh><Rod at={[0, .17, 0]} height={.17} radius={.016}/></group>
  if (id === 'food-water') return <group><Rod at={[0, .07, 0]} height={.14} radius={.055} color="#bfdce3"/><Box size={[.19, .045, .14]} at={[.18, .025, 0]} color="#dcbd91"/></group>
  return null
}
export function TreatmentCart() {
  return <group name="treatment-cart" position={[0, 0, 0]}>{[.55, 1.05].map(y => <Box key={y} size={[1.35, .055, .65]} at={[0, y, 0]}/>)}{[-.6, .6].flatMap(x => [-.25, .25].map(z => <group key={`${x}-${z}`}><Rod at={[x, .62, z]} height={.98}/><mesh position={[x, .06, z]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.065, .065, .04, 10]}/><meshStandardMaterial color="#5d7177"/></mesh></group>))}</group>
}
/** A lightweight authored bed with three independent sections. */
export function FunctionalBed() {
  const patient = useSimulationStore(s => s.attempt?.patient)
  const paused = useSimulationStore(s => s.attempt?.paused)
  const editor = useSceneEditor(s => s.open)
  const head = useRef<Group>(null), thigh = useRef<Group>(null), shin = useRef<Group>(null)
  useFrame((_, dt) => {
    if (paused || editor) return
    if (head.current) head.current.rotation.x = MathUtils.damp(head.current.rotation.x, patient?.position === 'semiSitting' ? .65 : 0, 4, dt)
    if (thigh.current) thigh.current.rotation.x = MathUtils.damp(thigh.current.rotation.x, patient?.position === 'kneesUp' ? -.65 : patient?.position === 'legsUp' ? -.3 : 0, 4, dt)
    if (shin.current) shin.current.rotation.x = MathUtils.damp(shin.current.rotation.x, patient?.position === 'kneesUp' ? 1.3 : 0, 4, dt)
  })
  const cushion = (length: number, z: number) => <><Box size={[1.02, .14, length]} at={[0, 0, z]} color="#dce7df"/><Box size={[1.08, .055, length]} at={[0, -.105, z]} color="#78959a"/></>
  return <group name="functional-bed" position={[-.274, 1.43, -2.2713]}>
    <Box size={[1.12, .16, 2.5]} at={[0, -.32, 0]} color="#879c9e"/>
    <group name="Bed_Head" ref={head} position={[0, 0, -.05]}>{cushion(1.2, -.6)}{patient?.position !== 'legsUp' && patient?.breathing !== false && <Box size={[.65, .1, .32]} at={[0, .1, -.98]} color="#f2f4eb"/>}</group>
    <group name="Bed_Knee" ref={thigh} position={[0, 0, -.05]}>{cushion(.64, .32)}<group name="Bed_FootEnd" ref={shin} position={[0, 0, .64]}>{cushion(.64, .32)}</group></group>
    {[-.43, .43].flatMap(x => [-.95, .95].map(z => <group key={`${x}-${z}`}><Rod at={[x, -.8, z]} height={.85}/><mesh position={[x, -1.13, z]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.1, .1, .06, 12]}/><meshStandardMaterial color="#556a70"/></mesh></group>))}
    {[-1.37, 1.37].map(z => <Box key={z} size={[1.12, .5, .075]} at={[0, .03, z]} color="#b2d3d3"/>)}
    {[-.57, .57].map(x => <Box key={x} size={[.055, .1, 1.75]} at={[x, .1, 0]} color="#f3f4ea"/>)}
  </group>
}

/** Accessories are attached to rig bones so they follow the posture without raycasting the skin. */
function AccessoryPortal({ target, visible, children }: { target: import('three').Object3D; visible: boolean; children: import('react').ReactNode }) {
  return createPortal(<group name="medical-accessory" visible={visible}>{children}</group>, target)
}
export function PatientAccessories({ object }: { object: import('three').Object3D }) {
  const attempt = useSimulationStore(s => s.attempt)
  const mounts = useMemo(() => ({
    head: object.getObjectByName('mixamorigHead') ?? object.getObjectByName('mixamorig:Head'),
    chest: object.getObjectByName('mixamorigSpine2') ?? object.getObjectByName('mixamorig:Spine2'),
    arm: object.getObjectByName('mixamorigLeftForeArm') ?? object.getObjectByName('mixamorig:LeftForeArm'),
    hand: object.getObjectByName('mixamorigRightHand') ?? object.getObjectByName('mixamorig:RightHand'),
    hips: object.getObjectByName('mixamorigHips') ?? object.getObjectByName('mixamorig:Hips'),
  }), [object])
  // Portal geometry into the bones; React removes and disposes it with the actor.
  return <>
    {mounts.head && <AccessoryPortal target={mounts.head} visible={!!attempt?.completed.includes('oxygen')}><mesh position={[0, .035, .105]} scale={[.7, 1, .5]}><sphereGeometry args={[.073, 12, 10]}/><meshStandardMaterial color="#b1dfe0" transparent opacity={.8}/></mesh><Rod at={[.065, -.04, .07]} height={.22} radius={.006} color="#abd8d6"/></AccessoryPortal>}
    {mounts.chest && <AccessoryPortal target={mounts.chest} visible={!!attempt?.completed.includes('attach-electrodes')}>{[-.09, .09].flatMap(x => [0, .08].map(y => <mesh key={`${x}-${y}`} position={[x, y, .09]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.022, .022, .008, 10]}/><meshStandardMaterial color="#f1e8ca"/></mesh>))}</AccessoryPortal>}
    {mounts.arm && <AccessoryPortal target={mounts.arm} visible={attempt?.caseId === 'anaphylaxis' && attempt.patient.injectionRoute === 'intravenous'}><Box size={[.06, .09, .008]} at={[0, .1, .06]} color="#f2e9ce"/><Rod at={[0, .1, .07]} height={.05} radius={.008} color="#6ca8b2"/></AccessoryPortal>}
    {mounts.hand && <AccessoryPortal target={mounts.hand} visible={!!attempt?.completed.includes('saturation')}><Box size={[.038, .04, .06]} at={[0, .06, .02]} color="#5e9dab"/></AccessoryPortal>}
    {mounts.hips && <AccessoryPortal target={mounts.hips} visible={!!attempt?.completed.includes('ice')}><Box size={[.22, .18, .035]} at={[0, .13, .12]} color="#8cb8cd"/></AccessoryPortal>}
  </>
}
