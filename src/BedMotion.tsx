import { useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { useSimulationStore } from './store'
import { useSceneEditor } from './sceneEditorStore'
import { interpolateBed, positionForBed, targetBedAngles } from './bedKinematics'
import { BedMotionContext as Context, type BedMotion } from './bedMotionContext'
export function BedMotionProvider({ children }: { children: ReactNode }) {
  const motion = useRef<BedMotion>({ angles: targetBedAngles('supine'), frame: null })
  const transition = useRef({ from: targetBedAngles('supine'), to: targetBedAngles('supine'), progress: 1, position: 'supine', attempt: '' })
  useFrame((_, dt) => {
    const a = useSimulationStore.getState().attempt, t = transition.current
    if (a && !['active', 'arrest'].includes(a.phase)) return
    const position = positionForBed(a?.patient)
    if (t.attempt !== (a?.id ?? '')) {
      t.attempt = a?.id ?? ''; t.position = position; t.to = targetBedAngles(position); t.from = t.to; t.progress = 1
    } else if (position !== t.position) {
      t.from = { ...motion.current.angles }; t.to = targetBedAngles(position); t.progress = 0; t.position = position
    }
    if (!a?.paused && !useSceneEditor.getState().open) t.progress = Math.min(1, t.progress + Math.min(dt, .5) * (a?.speed ?? 1) / 2)
    motion.current.angles = interpolateBed(t.from, t.to, t.progress)
  }, -2)
  return <Context.Provider value={motion}>{children}</Context.Provider>
}
