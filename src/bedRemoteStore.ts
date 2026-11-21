import { create } from 'zustand'
import { actionMenu } from './actionMenu.ts'
import { useSimulationStore } from './store.ts'
import { requiredActions, type Attempt } from './simulation.ts'
import { actionById, type ActionId } from './scenario.ts'

export const BED_BUTTONS = [
  { id: 'supine', label: 'ЛЁЖА' }, { id: 'semi-sitting', label: '30–45°' },
  { id: 'legs-up', label: 'НОГИ ↑' }, { id: 'knees-up', label: 'КОЛЕНИ ↑' },
  { id: 'sitting', label: 'СИДЯ' }, { id: 'firm-surface', label: 'СЛР' },
] as const
export type BedButtonId = typeof BED_BUTTONS[number]['id']
export type RemotePhase = 'idle' | 'approaching' | 'ready' | 'pressing' | 'returning'
export const REMOTE_TIMING = { approach: .9, press: .28, return: 1.05 } as const
export function suggestedBedButton(a: Attempt | null): ActionId | undefined {
  return a ? requiredActions(a).find(id => actionById(id).target.object === 'bed-controls' && !a.completed.includes(id)) : undefined
}
interface BedRemoteState {
  session: number
  phase: RemotePhase
  attemptId: string
  fromFirstPerson: boolean
  action: BedButtonId | null
  open: (fromFirstPerson: boolean) => void
  arrived: () => void
  press: (id: BedButtonId) => void
  released: () => void
  cancel: () => void
  reset: () => void
}
export const useBedRemote = create<BedRemoteState>((set, get) => ({
  session: 0, phase: 'idle', attemptId: '', fromFirstPerson: false, action: null,
  open: fromFirstPerson => {
    const a = useSimulationStore.getState().attempt
    if (get().phase !== 'idle' || !a || !['active', 'arrest'].includes(a.phase) || a.paused) return
    set({ session: get().session + 1, phase: 'approaching', attemptId: a.id, fromFirstPerson, action: null })
  },
  arrived: () => { if (get().phase === 'approaching') set({ phase: 'ready' }) },
  press: action => {
    const a = useSimulationStore.getState().attempt
    if (get().phase !== 'ready' || !a || a.id !== get().attemptId || a.paused || !actionMenu(a, 'bed-controls').some(item => item.id === action)) return
    set({ phase: 'pressing', action })
  },
  released: () => { if (get().phase === 'pressing') set({ phase: 'returning' }) },
  cancel: () => { if (['approaching', 'ready'].includes(get().phase)) set({ phase: 'returning', action: null }) },
  reset: () => set({ phase: 'idle', attemptId: '', action: null, fromFirstPerson: false }),
}))
