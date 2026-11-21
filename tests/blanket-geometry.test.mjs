import test from 'node:test'
import assert from 'node:assert/strict'
import { Bone, BoxGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three'
import { BlanketFit, blanketSamples, CLOTH, createBlanketGeometry } from '../src/blanketGeometry.ts'
import { targetBedAngles } from '../src/bedKinematics.ts'

function patient() {
  const geometry = new BoxGeometry(.4, .24, .8, 8, 8, 16)
  const count = geometry.getAttribute('position').count
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count * 4), 4))
  const weights = new Float32Array(count * 4)
  for (let i=0;i<count;i++) weights[i * 4] = 1
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial()), bone = new Bone()
  bone.name = 'mixamorigHips'
  mesh.add(bone); mesh.bind(new Skeleton([bone])); mesh.position.set(0, .16, .65); mesh.updateMatrixWorld(true)
  return { mesh, bone }
}
test('blanket rebuilds around the current skinned surface and caches stationary poses', () => {
  const { mesh, bone } = patient(), frame = new Group(), cloth = new Group(), geometry = createBlanketGeometry(), fitter = new BlanketFit()
  cloth.position.set(0,-.32,.18);cloth.scale.setScalar(1.5)
  const samples = blanketSamples(mesh), flat = targetBedAngles('supine')
  assert.ok(samples.length > 50 && samples.length < mesh.geometry.getAttribute('position').count)
  assert.equal(fitter.fit(geometry, cloth, frame, flat, mesh, samples), true)
  const before = new Float32Array(geometry.getAttribute('position').array)
  assert.equal(fitter.fit(geometry, cloth, frame, flat, mesh, samples), false)
  assert.equal(fitter.updates, 1)
  bone.rotation.x = -.6;mesh.updateMatrixWorld(true)
  assert.equal(fitter.fit(geometry, cloth, frame, flat, mesh, samples), true, 'bone-only pose changes also invalidate cached cloth')
  // The patient root/contact correction changes with pose, invalidating the fit.
  mesh.position.y += .07
  assert.equal(fitter.fit(geometry, cloth, frame, targetBedAngles('kneesUp'), mesh, samples), true)
  assert.notDeepEqual(geometry.getAttribute('position').array, before)
  assert.ok([...geometry.getAttribute('position').array, ...geometry.getAttribute('normal').array].every(Number.isFinite))
})
test('the blanket includes side and foot drapes instead of ending as an open plane above the toes', () => {
  const frame = new Group(), cloth = new Group(), geometry = createBlanketGeometry()
  cloth.position.set(0,-.32,.18);cloth.scale.setScalar(1.5)
  new BlanketFit().fit(geometry, cloth, frame, targetBedAngles('supine'))
  const p=geometry.getAttribute('position'), point=i=>new Vector3().fromBufferAttribute(p,i).applyMatrix4(cloth.matrixWorld)
  const stride=CLOTH.columns+1, center=point(Math.floor(CLOTH.rows/2)*stride+CLOTH.columns/2), side=point(Math.floor(CLOTH.rows/2)*stride), foot=point(CLOTH.rows*stride+CLOTH.columns/2)
  assert.ok(center.y-side.y>.25)
  assert.ok(center.y-foot.y>.15)
  assert.ok(foot.z>1.9)
})
