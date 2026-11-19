import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Box3, BufferGeometry, Group, Matrix4, Mesh, Vector3, type Object3D } from 'three'
import { useBedMotion } from './bedMotionContext'
import { subdivideMattress } from './mattressGeometry'
import { BED_ORIGIN, bedPoint } from './bedKinematics'
import { useSimulationStore } from './store'

/** The room's actual bed frame, endboards, wheels, rails and original mattress. */
export default function RestoredBed({ source, sourceMatrix }: { source: Object3D; sourceMatrix: Matrix4 }) {
  const motion = useBedMotion()!
  const root = useRef<Group>(null)
  const previous = useRef('')
  const prepared = useMemo(() => {
    source.updateWorldMatrix(true, true)
    const object = new Group(), head = new Group(); head.name = 'Bed_Head'; object.add(head)
    const deformed: { mesh: Mesh; rest: Float32Array; normal: Float32Array }[] = [], geometries: BufferGeometry[] = []
    const relative = new Matrix4().makeTranslation(-BED_ORIGIN[0], -BED_ORIGIN[1], -BED_ORIGIN[2]).multiply(sourceMatrix)
    source.traverse(child => {
      if (!(child instanceof Mesh)) return
      const mesh = child.clone(), geometry = child.geometry.clone()
      geometry.applyMatrix4(relative.clone().multiply(child.matrixWorld))
      mesh.castShadow = true; mesh.receiveShadow = true
      mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1); mesh.visible = true
      const isMattress = /Matress_Twin/.test(child.name)
      const isPillow = /Box_With_Curved_Edges/.test(child.name)
      const movingHead = /Foldable_Bed_Section/.test(child.name)
      if (isMattress) {
        const dense = subdivideMattress(geometry); geometry.dispose(); mesh.geometry = dense; geometries.push(dense)
        deformed.push({ mesh, rest: new Float32Array(dense.getAttribute('position').array), normal: new Float32Array(dense.getAttribute('normal').array) })
        object.add(mesh)
      } else {
        mesh.geometry = geometry; geometries.push(geometry)
        if (isPillow) { geometry.translate(0, -.07, .2); mesh.name = 'Bed_Pillow' }
        ;(movingHead ? head : object).add(mesh)
      }
    })
    object.name = 'restored-original-bed'
    object.userData.originalBounds = new Box3().setFromObject(object).getSize(new Vector3()).toArray()
    return { object, head, deformed, geometries }
  }, [source, sourceMatrix])
  useLayoutEffect(() => {
    const state = motion.current
    // This context contains an imperative Three.js contact frame, not React render state.
    // eslint-disable-next-line react/immutability
    state.frame = root.current
    return () => { state.frame = null }
  }, [motion])
  useEffect(() => () => prepared.geometries.forEach(g => g.dispose()), [prepared])
  useFrame(() => {
    const a = motion.current.angles
    Object.assign(prepared.object.userData, { bedAngles: a })
    const key = `${a.head},${a.thigh},${a.shin}`
    prepared.head.rotation.set(a.head, 0, 0)
    const patient = useSimulationStore.getState().attempt?.patient
    const pillow = prepared.object.getObjectByName('Bed_Pillow'); if (pillow) pillow.visible = patient?.position !== 'legsUp' && patient?.breathing !== false
    if (key === previous.current) return
    previous.current = key
    for (const { mesh, rest, normal } of prepared.deformed) {
      const p = mesh.geometry.getAttribute('position'), n = mesh.geometry.getAttribute('normal')
      for (let i = 0; i < p.count; i++) {
        const y = rest[i * 3 + 1], z = rest[i * 3 + 2], [dy, dz] = bedPoint(y, z, a)
        p.setXYZ(i, rest[i * 3], dy, dz)
        const [ny, nz] = bedPoint(y + 1, z, a)
        // Derive the local foam normal from the rotated thickness vector.
        const angle = Math.atan2(nz - dz, ny - dy), cos = Math.cos(angle), sin = Math.sin(angle)
        n.setXYZ(i, normal[i * 3], normal[i * 3 + 1] * cos - normal[i * 3 + 2] * sin, normal[i * 3 + 1] * sin + normal[i * 3 + 2] * cos)
      }
      p.needsUpdate = true; n.needsUpdate = true; mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere()
    }
  }, -1)
  return <group ref={root} name="bed-contact-frame"><primitive object={prepared.object}/></group>
}
