import { Bone, Matrix4, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three'
import { BED_GEOMETRY, bedPoint, mattressHeight, patientLegTilt, type BedAngles } from './bedKinematics.ts'
import { blanketSamples } from './blanketGeometry.ts'
export function prepareBedContact(object: Object3D) {
  const bones = new Map<string, Bone>()
  let mesh: SkinnedMesh | undefined
  object.traverse(node => { if (node instanceof Bone) bones.set(node.name.replace(/^mixamorig[:_]?/i, ''), node); if (!mesh && node instanceof SkinnedMesh) mesh = node })
  const bins = new Map<string, { index: number; back: number }>()
  if (mesh) {
    const p = mesh.geometry.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const key = `${Math.floor(p.getX(i) / .08)},${Math.floor(p.getY(i) / .045)}`
      if (!bins.has(key) || p.getZ(i) < bins.get(key)!.back) bins.set(key, { index: i, back: p.getZ(i) })
    }
  }
  const coreSamples = mesh ? [...bins.values()].filter(v => Math.abs(mesh!.geometry.getAttribute('position').getX(v.index)) < .18 && mesh!.geometry.getAttribute('position').getY(v.index) < 1.455).map(v => v.index) : []
  const headSamples = mesh ? [...bins.values()].filter(v => mesh!.geometry.getAttribute('position').getY(v.index) > 1.455).map(v => v.index) : []
  return { bones, mesh, coreSamples, headSamples, blanketSamples: mesh ? blanketSamples(mesh) : new Uint32Array(), samples: [...bins.values()].map(v => v.index), inverse: new Matrix4(), point: new Vector3(), scale: new Vector3() }
}
/** Bones and mattress consume the same angles, with hips and knees at the same hinges. */
export function alignPatientBones(calibration: ReturnType<typeof prepareBedContact>, a: BedAngles) {
  const { bones } = calibration
  const rotate = (name: string, angle: number) => bones.get(name)?.rotation.set(angle, 0, 0)
  const hips = bones.get('Hips')
  if (hips) { hips.rotation.set(-Math.PI / 2, 0, 0); hips.position.set(0, .32, 0) }
  rotate('Spine', a.head); rotate('Spine1', 0); rotate('Spine2', 0); rotate('Neck', 0)
  if (bones.get('Neck')) bones.get('Neck')!.position.z = .025
  const spine = bones.get('Spine')
  if (spine) spine.position.set(0, .12 - .12 * Math.sin(a.head), .12 * (Math.cos(a.head) - 1))
  for (const side of ['Left', 'Right']) { rotate(`${side}UpLeg`, -a.thigh + patientLegTilt(a.head)); rotate(`${side}Leg`, a.thigh - a.shin) }
}

export function seatPatientOnFloor(object: Object3D, calibration: ReturnType<typeof prepareBedContact>) {
  if (!calibration.mesh) return
  object.position.y = 0
  object.parent?.updateWorldMatrix(true, false); object.updateMatrixWorld(true)
  let lowest = Infinity
  for (const index of calibration.samples) {
    calibration.mesh.getVertexPosition(index, calibration.point)
    calibration.mesh.localToWorld(calibration.point)
    lowest = Math.min(lowest, calibration.point.y)
  }
  if (Number.isFinite(lowest)) object.position.y = (.14 - lowest) / (object.parent?.getWorldScale(calibration.scale).y ?? 1)
  object.updateMatrixWorld(true)
}
/** A few hundred cached back-surface points; never scan/raycast the full animated mesh per frame. */
export function seatPatientOnMattress(object: Object3D, calibration: ReturnType<typeof prepareBedContact>, frame: Object3D, angles: BedAngles, pillow: boolean) {
  if (!calibration.mesh) return
  object.position.y = 0
  frame.updateWorldMatrix(true, false); object.parent?.updateWorldMatrix(true, false); object.updateMatrixWorld(true)
  calibration.inverse.copy(frame.matrixWorld).invert()
  let clearance = -Infinity
  for (const index of calibration.coreSamples) {
    const p = calibration.point
    calibration.mesh.getVertexPosition(index, p)
    calibration.mesh.localToWorld(p).applyMatrix4(calibration.inverse)
    if (Math.abs(p.x) > BED_GEOMETRY.width / 2 - .035) continue
    const surface = mattressHeight(p.z, angles)
    if (surface === null) continue
    clearance = Math.max(clearance, surface + .016 - p.y)
  }
  if (!Number.isFinite(clearance)) return
  const parentScale = object.parent?.getWorldScale(calibration.scale).y ?? 1
  const bedScale = frame.getWorldScale(new Vector3()).y
  object.position.y = clearance * bedScale / parentScale
  object.userData.contactClearance = .016
  object.userData.contactSamples = calibration.samples.length
  object.updateMatrixWorld(true)
  // Fit the head to the pillow separately; a pillow must never lift the pelvis off the mattress.
  const neck = calibration.bones.get('Neck')
  if (pillow && neck) {
    let gap = 0
    const cos = Math.cos(angles.head), sin = Math.sin(angles.head)
    for (const index of calibration.headSamples) {
      const p = calibration.point
      calibration.mesh.getVertexPosition(index, p); calibration.mesh.localToWorld(p).applyMatrix4(calibration.inverse)
      const surface = mattressHeight(p.z, angles)
      if (surface !== null && Math.abs(p.x) < .6 && p.z > -1.507 * cos + .125 * sin && p.z < -.696 * cos + .125 * sin) gap = Math.max(gap, surface + .125 / cos + .008 - p.y)
    }
    neck.position.z += gap * cos * bedScale / parentScale
    object.updateMatrixWorld(true)
  }
}


