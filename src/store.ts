import { create } from 'zustand'
import { createAttempt, performAction, tickAttempt, type Attempt, type AttemptOptions } from './simulation.ts'
import type { ActionId, CaseId } from './scenario.ts'
export type { PatientState } from './simulation.ts'

interface SimulationStore {
  attempt: Attempt | null
  start: (caseId: CaseId, options?: AttemptOptions) => void
  act: (action: ActionId, realNowMs?: number) => void
  tick: (deltaSec: number) => void
  pause: () => void
  leave: () => void
}
export const useSimulationStore = create<SimulationStore>((set) => ({
  attempt: null,
  start: (caseId, options) => set({ attempt: createAttempt(caseId, options) }),
  act: (action, realNowMs) => set(current => ({ attempt: current.attempt ? performAction(current.attempt, action, realNowMs) : null })),
  tick: (deltaSec) => set(current => ({ attempt: current.attempt ? tickAttempt(current.attempt, deltaSec) : null })),
  pause: () => set(current => ({ attempt: current.attempt?.mode === 'training' ? { ...current.attempt, paused: !current.attempt.paused } : current.attempt })),
  leave: () => set({ attempt: null }),
}))
