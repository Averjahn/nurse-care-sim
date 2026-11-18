import { Color, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Object3D } from 'three'

export const HINT_COLOR = '#ffbf00'

/** Install once per mounted material, then animate only a shared GPU uniform.
 * Tint after lighting so bright hospital lights cannot wash yellow into white. */
export function bindInteractionHighlight(root: Object3D) {
  const strength = { value: 0 }
  const tint = { value: new Color(HINT_COLOR) }
  const restorers: Array<() => void> = []
  const seen = new Set<MeshStandardMaterial | MeshBasicMaterial>()
  root.traverse(node => {
    if (!(node instanceof Mesh)) return
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!(material instanceof MeshStandardMaterial || material instanceof MeshBasicMaterial) || seen.has(material)) continue
      seen.add(material)
      const compile = material.onBeforeCompile
      const cacheKey = material.customProgramCacheKey
      const key = material.customProgramCacheKey()
      material.onBeforeCompile = (shader, renderer) => {
        compile.call(material, shader, renderer)
        shader.uniforms.interactionStrength = strength
        shader.uniforms.interactionTint = tint
        shader.fragmentShader = 'uniform float interactionStrength;\nuniform vec3 interactionTint;\n' + shader.fragmentShader
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
          if (interactionStrength > 0.001) {
            float hintShade = clamp(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)), 0.35, 1.0);
            outgoingLight = mix(outgoingLight, interactionTint * hintShade, interactionStrength);
          }
          #include <opaque_fragment>
        `)
      }
      material.customProgramCacheKey = () => `${key}:saturated-interaction-v1`
      material.needsUpdate = true
      restorers.push(() => {
        material.onBeforeCompile = compile
        material.customProgramCacheKey = cacheKey
        material.needsUpdate = true
      })
    }
  })
  return { strength, tint, materialCount: seen.size, dispose: () => restorers.forEach(restore => restore()) }
}
