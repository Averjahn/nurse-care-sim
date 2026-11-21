import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const url = process.env.SIM_URL ?? 'http://127.0.0.1:5173/'
const out = path.resolve('exports/emergency-browser')
await fs.mkdir(out, { recursive: true })
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'careflow-browser-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
let stderr = ''
chrome.stderr.on('data', data => { stderr += data })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let ws
try {
  let port
  for (let i = 0; i < 80; i++) { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await sleep(100) } }
  assert.ok(port, stderr.slice(-1500))
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  const pending = new Map(), exceptions = []
  ws.addEventListener('message', e => {
    const data = JSON.parse(e.data)
    if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails)
    if (!data.id) return
    const p = pending.get(data.id); if (!p) return
    clearTimeout(p.timer); pending.delete(data.id)
    if (data.error) p.reject(new Error(JSON.stringify(data.error))); else p.resolve(data.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
    return response.result.value
  }
  const wait = async (expr, name) => {
    for (let i = 0; i < 180; i++) { if (await evaluate(expr)) return; await sleep(100) }
    throw new Error(`Not reached: ${name}\n${await evaluate('document.body.innerText')}`)
  }
  const click = async (selector, text) => {
    assert.ok(await evaluate(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.includes(${JSON.stringify(text)}));if(!el || el.disabled)return false;el.click();return true})()`), `Missing control ${text}`)
    await sleep(80)
  }
  const shot = async name => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(out, `${name}.png`), Buffer.from(data, 'base64')) }
  await send('Page.enable'); await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url })
  await wait('document.querySelectorAll(".case-card").length === 6', 'case selection')
  await wait('document.querySelector("canvas") !== null', '3D canvas')
  await click('.case-card', 'Острая боль в животе')
  await click('button', 'Начать эпизод')
  await wait(`(async()=>{const source=await(await fetch('/src/RoomScene.tsx')).text();const spec=source.match(/from ["']([^"']*react-three_fiber[^"']*)["']/)[1];const three=source.match(/import [*] as THREE from ["']([^"']+)["']/)[1];window.__THREE=await import(three);const fiber=await import(spec);window.__threeStore=[...fiber._roots.values()][0]?.store;const app=await(await fetch('/src/App.tsx')).text();const storePath=app.match(/from ["']([^"']*store[^"']*)["']/)[1];window.__simulation=(await import(storePath)).useSimulationStore;return Boolean(window.__threeStore?.getState().scene.getObjectByName('interaction-chart'))})()`, 'interactive scene')
  await wait(`(()=>{let found=false;window.__threeStore.getState().scene.traverse(o=>{if(o.userData.patientRenderer==='rigged')found=true});return found})()`, 'patient model loaded')
  assert.equal(await evaluate('document.querySelectorAll(".plan-panel,.brand,.module-title,.object-dock,.event-history,.hud-icon,.call-doctor,.emergency-modal").length'),0,'Removed UI must stay absent')
  assert.ok(await evaluate('document.querySelector(".menu-button").textContent.includes("Выйти в меню")'))
  assert.equal(await evaluate('window.__threeStore.getState().scene.getObjectByName("interaction-patient").scale.x'),1,'Patient never grows')
  await evaluate('window.__initialCamera=window.__threeStore.getState().camera')
  assert.equal(await evaluate(`(()=>{const visible=[];window.__threeStore.getState().scene.traverse(o=>{if(o.name.startsWith('editable-imported-')&&o.visible)visible.push(o.name)});return visible.length})()`),0,'Unused decorative equipment stays hidden during simulation')
  assert.equal(await evaluate('window.__threeStore.getState().scene.getObjectByName("editable-bed").visible'),true,'Functional bed remains visible')
  assert.ok(await evaluate(`(()=>{const T=window.__THREE,scene=window.__threeStore.getState().scene,windowActor=scene.getObjectByName('editable-window'),wall=scene.getObjectByName('editable-wall-0');const p=windowActor.getWorldPosition(new T.Vector3());const ray=new T.Raycaster(p.clone().add(new T.Vector3(1,0,.3)),new T.Vector3(-1,0,0));const empty=ray.intersectObject(wall,true).length===0;ray.ray.origin.z=p.z+1.2;const solid=ray.intersectObject(wall,true).length>0;const frame=new T.Box3().setFromObject(scene.getObjectByName('window-frame-jamb-1')),wallBox=new T.Box3().setFromObject(wall);return empty&&solid&&Math.abs(frame.max.x-wallBox.max.x)<.02&&!scene.getObjectByName('interaction-window')})()`),'Window sits in a through-opening and has no simulation interaction')
  await shot('01-minimal-desktop')
  assert.equal(await evaluate(`Boolean(window.__threeStore.getState().scene.getObjectByName('treatment-cart'))`),false,'No central empty cart')
  const bedSize = await evaluate(`window.__threeStore.getState().scene.getObjectByName('restored-original-bed').userData.originalBounds`)
  assert.ok(bedSize[0] > 2 && bedSize[2] > 3.6,'Original bed dimensions preserved')
  await evaluate(`(()=>{const {camera,controls}=window.__threeStore.getState();controls.target.set(-.27,1.6,-2.1);controls.minDistance=.5;camera.position.set(4.5,4.2,3.4);controls.update();camera.updateMatrixWorld()})()`)
  const reports=[]
  for(const [position,head,thigh] of [['supine',0,0],['semiSitting',Math.PI/4,0],['kneesUp',0,.65],['legsUp',0,Math.PI/9]]) {
    await evaluate(`window.__simulation.setState(s=>({attempt:{...s.attempt,patient:{...s.attempt.patient,position:${JSON.stringify(position)}}}}))`)
    await wait(`Math.abs(window.__threeStore.getState().scene.getObjectByName('Bed_Head').rotation.x-${head})<.001`,`${position}: head settled`)
    // Wait until the shared two-second motion has finished in every section.
    await wait(`(()=>{let up;window.__threeStore.getState().scene.traverse(o=>{if(o.name==='mixamorigLeftUpLeg')up=o});return up&&Math.abs(up.rotation.x+${thigh}-(.035+.045*Math.sin(${head})))<.001})()`, `${position}: knee settled`)
    const report = await evaluate(`(async()=>{const T=window.__THREE,scene=window.__threeStore.getState().scene,{mattressHeight}=await import('/src/bedKinematics.ts');let rig,mesh;scene.traverse(o=>{if(o.userData.patientRenderer==='rigged')rig=o});rig.traverse(o=>{if(!mesh&&o.isSkinnedMesh)mesh=o});const frame=scene.getObjectByName('bed-contact-frame');scene.updateMatrixWorld(true);const inv=new T.Matrix4().copy(frame.matrixWorld).invert(),p=new T.Vector3();const head=scene.getObjectByName('Bed_Head').rotation.x;const bones=[];rig.traverse(o=>{if(o.isBone)bones.push(o)});const up=bones.find(o=>o.name.endsWith('LeftUpLeg')),shin=bones.find(o=>o.name.endsWith('LeftLeg'));const a=scene.getObjectByName('restored-original-bed').userData.bedAngles;const regions={pelvis:Infinity,thigh:Infinity,calf:Infinity,torso:Infinity};let min=Infinity,near=0,checked=0;for(let i=0;i<mesh.geometry.getAttribute('position').count;i++){mesh.getVertexPosition(i,p);mesh.localToWorld(p).applyMatrix4(inv);if(Math.abs(p.x)>.9)continue;const h=mattressHeight(p.z,a);if(h===null)continue;min=Math.min(min,p.y-h);const rest=mesh.geometry.getAttribute('position'),y=rest.getY(i);if(Math.abs(rest.getX(i))<.18){const region=y<.5?'calf':y<.85?'thigh':y<1.02?'pelvis':y<1.4?'torso':null;if(region)regions[region]=Math.min(regions[region],p.y-h)}if(p.y-h<.05)near++;checked++}return {position:${JSON.stringify(position)},min,near,checked,regions,head,thigh:-up.rotation.x,knee:shin.rotation.x,shin:a.shin,samples:rig.userData.contactSamples,rootOffset:rig.position.y}})()`)
    reports.push(report)
    assert.ok(report.min >= 0,`Patient must not penetrate mattress: ${JSON.stringify(report)}`)
    assert.ok(report.near > 20,`Patient must rest on mattress, not float: ${JSON.stringify(report)}`)
    assert.ok(Math.abs(report.knee-(thigh-report.shin))<.001, 'Patient knee matches the mattress flexion: '+JSON.stringify(report))
    assert.ok(report.regions.calf < .045, 'Heels rest on the mattress: '+JSON.stringify(report))
    await shot('bed-calibration-'+position)
  }
  await evaluate(`window.__simulation.setState(s=>({attempt:{...s.attempt,paused:true,completed:[...s.attempt.completed,'blanket']}}))`)
  await wait(`(()=>{let actor=window.__threeStore.getState().scene.getObjectByName('patient-blanket');while(actor){if(!actor.visible)return false;actor=actor.parent}return true})()`, 'blanket covers raised legs')
  await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
  await shot('bed-calibration-blanket')
  const handReports = []
  for (const [position, head, thigh] of [['supine',0,0],['semiSitting',Math.PI/4,0],['kneesUp',0,.65],['legsUp',0,Math.PI/9]]) {
    await evaluate(`window.__simulation.setState(s=>({attempt:{...s.attempt,paused:false,patient:{...s.attempt.patient,position:${JSON.stringify(position)}}}}))`)
    await wait(`(()=>{const scene=window.__threeStore.getState().scene;let up;scene.traverse(o=>{if(o.name==='mixamorigLeftUpLeg')up=o});return Math.abs(scene.getObjectByName('Bed_Head').rotation.x-${head})<.001&&up&&Math.abs(up.rotation.x+${thigh}-(.035+.045*Math.sin(${head})))<.001})()`, 'covered pose settled')
    await evaluate('window.__simulation.setState(s=>({attempt:{...s.attempt,paused:true}}))')
    const hands = await evaluate(`(()=>{const T=window.__THREE,scene=window.__threeStore.getState().scene,cloth=scene.getObjectByName('patient-blanket').children[0];scene.updateMatrixWorld(true);return ['Left','Right'].flatMap(side=>['Hand','Hand_End'].map(part=>{let bone;scene.traverse(o=>{if(o.name==='mixamorig'+side+part)bone=o});const p=bone.getWorldPosition(new T.Vector3());const ray=new T.Raycaster(p.clone().add(new T.Vector3(0,3,0)),new T.Vector3(0,-1,0));const hit=ray.intersectObject(cloth)[0];return {bone:side+part,clearance:hit?hit.distance-3:null}}))})()`)
    for (const hand of hands) assert.ok(hand.clearance !== null && hand.clearance > .02, `${position}: hand stays above fabric: ${JSON.stringify(hand)}`)
    handReports.push({ position, hands })
    await shot('blanket-hands-'+position)
  }
  console.log(JSON.stringify(handReports, null, 2))
  console.log(JSON.stringify(reports,null,2))
  assert.equal(exceptions.length,0,JSON.stringify(exceptions))
  console.log('Original bed, all four supported poses, shared hinge angles and full-mesh mattress clearance passed.')
} finally {
  ws?.close();chrome.kill('SIGTERM');chrome.stderr.destroy();chrome.unref()
  await sleep(300)
  await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:150})
}
