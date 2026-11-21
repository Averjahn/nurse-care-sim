import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { DoubleSide, Group, SkinnedMesh } from 'three'
import { useBedMotion } from './bedMotionContext'
import { BlanketFit, createBlanketGeometry } from './blanketGeometry'

export default function PatientBlanket({ folded, lowerOnly }: { folded: boolean; lowerOnly: boolean }) {
  const motion = useBedMotion(), root = useRef<Group>(null)
  const geometry = useMemo(() => createBlanketGeometry(), [])
  const fitter = useMemo(() => new BlanketFit(), [])
  const fit = useCallback((mesh?: SkinnedMesh, samples?: Uint32Array) => {
    const group = root.current, frame = motion?.current.frame
    if (!group || !frame) return
    let ancestor: Group['parent'] = group
    while (ancestor) { if (!ancestor.visible) return; ancestor = ancestor.parent }
    fitter.fit(geometry, group, frame, motion!.current.angles, folded ? undefined : mesh, folded ? undefined : samples, lowerOnly)
  }, [fitter, geometry, motion, folded, lowerOnly])
  useLayoutEffect(() => {
    if (!motion) return
    const state = motion.current
    // Shared mutable animation context, updated after the rig's contact solver.
    // oxlint-disable-next-line react/immutability
    state.fitBlanket = fit
    return () => { if (state.fitBlanket === fit) delete state.fitBlanket }
  }, [motion, fit])
  useFrame(() => { if (!motion?.current.patientReady || folded) fit() })
  useEffect(() => () => geometry.dispose(), [geometry])
  return <group ref={root} name="patient-blanket"><mesh name="fitted-patient-blanket" geometry={geometry} castShadow receiveShadow>
    <meshStandardMaterial color="#b9d1d5" roughness={.96} side={DoubleSide}/>
  </mesh></group>
}
