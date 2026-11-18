import { Box3, SkinnedMesh, Vector3, type Bone, type Object3D, type Raycaster, type Intersection } from 'three'

/** Picking follows the animated skeleton, without CPU skinning ~50K triangles
 * on every pointer move. These bounds affect selection only, never rendering. */
export function installPatientPicking(root: Object3D) {
  root.traverse(mesh => {
    if (!(mesh instanceof SkinnedMesh)) return
    const bones = new Map(mesh.skeleton.bones.map(bone => [bone.name.replace(/^mixamorig[:_]?/, ''), bone]))
    const pairs: Array<[Bone, Bone, number]> = []
    const add = (a: string, b: string, radius: number) => {
      const from = bones.get(a), to = bones.get(b)
      if (from && to) pairs.push([from, to, radius])
    }
    add('Hips', 'Spine1', 0.17)
    add('Spine1', 'Neck', 0.18)
    add('Neck', 'Head', 0.12)
    add('Head', 'HeadTop_End', 0.11)
    for (const side of ['Left', 'Right']) {
      add(`${side}Arm`, `${side}ForeArm`, 0.085)
      add(`${side}ForeArm`, `${side}Hand`, 0.07)
      add(`${side}Hand`, `${side}Hand`, 0.08)
      add(`${side}UpLeg`, `${side}Leg`, 0.115)
      add(`${side}Leg`, `${side}Foot`, 0.09)
      add(`${side}Foot`, `${side}ToeBase`, 0.085)
    }
    if (!pairs.length) return // Other rigs keep their own picking implementation.
    const a = new Vector3(), b = new Vector3(), padding = new Vector3(), point = new Vector3(), nearest = new Vector3(), box = new Box3()
    mesh.raycast = (raycaster: Raycaster, hits: Intersection[]) => {
      const scale = mesh.matrixWorld.getMaxScaleOnAxis()
      let distance = Infinity
      for (const [from, to, radius] of pairs) {
        a.setFromMatrixPosition(from.matrixWorld)
        b.setFromMatrixPosition(to.matrixWorld)
        padding.setScalar(radius * scale)
        box.min.copy(a).min(b).sub(padding)
        box.max.copy(a).max(b).add(padding)
        if (!raycaster.ray.intersectBox(box, point)) continue
        const d = raycaster.ray.origin.distanceTo(point)
        if (d < raycaster.near || d > raycaster.far || d >= distance) continue
        distance = d
        nearest.copy(point)
      }
      if (distance < Infinity) hits.push({ distance, point: nearest.clone(), object: mesh })
    }
  })
}
