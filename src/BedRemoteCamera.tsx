import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import { REMOTE_TIMING, useBedRemote, type BedButtonId, type RemotePhase } from './bedRemoteStore'
import { useSimulationStore } from './store'
import { useSceneEditor } from './sceneEditorStore'

interface Orbit { enabled: boolean; target: Vector3 }
interface View { position: Vector3; target: Vector3; fov: number; offsetX: number; offsetY: number }
interface Flight { original: View; close: View; from: View; to: View; phase: RemotePhase; elapsed: number; controlsEnabled: boolean }
const smooth = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x) }

export default function BedRemoteCamera({ onCommit }: { onCommit: (action: BedButtonId) => void }) {
  const flight = useRef<Flight | null>(null)
  useFrame(({ camera, controls, scene, size }, rawDelta) => {
    if (!(camera instanceof PerspectiveCamera)) return
    const remote = useBedRemote.getState(), attempt = useSimulationStore.getState().attempt, orbit = controls as unknown as Orbit | null
    const read = (): View => ({ position: camera.position.clone(), target: orbit?.target.clone() ?? camera.getWorldDirection(new Vector3()).multiplyScalar(3).add(camera.position), fov: camera.fov, offsetX: camera.view?.enabled ? camera.view.offsetX : 0, offsetY: camera.view?.enabled ? camera.view.offsetY : 0 })
    const apply = (from: View, to: View, t: number) => {
      camera.position.lerpVectors(from.position, to.position, t)
      const target = new Vector3().lerpVectors(from.target, to.target, t)
      camera.fov = from.fov + (to.fov - from.fov) * t
      camera.setViewOffset(size.width, size.height, from.offsetX + (to.offsetX - from.offsetX) * t, from.offsetY + (to.offsetY - from.offsetY) * t, size.width, size.height)
      camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld()
      orbit?.target.copy(target)
    }
    if (remote.phase !== 'idle' && (!attempt || attempt.id !== remote.attemptId || !['active', 'arrest'].includes(attempt.phase) || useSceneEditor.getState().open)) remote.reset()
    if (useBedRemote.getState().phase === 'idle') {
      if (flight.current) { apply(flight.current.original, flight.current.original, 1); if (orbit) orbit.enabled = flight.current.controlsEnabled; flight.current = null }
      return
    }
    if (!flight.current) {
      const panel = scene.getObjectByName('interaction-bed-controls')
      if (!panel) { remote.reset(); return }
      panel.updateWorldMatrix(true, false)
      const original = read(), scale = panel.getWorldScale(new Vector3()).length() / Math.sqrt(3)
      const target = panel.localToWorld(new Vector3(0, 0, .07)), normal = new Vector3(0, 0, 1).transformDirection(panel.matrixWorld)
      const distance = Math.max(.57, .42 / camera.aspect) * scale / (2 * Math.tan(42 * Math.PI / 360)) * 1.35
      const close: View = { position: target.clone().addScaledVector(normal, distance).add(new Vector3(0, .02 * scale, 0)), target, fov: 42, offsetX: 0, offsetY: 0 }
      flight.current = { original, close, from: original, to: close, phase: 'approaching', elapsed: 0, controlsEnabled: orbit?.enabled ?? true }
    }
    const f = flight.current
    if (orbit) orbit.enabled = false
    if (remote.phase !== f.phase) {
      f.phase = remote.phase; f.elapsed = 0; f.from = read()
      if (remote.phase === 'returning') {
        if (remote.action) {
          const saved = useSceneEditor.getState().settings.camera
          const fov = Math.min(75, 2 * Math.atan(Math.tan(saved.fov * Math.PI / 360) * Math.max(1, size.height / size.width)) * 180 / Math.PI)
          f.to = { position: new Vector3(...saved.position), target: new Vector3(...saved.target), fov, offsetX: size.width > 900 ? Math.min(340, size.width * .25) / 2 : 0, offsetY: 0 }
        } else f.to = f.original
      }
    }
    f.elapsed += Math.min(rawDelta, .1)
    if (remote.phase === 'approaching') {
      apply(f.from, f.close, smooth(f.elapsed / REMOTE_TIMING.approach))
      if (f.elapsed >= REMOTE_TIMING.approach) remote.arrived()
    } else if (remote.phase === 'ready' || remote.phase === 'pressing') {
      apply(f.close, f.close, 1)
      if (remote.phase === 'pressing' && f.elapsed >= REMOTE_TIMING.press) remote.released()
    } else if (remote.phase === 'returning') {
      apply(f.from, f.to, smooth(f.elapsed / REMOTE_TIMING.return))
      if (f.elapsed >= REMOTE_TIMING.return) {
        const action = remote.action
        if (orbit) orbit.enabled = f.controlsEnabled
        flight.current = null; remote.reset()
        if (action) onCommit(action)
      }
    }
  })
  return null
}
