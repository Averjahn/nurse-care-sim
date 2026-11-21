import type { ObjectSettings, SceneSettings } from './sceneSettings.ts'

export const DEFAULT_HINT_COLOR = '#FFD500'
export const SCENE_PRESET_REVISION = 2
export const CAMERA_PRESET: SceneSettings['camera'] = { position: [5.02, 6.37, 3.8], target: [1.09, 2.12, -2.1], fov: 36, eyeHeight: 3.4 }
export const COLLAPSE_LAYOUT: Record<string, ObjectSettings> = {
  'call-bell': { position: [0.8797297328762567, 1.2138771338025447, -2.0341672444288825] },
  oxygen: { position: [1.2257576631881326, 0.654, -3.5592940517211016] },
  sink: { position: [-3.75, 1.0169459520697726, -2.4904704470556362] },
  'enema-kit': { hintScale: 2 },
  'ice-pack': { hintScale: 2 },
  'bag-mask': { hintScale: 2 },
  'food-water': { hintScale: 2 },
  equipment: { hintScale: 2 },
  injection: { hintScale: 2 },
  analgesics: { hintScale: 2 },
  pulseox: { scale: 1, hintScale: 2 },
  glucometer: { hintScale: 2 },
  tonometer: { hintScale: 1.6 },
  chart: { position: [3.3514625145603754, 1.0175, -3.62], hintScale: 1.5 },
  medications: { hintScale: 1.5 },
  'iv-stand': { hintScale: 1.05 },
  monitor: { hintScale: 1.15 },
}

/** Apply this release once; subsequent editor changes remain editable. */
export function applyScenePreset(settings: SceneSettings) {
  const revision = settings.presetRevision ?? 0
  if (revision < 1) {
    settings.hintColor = DEFAULT_HINT_COLOR
    for (const objects of [settings.objects, ...Object.values(settings.layouts ?? {})]) {
      for (const object of Object.values(objects)) delete object.hintColor
    }
    const collapse = { ...settings.layouts?.collapse }
    for (const [id, patch] of Object.entries(COLLAPSE_LAYOUT)) collapse[id] = { ...collapse[id], ...structuredClone(patch) }
    settings.layouts = { ...settings.layouts, collapse }
  }
  if (revision < 2) settings.camera = structuredClone(CAMERA_PRESET)
  settings.presetRevision = SCENE_PRESET_REVISION
  return settings
}
