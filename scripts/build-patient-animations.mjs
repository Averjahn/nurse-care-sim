import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {Quaternion,Euler,Vector3} from 'three'
import {readGlb} from './lib/glb.mjs'
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const {values:args}=parseArgs({options:{source:{type:'string',default:'exports/patient-source/patient-rig-base.glb'},output:{type:'string',default:'public/models/patient-rigged.glb'}}})
const input=resolve(project,args.source),output=resolve(project,args.output)
if(input===output)throw new Error('Source and output must be separate files.')
const bytes=await readFile(input),gltf=readGlb(bytes)
if(!gltf.skins?.length||gltf.animations?.length)throw new Error('Expected a skinned rest-pose source without existing clips.')
let cursor=12,binary
while(cursor<bytes.length){const size=bytes.readUInt32LE(cursor),type=bytes.readUInt32LE(cursor+4);if(type===0x004e4942)binary=bytes.subarray(cursor+8,cursor+8+size);cursor+=8+size}
if(!binary)throw new Error('Missing BIN chunk.')
const parts=[Buffer.from(binary)];let length=binary.length
const components={SCALAR:1,VEC3:3,VEC4:4,MAT4:16}
function append(values,type,componentType=5126,min,max){
 const data=Buffer.from((componentType===5123?new Uint16Array(values):new Float32Array(values)).buffer),padding=(4-data.length%4)%4,index=gltf.accessors.length
 gltf.bufferViews.push({buffer:0,byteOffset:length,byteLength:data.length});parts.push(data,Buffer.alloc(padding));length+=data.length+padding
 gltf.accessors.push({bufferView:gltf.bufferViews.length-1,componentType,count:values.length/components[type],type,...(min?{min,max}:{})});return index
}
function read(index){
 const a=gltf.accessors[index],v=gltf.bufferViews[a.bufferView],width=components[a.type],step=a.componentType===5123?2:4,stride=v.byteStride??width*step,out=[],data=new DataView(binary.buffer,binary.byteOffset,binary.byteLength)
 for(let i=0;i<a.count;i++)for(let c=0;c<width;c++){const p=(v.byteOffset??0)+(a.byteOffset??0)+i*stride+c*step;out.push(a.componentType===5123?data.getUint16(p,true):a.componentType===5125?data.getUint32(p,true):data.getFloat32(p,true))}return out
}
const mesh=gltf.meshes[0],primitive=mesh.primitives[0],positions=read(primitive.attributes.POSITION),rise=[],compression=[]
for(let i=0;i<positions.length;i+=3){
 const [x,y,z]=positions.slice(i,i+3),front=Math.max(0,Math.min(1,(z-.005)/.055)),mask=Math.exp(-((x/.17)**2)-(((y-1.28)/.14)**2))*front
 rise.push(0,0,.015*mask);compression.push(0,0,-.03*mask)
}
primitive.targets=[{POSITION:append(rise,'VEC3',5126,[0,0,0],[0,0,.015])},{POSITION:append(compression,'VEC3',5126,[0,0,-.03],[0,0,0])}]
mesh.extras={...mesh.extras,targetNames:['chest_rise','chest_compression']};mesh.weights=[0,0]
// Separate the visible skin from scrubs while preserving the same embedded PBR
// textures. State tinting must not recolor the entire blue gown.
const indices=primitive.indices===undefined?Array.from({length:positions.length/3},(_,i)=>i):read(primitive.indices),skin=[],cloth=[]
const isSkin=i=>{const [x,y]=positions.slice(i*3,i*3+2);return y>1.455||y<.13||(Math.abs(x)>.43&&y>.92&&y<1.34)}
for(let i=0;i<indices.length;i+=3){const triangle=indices.slice(i,i+3);(triangle.filter(isSkin).length>=2?skin:cloth).push(...triangle)}
const skinMaterial=structuredClone(gltf.materials[primitive.material??0]);skinMaterial.name='skin_body';gltf.materials.push(skinMaterial)
mesh.primitives=[{...primitive,indices:append(cloth,'SCALAR',5123)},{...primitive,material:gltf.materials.length-1,indices:append(skin,'SCALAR',5123)}]
const bones=gltf.skins[0].joints,boneName=index=>gltf.nodes[index].name.replace(/^mixamorig:/,'')
const q=(x=0,y=0,z=0)=>new Quaternion().setFromEuler(new Euler(x,y,z,'XYZ'))
function pose(name){
 const values=new Map(bones.map(index=>[index,q()])),hips=gltf.nodes.findIndex(n=>n.name==='mixamorig:Hips')
 const set=(bone,x,y,z)=>values.set(gltf.nodes.findIndex(n=>n.name===`mixamorig:${bone}`),q(x,y,z))
 const position=new Vector3(0,.32,0),neckPosition=new Vector3(0,.12,.10)
 values.set(hips,q(-Math.PI/2))
 for(const [side,sign]of[['Left',1],['Right',-1]]){set(`${side}Arm`,0,0,-sign*.85);set(`${side}ForeArm`,0,0,-sign*.13)}
 if(name==='semifowler'){neckPosition.z=0;set('Spine1',.4,0,0);set('Spine2',.25,0,0);set('Neck',-.08,0,0)}
 if(name==='legs_elevated')for(const side of ['Left','Right']){set(`${side}UpLeg`,-.28,0,0);set(`${side}Leg`,.1,0,0)}
 if(name==='sitting_edge'){
  values.set(hips,q(0,Math.PI/2,0));position.set(.58,.29,.16);neckPosition.z=0
  for(const [side,sign]of[['Left',1],['Right',-1]]){set(`${side}UpLeg`,-Math.PI/2,0,0);set(`${side}Leg`,Math.PI/2,0,0);set(`${side}Hand`,0,0,sign*1.5)}
 }
 if(name==='collapsed'){values.set(hips,q(0,0,.08).multiply(q(-Math.PI/2)));position.x=.08}
 return {values,position,neckPosition}
}
const profiles=Object.fromEntries(['lying','semifowler','sitting_edge','legs_elevated','collapsed','arrest'].map(name=>[name,pose(name)]))
const hips=gltf.nodes.findIndex(n=>n.name==='mixamorig:Hips'),animations=[]
function clip(name,from,to,duration,transition=false){
 const times=Array.from({length:Math.round(duration*30)+1},(_,i)=>i/30),input=append(times,'SCALAR',5126,[0],[duration]),samplers=[],channels=[]
 const add=(node,path,values,type)=>{const sampler=samplers.length;samplers.push({input,output:append(values,type),interpolation:'LINEAR'});channels.push({sampler,target:{node,path}})}
 for(const index of bones){const values=[];for(const time of times){const t=time/duration,eased=t*t*(3-2*t);values.push(...from.values.get(index).clone().slerp(to.values.get(index),eased).toArray())}add(index,'rotation',values,'VEC4')}
 const positions=[]
 for(const time of times){const t=time/duration,eased=t*t*(3-2*t),p=from.position.clone().lerp(to.position,eased);if(transition)p.y+=Math.sin(Math.PI*t)*.08;positions.push(...p.toArray())}
 add(hips,'translation',positions,'VEC3');
 const neck=gltf.nodes.findIndex(n=>n.name==='mixamorig:Neck'),neckPositions=[]
 for(const time of times){const t=time/duration,eased=t*t*(3-2*t);neckPositions.push(...from.neckPosition.clone().lerp(to.neckPosition,eased).toArray())}
 add(neck,'translation',neckPositions,'VEC3');animations.push({name,samplers,channels,extras:{fps:30,authoring:'procedural draft; contact and acting need manual refinement'}})
}
const idleNames={lying:'lying_idle',semifowler:'semifowler_idle',sitting_edge:'sit_edge_idle',legs_elevated:'legs_elevated_idle',collapsed:'collapsed_idle',arrest:'arrest_idle'}
for(const [name,idle]of Object.entries(idleNames))clip(idle,profiles[name],profiles[name],1)
for(const [name,from,to,duration]of[
 ['lying_to_sit_edge','lying','sitting_edge',4.5],['sit_edge_to_lying','sitting_edge','lying',4.5],['faint_from_sit','sitting_edge','collapsed',1.2],
 ['lying_to_semifowler','lying','semifowler',2],['semifowler_to_lying','semifowler','lying',2],['lying_to_legs_elevated','lying','legs_elevated',2],['legs_elevated_to_lying','legs_elevated','lying',2],
 ['collapse_from_lying','lying','collapsed',.6],['collapsed_to_lying','collapsed','lying',1],['arrest_to_lying','arrest','lying',1],
])clip(name,profiles[from],profiles[to],duration,true)
const pulseTimes=append([0,.15,.3],'SCALAR',5126,[0],[.3]),pulseValues=append([0,0,0,1,0,0],'SCALAR')
animations.push({name:'compression',samplers:[{input:pulseTimes,output:pulseValues,interpolation:'LINEAR'}],channels:[{sampler:0,target:{node:1,path:'weights'}}]})
gltf.animations=animations;gltf.buffers=[{byteLength:length}];gltf.nodes[0].name='PatientRig';gltf.asset.extras={...gltf.asset.extras,authoring:'Offline draft rig and keyframes based on the user-provided A-pose. Facial morphs/fingers/contact still require manual authoring.'}
let json=Buffer.from(JSON.stringify(gltf));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);const bin=Buffer.concat(parts),header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8)
header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+json.length+8+bin.length,8);jh.writeUInt32LE(json.length);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4)
await mkdir(dirname(output),{recursive:true});await writeFile(output,Buffer.concat([header,jh,json,bh,bin]),{flag:'wx'})
console.log(JSON.stringify({output,bones:bones.map(boneName),clips:animations.map(a=>a.name),morphs:mesh.extras.targetNames,bytes:12+8+json.length+8+bin.length,draft:true},null,2))
