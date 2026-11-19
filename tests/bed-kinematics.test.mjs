import test from 'node:test'
import assert from 'node:assert/strict'
import { BED_GEOMETRY, BED_ORIGIN, bedPoint, interpolateBed, mattressHeight, targetBedAngles } from '../src/bedKinematics.ts'
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)
test('restored mattress preserves original width, length and height', () => {
  assert.ok(BED_GEOMETRY.width > 1.97)
  assert.ok(BED_GEOMETRY.footEnd - BED_GEOMETRY.headEnd > 3.6)
  close(BED_ORIGIN[1], 1.395375857)
})
for (const position of ['supine', 'semiSitting', 'legsUp', 'kneesUp']) {
  test(`${position}: support height matches every point on the bent mattress`, () => {
    const angles = targetBedAngles(position)
    for (let z = -1.7; z < 1.85; z += .013) {
      const [y, projectedZ] = bedPoint(0, z, angles)
      close(mattressHeight(projectedZ, angles), y)
    }
    assert.equal(mattressHeight(-10, angles), null)
    assert.equal(mattressHeight(10, angles), null)
  })
  test(`${position}: foam has no tears at the lumbar, hip and knee hinges`, () => {
    const a = targetBedAngles(position)
    for (const hinge of [0, BED_GEOMETRY.hip, BED_GEOMETRY.knee]) for (const thickness of [0, -.15, -BED_GEOMETRY.thickness]) {
      const left = bedPoint(thickness, hinge - 1e-8, a), right = bedPoint(thickness, hinge + 1e-8, a)
      assert.ok(Math.hypot(left[0] - right[0], left[1] - right[1]) < 1e-6)
    }
  })
}
test('bed and body share a continuous reversible motion without overshooting', () => {
  const from = targetBedAngles('semiSitting'), to = targetBedAngles('kneesUp')
  assert.deepEqual(interpolateBed(from, to, 0), from)
  assert.deepEqual(interpolateBed(from, to, 1), to)
  assert.deepEqual(interpolateBed(from, to, 2), to)
  for (let t = 0; t <= 1; t += .02) {
    const a = interpolateBed(from, to, t)
    for (const key of ['head', 'thigh', 'shin']) assert.ok(a[key] >= Math.min(from[key], to[key]) - 1e-10 && a[key] <= Math.max(from[key], to[key]) + 1e-10)
  }
})
const { BoxGeometry, Box3, Vector3 } = await import('three')
const { subdivideMattress } = await import('../src/mattressGeometry.ts')
test('original mattress subdivision preserves dimensions and provides vertices at both new leg hinges', () => {
  const source = new BoxGeometry(BED_GEOMETRY.width, BED_GEOMETRY.thickness, BED_GEOMETRY.footEnd)
  source.translate(0, -BED_GEOMETRY.thickness / 2, BED_GEOMETRY.footEnd / 2)
  const dense = subdivideMattress(source)
  const before = new Box3().setFromBufferAttribute(source.getAttribute('position')), after = new Box3().setFromBufferAttribute(dense.getAttribute('position'))
  assert.ok(before.getSize(new Vector3()).distanceTo(after.getSize(new Vector3())) < 1e-6)
  assert.ok(dense.getAttribute('position').count < 20000)
  for (const hinge of [BED_GEOMETRY.hip, BED_GEOMETRY.knee]) {
    assert.ok(Array.from({ length: dense.getAttribute('position').count }, (_, i) => dense.getAttribute('position').getZ(i)).some(z => Math.abs(z - hinge) < 1e-6))
  }
  assert.ok([...dense.getAttribute('position').array, ...dense.getAttribute('normal').array, ...dense.getAttribute('uv').array].every(Number.isFinite))
  source.dispose(); dense.dispose()
})
const { positionForBed } = await import('../src/bedKinematics.ts')
const { basePatient } = await import('../src/simulation.ts')
test('bed is flat during CPR and stays empty while the patient is at the sink', () => {
  assert.equal(positionForBed({ ...basePatient, position: 'semiSitting', breathing: false }), 'supine')
  assert.equal(positionForBed({ ...basePatient, position: 'sitting', location: 'sink' }), 'supine')
  assert.equal(positionForBed({ ...basePatient, position: 'kneesUp' }), 'kneesUp')
})
