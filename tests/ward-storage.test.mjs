import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateRemovedCabinet, WALL_STORAGE_POSITIONS } from '../src/wardStorage.ts'
import { DEFAULT_SCENE_SETTINGS, readSceneSettings } from '../src/sceneSettings.ts'

test('saved placements on the retired cabinet move to wall storage in every case', () => {
  const settings = structuredClone(DEFAULT_SCENE_SETTINGS)
  settings.objects.tonometer = { position: [1.43, 1.604, -2.65], scale: 1.2 }
  settings.objects['aed-device'] = { position: [3.95, 1.11, -3.62] }
  settings.layouts = { abdomen: { thermometer: { position: [1.55, 1.546, -2.15], hintColor: '#ffaa00' } } }
  migrateRemovedCabinet(settings)
  assert.deepEqual(settings.objects.tonometer.position, WALL_STORAGE_POSITIONS.tonometer)
  assert.equal(settings.objects.tonometer.scale, 1.2)
  assert.deepEqual(settings.objects['aed-device'].position, WALL_STORAGE_POSITIONS['aed-device'])
  assert.deepEqual(settings.layouts.abdomen.thermometer.position, WALL_STORAGE_POSITIONS.thermometer)
  assert.equal(settings.layouts.abdomen.thermometer.hintColor, '#ffaa00')
})
test('unrelated custom placements survive migration and updated positions are stable on reload', () => {
  const settings = structuredClone(DEFAULT_SCENE_SETTINGS)
  settings.objects.pulseox = { position: [-3, 1.866, -3.62] }
  settings.objects['aed-device'] = { position: [1.5, 2.5, -3.9] }
  const before = structuredClone(settings)
  assert.deepEqual(migrateRemovedCabinet(settings), before)
  const previous = globalThis.localStorage
  globalThis.localStorage = { getItem: () => JSON.stringify(settings) }
  try { assert.deepEqual(readSceneSettings(), before) }
  finally { globalThis.localStorage = previous }
})
