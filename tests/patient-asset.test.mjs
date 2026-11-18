import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {readGlb,glbInventory} from '../scripts/lib/glb.mjs'
import {validatePatientRig,POSE_CLIPS} from '../src/patientAnimation.ts'
const bytes=await fs.readFile(new URL('../public/models/patient-rigged.glb',import.meta.url)),gltf=readGlb(bytes)
let offset=12,bin
while(offset<bytes.length){const length=bytes.readUInt32LE(offset);if(bytes.readUInt32LE(offset+4)===0x004e4942)bin=bytes.subarray(offset+8,offset+8+length);offset+=8+length}
function accessor(index){
 const a=gltf.accessors[index],v=gltf.bufferViews[a.bufferView],n={SCALAR:1,VEC3:3,VEC4:4,MAT4:16}[a.type],size=a.componentType===5123?2:4,view=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),out=[]
 for(let i=0;i<a.count;i++)for(let c=0;c<n;c++){const p=(v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??n*size)+c*size;out.push(a.componentType===5123?view.getUint16(p,true):a.componentType===5125?view.getUint32(p,true):view.getFloat32(p,true))}return out
}
test('provided patient derivative has real skinning and all runtime clips',()=>{
 const inventory=glbInventory(gltf),report=validatePatientRig(inventory)
 assert.equal(report.ok,true,report.errors.join('\n'));assert.equal(inventory.bones.length,27)
 assert.ok(inventory.morphs.includes('chest_rise'));assert.ok(inventory.morphs.includes('chest_compression'))
 assert.ok(bytes.length<15*1024*1024)
 const triangles=gltf.meshes.flatMap(m=>m.primitives).reduce((sum,p)=>sum+gltf.accessors[p.indices].count/3,0)
 assert.equal(triangles,49658)
})
test('every skin weight is finite, normalized and refers to a real joint',()=>{
 for(const p of gltf.meshes[0].primitives){
  const joints=accessor(p.attributes.JOINTS_0),weights=accessor(p.attributes.WEIGHTS_0)
  assert.equal(weights.length,gltf.accessors[p.attributes.POSITION].count*4)
  for(let i=0;i<weights.length;i+=4){
   const row=weights.slice(i,i+4);assert.ok(row.every(w=>Number.isFinite(w)&&w>=0&&w<=1));assert.ok(Math.abs(row.reduce((a,b)=>a+b,0)-1)<1e-6)
   assert.ok(joints.slice(i,i+4).every(index=>Number.isInteger(index)&&index>=0&&index<gltf.skins[0].joints.length))
  }
 }
})
test('transition boundaries match adjacent idle clips',()=>{
 for(const [name,from,to] of [['lying_to_sit_edge','lying','sitting_edge'],['sit_edge_to_lying','sitting_edge','lying'],['faint_from_sit','sitting_edge','collapsed']]){
  const transition=gltf.animations.find(a=>a.name===name),first=gltf.animations.find(a=>a.name===POSE_CLIPS[from]),last=gltf.animations.find(a=>a.name===POSE_CLIPS[to])
  for(const channel of transition.channels){
   const find=clip=>clip.channels.find(c=>c.target.node===channel.target.node&&c.target.path===channel.target.path)
   const values=accessor(transition.samplers[channel.sampler].output),a=accessor(first.samplers[find(first).sampler].output),b=accessor(last.samplers[find(last).sampler].output),width=channel.target.path==='rotation'?4:3
   for(let i=0;i<width;i++){assert.ok(Math.abs(values[i]-a[i])<1e-6);assert.ok(Math.abs(values[values.length-width+i]-b[i])<1e-6)}
  }
 }
})
test('facial morphs remain explicitly pending, not fabricated zero targets',()=>{
 const inventory=glbInventory(gltf)
 assert.ok(!inventory.morphs.includes('eyes_closed'))
 assert.ok(validatePatientRig(inventory).warnings.some(w=>w.includes('eyes_closed')))
 const rise=accessor(gltf.meshes[0].primitives[0].targets[0].POSITION),compression=accessor(gltf.meshes[0].primitives[0].targets[1].POSITION)
 assert.ok(rise.some(v=>v>0));assert.ok(compression.some(v=>v<0))
})
