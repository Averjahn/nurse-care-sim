import type { Vec3, SceneSettings } from './sceneSettings.ts'

export const WALL_STORAGE_POSITIONS: Record<string, Vec3> = {
  'aed-device': [1.4, 2.3, -3.90271],
  tonometer: [3.95, 1.08, -3.68],
  thermometer: [2.95, 1.8225, -3.36],
  pulseox: [3.5, 1.866, -3.38],
  'food-water': [-3.88, 1.825, -3.62],
}

/** Retire placements on the removed cabinet, preserving unrelated custom layouts. */
export function migrateRemovedCabinet(settings: SceneSettings) {
  for (const objects of [settings.objects, ...Object.values(settings.layouts ?? {})]) {
    for (const [id, position] of Object.entries(WALL_STORAGE_POSITIONS)) {
      const old = objects[id]?.position
      if (!old) continue
      const onCabinet = id !== 'aed-device' && old[0] >= 1.1 && old[0] <= 2.3 && old[1] >= 1.2 && old[1] <= 2.1 && old[2] >= -3 && old[2] <= -1.7
      const onShelf = id === 'aed-device' && old[1] < 1.9 && old[2] < -3.2
      if (onCabinet || onShelf) objects[id] = { ...objects[id], position: [...position] }
    }
  }
  return settings
}

/** Ground the new caster-mounted model at the former published bottle placement. */
export function migrateOxygenConcentrator(settings: SceneSettings) {
  for (const objects of [settings.objects, ...Object.values(settings.layouts ?? {})]) {
    const oxygen = objects.oxygen
    if (oxygen?.position && Math.abs(oxygen.position[1] - .938507008614826) < 1e-8) {
      oxygen.position = [oxygen.position[0], .654, oxygen.position[2]]
    }
  }
  return settings
}