/** Two-bone arm IK keeps the hands above the mattress as the backrest rises. */
export function restPatientArms(object: Object3D, calibration: ReturnType<typeof prepareBedContact>, frame: Object3D, a: BedAngles) {
  const point = new Vector3(), shoulder = new Vector3(), elbow = new Vector3(), hand = new Vector3(), target = new Vector3(), bend = new Vector3(), direction = new Vector3()
  for (const [side, sign] of [['Left', 1], ['Right', -1]] as const) {
    const upper = calibration.bones.get(`${side}Arm`), lower = calibration.bones.get(`${side}ForeArm`), wrist = calibration.bones.get(`${side}Hand`)
    if (!upper || !lower || !wrist) continue
    upper.getWorldPosition(shoulder); lower.getWorldPosition(elbow); wrist.getWorldPosition(hand)
    const l1 = shoulder.distanceTo(elbow), l2 = elbow.distanceTo(hand)
    // Hands rest beside the hips, under the cloth, instead of reaching above it.
    const [y, z] = bedPoint(.12, .12, a)
    target.set(sign * .43, y, z)
    frame.localToWorld(target)
    direction.copy(target).sub(shoulder)
    const distance = Math.min(direction.length(), (l1 + l2) * .985); direction.normalize()
    const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance)
    const height = Math.sqrt(Math.max(0, l1 * l1 - along * along))
    bend.set(sign * .6, .06, .2).transformDirection(frame.matrixWorld); bend.addScaledVector(direction, -bend.dot(direction)).normalize()
    point.copy(shoulder).addScaledVector(direction, along).addScaledVector(bend, height)
    frame.worldToLocal(point)
    point.y = Math.max(point.y, (mattressHeight(point.z, a) ?? 0) + .12)
    frame.localToWorld(point)
    aim(upper, lower, point)
    object.updateMatrixWorld(true)
    target.copy(shoulder).addScaledVector(direction, distance)
    aim(lower, wrist, target)
    object.updateMatrixWorld(true)
    const fingers = calibration.bones.get(`${side}Hand_End`)
    if (fingers) {
      wrist.getWorldPosition(hand)
      target.set(0, Math.sin(a.thigh), Math.cos(a.thigh)).transformDirection(frame.matrixWorld).multiplyScalar(.2).add(hand)
      aim(wrist, fingers, target); object.updateMatrixWorld(true)
    }
  }
}
function aim(bone: Bone, child: Bone, target: Vector3) {
  const origin = bone.getWorldPosition(new Vector3()), from = child.getWorldPosition(new Vector3()).sub(origin).normalize(), to = target.clone().sub(origin).normalize()
  const delta = new Quaternion().setFromUnitVectors(from, to), world = bone.getWorldQuaternion(new Quaternion()).premultiply(delta), parent = bone.parent!.getWorldQuaternion(new Quaternion()).invert()
  bone.quaternion.copy(parent.multiply(world))
}
