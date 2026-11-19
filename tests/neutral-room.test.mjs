import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { readGlb } from '../scripts/lib/glb.mjs'

const sourceBytes = await readFile(new URL('../public/models/gradd-hospital-room.glb', import.meta.url))
const bytes = await readFile(new URL('../public/models/ward-room-neutral.glb', import.meta.url))
const source = readGlb(sourceBytes), neutral = readGlb(bytes)
function binary(data) {
  let offset = 12
  while (offset < data.length) {
    const length = data.readUInt32LE(offset)
    if (data.readUInt32LE(offset + 4) === 0x004e4942) return data.subarray(offset + 8, offset + 8 + length)
    offset += 8 + length
  }
}
function positions(data, gltf, node) {
  const index = gltf.meshes[gltf.nodes[node].mesh].primitives[0].attributes.POSITION
  const a = gltf.accessors[index], v = gltf.bufferViews[a.bufferView], bin = binary(data), result = []
  for (let i = 0; i < a.count; i++) for (let j = 0; j < 3; j++) result.push(bin.readFloatLE((v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (v.byteStride ?? 12) + j * 4))
  return result
}
test('neutral room removes manufacturer maps and keeps the generic hazard warning', () => {
  assert.equal(neutral.images.length, 1)
  assert.equal(neutral.textures.length, 1)
  assert.equal(neutral.materials.filter(m => m.pbrMetallicRoughness?.baseColorTexture).length, 1)
  assert.ok(neutral.materials.every(m => !/BTEC|BTMB|BTEM|BTIM/i.test(m.name)))
  const originalImage = source.images[source.textures[45].source], originalView = source.bufferViews[originalImage.bufferView]
  const image = neutral.images[0], view = neutral.bufferViews[image.bufferView]
  assert.ok(binary(bytes).subarray(view.byteOffset, view.byteOffset + view.byteLength).equals(binary(sourceBytes).subarray(originalView.byteOffset, originalView.byteOffset + originalView.byteLength)))
  assert.ok(bytes.length < sourceBytes.length)
})
test('model redesign changes physical parts while preserving mattress and room alignment', () => {
  for (const node of [77, 88, 159, 160, 163, 164, 165]) assert.notDeepEqual(positions(bytes, neutral, node), positions(sourceBytes, source, node))
  for (const node of [0, 1, 2, 65, 97]) assert.deepEqual(positions(bytes, neutral, node), positions(sourceBytes, source, node))
  assert.ok(neutral.nodes.some(n => n.name === 'Neutral_Display_ECG_Monitor'))
  assert.ok(neutral.nodes.some(n => n.name === 'Neutral_Display_IV_Monitor'))
})
test('derivative keeps provenance, author credits and license', () => {
  assert.equal(neutral.asset.extras.sourceSha256, createHash('sha256').update(sourceBytes).digest('hex'))
  assert.match(neutral.asset.copyright, /GRADD CO.*CC BY 3.0.*Brady Arnold/)
  assert.match(neutral.asset.extras.changes, /Manufacturer textures removed/)
})
