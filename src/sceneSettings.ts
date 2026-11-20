import { migrateRemovedCabinet } from './wardStorage.ts'
export type Vec3 = [number, number, number]
export interface ObjectSettings { position?: Vec3; scale?: number; hintColor?: string; hintScale?: number }
export interface SceneSettings {
  version: 1
  objects: Record<string, ObjectSettings>
  layouts?: Record<string, Record<string, ObjectSettings>>
  hintColor: string
  camera: { position: Vec3; target: Vec3; fov: number; eyeHeight: number }
}
export const SCENE_SETTINGS_KEY = 'careflow-scene-editor-v1'
export const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  version: 1, objects: {}, hintColor: '#ffbf00',
  camera: { position: [5.4, 6.4, 3.8], target: [.15, 1.3, -2.1], fov: 36, eyeHeight: 3.4 },
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const vector = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(n => finite(n, -100, 100))
const color = (v: unknown): v is string => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v)
export function parseSceneSettings(input: unknown): SceneSettings {
  if (!record(input) || input.version !== 1 || !record(input.objects)) throw new Error('Нужна конфигурация сцены версии 1.')
  const result = structuredClone(DEFAULT_SCENE_SETTINGS)
  if (input.layouts !== undefined) {
    if (!record(input.layouts)) throw new Error('Некорректные расстановки.')
    result.layouts = {}
    for (const [key, objects] of Object.entries(input.layouts)) {
      if (!['collapse', 'hypertension', 'chest-pain', 'syncope', 'anaphylaxis', 'abdomen'].includes(key)) throw new Error('Неизвестный кейс.')
      result.layouts[key] = parseSceneSettings({ version: 1, objects }).objects
    }
  }
  if (input.hintColor !== undefined) {
    if (!color(input.hintColor)) throw new Error('Некорректный цвет подсветки.')
    result.hintColor = input.hintColor
  }
  if (input.camera !== undefined) {
    const c = input.camera
    if (!record(c) || !vector(c.position) || !vector(c.target) || !finite(c.fov, 20, 80) || !finite(c.eyeHeight, 1.2, 4.5)) throw new Error('Проверьте положение камеры, угол обзора и высоту.')
    if (Math.hypot(...c.position.map((n, i) => n - (c.target as Vec3)[i])) < 0.1) throw new Error('Камера и точка взгляда должны различаться.')
    result.camera = { position: [...c.position], target: [...c.target], fov: c.fov, eyeHeight: c.eyeHeight }
  }
  if (Object.keys(input.objects).length > 300) throw new Error('Слишком много объектов в конфигурации.')
  for (const [id, item] of Object.entries(input.objects)) {
    if (!id || id.length > 180 || ['__proto__', 'prototype', 'constructor'].includes(id) || !record(item)) throw new Error('Некорректный объект в конфигурации.')
    const next: ObjectSettings = {}
    if (item.position !== undefined) { if (!vector(item.position)) throw new Error(`Проверьте координаты: ${id}.`); next.position = [...item.position] }
    if (item.scale !== undefined) { if (!finite(item.scale, 0.05, 5)) throw new Error(`Размер ${id}: от 5 до 500%.`); next.scale = item.scale }
    if (item.hintColor !== undefined) { if (!color(item.hintColor)) throw new Error(`Проверьте цвет: ${id}.`); next.hintColor = item.hintColor }
    if (item.hintScale !== undefined) { if (!finite(item.hintScale, 1, 3)) throw new Error(`Увеличение ${id}: от 1 до 3×.`); next.hintScale = id === 'patient' ? 1 : item.hintScale }
    result.objects[id] = next
  }
  return result
}
export function readSceneSettings(): SceneSettings {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(SCENE_SETTINGS_KEY)
      if (saved) {
        const settings = parseSceneSettings(JSON.parse(saved))
        if (JSON.stringify(settings.camera.position) === '[7.2,6.8,8.5]' && JSON.stringify(settings.camera.target) === '[0,1.2,0]' && settings.camera.fov === 36) {
          settings.camera = { ...structuredClone(DEFAULT_SCENE_SETTINGS.camera), eyeHeight: settings.camera.eyeHeight }
        }
        return migrateRemovedCabinet(settings)
      }
    }
  } catch { /* Invalid/old storage must not prevent opening the simulator. */ }
  const defaults = structuredClone(DEFAULT_SCENE_SETTINGS)
  try {
    const legacyHeight = Number(localStorage.getItem('careflow-first-person-camera-height-v2'))
    if (finite(legacyHeight, 1.2, 4.5)) defaults.camera.eyeHeight = legacyHeight
  } catch { /* Storage is optional. */ }
  return defaults
}
