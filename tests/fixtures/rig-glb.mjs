// Deliberately tiny test geometry. Never installed as the production patient.
import { POSE_CLIPS, CORE_TRANSITION_CLIPS, PATIENT_MORPHS, BED_BONES } from '../../src/patientAnimation.ts'
export function rigFixture({ bed = false, invalid = false } = {}) {
  if (invalid) return Buffer.from('not a GLB')
  const chunks = [], bufferViews = [], accessors = []
  let offset = 0
  const accessor = (values, type, componentType = 5126, min, max) => {
    const data = Buffer.from((componentType === 5123 ? new Uint16Array(values) : new Float32Array(values)).buffer)
    const padding = (4 - data.length % 4) % 4
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length })
    chunks.push(data, Buffer.alloc(padding)); offset += data.length + padding
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type]
    accessors.push({ bufferView: bufferViews.length - 1, componentType, count: values.length / n, type, ...(min ? { min, max } : {}) })
    return accessors.length - 1
  }
  const position = accessor([-0.1, 0, 0, 0.1, 0, 0, 0, 0.2, 0], 'VEC3', 5126, [-0.1, 0, 0], [0.1, 0.2, 0])
  const indices = accessor([0, 1, 2], 'SCALAR', 5123)
  const joints = accessor(Array(12).fill(0), 'VEC4', 5123)
  const weights = accessor([1,0,0,0, 1,0,0,0, 1,0,0,0], 'VEC4')
  const normals = accessor([0,0,1,0,0,1,0,0,1], 'VEC3')
  const zeroMorph = accessor(Array(9).fill(0), 'VEC3', 5126, [0,0,0], [0,0,0])
  const names = bed ? [...BED_BONES] : ['mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Head']
  const nodes = [{ name: 'Asset', children: [1, 2] }, { name: 'PatientMesh', mesh: 0, skin: 0 }, { name: names[0], children: [3] }, { name: names[1], children: [4] }, { name: names[2] }]
  if (bed) nodes.push({ name: 'Bed_Pillow' }); if (bed) nodes[0].children.push(5)
  const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
  const bind = accessor([...identity, ...identity, ...identity], 'MAT4')
  const times = accessor([0, 0.5, 1], 'SCALAR', 5126, [0], [1])
  const quaternions = accessor([0,0,0,1, 0,0.1,0,Math.sqrt(0.99), 0,0,0,1], 'VEC4')
  const animations = bed ? [] : [...Object.values(POSE_CLIPS), ...CORE_TRANSITION_CLIPS, 'compression'].map(name => ({ name, samplers: [{ input: times, output: quaternions, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 4, path: 'rotation' } }] }))
  const gltf = { asset: { version: '2.0', generator: 'Careflow test fixture' }, scene: 0, scenes: [{ nodes: [0] }], nodes,
    meshes: [{ name: 'PatientMesh', extras: { targetNames: [...PATIENT_MORPHS] }, weights: Array(PATIENT_MORPHS.length).fill(0), primitives: [{ attributes: { POSITION: position, NORMAL: normals, JOINTS_0: joints, WEIGHTS_0: weights }, indices, material: 0, targets: PATIENT_MORPHS.map(() => ({ POSITION: zeroMorph })) }] }],
    materials: [{ name: 'skin_body', pbrMetallicRoughness: { baseColorFactor: [0.8,0.7,0.6,1], metallicFactor: 0, roughnessFactor: 0.85 } }],
    skins: [{ joints: [2,3,4], inverseBindMatrices: bind, skeleton: 2 }], animations, accessors, bufferViews, buffers: [{ byteLength: offset }],
  }
  let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc((4-json.length%4)%4, 32)])
  const bin = Buffer.concat(chunks), header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8)
  header.write('glTF'); header.writeUInt32LE(2,4); header.writeUInt32LE(12+8+json.length+8+bin.length,8)
  jsonHeader.writeUInt32LE(json.length);jsonHeader.writeUInt32LE(0x4e4f534a,4)
  binHeader.writeUInt32LE(bin.length);binHeader.writeUInt32LE(0x004e4942,4)
  return Buffer.concat([header,jsonHeader,json,binHeader,bin])
}
