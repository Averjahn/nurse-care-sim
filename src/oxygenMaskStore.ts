import { create } from 'zustand'

export const useOxygenMask = create<{ dragging: boolean; setDragging: (dragging: boolean) => void }>(set => ({
  dragging: false, setDragging: dragging => set({ dragging }),
}))
