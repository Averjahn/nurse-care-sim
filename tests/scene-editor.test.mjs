import test from 'node:test'
import assert from 'node:assert/strict'
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { DEFAULT_SCENE_SETTINGS, parseSceneSettings, readSceneSettings, SCENE_SETTINGS_KEY } from '../src/sceneSettings.ts'
import { selectEditorSceneObject, useSceneEditor } from '../src/sceneEditorStore.ts'
import { splitRoomObjects } from '../src/importedRoomObjects.ts'

test('scene configuration round-trips and protects patient pulse scale', () => {
  const input = structuredClone(DEFAULT_SCENE_SETTINGS)
  input.objects.patient = { position: [-0.3, 1.2, -2], scale: 1.2, hintColor: '#ff3300', hintScale: 2 }
  const parsed = parseSceneSettings(JSON.parse(JSON.stringify(input)))
  assert.equal(parsed.objects.patient.hintScale, 1)
  assert.deepEqual(parsed.objects.patient.position, input.objects.patient.position)
  assert.equal(parsed.objects.patient.scale, 1.2)
  parsed.camera.position[0] = 3
  assert.equal(DEFAULT_SCENE_SETTINGS.camera.position[0], 7.2, 'Defaults must remain immutable')
})

test('case layouts persist independently with undo and reset', () => {
  useSceneEditor.setState({ settings: structuredClone(DEFAULT_SCENE_SETTINGS), layout: '', undoStack: [], redoStack: [] })
  const s = useSceneEditor.getState()
  s.updateObject('monitor', { scale: 1.2 })
  s.setLayout('collapse')
  s.updateObject('monitor', { position: [1, 2, 3] })
  s.setLayout('abdomen')
  s.updateObject('monitor', { position: [-1, 2, 3] })
  let settings = parseSceneSettings(JSON.parse(JSON.stringify(useSceneEditor.getState().settings)))
  assert.equal(settings.objects.monitor.scale, 1.2)
  assert.deepEqual(settings.layouts.collapse.monitor.position, [1, 2, 3])
  assert.deepEqual(settings.layouts.abdomen.monitor.position, [-1, 2, 3])
  s.resetObject('monitor')
  assert.equal(useSceneEditor.getState().settings.layouts.abdomen.monitor, undefined)
  s.undo()
  settings = useSceneEditor.getState().settings
  assert.deepEqual(settings.layouts.abdomen.monitor.position, [-1, 2, 3])
  assert.throws(() => parseSceneSettings({ ...settings, layouts: { unknown: {} } }))
  s.setLayout('')
})

test('invalid or unsupported scene imports fail atomically', () => {
  for (const patch of [
    { version: 3 }, { objects: { bed: { scale: -1 } } }, { objects: { bed: { position: [0, NaN, 0] } } },
    { hintColor: 'yellow' }, { camera: { ...DEFAULT_SCENE_SETTINGS.camera, fov: 0 } },
    { camera: { ...DEFAULT_SCENE_SETTINGS.camera, position: [0, 1.2, 0] } },
    { objects: JSON.parse('{"__proto__":{"scale":2}}') },
  ]) assert.throws(() => parseSceneSettings({ ...structuredClone(DEFAULT_SCENE_SETTINGS), ...patch }))
})

test('editor supports undo, redo, reset and durable configuration without saving runtime objects', () => {
  const previous = globalThis.localStorage, values = new Map()
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  try {
    useSceneEditor.setState({ settings: structuredClone(DEFAULT_SCENE_SETTINGS), undoStack: [], redoStack: [] })
    const s = useSceneEditor.getState()
    const camera = s.settings.camera
    s.updateObject('bed', { position: [1, 2, 3] })
    s.updateObject('bed', { scale: 1.25 })
    assert.equal(useSceneEditor.getState().settings.camera, camera, 'Object edits must not reset the camera')
    s.undo(); assert.equal(useSceneEditor.getState().settings.objects.bed.scale, undefined)
    s.redo(); assert.equal(useSceneEditor.getState().settings.objects.bed.scale, 1.25)
    s.resetObject('bed'); assert.equal(useSceneEditor.getState().settings.objects.bed, undefined)
    s.undo(); assert.equal(useSceneEditor.getState().settings.objects.bed.scale, 1.25)
    const before = useSceneEditor.getState().settings
    assert.throws(() => s.importSettings({ version: 9 }))
    assert.equal(useSceneEditor.getState().settings, before)
    const saved = JSON.parse(values.get(SCENE_SETTINGS_KEY))
    assert.equal(saved.targets, undefined)
    assert.deepEqual(readSceneSettings(), saved)
    values.set(SCENE_SETTINGS_KEY, 'not valid JSON')
    assert.deepEqual(readSceneSettings(), DEFAULT_SCENE_SETTINGS)
  } finally { globalThis.localStorage = previous }
})

test('imported furniture keeps its world geometry when split into editable groups', () => {
  const model = new Group(), material = new MeshStandardMaterial()
  for (const [name, x] of [['Mesh1_box_Model', 0], ['Mesh54_box24_Hospital_Bed_001', 100], ['Mesh55_box25_Hospital_Bed_001', 120], ['Mesh23_Drawers_on_Wheels', 200]]) {
    const mesh = new Mesh(new BoxGeometry(10, 5, 15), material); mesh.name = name; mesh.position.set(x, 20, 30); model.add(mesh)
  }
  model.updateMatrixWorld(true)
  const original = new Box3().setFromObject(model)
  const entries = splitRoomObjects(model)
  for (const entry of entries) {
    const wrapper = new Group(); wrapper.position.fromArray(entry.position); wrapper.add(entry.object); model.add(wrapper)
  }
  model.updateMatrixWorld(true)
  const after = new Box3().setFromObject(model)
  assert.ok(after.min.distanceTo(original.min) < 1e-8 && after.max.distanceTo(original.max) < 1e-8)
  assert.equal(entries.find(e => e.id === 'bed').object.children.length, 2)
  assert.equal(model.children.some(n => n.name === 'Mesh1_box_Model'), true, 'Room shell is preserved')
  assert.notEqual(entries[0].materials[0], material, 'Preview must not mutate cached shared source materials')
  assert.equal(new Vector3(...entries[0].position).x, 110)
})

test('gizmo drag release cannot replace the selected object with background geometry', () => {
  useSceneEditor.setState({ selected: 'call-bell', dragging: true, selectionBlockedUntil: 0 })
  selectEditorSceneObject('wall-0')
  assert.equal(useSceneEditor.getState().selected, 'call-bell')
  useSceneEditor.setState({ dragging: false, selectionBlockedUntil: Date.now() + 1000 })
  selectEditorSceneObject('wall-0')
  assert.equal(useSceneEditor.getState().selected, 'call-bell')
  useSceneEditor.getState().select('bed')
  assert.equal(useSceneEditor.getState().selected, 'bed', 'Inspector selection remains available')
  useSceneEditor.setState({ selectionBlockedUntil: 0 })
  selectEditorSceneObject('wall-0')
  assert.equal(useSceneEditor.getState().selected, 'wall-0')
})
