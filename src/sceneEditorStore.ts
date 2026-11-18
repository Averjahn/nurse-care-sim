import { create } from 'zustand'
import type { Object3D } from 'three'
import { DEFAULT_SCENE_SETTINGS, SCENE_SETTINGS_KEY, parseSceneSettings, readSceneSettings, type ObjectSettings, type SceneSettings, type Vec3 } from './sceneSettings.ts'

export interface EditorTarget { id: string; label: string; object: Object3D; position: Vec3; localPosition: Vec3; localScale: Vec3; hintScale: number }
interface EditorState {
  open: boolean; selected: string; preview: boolean; settings: SceneSettings
  dragging: boolean; selectionBlockedUntil: number
  targets: Record<string, EditorTarget>; undoStack: SceneSettings[]; redoStack: SceneSettings[]; storageError: string
  captureView: (() => SceneSettings['camera']) | null
  toggle: () => void; select: (id: string) => void; setPreview: (value: boolean) => void
  register: (target: EditorTarget) => void; unregister: (id: string, object: Object3D) => void
  updateObject: (id: string, patch: ObjectSettings, field?: string) => void
  updateCamera: (patch: Partial<SceneSettings['camera']>) => void; setHintColor: (color: string) => void
  resetObject: (id: string) => void; resetAll: () => void; undo: () => void; redo: () => void
  importSettings: (input: unknown) => void
}
let lastEdit = { key: '', time: 0 }
function persist(settings: SceneSettings) {
  try { localStorage.setItem(SCENE_SETTINGS_KEY, JSON.stringify(settings)); return '' }
  catch { return 'Сохранение в браузере недоступно. Скопируйте настройки перед закрытием.' }
}
export const useSceneEditor = create<EditorState>((set, get) => {
  const commit = (settings: SceneSettings, key = '') => {
    const state = get(), now = Date.now()
    if (JSON.stringify(settings) === JSON.stringify(state.settings)) return
    settings = {
      ...settings,
      camera: JSON.stringify(settings.camera) === JSON.stringify(state.settings.camera) ? state.settings.camera : settings.camera,
      objects: Object.fromEntries(Object.entries(settings.objects).map(([id, value]) => [id, JSON.stringify(value) === JSON.stringify(state.settings.objects[id]) ? state.settings.objects[id] : value])),
    }
    const merge = Boolean(key && key === lastEdit.key && now - lastEdit.time < 800)
    lastEdit = { key, time: now }
    set({ settings, undoStack: merge ? state.undoStack : [...state.undoStack, state.settings].slice(-50), redoStack: [], storageError: persist(settings) })
  }
  return {
    open: false, selected: 'patient', preview: true, settings: readSceneSettings(), dragging: false, selectionBlockedUntil: 0, targets: {}, undoStack: [], redoStack: [], storageError: '', captureView: null,
    toggle: () => set(s => ({ open: !s.open })), select: selected => set({ selected }), setPreview: preview => set({ preview }),
    register: target => set(s => ({ targets: { ...s.targets, [target.id]: target } })),
    unregister: (id, object) => set(s => {
      if (s.targets[id]?.object !== object) return s
      const targets = { ...s.targets }; delete targets[id]; return { targets }
    }),
    updateObject: (id, patch, field = Object.keys(patch).join(',')) => {
      const current = get().settings
      commit(parseSceneSettings({ ...current, objects: { ...current.objects, [id]: { ...current.objects[id], ...patch } } }), `${id}:${field}`)
    },
    updateCamera: patch => { const s = get().settings; commit(parseSceneSettings({ ...s, camera: { ...s.camera, ...patch } }), 'camera') },
    setHintColor: hintColor => commit(parseSceneSettings({ ...get().settings, hintColor }), 'hint-color'),
    resetObject: id => { const s = get().settings, objects = { ...s.objects }; delete objects[id]; commit({ ...s, objects }) },
    resetAll: () => commit(structuredClone(DEFAULT_SCENE_SETTINGS)),
    undo: () => {
      const s = get(), settings = s.undoStack.at(-1); if (!settings) return
      lastEdit.key = ''; set({ settings, undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, s.settings], storageError: persist(settings) })
    },
    redo: () => {
      const s = get(), settings = s.redoStack.at(-1); if (!settings) return
      lastEdit.key = ''; set({ settings, redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, s.settings], storageError: persist(settings) })
    },
    importSettings: input => commit(parseSceneSettings(input)),
  }
})

/** A drag release may also emit a click on geometry behind the gizmo. */
export function selectEditorSceneObject(id: string) {
  const state = useSceneEditor.getState()
  if (!state.dragging && Date.now() >= state.selectionBlockedUntil) state.select(id)
}
