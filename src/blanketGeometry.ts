import { BufferGeometry, Float32BufferAttribute, Matrix4, Object3D, SkinnedMesh, Vector3 } from 'three'
import { bedPoint, type BedAngles } from './bedKinematics.ts'

export const CLOTH = { columns: 40, rows: 84, width: 1.44, start: -.55, end: 1.18, clearance: .065, radius: .19 } as const
export function createBlanketGeometry() {
  const geometry = new BufferGeometry(), indices: number[] = [], uv: number[] = []
  const stride = CLOTH.columns + 1
  for (let row = 0; row <= CLOTH.rows; row++) for (let col = 0; col <= CLOTH.columns; col++) uv.push(col / CLOTH.columns, row / CLOTH.rows)
  for (let row = 0; row < CLOTH.rows; row++) for (let col = 0; col < CLOTH.columns; col++) {
    const a = row * stride + col, b = a + 1, c = a + stride
    indices.push(a, c, b, b, c, c + 1)
  }
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(stride * (CLOTH.rows + 1) * 3), 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  return geometry
}
/** Cache both sides of small surface bins: a limb can rotate its original front downwards. */
export function blanketSamples(mesh: SkinnedMesh) {
  const p = mesh.geometry.getAttribute('position'), bins = new Map<string, [number, number]>()
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 1.425) continue // Keep the neck and face uncovered.
    const key = `${Math.floor(p.getX(i) / .035)},${Math.floor(p.getY(i) / .035)}`, previous = bins.get(key)
    if (!previous) bins.set(key, [i, i])
    else {
      if (p.getZ(i) < p.getZ(previous[0])) previous[0] = i
      if (p.getZ(i) > p.getZ(previous[1])) previous[1] = i
    }
  }
  return new Uint32Array([...new Set([...bins.values()].flat())])
}
/** A lightweight cloth envelope, regenerated only when the bed, rig or calibration changes. */
export class BlanketFit {
  private key = ''
  private body?: SkinnedMesh
  private positions = new Float32Array((CLOTH.columns + 1) * (CLOTH.rows + 1) * 3)
  private heights = new Float32Array((CLOTH.columns + 1) * (CLOTH.rows + 1))
  private relaxed = new Float32Array(this.heights.length)
  updates = 0
  fit(geometry: BufferGeometry, root: Object3D, frame: Object3D, angles: BedAngles, mesh?: SkinnedMesh, samples?: Uint32Array, lowerOnly = false) {
    root.updateWorldMatrix(true, false); frame.updateWorldMatrix(true, false); mesh?.updateWorldMatrix(true, false)
    const toBed = new Matrix4().copy(frame.matrixWorld).invert().multiply(root.matrixWorld), fromBed = toBed.clone().invert()
    const pose = mesh?.skeleton.bones.filter(bone => /Hand$|Foot$|Hips$|Spine2$/.test(bone.name)).flatMap(bone => bone.matrixWorld.elements).map(n => n.toFixed(2)).join(',') ?? ''
    const key = `${lowerOnly}:${pose}:` + [...Object.values(angles), ...toBed.elements, ...(mesh?.matrixWorld.elements ?? [])].map(n => n.toFixed(5)).join(',')
    if (key === this.key && mesh === this.body) return false
    const started = performance.now()
    this.key = key; this.body = mesh; this.updates++
    const buckets = new Map<string, Vector3[]>(), cell = CLOTH.radius, point = new Vector3()
    if (mesh && samples) {
      const matrix = new Matrix4().copy(frame.matrixWorld).invert().multiply(mesh.matrixWorld)
      for (const index of samples) {
        mesh.getVertexPosition(index, point); point.applyMatrix4(matrix)
        const k = `${Math.floor(point.x / cell)},${Math.floor(point.z / cell)}`
        if (!buckets.has(k)) buckets.set(k, [])
        buckets.get(k)!.push(point.clone())
      }
    }
    const p = geometry.getAttribute('position'), radius2 = CLOTH.radius ** 2
    for (let row = 0; row <= CLOTH.rows; row++) for (let col = 0; col <= CLOTH.columns; col++) {
      const start = lowerOnly ? .08 : CLOTH.start
      const u = col / CLOTH.columns, v = row / CLOTH.rows, x = (u - .5) * CLOTH.width, z = start + v * (CLOTH.end - start)
      const side = Math.max(0, (Math.abs(x) - .54) / .18), foot = Math.max(0, (v - .94) / .06)
      point.set(x, .235 - side * .19 - foot * .13, z).applyMatrix4(toBed)
      const [y, projected] = bedPoint(point.y, point.z, angles)
      point.setY(y).setZ(projected)
      const base = y, bx = Math.floor(point.x / cell), bz = Math.floor(point.z / cell)
      let height = base
      for (let ix = bx - 1; ix <= bx + 1; ix++) for (let iz = bz - 1; iz <= bz + 1; iz++) {
        for (const sample of buckets.get(`${ix},${iz}`) ?? []) {
          const d2 = (point.x - sample.x) ** 2 + (point.z - sample.z) ** 2
          if (d2 > radius2) continue
          height = Math.max(height, sample.y + CLOTH.clearance - d2 / radius2 * Math.max(.12, sample.y - base + .09))
        }
      }
      // Shallow folds preserve the contact allowance and avoid a smooth plastic dome.
      const folds = (.003 * Math.sin(z * 39 + x * 11) + .002 * Math.sin(x * 57 - z * 16)) * (1 - foot * .6)
      point.y = height + folds
      const i = row * (CLOTH.columns + 1) + col
      point.toArray(this.positions, i * 3); this.heights[i] = point.y
    }
    // Relax valleys without lowering the collision envelope over toes or knuckles.
    const stride = CLOTH.columns + 1
    for (let pass = 0; pass < 3; pass++) {
      this.relaxed.set(this.heights)
      for (let row = 1; row < CLOTH.rows; row++) for (let col = 1; col < CLOTH.columns; col++) {
        const i = row * stride + col
        const average = (this.heights[i] * 4 + this.heights[i - 1] + this.heights[i + 1] + this.heights[i - stride] + this.heights[i + stride]) / 8
        this.relaxed[i] = Math.max(this.positions[i * 3 + 1], average)
      }
      this.heights.set(this.relaxed)
    }
    for (let i = 0; i < p.count; i++) {
      point.fromArray(this.positions, i * 3).setY(this.heights[i]).applyMatrix4(fromBed)
      p.setXYZ(i, point.x, point.y, point.z)
    }
    p.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingSphere()
    root.userData.blanketFitUpdates = this.updates
    root.userData.blanketSamples = samples?.length ?? 0
    root.userData.blanketFitMs = performance.now() - started
    return true
  }
}
