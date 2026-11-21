import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SCENE_SETTINGS, SCENE_SETTINGS_KEY, readSceneSettings } from '../src/sceneSettings.ts'
import { COLLAPSE_LAYOUT, DEFAULT_HINT_COLOR, SCENE_PRESET_REVISION, applyScenePreset } from '../src/scenePreset.ts'
import { HINT_COLOR } from '../src/interactionHighlight.ts'

test('published preset uses one yellow and the supplied collapse settings', () => {
  assert.equal(DEFAULT_HINT_COLOR, '#FFD500')
  assert.equal(HINT_COLOR, DEFAULT_HINT_COLOR)
  assert.equal(DEFAULT_SCENE_SETTINGS.hintColor, DEFAULT_HINT_COLOR)
  assert.deepEqual(DEFAULT_SCENE_SETTINGS.layouts.collapse, COLLAPSE_LAYOUT)
  assert.deepEqual(COLLAPSE_LAYOUT['call-bell'].position, [0.8797297328762567, 1.2138771338025447, -2.0341672444288825])
  assert.equal(COLLAPSE_LAYOUT.tonometer.hintScale, 1.6)
  assert.equal(COLLAPSE_LAYOUT.pulseox.scale, 1)
  assert.equal(COLLAPSE_LAYOUT.monitor.hintScale, 1.15)
})
test('preset clears individual colors across cases while preserving unrelated transforms', () => {
  const settings = structuredClone(DEFAULT_SCENE_SETTINGS)
  settings.presetRevision = 0
  settings.objects.patient = { position: [0, 1, -2], hintColor: '#ffde38' }
  settings.layouts.abdomen = { bed: { position: [1, 2, 3], hintColor: '#ffdd00' } }
  settings.layouts.collapse.monitor.hintColor = '#ffdd00'
  applyScenePreset(settings)
  for (const objects of [settings.objects, ...Object.values(settings.layouts)]) for (const value of Object.values(objects)) assert.equal(value.hintColor, undefined)
  assert.deepEqual(settings.layouts.abdomen.bed.position, [1, 2, 3])
  assert.deepEqual(settings.objects.patient.position, [0, 1, -2])
})
test('camera release upgrades revision 2 without resetting edited objects, colors or layouts, once', () => {
  const previous = globalThis.localStorage
  const saved = structuredClone(DEFAULT_SCENE_SETTINGS)
  saved.presetRevision = 2
  saved.camera = { position: [5.02, 6.37, 3.8], target: [1.09, 2.12, -2.1], fov: 36, eyeHeight: 3.4 }
  saved.objects.patient = { position: [1, 2, 3], hintColor: '#123456' }
  saved.layouts.collapse.monitor = { position: [2, 3, 4] }
  const values = new Map([[SCENE_SETTINGS_KEY, JSON.stringify(saved)]])
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  try {
    const upgraded = readSceneSettings()
    assert.deepEqual(upgraded.camera.position, [4.54, 6.12, 4.54])
    assert.deepEqual(upgraded.camera.target, [.85, 2.12, -2.1])
    assert.deepEqual(upgraded.objects, saved.objects)
    assert.deepEqual(upgraded.layouts, saved.layouts)
    upgraded.camera.position = [4, 5, 6]
    values.set(SCENE_SETTINGS_KEY, JSON.stringify(upgraded))
    assert.deepEqual(readSceneSettings().camera.position, [4, 5, 6])
  } finally { globalThis.localStorage = previous }
})
test('saved configurations get the preset once, then preserve subsequent editor changes', () => {
  const previous = globalThis.localStorage
  let saved = { version: 1, objects: {}, hintColor: '#ffbf00', camera: structuredClone(DEFAULT_SCENE_SETTINGS.camera), layouts: { collapse: { patient: { hintColor: '#ffde38' } } } }
  const values = new Map([[SCENE_SETTINGS_KEY, JSON.stringify(saved)]])
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  try {
    const settings = readSceneSettings()
    assert.equal(settings.presetRevision, SCENE_PRESET_REVISION)
    assert.equal(settings.hintColor, '#FFD500')
    assert.deepEqual(settings.layouts.collapse.oxygen.position, COLLAPSE_LAYOUT.oxygen.position)
    assert.equal(settings.layouts.collapse.patient.hintColor, undefined)
    saved = JSON.parse(values.get(SCENE_SETTINGS_KEY))
    saved.layouts.collapse.oxygen.position = [1, 1, -3]
    values.set(SCENE_SETTINGS_KEY, JSON.stringify(saved))
    assert.deepEqual(readSceneSettings().layouts.collapse.oxygen.position, [1, 1, -3])
  } finally { globalThis.localStorage = previous }
})
