import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Html } from '@react-three/drei'
import { createPortal, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Group, Matrix4, Plane, Vector3 } from 'three'
import { OxygenHose } from './oxygenHose'
import { useOxygenMask } from './oxygenMaskStore'
import { useSimulationStore } from './store'
import { useSceneEditor } from './sceneEditorStore'
import { BED_GEOMETRY, mattressHeight } from './bedKinematics'
import { useBedMotion } from './bedMotionContext'

const rings = 33, sides = 8
function hoseGeometry() {
  const geometry = new BufferGeometry(), indices: number[] = []
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(rings * sides * 3), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(rings * sides * 3), 3))
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + (j + 1) % sides, c = a + sides, d = b + sides
    indices.push(a, b, c, b, d, c)
  }
  geometry.setIndex(indices)
  return geometry
}

export default function OxygenMask({ dock, outlet }: { dock: RefObject<Group | null>; outlet: RefObject<Group | null> }) {
  const { scene, camera, gl, controls } = useThree()
  const motion = useBedMotion()
  const mask = useRef<Group>(null), dragging = useRef(false), pointer = useRef(-1)
  const frameDelta = useRef(1 / 60)
  const plane = useMemo(() => new Plane(), [])
  const [hovered, setHovered] = useState(false), [message, setMessage] = useState('')
  const isDragging = useOxygenMask(s => s.dragging)
  const attached = useSimulationStore(s => !!s.attempt?.completed.includes('oxygen'))
  const attemptId = useSimulationStore(s => s.attempt?.id)
  const rope = useMemo(() => new OxygenHose(rings), [])
  const lastAttempt = useRef<string | null>(null)
  const geometry = useMemo(() => hoseGeometry(), [])
  const scratch = useMemo(() => ({ start: new Vector3(), end: new Vector3(), target: new Vector3(), local: new Vector3(), direction: new Vector3(), tangent: new Vector3(), normal: new Vector3(), binormal: new Vector3(), up: new Vector3(0, 1, 0), bedInverse: new Matrix4(), bedWorld: new Matrix4() }), [])
  const stop = () => { dragging.current = false; pointer.current = -1; useOxygenMask.getState().setDragging(false) }
  useEffect(() => () => { useOxygenMask.getState().setDragging(false); document.body.style.cursor = '' }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(''), 4000); return () => clearTimeout(timer) }, [message])
  useEffect(() => {
    const cancel = () => { dragging.current = false; useOxygenMask.getState().setDragging(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape) }
  }, [])
  const face = () => scene.getObjectByName('oxygen-face-anchor')
  const usable = () => {
    const a = useSimulationStore.getState().attempt
    return !!a && a.phase === 'active' && !a.paused && !useSceneEditor.getState().open
  }
  const release = (event: ThreeEvent<PointerEvent>, cancelled = false) => {
    if (!dragging.current) return
    event.stopPropagation(); event.nativeEvent.preventDefault()
    const anchor = face()
    if (!cancelled && usable() && anchor) {
      anchor.getWorldPosition(scratch.target)
      outlet.current?.getWorldPosition(scratch.start)
      const reachable = scratch.target.distanceTo(scratch.start) < 3.45
      scratch.target.project(camera)
      const rect = gl.domElement.getBoundingClientRect()
      const x = rect.left + (scratch.target.x + 1) * rect.width / 2, y = rect.top + (1 - scratch.target.y) * rect.height / 2
      if (reachable && Math.hypot(event.clientX - x, event.clientY - y) <= Math.max(24, Math.min(50, rect.width * .045))) {
        useSimulationStore.getState().act('oxygen')
        if (!useSimulationStore.getState().attempt?.completed.includes('oxygen')) setMessage(useSimulationStore.getState().attempt?.feedback ?? '')
      } else setMessage(reachable ? 'Поднесите маску к лицу пациентки и отпустите.' : 'Шланг не дотягивается до лица пациентки.')
    }
    stop()
    ;(event.target as unknown as { releasePointerCapture: (id: number) => void })?.releasePointerCapture(event.pointerId)
  }
  useFrame((_, dt) => { frameDelta.current = dt })
  // Run after the patient mixer and bed contact have updated all bones for this frame.
  const updateHose = () => {
    const dt = frameDelta.current
    const root = mask.current, a = useSimulationStore.getState().attempt
    if (!root || !dock.current || !outlet.current) return
    if (a && !['active', 'arrest'].includes(a.phase)) { if (dragging.current) stop(); return }
    if (dragging.current && (!usable() || useSceneEditor.getState().open)) stop()
    const anchor = attached ? face() : dock.current
    if (!dragging.current && anchor) {
      anchor.updateWorldMatrix(true, false)
      anchor.getWorldPosition(root.position); anchor.getWorldQuaternion(root.quaternion)
    }
    root.userData.maskState = dragging.current ? 'dragging' : attached ? 'attached' : 'docked'
    root.updateMatrixWorld(true)
    outlet.current.getWorldPosition(scratch.start)
    scratch.end.set(0, -.065, .065); root.localToWorld(scratch.end)
    if (lastAttempt.current !== (attemptId ?? 'preview')) { rope.reset(scratch.start, scratch.end); lastAttempt.current = attemptId ?? 'preview' }
    const bed = motion?.current.frame
    if (bed) { bed.updateWorldMatrix(true, false); scratch.bedWorld.copy(bed.matrixWorld); scratch.bedInverse.copy(bed.matrixWorld).invert() }
    const collide = (point: Vector3) => {
      if (!bed || !motion) return
      scratch.local.copy(point).applyMatrix4(scratch.bedInverse)
      if (Math.abs(scratch.local.x) > BED_GEOMETRY.width / 2) return
      const height = mattressHeight(scratch.local.z, motion.current.angles)
      const body = Math.abs(scratch.local.x) < .32 && scratch.local.z > -1.4 && scratch.local.z < 1.1 ? .32 : .025
      if (height !== null && scratch.local.y < height + body) {
        scratch.local.y = height + body; point.copy(scratch.local).applyMatrix4(scratch.bedWorld)
      }
    }
    if (!a?.paused && !useSceneEditor.getState().open) rope.step(scratch.start, scratch.end, dt, collide)
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal')
    for (let i = 0; i < rings; i++) {
      scratch.tangent.subVectors(rope.points[Math.min(rings - 1, i + 1)], rope.points[Math.max(0, i - 1)]).normalize()
      scratch.normal.crossVectors(scratch.tangent, Math.abs(scratch.tangent.y) > .98 ? scratch.direction.set(1, 0, 0) : scratch.up).normalize()
      scratch.binormal.crossVectors(scratch.tangent, scratch.normal).normalize()
      for (let j = 0; j < sides; j++) {
        const angle = j / sides * Math.PI * 2, nx = scratch.normal.x * Math.cos(angle) + scratch.binormal.x * Math.sin(angle), ny = scratch.normal.y * Math.cos(angle) + scratch.binormal.y * Math.sin(angle), nz = scratch.normal.z * Math.cos(angle) + scratch.binormal.z * Math.sin(angle), p = rope.points[i]
        positions.setXYZ(i * sides + j, p.x + nx * .007, p.y + ny * .007, p.z + nz * .007)
        normals.setXYZ(i * sides + j, nx, ny, nz)
      }
    }
    positions.needsUpdate = true; normals.needsUpdate = true
  }
  return createPortal(<group name="oxygen-mask-assembly">
    <mesh name="oxygen-delivery-hose" geometry={geometry} onBeforeRender={updateHose} frustumCulled={false} raycast={() => {}}><meshStandardMaterial color="#75bdb5" roughness={.4}/></mesh>
    <group ref={mask} name="oxygen-mask" userData={{ emergencyObject: 'oxygen', maskState: isDragging ? 'dragging' : attached ? 'attached' : 'docked' }}
      onPointerDown={event => {
        event.stopPropagation(); event.nativeEvent.preventDefault()
        if (!usable() || attached || !face()) return
        if (document.pointerLockElement) document.exitPointerLock()
        camera.getWorldDirection(scratch.direction); face()!.getWorldPosition(scratch.target)
        plane.setFromNormalAndCoplanarPoint(scratch.direction, scratch.target)
        dragging.current = true; pointer.current = event.pointerId; setMessage('')
        useOxygenMask.getState().setDragging(true)
        if (controls) Reflect.set(controls, 'enabled', false)
        ;(event.target as unknown as { setPointerCapture: (id: number) => void })?.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        if (!dragging.current || pointer.current !== event.pointerId || !mask.current) return
        event.stopPropagation()
        if (event.ray.intersectPlane(plane, scratch.target)) {
          outlet.current?.getWorldPosition(scratch.start)
          scratch.target.sub(scratch.start).clampLength(0, 3.4).add(scratch.start)
          mask.current.position.copy(scratch.target); mask.current.quaternion.copy(camera.quaternion)
        }
      }}
      onPointerUp={event => release(event)} onPointerCancel={event => release(event, true)}
      onLostPointerCapture={() => stop()}
      onClick={event => { event.stopPropagation(); event.nativeEvent.preventDefault() }}
      onPointerOver={event => { event.stopPropagation(); setHovered(true); document.body.style.cursor = attached ? 'default' : 'grab' }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}>
      <mesh scale={[.062, .082, .04]}><sphereGeometry args={[1, 20, 14]}/><meshStandardMaterial color="#c7f2eb" transparent opacity={.55} depthWrite={false} roughness={.25}/></mesh>
      <mesh scale={[.061, .081, .061]}><torusGeometry args={[1, .055, 6, 32]}/><meshStandardMaterial color="#8acac0"/></mesh>
      <mesh position={[0, -.065, .052]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.013, .013, .03, 12]}/><meshStandardMaterial color="#8acac0"/></mesh>
      {[-1, 1].map(side => <mesh key={side} position={[side * .065, .015, -.025]} rotation={[0, side * -.55, 0]}><boxGeometry args={[.012, .013, .10]}/><meshStandardMaterial color="#6eaea5"/></mesh>)}
      <mesh><sphereGeometry args={[.13, 10, 8]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>
      {(hovered || message || isDragging) && <Html position={[0, .18, 0]} center style={{ pointerEvents: 'none' }}><span className="scene-label">{message || (attached ? 'Кислородная маска закреплена' : isDragging ? 'Отпустите маску у лица пациентки' : 'Перетащите маску на лицо пациентки')}</span></Html>}
    </group>
  </group>, scene)
}
