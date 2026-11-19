// Build a licensed, visibly modified derivative without manufacturer textures.
// Node names are retained so saved editor IDs and bed grouping remain compatible.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { BoxGeometry, Color, ExtrudeGeometry, Path, Shape, SphereGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { readGlb } from './lib/glb.mjs'

const source = new URL('../public/models/gradd-hospital-room.glb', import.meta.url)
const output = new URL('../public/models/ward-room-neutral.glb', import.meta.url)
const original = await readFile(source), gltf = readGlb(original)
const sourceSha256 = createHash('sha256').update(original).digest('hex')
if (sourceSha256 !== '6b15769dc4a2713a7465a4289153f32dc58850df2ae013c5738d92ccb6ce06b0') throw new Error('Source model changed; review part indices before rebuilding.')
let cursor = 12, bin
while (cursor < original.length) {
  const length = original.readUInt32LE(cursor)
  if (original.readUInt32LE(cursor + 4) === 0x004e4942) bin = original.subarray(cursor + 8, cursor + 8 + length)
  cursor += 8 + length
}
if (!bin || gltf.extensionsUsed?.length) throw new Error('Expected the original uncompressed GLB.')
const parts = [bin]; let byteLength = bin.length
function accessor(array, type, bounds) {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength), index = gltf.accessors.length
  gltf.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length })
  gltf.accessors.push({ bufferView: gltf.bufferViews.length - 1, componentType: array instanceof Uint32Array ? 5125 : 5126, count: array.length / ({ VEC3: 3, VEC2: 2, SCALAR: 1 }[type]), type, ...bounds })
  parts.push(bytes, Buffer.alloc((4 - bytes.length % 4) % 4)); byteLength += bytes.length + (4 - bytes.length % 4) % 4
  return index
}
function primitive(geometry, material) {
  geometry.computeBoundingBox()
  const attributes = { POSITION: accessor(new Float32Array(geometry.attributes.position.array), 'VEC3', { min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() }) }
  if (geometry.attributes.normal) attributes.NORMAL = accessor(new Float32Array(geometry.attributes.normal.array), 'VEC3')
  const result = { attributes, material }
  if (geometry.index) result.indices = accessor(new Uint32Array(geometry.index.array), 'SCALAR')
  geometry.dispose()
  return result
}
function bounds(nodeIndex) {
  const ps = gltf.meshes[gltf.nodes[nodeIndex].mesh].primitives.map(p => gltf.accessors[p.attributes.POSITION])
  const min = [0, 1, 2].map(k => Math.min(...ps.map(a => a.min[k])))
  const max = [0, 1, 2].map(k => Math.max(...ps.map(a => a.max[k])))
  return { min, max, size: max.map((v, k) => v - min[k]), center: max.map((v, k) => (v + min[k]) / 2) }
}
const rgb = hex => new Color(hex).toArray()
const names = gltf.materials.map(m => m.name)
const hazardMaterial = names.indexOf('Bio_Waste_001')
const hazardTexture = gltf.materials[hazardMaterial].pbrMetallicRoughness.baseColorTexture.index
const hazardImage = gltf.images[gltf.textures[hazardTexture].source]
const hazardSampler = gltf.samplers?.[gltf.textures[hazardTexture].sampler] ?? {}
const removedMaterials = []
gltf.materials.forEach((m, i) => {
  const name = names[i], pbr = m.pbrMetallicRoughness
  if (pbr.baseColorTexture && i !== hazardMaterial) removedMaterials.push(i)
  let hex = '#e2eae7'
  if (/Black|Charcoal|Screen_Off/.test(name)) hex = '#253e46'
  else if (/Blue/.test(name)) hex = '#609b9a'
  else if (/Chrome|Steel|steel|Stainless/.test(name)) hex = '#91a8a7'
  else if (/Tan|BTEC_Med_Bed/.test(name)) hex = '#d3e1dd'
  else if (/Red_SemiGloss/.test(name)) hex = '#547f83'
  else if (/Cloth_White/.test(name)) hex = '#edf3ef'
  else if (/Xray_Light/.test(name)) hex = '#36515a'
  else if (/ECG_Monitor|BP_Monitor/.test(name)) hex = '#d7e7e4'
  else if (/LED/.test(name)) hex = '#76bda7'
  m.name = `ward_surface_${String(i).padStart(2, '0')}`
  m.pbrMetallicRoughness = { baseColorFactor: [...rgb(hex), pbr.baseColorFactor?.[3] ?? 1], metallicFactor: /Chrome|Steel|steel|Stainless/.test(name) ? 0.2 : 0, roughnessFactor: 0.78 }
  delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture
  if (i === hazardMaterial) {
    m.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1]
    m.pbrMetallicRoughness.baseColorTexture = { index: 0 }
  }
})
gltf.images = [hazardImage]; gltf.textures = [{ source: 0, sampler: 0 }]; gltf.samplers = [hazardSampler]
function material(name, hex, roughness = 0.8) {
  const index = gltf.materials.length
  gltf.materials.push({ name, pbrMetallicRoughness: { baseColorFactor: [...rgb(hex), 1], metallicFactor: 0, roughnessFactor: roughness } })
  return index
}
const shell = material('neutral_shell', '#e1eae6'), accent = material('neutral_accent', '#548f91'), display = material('neutral_standby_display', '#193b45'), indicator = material('neutral_indicator', '#89c7b2')
function replace(nodeIndex, geometry, mat) { gltf.meshes[gltf.nodes[nodeIndex].mesh].primitives = [primitive(geometry, mat)] }
function add(name, geometry, mat) {
  const mesh = gltf.meshes.length; gltf.meshes.push({ name, primitives: [primitive(geometry, mat)] })
  const node = gltf.nodes.length; gltf.nodes.push({ name, mesh }); gltf.scenes[gltf.scene ?? 0].nodes.push(node)
}
// Chamfered endboards with one wide elliptical handle replace the original slots.
for (const index of [77, 88]) {
  const b = bounds(index), [w, h, d] = [b.size[0] * 0.95, b.size[1] * 0.88, b.size[2] * 1.15]
  const s = new Shape(); s.moveTo(-w / 2, -h / 2); s.lineTo(w / 2, -h / 2); s.lineTo(w / 2, h * 0.27); s.lineTo(w * 0.35, h / 2); s.lineTo(-w * 0.35, h / 2); s.lineTo(-w / 2, h * 0.27); s.closePath()
  const handle = new Path(); handle.absellipse(0, h * 0.23, w * 0.24, h * 0.065, 0, Math.PI * 2, true); s.holes.push(handle)
  const y = b.min[1] + h / 2
  const board = new ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelSize: d * 0.12, bevelThickness: d * 0.12, bevelSegments: 1, curveSegments: 16 }).translate(b.center[0], y, b.center[2] - d / 2)
  replace(index, board, shell)
  add(`Neutral_Trim_${index}_Hospital_Bed`, new BoxGeometry(w * 0.76, h * 0.085, d * 1.3).translate(b.center[0], y - h * 0.26, b.center[2]), accent)
}
// Taper the waste container and soften the lid; retain the generic hazard sign.
const waste = bounds(165)
const positionAccessors = new Set(gltf.meshes[gltf.nodes[165].mesh].primitives.map(p => p.attributes.POSITION))
for (const index of positionAccessors) {
  const a = gltf.accessors[index], v = gltf.bufferViews[a.bufferView], values = new Float32Array(a.count * 3), view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
  for (let i = 0; i < a.count; i++) {
    const p = (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (v.byteStride ?? 12)
    const y = view.getFloat32(p + 4, true), taper = 0.9 + 0.1 * (y - waste.min[1]) / waste.size[1]
    values.set([waste.center[0] + (view.getFloat32(p, true) - waste.center[0]) * taper, y, waste.center[2] + (view.getFloat32(p + 8, true) - waste.center[2]) * taper], i * 3)
  }
  const next = accessor(values, 'VEC3', { min: waste.min, max: waste.max })
  for (const p of gltf.meshes[gltf.nodes[165].mesh].primitives) if (p.attributes.POSITION === index) p.attributes.POSITION = next
}
for (const index of [163, 164]) {
  const b = bounds(index)
  replace(index, new RoundedBoxGeometry(b.size[0] * 1.03, b.size[1], b.size[2] * 0.97, 2, Math.min(...b.size) * 0.2).translate(...b.center), accent)
}
// A new generic pressure-unit enclosure and a simple standby face without values.
for (const index of [159, 160]) {
  const b = bounds(index)
  replace(index, new RoundedBoxGeometry(...b.size, 2, Math.min(...b.size) * 0.18).translate(...b.center), index === 159 ? display : shell)
}
const pressure = bounds(160)
for (const x of [-0.27, 0, 0.27]) add(`Neutral_Key_${x}_Blood_Pressure_Monitor`, new SphereGeometry(pressure.size[0] * 0.075, 10, 6).scale(1, 1, 0.3).translate(pressure.center[0] + x * pressure.size[0], pressure.min[1] + pressure.size[1] * 0.16, pressure.max[2] + 0.5), accent)
// Original monitor body gets a new inset standby panel on its outward (+X) face.
const monitor = bounds(109), mx = monitor.max[0] + 0.2
add('Neutral_Display_ECG_Monitor', new BoxGeometry(0.35, monitor.size[1] * 0.65, monitor.size[2] * 0.72).translate(mx, monitor.center[1], monitor.center[2]), display)
for (let i = 0; i < 3; i++) add(`Neutral_Status_${i}_ECG_Monitor`, new BoxGeometry(0.1, 0.28, monitor.size[2] * (0.3 - i * 0.055)).translate(mx + 0.23, monitor.center[1] + (1 - i) * 1.5, monitor.center[2]), indicator)
const infusion = bounds(19), normal = infusion.size[0] < infusion.size[2] ? 0 : 2, horizontal = normal === 0 ? 2 : 0
const panelSize = [0, infusion.size[1] * 0.48, 0], panelCenter = [...infusion.center]
panelSize[normal] = 0.25; panelSize[horizontal] = infusion.size[horizontal] * 0.73
panelCenter[normal] = infusion.max[normal] + 0.2; panelCenter[1] += infusion.size[1] * 0.1
add('Neutral_Display_IV_Monitor', new BoxGeometry(...panelSize).translate(...panelCenter), display)
for (const offset of [-0.2, 0.2]) {
  const p = [...panelCenter]; p[horizontal] += infusion.size[horizontal] * offset; p[1] = infusion.min[1] + infusion.size[1] * 0.18
  add(`Neutral_Control_${offset}_IV_Monitor`, new SphereGeometry(infusion.size[horizontal] * 0.07, 10, 6).translate(...p), accent)
}

gltf.asset.copyright = 'GRADD Hospital Room by GRADD CO, CC BY 3.0, https://poly.pizza/m/9sUalfQ76kn. Original embedded texture credits: Brady Arnold. Modified neutral derivative by nurse-care-sim, 2026-11-19.'
gltf.asset.extras = { sourceSha256, changes: 'Manufacturer textures removed; neutral materials; new endboards, trims, infusion/monitor standby panels, pressure casing and buttons; tapered waste body and rounded lid. Generic biohazard warning retained.' }
// Repack referenced image/accessor views, omitting every removed texture's bytes.
const fullBin = Buffer.concat(parts), used = new Set(gltf.accessors.map(a => a.bufferView).filter(v => v !== undefined))
gltf.images.forEach(image => used.add(image.bufferView))
const remap = new Map(), packed = []; let packedLength = 0
const views = []
for (const index of [...used].sort((a, b) => a - b)) {
  const view = gltf.bufferViews[index], bytes = fullBin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength), padding = (4 - bytes.length % 4) % 4
  remap.set(index, views.length); views.push({ ...view, byteOffset: packedLength }); packed.push(bytes, Buffer.alloc(padding)); packedLength += bytes.length + padding
}
gltf.accessors.forEach(a => { if (a.bufferView !== undefined) a.bufferView = remap.get(a.bufferView) })
gltf.images.forEach(image => { image.bufferView = remap.get(image.bufferView) })
gltf.bufferViews = views; gltf.buffers = [{ byteLength: packedLength }]
let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)])
const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8)
header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + packedLength, 8)
jh.writeUInt32LE(json.length); jh.writeUInt32LE(0x4e4f534a, 4); bh.writeUInt32LE(packedLength); bh.writeUInt32LE(0x004e4942, 4)
await writeFile(output, Buffer.concat([header, jh, json, bh, ...packed]))
console.log(JSON.stringify({ output: output.pathname, originalBytes: original.length, bytes: 28 + json.length + packedLength, removedTextureMaterials: removedMaterials.length, retainedImages: gltf.images.length, redesignedParts: [77, 88, 159, 160, 163, 164, 165] }))
