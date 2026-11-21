import { createContext, useContext } from 'react'
import type { Group, SkinnedMesh } from 'three'
import type { BedAngles } from './bedKinematics'
export interface BedMotion { angles: BedAngles; frame: Group | null; patientReady?: boolean; fitBlanket?: (mesh?: SkinnedMesh, samples?: Uint32Array) => void }
export const BedMotionContext = createContext<{ current: BedMotion } | null>(null)
export const useBedMotion = () => useContext(BedMotionContext)
