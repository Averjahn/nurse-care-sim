import test from 'node:test'
import assert from 'node:assert/strict'
import { Bone, Group, Vector3 } from 'three'
import { alignPatientBones, prepareBedContact, restPatientArms } from '../src/patientBedContact.ts'
import { mattressHeight } from '../src/bedKinematics.ts'

// The same joint positions and scale as the supplied patient rig.
function fixture() {
  const frame = new Group(), parent = new Group(), actor = new Group(), joints = new Map()
  frame.add(parent); parent.position.set(0, -.32, .18); parent.add(actor)
  actor.scale.setScalar(1.5); actor.position.y = .046422565
  const add = (name, parentName, position) => {
    const bone = new Bone(); bone.name = `mixamorig:${name}`
    const item = joints.get(parentName)
    bone.position.fromArray(position).sub(item?.rest ?? new Vector3())
    ;(item?.bone ?? actor).add(bone); joints.set(name, { bone, rest: new Vector3(...position) })
  }
  add('Hips', null, [0, .9, 0]); add('Spine', 'Hips', [0, 1.02, 0])
  add('Spine1', 'Spine', [0, 1.17, 0]); add('Spine2', 'Spine1', [0, 1.34, 0])
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    add(`${side}Shoulder`, 'Spine2', [sign * .14, 1.38, 0])
    add(`${side}Arm`, `${side}Shoulder`, [sign * .22, 1.38, 0])
    add(`${side}ForeArm`, `${side}Arm`, [sign * .44, 1.20, 0])
    add(`${side}Hand`, `${side}ForeArm`, [sign * .64, 1.06, 0])
    add(`${side}Hand_End`, `${side}Hand`, [sign * .76, 1, .01])
  }
  const calibration = prepareBedContact(actor)
  const position = name => frame.worldToLocal(calibration.bones.get(name).getWorldPosition(new Vector3()))
  return { frame, actor, calibration, position }
}

test('Fowler arms have lowered elbows, supported hands and neutral wrists', () => {
  const { frame, actor, calibration, position } = fixture()
  const angles = { head: Math.PI / 4, thigh: 0, shin: 0 }
  alignPatientBones(calibration, angles); frame.updateMatrixWorld(true)
  const lengths = ['Left', 'Right'].map(side => [position(`${side}Arm`).distanceTo(position(`${side}ForeArm`)), position(`${side}ForeArm`).distanceTo(position(`${side}Hand`))])
  restPatientArms(actor, calibration, frame, angles)
  for (const [index, side] of ['Left', 'Right'].entries()) {
    const shoulder = position(`${side}Arm`), elbow = position(`${side}ForeArm`), hand = position(`${side}Hand`), tip = position(`${side}Hand_End`)
    assert.ok(Math.abs(elbow.x) < .5 && elbow.y < .3, `${side}: elbow rests beside waist`)
    assert.ok(Math.abs(hand.x) < .5 && hand.y < .27 && hand.y > .22, `${side}: wrist rests beside thigh`)
    assert.ok(tip.toArray().every(Number.isFinite))
    assert.ok(elbow.y > (mattressHeight(elbow.z, angles) ?? 0) + .06)
    assert.ok(Math.abs(shoulder.distanceTo(elbow) - lengths[index][0]) < 1e-6)
    assert.ok(Math.abs(elbow.distanceTo(hand) - lengths[index][1]) < 1e-6)
    assert.ok(Math.abs(calibration.bones.get(`${side}Hand`).quaternion.w) > .9999, `${side}: neutral wrist without twisting`)
  }
})

test('arms move continuously from supine to Fowler without changing limb lengths', () => {
  const { frame, actor, calibration, position } = fixture()
  let previous
  for (let i = 0; i <= 80; i++) {
    const angles = { head: i / 80 * Math.PI / 4, thigh: 0, shin: 0 }
    alignPatientBones(calibration, angles); frame.updateMatrixWorld(true)
    restPatientArms(actor, calibration, frame, angles)
    const current = ['LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand'].map(position)
    assert.ok(current.every(p => p.toArray().every(Number.isFinite)))
    if (previous) for (let j = 0; j < current.length; j++) assert.ok(current[j].distanceTo(previous[j]) < .04, `no arm jump at ${i}`)
    previous = current
  }
})
