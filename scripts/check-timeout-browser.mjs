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
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, method === 'Page.captureScreenshot' ? 45000 : 20000)
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



  const run=(fn,...args)=>evaluate('('+fn.toString()+')(...'+JSON.stringify(args)+')')
  await send('Page.enable');await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
  await send('Page.navigate',{url})
  await wait('document.querySelectorAll(".case-card").length===6','menu')
  await click('button','Начать эпизод')
  await run(async()=>{
    const app=await(await fetch('/src/App.tsx')).text()
    window.__sim=(await import(app.match(/from ["']([^"']*\/store\.ts[^"']*)["']/)[1])).useSimulationStore
    window.__remote=(await import(app.match(/from ["']([^"']*bedRemoteStore[^"']*)["']/)[1])).useBedRemote
    window.__advance=window.__sim.getState().tick
    window.__sim.setState({tick:()=>{}})
    window.__sim.setState(s=>({attempt:{...s.attempt,patient:{...s.attempt.patient,secondsSinceOnset:0}}}))
    const source=await(await fetch('/src/RoomScene.tsx')).text()
    window.__T=await import(source.match(/import [*] as THREE from ["']([^"']+)["']/)[1])
    const fiber=await import(source.match(/from ["']([^"']*react-three_fiber[^"']*)["']/)[1])
    for(let i=0;i<100&&!fiber._roots.size;i++)await new Promise(resolve=>setTimeout(resolve,100))
    window.__three=[...fiber._roots.values()][0].store
    window.__snapshot=()=>{
      const {scene,camera}=window.__three.getState()
      scene.updateMatrixWorld(true)
      const round=n=>Math.round(n*1e5)/1e5
      const equipment=[]
      let rig
      scene.traverse(o=>{
        if(o.userData.patientRenderer==='rigged')rig=o
        if(o.name.startsWith('interaction-')&&!['interaction-patient','interaction-cpr','interaction-covered-patient'].includes(o.name)){
          let p=o,visible=true;while(p){if(!p.visible)visible=false;p=p.parent}
          if(visible)equipment.push({name:o.name,uuid:o.uuid,matrix:o.matrixWorld.elements.map(round)})
        }
      })
      const bed=scene.getObjectByName('restored-original-bed')
      return {equipment:equipment.sort((a,b)=>a.name.localeCompare(b.name)),camera:{uuid:camera.uuid,position:camera.position.toArray().map(round),quaternion:camera.quaternion.toArray().map(round),fov:round(camera.fov)},rig:rig?.uuid,bed:bed.uuid,angles:{...bed.userData.bedAngles}}
    }
  })
  await wait('(()=>{let ready=false;window.__three.getState().scene.traverse(o=>{if(o.userData.patientRenderer==="rigged")ready=true});return ready})()','rig')
  const frames=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const normal=await run(()=>window.__snapshot())
  await click('.header-actions button','От первого лица')
  await wait('document.querySelector(".crosshair")!==null','first person')
  await frames()
  await run(()=>{
    const T=window.__T,camera=window.__three.getState().camera
    camera.position.set(2.6,2.8,1);camera.lookAt(new T.Vector3(-.3,1.6,-2));camera.updateMatrixWorld()
    window.__advance(180)
  })
  await wait('window.__sim.getState().attempt.phase==="arrest"','resuscitation stage')
  await frames()
  const arrest=await run(()=>window.__snapshot())
  assert.deepEqual(arrest.equipment.map(e=>e.name),normal.equipment.map(e=>e.name),'All case equipment remains in the ward during arrest')
  await run(()=>window.__advance(239))
  await frames()
  const before=await run(()=>window.__snapshot())
  const oldId=await evaluate('window.__sim.getState().attempt.id')
  await run(()=>window.__advance(1))
  await wait('document.querySelector(".timeout-dialog")?.open','timeout dialog')
  assert.equal(await evaluate('window.__sim.getState().attempt.phase'),'failed')
  assert.equal(await evaluate('document.querySelectorAll(".results-panel,.scenario-picker,.action-panel").length'),0,'Failure shows a compact modal over the existing scene')
  await frames()
  assert.deepEqual(await run(()=>window.__snapshot()),before,'Camera, patient, bed and all equipment retain their actual scene objects and transforms')
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW'})
  await frames()
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'w',code:'KeyW'})
  await run(()=>window.__advance(100))
  assert.deepEqual(await run(()=>window.__snapshot()),before,'The expired scene does not continue moving')
  assert.equal(await evaluate('window.__sim.getState().attempt.patient.secondsSinceOnset'),420)
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'})
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'})
  assert.ok(await evaluate('document.querySelector(".timeout-dialog").open'),'Escape cannot discard the completion choices')
  assert.equal(await evaluate('document.querySelectorAll(".timeout-actions button").length'),2)
  await shot('timeout-preserved-first-person')
  await click('.timeout-actions button','Попробовать ещё раз')
  await wait('window.__sim.getState().attempt.phase==="active"','retry')
  assert.notEqual(await evaluate('window.__sim.getState().attempt.id'),oldId)
  assert.equal(await evaluate('window.__sim.getState().attempt.caseId'),'collapse')
  assert.equal(await evaluate('window.__sim.getState().attempt.completed.length'),0)
  assert.equal(await evaluate('document.querySelector(".timeout-dialog")'),null)
  // Expiry must not snap back to the original camera if a remote flight is in progress.
  await run(()=>window.__sim.setState(s=>({attempt:{...s.attempt,patient:{...s.attempt.patient,secondsSinceOnset:0}}})))
  await run(()=>window.__advance(419))
  await frames()
  const point=await run(()=>{
    const T=window.__T,{scene,camera,gl}=window.__three.getState(),root=scene.getObjectByName('interaction-bed-controls'),p=root.localToWorld(new T.Vector3(0,0,.09)).project(camera),r=gl.domElement.getBoundingClientRect()
    return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}
  })
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point})
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1})
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1})
  await wait('window.__remote.getState().phase==="approaching"','remote camera moving')
  await frames()
  const during=await run(()=>{
    const snapshot=window.__snapshot()
    window.__advance(1)
    return snapshot
  })
  await wait('document.querySelector(".timeout-dialog")?.open','timeout interrupts flight')
  await frames()
  assert.deepEqual((await run(()=>window.__snapshot())).camera,during.camera,'Expiry holds the current flight camera instead of resetting it')
  assert.equal(await evaluate('window.__remote.getState().phase'),'idle')
  assert.equal(await evaluate('window.__sim.getState().attempt.actionHistory.length'),0,'An interrupted flight does not execute an action')
  await shot('timeout-preserved-remote-camera')
  await click('.timeout-actions button','В главное меню')
  await wait('document.querySelectorAll(".case-card").length===6','explicit return to menu')
  assert.equal(await evaluate('window.__sim.getState().attempt'),null)
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  await click('.case-card','Гипертонический криз')
  await click('button','Начать эпизод')
  await frames()
  const beforeBackground=await run(()=>window.__snapshot().equipment)
  await run(()=>window.__advance(420))
  await wait('document.querySelector(".timeout-dialog")?.open','mobile timeout')
  assert.deepEqual(await run(()=>window.__snapshot().equipment),beforeBackground,'A background timeout keeps the visible equipment even if the clinical episode changes')
  const rect=await run(()=>{const e=document.querySelector('.timeout-dialog'),r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:e.scrollWidth,width:r.width}})
  assert.ok(rect.left>=10&&rect.right<=380&&rect.top>=10&&rect.bottom<=834)
  assert.ok(rect.scroll<=rect.width+1)
  await shot('timeout-mobile')
  assert.equal(exceptions.length,0,JSON.stringify(exceptions))
  console.log('Timeout passed: equipment survives arrest and expiry; first-person camera, patient and bed stay in place; frozen state rejects movement; retry and menu require explicit choices; in-progress remote flight cannot reset the view; mobile dialog fits.')
} finally {
  ws?.close();chrome.kill('SIGTERM');chrome.stderr.destroy();chrome.unref()
  await sleep(300)
  await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:150})
}

