import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const url = process.env.SIM_URL ?? 'http://127.0.0.1:5173/'
const out = path.resolve('exports/scene-editor-browser')
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
  const initialize = async () => {
    await wait(`(async()=>{const app=await(await fetch('/src/App.tsx')).text();window.__editor=(await import(app.match(/from ["']([^"']*sceneEditorStore[^"']*)["']/)[1])).useSceneEditor;window.__simulation=(await import(app.match(/from ["']([^"']*[/]store[^"']*)["']/)[1])).useSimulationStore;const source=await(await fetch('/src/RoomScene.tsx')).text();const f=await import(source.match(/from ["']([^"']*react-three_fiber[^"']*)["']/)[1]);window.__T=await import(source.match(/import [*] as THREE from ["']([^"']+)["']/)[1]);window.__three=[...f._roots.values()][0]?.store;return Object.keys(window.__editor.getState().targets).length>20})()`,'registered scene objects')
  }
  const shortcut = async () => {
    for(const [key,code] of [['q','KeyQ'],['w','KeyW'],['e','KeyE']]){
      await send('Input.dispatchKeyEvent',{type:'keyDown',key,code})
    }
    for(const [key,code] of [['q','KeyQ'],['w','KeyW'],['e','KeyE']]) await send('Input.dispatchKeyEvent',{type:'keyUp',key,code})
    await wait('Boolean(document.querySelector(".scene-editor"))','QWE opens scene editor')
  }
  const input = async (selector,value) => {
    assert.ok(await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;const type=el.tagName==='TEXTAREA'?HTMLTextAreaElement:el.tagName==='SELECT'?HTMLSelectElement:HTMLInputElement;Object.getOwnPropertyDescriptor(type.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true})()`),selector)
    await sleep(100)
  }
  await initialize()
  await click('button','Начать эпизод');await shortcut()
  await input('[aria-label="Расстановка кейса"]','')
  await wait(`!Object.keys(window.__editor.getState().targets).some(id=>id.startsWith('imported-')||id.startsWith('wall-')||id==='window')`,'editor excludes decoration')
  const clock=await evaluate('window.__simulation.getState().attempt.patient.secondsSinceOnset')
  await sleep(600);assert.equal(await evaluate('window.__simulation.getState().attempt.patient.secondsSinceOnset'),clock,'Editor pauses clinical time')
  assert.equal(await evaluate('document.querySelectorAll(".patient-panel,.action-panel,.scenario-picker").length'),0)
  await shot('01-editor-overview')
  // Choose an actual 3D control through the canvas, not the inspector list.
  const point=await evaluate(`(()=>{const {camera,controls}=window.__three.getState(),T=window.__T;const target=window.__editor.getState().targets['call-bell'].object;const center=target.getWorldPosition(new T.Vector3());controls.enableDamping=false;controls.minDistance=1;controls.target.copy(center);camera.position.copy(center).add(new T.Vector3(3,3,5));controls.update();return true})()`)
  assert.ok(point);await sleep(200)
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:720,y:500})
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:720,y:500,button:'left',clickCount:1})
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:720,y:500,button:'left',clickCount:1})
  await wait('window.__editor.getState().selected === "call-bell"','scene click selects editor object')
  await wait(`(()=>{let c;window.__three.getState().scene.traverse(o=>{if(o.isTransformControls)c=o});const target=window.__editor.getState().targets['call-bell'].object;return c?.object===target && c.worldPosition.distanceTo(target.getWorldPosition(new window.__T.Vector3()))<.001})()`,'gizmo follows selected object')
  const gizmoPoint=await evaluate(`(()=>{const {scene,camera}=window.__three.getState(),T=window.__T;let control;scene.traverse(o=>{if(o.isTransformControls)control=o});const candidates=control.gizmo.gizmo.translate.children.filter(o=>o.name==='X'&&o.visible).map(o=>new T.Box3().setFromObject(o).getCenter(new T.Vector3()).project(camera));const p=candidates.sort((a,b)=>b.x-a.x)[0];return {x:(p.x+1)*720,y:(1-p.y)*500}})()`)
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...gizmoPoint})
  await sleep(120)
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...gizmoPoint,button:'left',clickCount:1})
  for(let i=1;i<=5;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:gizmoPoint.x+i*8,y:gizmoPoint.y,button:'left',buttons:1});await sleep(40)}
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:gizmoPoint.x+40,y:gizmoPoint.y,button:'left',clickCount:1})
  assert.ok(Math.abs(await evaluate('window.__editor.getState().settings.objects["call-bell"]?.position?.[0]')-.88)>.01,'Dragging the gizmo updates persisted world position')
  assert.equal(await evaluate('window.__editor.getState().selected'),'call-bell','Drag release must preserve selected object')
  await input('[aria-label="Положение · X"]',1.18)
  await wait('Math.abs(window.__editor.getState().targets["call-bell"].object.getWorldPosition(new window.__T.Vector3()).x-1.18)<0.001','Live world coordinates')
  await input('[aria-label="Размер объекта"]',125)
  await wait('Math.abs(window.__editor.getState().targets["call-bell"].object.scale.x-1.25)<0.001','Live uniform size')
  await input('[aria-label="Цвет мигания объекта"]','#ff3300')
  await input('#editor-hint-scale',1.8)
  assert.equal(await evaluate('window.__editor.getState().settings.objects["call-bell"].hintScale'),1.8)
  await shot('02-object-controls')
  await click('[aria-label="Отменить изменение"]','');assert.notEqual(await evaluate('window.__editor.getState().settings.objects["call-bell"].hintScale'),1.8)
  await click('[aria-label="Повторить изменение"]','');assert.equal(await evaluate('window.__editor.getState().settings.objects["call-bell"].hintScale'),1.8)
  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text}}})`)
  await click('button','Копировать настройки')
  assert.equal(JSON.parse(await evaluate('window.__copied')).objects['call-bell'].hintColor,'#ff3300')
  await click('summary','Перенести настройки')
  const transferred=await evaluate('JSON.parse(window.__copied)');transferred.objects['call-bell'].position[0]=1.4
  await input('[aria-label="Конфигурация сцены"]',JSON.stringify(transferred))
  await click('button','Применить вставленные настройки')
  await wait('Math.abs(window.__editor.getState().targets["call-bell"].object.getWorldPosition(new window.__T.Vector3()).x-1.4)<0.001','Import applies to scene')
  await click('[role="tab"]','Камера')
  await evaluate(`(()=>{const {camera,controls}=window.__three.getState();camera.position.set(6.8,5.4,9.2);controls.target.set(.4,1.6,-.3);controls.update()})()`)
  await click('button','Сохранить текущий ракурс')
  assert.ok(Math.abs(await evaluate('window.__editor.getState().settings.camera.position[0]')-6.8)<0.001)
  await input('[aria-label="Угол обзора камеры"]',46)
  await wait('Math.abs(window.__three.getState().camera.fov-46)<0.001','Live camera FOV')
  await input('[aria-label="Высота глаз"]',2.2)
  await shot('03-camera')
  await click('[role="tab"]','Объекты')
  await click('button','Сбросить этот объект')
  await wait('Math.abs(window.__editor.getState().targets["call-bell"].object.getWorldPosition(new window.__T.Vector3()).x-.88)<0.001','Reset restores original transform')
  await click('[aria-label="Отменить изменение"]','')
  await wait('Math.abs(window.__editor.getState().targets["call-bell"].object.getWorldPosition(new window.__T.Vector3()).x-1.4)<0.001','Undo restores custom transform')
  await input('[aria-label="Расстановка кейса"]','abdomen')
  await wait('Boolean(window.__editor.getState().targets["ice-pack"]) && !window.__editor.getState().targets["shock-kit"]','case equipment filter')
  await input('[aria-label="Объект сцены"]','ice-pack')
  await input('[aria-label="Положение · X"]',-2.2)
  await input('[aria-label="Расстановка кейса"]','anaphylaxis')
  await wait('Boolean(window.__editor.getState().targets["shock-kit"]) && !window.__editor.getState().targets["ice-pack"]','switch case equipment')
  await evaluate('window.__editor.getState().setCatalog(true)')
  await wait('Boolean(window.__editor.getState().targets["ice-pack"]) && Boolean(window.__editor.getState().targets["shelf-left"])','catalog and supports')
  await input('[aria-label="Расстановка кейса"]','')
  await evaluate('window.__editor.getState().setPreview(false)')
  await sleep(200)
  const collisions = await evaluate(`(()=>{const s=window.__editor.getState(),T=window.__T,ids=['glucometer','tonometer','aed-device','bag-mask','ecg-device','shock-kit','medications','equipment','injection','analgesics','chart','blanket','linen','heater','ice-pack','enema-kit','food-water','thermometer','pulseox'];const boxes=ids.map(id=>[id,new T.Box3().setFromObject(s.targets[id].object)]);const errors=[];for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){if(boxes[i][1].clone().expandByScalar(.02).intersectsBox(boxes[j][1]))errors.push([boxes[i][0],boxes[j][0]])}return errors})()`)
  assert.deepEqual(collisions, [], 'Catalog objects have at least 2 cm clearance')
  await shot('05-separated-shelf-catalog')
  await input('[aria-label="Расстановка кейса"]','abdomen')
  await wait('Math.abs(window.__editor.getState().targets["ice-pack"].object.getWorldPosition(new window.__T.Vector3()).x+2.2)<.001','case layout restored')
  await send('Page.reload')
  await wait('document.querySelectorAll(".case-card").length===6','reload returns to normal menu')
  await initialize();assert.equal(await evaluate('window.__editor.getState().open'),false)
  assert.equal(await evaluate('window.__editor.getState().settings.camera.fov'),46)
  assert.equal(await evaluate('window.__editor.getState().settings.camera.eyeHeight'),2.2)
  await wait('Boolean(window.__editor.getState().targets["call-bell"]) && Math.abs(window.__editor.getState().targets["call-bell"].object.getWorldPosition(new window.__T.Vector3()).x-1.4)<0.001','Reload preserves world transform')
  await shortcut()
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  await shot('04-editor-mobile')
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'))
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'})
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'})
  await wait('document.querySelector(".scene-editor")===null','Escape closes editor')
  await wait(`(()=>{let visible=0;window.__three.getState().scene.traverse(o=>{if(o.name.startsWith('editable-imported-')&&o.visible)visible++});return visible===0})()`,'closing editor hides decorative objects again')
  assert.equal(exceptions.length,0,JSON.stringify(exceptions))
  console.log('Scene editor passed: QWE, interactive targets, case layouts, catalog, supports, coordinates, undo/redo, export/import, camera, persistence and mobile.')
} finally {
  ws?.close();chrome.kill('SIGTERM');chrome.stderr.destroy();chrome.unref();await sleep(300);await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:150})
}
