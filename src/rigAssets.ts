import { AnimationClip, Color, Mesh, MeshStandardMaterial, PropertyBinding, SkinnedMesh, type Material, type Object3D } from 'three'
import { normalizedBoneName, type RigInventory } from './patientAnimation.ts'

export function rigInventory(root: Object3D, clips: readonly AnimationClip[]): RigInventory {
  const bones = new Set<string>(), morphs = new Set<string>()
  let skinnedMeshes = 0
  root.traverse(object => {
    if (object instanceof SkinnedMesh) {
      if (object.geometry.getAttribute('skinIndex') && object.geometry.getAttribute('skinWeight')) skinnedMeshes++
      for (const bone of object.skeleton.bones) bones.add(bone.name)
    }
    if (object instanceof Mesh) for (const name of Object.keys(object.morphTargetDictionary ?? {})) morphs.add(name)
  })
  return { skinnedMeshes, bones: [...bones], morphs: [...morphs], clips: clips.map(clip => clip.name) }
}
/** Animation-only files must use the same armature/rest pose; this only resolves
 * Mixamo's colon/underscore spelling. It does not retarget different proportions. */
export function bindRigClips(root: Object3D, clips: readonly AnimationClip[]): AnimationClip[] {
  const nodes = new Map<string, Object3D>()
  root.traverse(object => { nodes.set(object.name, object); if (object.type === 'Bone') nodes.set(normalizedBoneName(object.name), object) })
  return clips.map(original => {
    const clip = original.clone()
    for (const track of clip.tracks) {
      const parsed = PropertyBinding.parseTrackName(track.name)
      const requested = parsed.objectName === 'bones' ? parsed.objectIndex : parsed.nodeName
      const node = nodes.get(requested) ?? nodes.get(normalizedBoneName(requested))
      if (!node) throw new Error(`Клип ${clip.name}: не найден узел ${requested}. Нужна та же арматура.`)
      if (node === root && ['position', 'quaternion', 'scale'].includes(parsed.propertyName)) throw new Error(`Клип ${clip.name}: root motion запрещён; положение задаёт сцена.`)
      track.name = `${node.name}.${parsed.propertyName}${parsed.propertyIndex !== undefined ? `[${parsed.propertyIndex}]` : ''}`
    }
    return clip
  })
}
export function mergeRigClips(embedded: readonly AnimationClip[], separate: readonly AnimationClip[]): AnimationClip[] {
  return [...new Map([...embedded, ...separate].map(clip => [clip.name, clip])).values()]
}
export function cloneRigMaterials(root: Object3D): Material[] {
  const materials: Material[] = []
  root.traverse(object => {
    if (!(object instanceof Mesh)) return
    object.castShadow = true; object.receiveShadow = true
    const clone = (material: Material) => { const copy = material.clone(); materials.push(copy); return copy }
    object.material = Array.isArray(object.material) ? object.material.map(clone) : clone(object.material)
  })
  return materials
}

/** Remove baked yellow/green color and excessive shading from the supplied
 * scrubs atlas. Retain its fine shading and normal map for seams and folds. */
export function cleanRigClothing(material: MeshStandardMaterial) {
  material.color.set('#ffffff')
  material.metalness = 0
  material.metalnessMap = null
  material.roughness = 0.92
  material.roughnessMap = null
  material.onBeforeCompile = shader => {
    shader.uniforms.cleanClothColor = { value: new Color('#80b5cc') }
    shader.fragmentShader = 'uniform vec3 cleanClothColor;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      float clothLuminance = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      float clothDetail = clamp(pow(max(clothLuminance, 0.0), 0.35) * 1.35, 0.72, 1.18);
      diffuseColor.rgb = cleanClothColor * clothDetail;
    `)
  }
  material.customProgramCacheKey = () => 'careflow-clean-scrubs-v1'
  material.needsUpdate = true
}

export function applyRigMorphs(meshes: Mesh[], targets: Record<string, number>, compression: AnimationClip, compressing: boolean) {
  for (const mesh of meshes) for (const [name, value] of Object.entries(targets)) {
    const index = mesh.morphTargetDictionary![name]
    if (index === undefined) continue
    const owned = compressing && compression.tracks.some(track => track.name.startsWith(`${mesh.name}.morphTargetInfluences`) && (track.name.endsWith('Influences') || track.name.endsWith(`[${index}]`) || track.name.endsWith(`[${name}]`)))
    if (!owned) mesh.morphTargetInfluences![index] = value
  }
}

export function applyRigSkin(skin: { material: MeshStandardMaterial; base: Color; roughness: number }[], state: string) {
  const tint = state === 'coldSweat' ? '#bdc9c5' : state === 'pale' ? '#e2ddd1' : state === 'flushed' || state === 'rash' ? '#dd9487' : null
  for (const entry of skin) {
    entry.material.color.copy(entry.base)
    if (tint) entry.material.color.lerp(new Color(tint), 0.35)
    entry.material.roughness = state === 'coldSweat' ? Math.min(0.3, entry.roughness) : entry.roughness
  }
}
