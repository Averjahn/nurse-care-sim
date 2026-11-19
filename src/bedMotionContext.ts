import { createContext, useContext } from 'react'
import type { Group } from 'three'
import type { BedAngles } from './bedKinematics'
export interface BedMotion { angles: BedAngles; frame: Group | null }
export const BedMotionContext = createContext<{ current: BedMotion } | null>(null)
export const useBedMotion = () => useContext(BedMotionContext)
