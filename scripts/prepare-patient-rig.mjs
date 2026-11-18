import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {createHash} from 'node:crypto'
import {Matrix4,Vector3,Quaternion} from 'three'
import {readGlb} from './lib/glb.mjs'

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const {values:args}=parseArgs({options:{source:{type:'string',default:'A-pose.glb'},output:{type:'string',default:'exports/patient-source/patient-rig-base.glb'}}})
const input=resolve(project,args.source),output=resolve(project,args.output)
if(input===output)throw new Error('Source and output must be separate files.')
const bytes=await readFile(input),gltf=readGlb(bytes)
const sourceHash=createHash('sha256').update(bytes).digest('hex')
if(sourceHash!=='5fa58345e1990350a3ea9ebe0dd4393f7fc7fdf575e5efedaef30b0d888892aa')throw new Error('This draft skeleton is tailored to the provided A-pose.glb. Check anatomical landmarks before using another source.')
if(gltf.skins?.length||gltf.animations?.length)throw new Error('Input already has a skin or animation. Refusing automatic re-rigging.')
if(gltf.nodes?.length!==1||gltf.nodes[0].mesh===undefined||gltf.nodes[0].matrix||gltf.nodes[0].rotation||gltf.nodes[0].translation||gltf.nodes[0].scale)throw new Error('Draft rigger expects a single untransformed A-pose mesh.')
if(gltf.meshes?.length!==1)throw new Error('Expected one source mesh.')
const primitives=gltf.meshes[0].primitives
if(primitives.length!==1)throw new Error('Expected one source primitive.')
const primitive=primitives[0]
const sizes={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16},componentBytes={5121:1,5123:2,5125:4,5126:4}
let cursor=12,originalBin
while(cursor<bytes.length){const length=bytes.readUInt32LE(cursor),type=bytes.readUInt32LE(cursor+4);if(type===0x004e4942)originalBin=bytes.subarray(cursor+8,cursor+8+length);cursor+=8+length}
if(!originalBin)throw new Error('Missing binary data.')
const parts=[Buffer.from(originalBin)],oldNodes=gltf.nodes
let byteLength=originalBin.length
function readAccessor(index){
 const accessor=gltf.accessors[index],view=gltf.bufferViews[accessor.bufferView]
 if(accessor.sparse)throw new Error('Sparse accessors are not supported by the draft rigger.')
 const components=sizes[accessor.type],step=componentBytes[accessor.componentType],stride=view.byteStride??components*step,buffer=new DataView(originalBin.buffer,originalBin.byteOffset,originalBin.byteLength),out=[]
 for(let i=0;i<accessor.count;i++)for(let c=0;c<components;c++){
  const offset=(view.byteOffset??0)+(accessor.byteOffset??0)+i*stride+c*step
  out.push(accessor.componentType===5126?buffer.getFloat32(offset,true):accessor.componentType===5123?buffer.getUint16(offset,true):accessor.componentType===5125?buffer.getUint32(offset,true):buffer.getUint8(offset))
 }
 return out
}
function append(values,type,componentType=5126,min,max){
 const data=Buffer.from((componentType===5123?new Uint16Array(values):new Float32Array(values)).buffer),padding=(4-data.length%4)%4
 gltf.bufferViews.push({buffer:0,byteOffset:byteLength,byteLength:data.length});parts.push(data,Buffer.alloc(padding));byteLength+=data.length+padding
 const index=gltf.accessors.length
 gltf.accessors.push({bufferView:gltf.bufferViews.length-1,componentType,type,count:values.length/sizes[type],...(min?{min,max}:{})})
 return index
}
const positions=readAccessor(primitive.attributes.POSITION),normalValues=primitive.attributes.NORMAL===undefined?null:readAccessor(primitive.attributes.NORMAL)
const sourceBounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}
for(let i=0;i<positions.length;i++){
 const c=i%3;sourceBounds.min[c]=Math.min(sourceBounds.min[c],positions[i]);sourceBounds.max[c]=Math.max(sourceBounds.max[c],positions[i])
}
const height=sourceBounds.max[1]-sourceBounds.min[1],scale=1.8/height
if(height<=0)throw new Error('Zero source height.')
const centerX=(sourceBounds.min[0]+sourceBounds.max[0])/2,centerZ=(sourceBounds.min[2]+sourceBounds.max[2])/2
const points=[],canonical=[],minimum=[Infinity,Infinity,Infinity],maximum=[-Infinity,-Infinity,-Infinity]
// This verified Tripo source faces +X. Canonical humanoid faces +Z, Y up.
for(let i=0;i<positions.length;i+=3){
 const p=new Vector3(-(positions[i+2]-centerZ)*scale,(positions[i+1]-sourceBounds.min[1])*scale,(positions[i]-centerX)*scale)
 points.push(p);canonical.push(...p.toArray())
 for(let c=0;c<3;c++){minimum[c]=Math.min(minimum[c],p.getComponent(c));maximum[c]=Math.max(maximum[c],p.getComponent(c))}
}
primitive.attributes.POSITION=append(canonical,'VEC3',5126,minimum,maximum)
if(normalValues){const normals=[];for(let i=0;i<normalValues.length;i+=3)normals.push(-normalValues[i+2],normalValues[i+1],normalValues[i]);primitive.attributes.NORMAL=append(normals,'VEC3')}
if(primitive.attributes.TANGENT!==undefined)throw new Error('Recompute tangent orientation explicitly before preparing this source.')
const bones=[]
function bone(name,parent,point){bones.push({name:`mixamorig:${name}`,parent,world:new Vector3(...point)});return bones.length-1}
const hips=bone('Hips',null,[0,.9,0]),spine=bone('Spine',hips,[0,1.02,0]),spine1=bone('Spine1',spine,[0,1.17,0]),spine2=bone('Spine2',spine1,[0,1.34,0]),neck=bone('Neck',spine2,[0,1.46,0]),head=bone('Head',neck,[0,1.60,0]);bone('HeadTop_End',head,[0,1.8,0])
for(const [side,sign]of[['Left',1],['Right',-1]]){
 const shoulder=bone(`${side}Shoulder`,spine2,[sign*.14,1.38,0]),arm=bone(`${side}Arm`,shoulder,[sign*.22,1.38,0]),forearm=bone(`${side}ForeArm`,arm,[sign*.44,1.20,0]),hand=bone(`${side}Hand`,forearm,[sign*.64,1.06,0]);bone(`${side}Hand_End`,hand,[sign*.76,1.0,.01])
 const thigh=bone(`${side}UpLeg`,hips,[sign*.105,.89,0]),knee=bone(`${side}Leg`,thigh,[sign*.11,.48,.01]),foot=bone(`${side}Foot`,knee,[sign*.11,.105,0]),toe=bone(`${side}ToeBase`,foot,[sign*.11,.04,.11]);bone(`${side}Toe_End`,toe,[sign*.11,.025,.18])
}
const segments=[]
for(let i=0;i<bones.length;i++){
 const children=bones.map((b,index)=>({b,index})).filter(({b})=>b.parent===i)
 for(const {b}of children)segments.push({index:i,a:bones[i].world,b:b.world})
}
function segmentDistance(point,a,b){const delta=b.clone().sub(a),t=Math.max(0,Math.min(1,point.clone().sub(a).dot(delta)/delta.lengthSq()));return point.distanceTo(a.clone().addScaledVector(delta,t))}
const joints=[],weights=[]
let worstWeightError=0
for(const p of points){
 const side=p.x>=0?'Left':'Right',armRegion=Math.abs(p.x)>.245&&p.y>.92,legRegion=p.y<.86
 const candidates=segments.filter(segment=>{
  const name=bones[segment.index].name
  if(armRegion)return name.includes(`${side}Shoulder`)||name.includes(`${side}Arm`)||name.includes(`${side}ForeArm`)||name.includes(`${side}Hand`)
  if(legRegion)return name.includes(`${side}UpLeg`)||name.includes(`${side}Leg`)||name.includes(`${side}Foot`)||name.includes(`${side}ToeBase`)||name.endsWith(':Hips')
  return !/Left|Right/.test(name)
 }).map(segment=>({...segment,distance:segmentDistance(p,segment.a,segment.b)}))
 const nearestByBone=new Map()
 for(const candidate of candidates)if(!nearestByBone.has(candidate.index)||nearestByBone.get(candidate.index).distance>candidate.distance)nearestByBone.set(candidate.index,candidate)
 candidates.splice(0,candidates.length,...[...nearestByBone.values()].sort((a,b)=>a.distance-b.distance).slice(0,4))
 if(!candidates.length)throw new Error('No skinning candidates.')
 const scores=candidates.map(s=>1/(s.distance*s.distance+.0004)**2),total=scores.reduce((a,b)=>a+b,0)
 const values=scores.map(s=>s/total);worstWeightError=Math.max(worstWeightError,Math.abs(values.reduce((a,b)=>a+b,0)-1))
 for(let i=0;i<4;i++){joints.push(candidates[i]?.index??0);weights.push(values[i]??0)}
}
primitive.attributes.JOINTS_0=append(joints,'VEC4',5123);primitive.attributes.WEIGHTS_0=append(weights,'VEC4')
const inverse=[]
for(const b of bones)inverse.push(...new Matrix4().compose(b.world,new Quaternion(),new Vector3(1,1,1)).invert().elements)
const inverseBindMatrices=append(inverse,'MAT4')
gltf.nodes=[{name:'PatientRig_Draft',children:[1,2],extras:{draft:true,sourceSha256:createHash('sha256').update(bytes).digest('hex')}},{...oldNodes[0],name:'PatientBody',skin:0}]
for(const b of bones){const translation=b.parent===null?b.world:b.world.clone().sub(bones[b.parent].world);gltf.nodes.push({name:b.name,translation:translation.toArray()})}
for(let i=0;i<bones.length;i++)if(bones[i].parent!==null){const parent=gltf.nodes[bones[i].parent+2];(parent.children??=[]).push(i+2)}
gltf.skins=[{name:'MixamoCompatibleDraft',joints:bones.map((_,i)=>i+2),inverseBindMatrices,skeleton:2}]
gltf.scenes=[{name:'Patient A-pose rig draft',nodes:[0]}];gltf.scene=0;gltf.buffers=[{byteLength}]
gltf.asset.extras={...gltf.asset.extras,preparation:'Offline draft skinning: verify joint placement and weights in a DCC before final animation. No clips, facial morphs or finger rig are authored.'}
let json=Buffer.from(JSON.stringify(gltf));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)])
const binary=Buffer.concat(parts),header=Buffer.alloc(12),jsonHeader=Buffer.alloc(8),binHeader=Buffer.alloc(8)
header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+json.length+8+binary.length,8)
jsonHeader.writeUInt32LE(json.length);jsonHeader.writeUInt32LE(0x4e4f534a,4);binHeader.writeUInt32LE(binary.length);binHeader.writeUInt32LE(0x004e4942,4)
await mkdir(dirname(output),{recursive:true});await writeFile(output,Buffer.concat([header,jsonHeader,json,binHeader,binary]),{flag:'wx'})
const report={input,output,sourceSha256:createHash('sha256').update(bytes).digest('hex'),vertices:points.length,bones:bones.length,canonicalHeight:1.8,front:'+Z',worstWeightError,draft:true,missing:['finger rig','facial morphs','animation clips','manual weight correction and contact checks']}
await mkdir(resolve(project,'exports/patient-source'),{recursive:true});await writeFile(resolve(project,'exports/patient-source/rig-preparation.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
