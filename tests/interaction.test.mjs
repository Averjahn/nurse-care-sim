import test from 'node:test'
import assert from 'node:assert/strict'
import { Bone, BoxGeometry, Group, MeshStandardMaterial, Raycaster, Skeleton, SkinnedMesh, Vector3 } from 'three'
import { installPatientPicking } from '../src/patientPicking.ts'
import { placeActionPopover } from '../src/actionPopover.ts'

function patient() {
  const root = new Group(), hips = new Bone(), chest = new Bone(), neck = new Bone()
  hips.name = 'mixamorig:Hips'; chest.name = 'mixamorig:Spine1'; neck.name = 'mixamorig:Neck'
  chest.position.y = 1; neck.position.y = 0.5; hips.add(chest); chest.add(neck)
  const mesh = new SkinnedMesh(new BoxGeometry(), new MeshStandardMaterial())
  mesh.skeleton = new Skeleton([hips, chest, neck])
  // Any accidental return to per-triangle skinning must fail this test.
  mesh.getVertexPosition = () => { throw new Error('Expensive CPU skinning invoked') }
  root.add(mesh, hips); root.updateMatrixWorld(true)
  installPatientPicking(root)
  return { root, hips, mesh }
}

test('patient selection follows posed and transformed bones without CPU skinning', () => {
  const { root, hips, mesh } = patient()
  const ray = new Raycaster(new Vector3(0, 0.5, 3), new Vector3(0, 0, -1))
  assert.equal(ray.intersectObject(mesh).length, 1)
  hips.position.x = 1; root.updateMatrixWorld(true)
  assert.equal(ray.intersectObject(mesh).length, 0, 'Old pose must no longer be selectable')
  root.position.x = 2; root.scale.setScalar(2); root.updateMatrixWorld(true)
  ray.ray.origin.set(4, 1, 3)
  assert.equal(ray.intersectObject(mesh).length, 1, 'World scale and model placement respected')
  ray.far = 2
  assert.equal(ray.intersectObject(mesh).length, 0, 'Far clipping respected')
})

test('selection does not replace raycasting on an unrelated skeleton', () => {
  const mesh = new SkinnedMesh(); mesh.skeleton = new Skeleton([new Bone()])
  const original = mesh.raycast
  installPatientPicking(mesh)
  assert.equal(mesh.raycast, original)
})

test('action popup stays beside the selection and avoids the patient panel', () => {
  const panel = { width: 360, height: 300 }, viewport = { width: 1440, height: 1000 }
  const left = placeActionPopover({ x: 120, y: 300 }, panel, viewport)
  assert.ok(left.x > 120 && left.x < 160)
  const right = placeActionPopover({ x: 1100, y: 300 }, panel, viewport)
  assert.ok(right.x + panel.width < 1100)
  assert.ok(right.x + panel.width < viewport.width - 320)
})

test('action popup remains reachable at viewport edges and on narrow screens', () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 700 }]) {
    const panel = { width: Math.min(360, viewport.width - 24), height: 500 }
    for (const anchor of [{ x: 0, y: 0 }, { x: viewport.width, y: viewport.height }, { x: 200, y: 400 }]) {
      const p = placeActionPopover(anchor, panel, viewport)
      assert.ok(p.x >= 12 && p.y >= 66)
      assert.ok(p.x + panel.width <= viewport.width - 12)
      assert.ok(p.y + panel.height <= viewport.height - 12)
    }
  }
})
