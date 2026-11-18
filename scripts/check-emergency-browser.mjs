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
    for (let i = 0; i < 100; i++) { if (await evaluate(expr)) return; await sleep(100) }
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
  await shot('01-minimal-desktop')
  const select = async id => {
    if(await evaluate(`Boolean(document.querySelector('[aria-label="Закрыть действия"]'))`)) await click('[aria-label="Закрыть действия"]','')
    await evaluate(`(()=>{const {scene,camera,controls}=window.__threeStore.getState();scene.updateMatrixWorld(true);const target=scene.getObjectByName('interaction-'+${JSON.stringify(id)});if(!target)throw new Error('Missing interactive object');const center=new window.__THREE.Box3().setFromObject(target).getCenter(new window.__THREE.Vector3());controls.enableDamping=false;controls.minDistance=1;controls.target.copy(center);camera.position.copy(center).add(new window.__THREE.Vector3(3,3,5));controls.update();camera.updateMatrixWorld();scene.updateMatrixWorld(true)})()`)
    await sleep(100)
    const point=await evaluate(`(()=>{const T=window.__THREE,{scene,camera,gl}=window.__threeStore.getState();const target=scene.getObjectByName('interaction-'+${JSON.stringify(id)}),candidates=[target.getWorldPosition(new T.Vector3())];target.traverse(o=>{if(o instanceof T.Mesh)candidates.push(new T.Box3().setFromObject(o).getCenter(new T.Vector3()))});const rect=gl.domElement.getBoundingClientRect();for(const point of candidates){const p=point.project(camera);const x=rect.left+(p.x+1)/2*rect.width,y=rect.top+(1-p.y)/2*rect.height;if(document.elementFromPoint(x,y)!==gl.domElement)continue;const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(p.x,p.y),camera);let hit=ray.intersectObjects(scene.children,true).find(h=>{let o=h.object;while(o){if(!o.visible)return false;o=o.parent}return true})?.object;while(hit){if(hit===target)return {x,y};hit=hit.parent}}return null})()`)
    assert.ok(point,`Object ${id} must be visible and clickable in the scene`)
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point})
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1})
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1})
    await sleep(150)
    await wait('document.querySelector(".action-panel")?.style.visibility === "visible"',`${id}: scene click opens anchored actions`)
    const popup=await evaluate(`(()=>{const r=document.querySelector('.action-panel').getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}})()`)
    assert.ok(popup.left>=10 && popup.top>=64 && popup.right<=await evaluate('innerWidth')-10 && popup.bottom<=await evaluate('innerHeight')-10,'Popup fits viewport')
    const distance=Math.hypot(Math.max(popup.left-point.x,0,point.x-popup.right),Math.max(popup.top-point.y,0,point.y-popup.bottom))
    assert.ok(distance<60,'Popup appears beside the clicked 3D object')
    assert.equal(await evaluate('window.__threeStore.getState().scene.getObjectByName('+JSON.stringify('interaction-'+id)+').userData.hinted'),false,'Click acknowledges hint')
  }
  const action = name => click('.context-actions button', name)
  await select('call-bell');await action('Срочно вызвать врача')
  assert.notEqual(await evaluate('window.__simulation.getState().attempt.doctorCalledAt'),null)
  await select('patient');await action('Спросить о жалобах');await action('Оценить сознание')
  await select('bed-controls');await action('Уложить на спину')
  await wait('document.querySelector(".action-panel") === null','Bed choice closes action panel')
  await select('equipment');await action('Отказаться от грелки')
  await select('monitor');await action('Измерить давление')
  for(let i=0;i<3;i++){await sleep(450);await click('.measurement-game button','Отметить пульсовую волну')}
  await wait('document.querySelector(".observed-vitals").textContent.includes("110")','measured vitals')
  const attempt=await evaluate('window.__simulation.getState().attempt')
  assert.notEqual(attempt.stableAt,null);assert.equal(attempt.errors.length,0)
  await evaluate('window.__simulation.getState().tick(91)')
  await action('Повторно измерить давление')
  for(let i=0;i<3;i++){await sleep(450);await click('.measurement-game button','Отметить пульсовую волну')}
  await wait('document.querySelector(".measurement-game") === null','repeat measurement')
  await select('chart');await action('Записать фактические показатели')
  await shot('02-physical-chart')
  await select('call-bell');await action('Передать пациентку')
  await wait('document.querySelector(".results-panel") !== null','successful handoff')
  await shot('03-results')
  await click('button','Выбрать другой')
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  await click('button','Начать эпизод')
  await wait('window.__simulation.getState().attempt?.phase === "active"','mobile attempt')
  await shot('04-minimal-mobile')
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
  await select('heater');await action('Приложить грелку')
  assert.ok(await evaluate('document.querySelector(".action-feedback").textContent.includes("запрещены")'))
  await shot('05-mobile-context')
  await click('[aria-label="Закрыть действия"]','')
  await click('button','Выйти в меню')
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
  // Known next-step states isolate visual hint behavior from clinical scoring.
  await click('button','Начать эпизод')
  await evaluate("window.__simulation.setState(s=>({attempt:{...s.attempt,completed:['call-doctor']}}))")
  await wait('window.__threeStore.getState().scene.getObjectByName("interaction-patient").userData.hinted','patient hint')
  const glow=[]
  for(let i=0;i<8;i++){
    const sample=await evaluate(`(()=>{const root=window.__threeStore.getState().scene.getObjectByName('interaction-patient');let intensity=0;root.traverse(o=>{if(o.material?.emissive){const shader={uniforms:{},fragmentShader:'#include <opaque_fragment>'};o.material.onBeforeCompile(shader,window.__threeStore.getState().gl);intensity=Math.max(intensity,shader.uniforms.interactionStrength?.value??0)}});return {scale:root.scale.x,intensity}})()`)
    assert.equal(sample.scale,1,'Highlighted patient keeps original size');glow.push(sample.intensity);await sleep(100)
  }
  assert.ok(Math.max(...glow)-Math.min(...glow)>0.1,'Patient mesh itself glows')
  await evaluate("window.__simulation.setState(s=>({attempt:{...s.attempt,completed:['talk','inspect','baseline','measure']}}))")
  await wait('window.__threeStore.getState().scene.getObjectByName("interaction-call-bell").userData.hinted','call button hint')
  const samples=[]
  for(let i=0;i<20;i++){samples.push(await evaluate('window.__threeStore.getState().scene.getObjectByName("interaction-call-bell").scale.x'));await sleep(90)}
  if (Math.max(...samples)<=1.47 || Math.min(...samples)>=1.03) console.log('Pulse samples', samples)
  assert.ok(Math.max(...samples)>1.47 && Math.max(...samples)<=1.5,'Call button pulses up to 1.5×')
  assert.ok(Math.min(...samples)<1.03,'Call button returns to original scale')
  await select('call-bell')
  await wait('window.__threeStore.getState().scene.getObjectByName("interaction-call-bell").scale.x===1','Click stops size pulse')
  await click('[aria-label="Закрыть действия"]','')
  await click('.header-actions button','От первого лица')
  await wait('document.querySelector(".crosshair-label") !== null','first-person crosshair')
  await evaluate('(()=>{const {camera}=window.__threeStore.getState();camera.position.set(1.9,1.475,0.98);camera.lookAt(1.9,1.475,-3.62);camera.updateMatrixWorld()})()')
  await wait('document.querySelector(".crosshair-label").textContent.includes("Кислород")','unlimited first-person reach')
  assert.equal(await evaluate('window.__initialCamera===window.__threeStore.getState().camera'),true,'Timer updates must preserve the configured camera instance')
  assert.equal(exceptions.length,0,JSON.stringify(exceptions))
  assert.ok(await evaluate('window.__threeStore.getState().gl.info.programs.every(p=>p.diagnostics?.runnable!==false)'), 'GPU shaders compile')
  console.log('Browser passed: minimal HUD, real 3D clicks, assessment, bed auto-close, measurement, stabilization, physical chart, handoff, mobile layout, contextual feedback, 1.5× bell pulse, fixed patient scale, click acknowledgement, first-person reach. No runtime exceptions.')
} finally {
  ws?.close();chrome.kill('SIGTERM');chrome.stderr.destroy();chrome.unref()
  await sleep(300)
  await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:150})
}
