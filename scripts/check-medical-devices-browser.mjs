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
  assert.equal(await evaluate(`(()=>{const visible=[];window.__threeStore.getState().scene.traverse(o=>{if(o.name.startsWith('editable-imported-')&&o.visible)visible.push(o.name)});return visible.length})()`),0,'Unused decorative equipment stays hidden during simulation')
  assert.equal(await evaluate('window.__threeStore.getState().scene.getObjectByName("editable-bed").visible'),true,'Functional bed remains visible')
  assert.ok(await evaluate(`(()=>{const T=window.__THREE,scene=window.__threeStore.getState().scene,windowActor=scene.getObjectByName('editable-window'),wall=scene.getObjectByName('editable-wall-0');const p=windowActor.getWorldPosition(new T.Vector3());const ray=new T.Raycaster(p.clone().add(new T.Vector3(1,0,.3)),new T.Vector3(-1,0,0));const empty=ray.intersectObject(wall,true).length===0;ray.ray.origin.z=p.z+1.2;const solid=ray.intersectObject(wall,true).length>0;const frame=new T.Box3().setFromObject(scene.getObjectByName('window-frame-jamb-1')),wallBox=new T.Box3().setFromObject(wall);return empty&&solid&&Math.abs(frame.max.x-wallBox.max.x)<.02&&!scene.getObjectByName('interaction-window')})()`),'Window sits in a through-opening and has no simulation interaction')
  await shot('01-minimal-desktop')
  const select = async id => {
    if(await evaluate(`Boolean(document.querySelector('[aria-label="Закрыть действия"]'))`)) await click('[aria-label="Закрыть действия"]','')
    await evaluate(`(()=>{const {scene,camera,controls}=window.__threeStore.getState();scene.updateMatrixWorld(true);const target=scene.getObjectByName('interaction-'+${JSON.stringify(id)});if(!target)throw new Error('Missing interactive object');const center=new window.__THREE.Box3().setFromObject(target).getCenter(new window.__THREE.Vector3());controls.enableDamping=false;controls.minDistance=1;controls.target.copy(center);camera.position.copy(center).add(new window.__THREE.Vector3(3,3,5));controls.update();camera.updateMatrixWorld();scene.updateMatrixWorld(true)})()`)
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    const findPoint=()=>evaluate(`(()=>{const T=window.__THREE,{scene,camera,gl}=window.__threeStore.getState();const target=scene.getObjectByName('interaction-'+${JSON.stringify(id)}),candidates=[target.getWorldPosition(new T.Vector3())];target.traverse(o=>{if(o instanceof T.Mesh)candidates.push(new T.Box3().setFromObject(o).getCenter(new T.Vector3()))});const rect=gl.domElement.getBoundingClientRect();for(const point of candidates){const p=point.project(camera);const x=rect.left+(p.x+1)/2*rect.width,y=rect.top+(1-p.y)/2*rect.height;if(document.elementFromPoint(x,y)!==gl.domElement)continue;const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(p.x,p.y),camera);let hit=ray.intersectObjects(scene.children,true).find(h=>{let o=h.object;while(o){if(!o.visible)return false;o=o.parent}return true})?.object;while(hit){if(hit===target)return {x,y};hit=hit.parent}}return null})()`)
    let point = await findPoint()
    for (const angle of [[4, 3, 1], [0, 4, 4], [-4, 3, 1], [2, 5, -3]]) {
      if (point) break
      await evaluate(`(()=>{const T=window.__THREE,{scene,camera,controls}=window.__threeStore.getState();const center=new T.Box3().setFromObject(scene.getObjectByName('interaction-'+${JSON.stringify(id)})).getCenter(new T.Vector3());controls.target.copy(center);camera.position.copy(center).add(new T.Vector3(...${JSON.stringify(angle)}));controls.update();camera.updateMatrixWorld()})()`)
      await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
      point = await findPoint()
    }
    if (!point) await shot(`missing-${id}`)
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
  // Real 3D interaction checks for each newly authored device.
  await select('bed-controls'); await action('На спину, согнуть ноги')
  await wait(`(()=>{let rig;window.__threeStore.getState().scene.traverse(o=>{if(o.userData.patientRenderer==='rigged')rig=o});const leg=rig?.getObjectByName('mixamorigLeftUpLeg');return leg&&Math.abs(leg.quaternion.x)>.2})()`, 'flexed knee skeleton pose')
  await select('thermometer');await action('Измерить температуру')
  await select('pulseox');await action('Установить датчик')
  await wait('document.querySelector(".pulse-trace") !== null','pulse trace present')
  const digest = `(()=>{const data=document.querySelector('.pulse-trace').getContext('2d').getImageData(0,0,560,170).data;let hash=2166136261;for(let i=0;i<data.length;i+=37)hash=Math.imul(hash^data[i],16777619);return hash>>>0})()`
  await wait(`document.querySelector('.pulse-trace').getContext('2d').getImageData(0,0,1,1).data[3]===255`, 'pulse canvas painted')
  const pixels = await evaluate(digest)
  await wait(`${digest} !== ${pixels}`, 'pulse trace changes over time')
  await shot('06-knees-and-devices')
  await evaluate(`window.__simulation.getState().start('collapse')`)
  await select('glucometer'); await action('Измерить глюкозу')
  assert.equal(await evaluate('window.__simulation.getState().attempt.glucoseMeasurement.value'), 5.4)
  await evaluate(`window.__simulation.getState().start('chest-pain',{variant:'responsive',nitroMinSbp:100})`)
  await select('ecg-device');await action('Наложить электроды');await select('ecg-device');await action('Снять ЭКГ')
  assert.ok(await evaluate(`window.__simulation.getState().attempt.completed.includes('ecg')`))
  await select('bed-controls');await action('Помочь принять полусидячее')
  await shot('07-ecg')
  await evaluate(`window.__simulation.getState().start('anaphylaxis',{route:'intravenous'})`)
  await wait(`Math.abs(window.__threeStore.getState().scene.getObjectByName('Bed_Head').rotation.x)<.001`, 'new episode resets bed')
  await select('call-bell');await action('Вызвать реанимационную')
  await select('injection');await action('Прекратить инфузию');await select('injection');await action('Удалить венозный катетер')
  assert.ok(await evaluate(`!window.__simulation.getState().attempt.completed.includes('remove-catheter')`))
  await select('medications');await action('Сверить учебное назначение')
  await select('shock-kit');await action('Ввести адреналин')
  await select('oxygen');await action('Подготовить и подать кислород')
  await select('monitor');await action('Подключить непрерывный')
  await select('pulseox');await action('Установить датчик')
  await select('iv-stand')
  await shot('08-shock-devices')
  assert.ok(await evaluate(`(()=>{let rig;window.__threeStore.getState().scene.traverse(o=>{if(o.userData.patientRenderer==='rigged')rig=o});return rig?.getObjectByName('mixamorigHead')?.children.some(o=>o.name==='medical-accessory'&&o.visible)})()`),'Oxygen mask follows the head bone')
  await evaluate(`window.__simulation.getState().start('syncope',{variant:'brief'})`)
  await wait(`window.__threeStore.getState().scene.getObjectByName('editable-patient').getWorldPosition(new window.__THREE.Vector3()).x < -3`,'patient at sink')
  await select('patient');await action('Оценить безопасность')
  await select('sink');await action('Оценить травмы');await action('Безопасно уложить на месте')
  await shot('09-syncope-on-site')
  await evaluate('window.__simulation.getState().tick(25)')
  await action('Переместить на кровать')
  await wait(`window.__threeStore.getState().scene.getObjectByName('editable-patient').getWorldPosition(new window.__THREE.Vector3()).x > -1`,'patient transferred to bed')
  await shot('09-transfer')
  await evaluate(`window.__simulation.getState().start('abdomen'); window.__simulation.getState().tick(180)`)
  await select('call-bell'); await action('Вызвать реанимационную')
  await select('cpr'); await action('Проверить реакцию'); await action('Выбрать центр'); await action('Выполнить 30 компрессий')
  assert.equal(await evaluate('window.__simulation.getState().attempt.cycleCompressions'), 30)
  await action('Открыть дыхательные пути')
  await select('oxygen'); await action('Подключить кислород к мешку')
  await select('bag-mask'); await action('Выполнить 2 вдоха')
  await select('aed-device'); await action('Подготовить АНД'); await action('Наклеить электроды'); await action('Выполнить команды')
  assert.ok(await evaluate(`!!window.__threeStore.getState().scene.getObjectByName('restored-wall-defibrillator') && !window.__threeStore.getState().scene.getObjectByName('editable-bedside-cabinet')`))
  await select('bed-controls'); await action('Подготовить кровать для СЛР')
  assert.ok(await evaluate(`window.__simulation.getState().attempt.completed.includes('aed-follow') && window.__simulation.getState().attempt.completed.includes('ventilate')`))
  await shot('10-cpr-aed-bag-mask')
  assert.equal(exceptions.length,0,JSON.stringify(exceptions))
  console.log('Medical device browser checks passed: actual model clicks, flexed-knee skeleton, animated pulse canvas, ECG electrodes/recording, shock kit, catheter guard, head-mounted oxygen mask, monitoring, IV stand and sink transfer. No runtime exceptions.')
} finally {
  ws?.close();chrome.kill('SIGTERM');chrome.stderr.destroy();chrome.unref()
  await sleep(300)
  await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:150})
}
