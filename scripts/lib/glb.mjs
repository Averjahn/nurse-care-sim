export function readGlb(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii',0,4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Ожидался полный GLB v2.')
  const length = bytes.readUInt32LE(12)
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || length > bytes.length - 20) throw new Error('Некорректный JSON-чанк GLB.')
  const json = JSON.parse(bytes.subarray(20,20+length).toString())
  if (json.asset?.version !== '2.0') throw new Error('Требуется glTF 2.0.')
  return json
}
export function glbInventory(json) {
  return {
    skinnedMeshes: (json.nodes ?? []).filter(n => n.skin !== undefined && n.mesh !== undefined && json.meshes?.[n.mesh]?.primitives?.every(p => p.attributes?.JOINTS_0 !== undefined && p.attributes?.WEIGHTS_0 !== undefined)).length,
    bones: [...new Set((json.skins ?? []).flatMap(skin => skin.joints.map(i => json.nodes[i]?.name ?? '')))],
    clips: (json.animations ?? []).map(a => a.name),
    morphs: [...new Set((json.meshes ?? []).flatMap(mesh => mesh.extras?.targetNames ?? []))],
  }
}
