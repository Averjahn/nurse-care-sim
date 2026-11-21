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
  await click('.case-card','Реакция после инъекции')
  await click('button','Начать эпизод')
  await run(async()=>{
    const app=await(await fetch('/src/App.tsx')).text()
    window.__sim=(await import(app.match(/from ["']([^"']*\/store\.ts[^"']*)["']/)[1])).useSimulationStore
    window.__sim.setState({tick:()=>{}})
    const source=await(await fetch('/src/RoomScene.tsx')).text()
    const fiber=await import(source.match(/from ["']([^"']*react-three_fiber[^"']*)["']/)[1])
    for(let i=0;i<100&&!fiber._roots.size;i++)await new Promise(resolve=>setTimeout(resolve,100))
    window.__three=[...fiber._roots.values()][0].store
    window.__T=await import(source.match(/import [*] as THREE from ["']([^"']+)["']/)[1])
    window.__project=name=>{
      const {scene,camera,gl}=window.__three.getState(),p=scene.getObjectByName(name).getWorldPosition(new window.__T.Vector3()).project(camera),r=gl.domElement.getBoundingClientRect()
      return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}
    }
    window.__pose=name=>{
      const o=window.__three.getState().scene.getObjectByName(name);o.updateWorldMatrix(true,false)
      return {uuid:o.uuid,matrix:o.matrixWorld.elements.map(n=>Math.round(n*1e5)/1e5)}
    }
  })
  await wait('!!window.__three.getState().scene.getObjectByName("oxygen-face-anchor") && !!window.__three.getState().scene.getObjectByName("oxygen-mask")','mask and face ready')
  await run(()=>{
    const a=window.__sim.getState().attempt
    for(const id of ['call-team','inspect',a.patient.injectionRoute==='intravenous'?'stop-infusion':'stop-trigger','legs-up','adrenaline'])window.__sim.getState().act(id)
  })
  await sleep(500)
  const device=await run(()=>window.__pose('oxygen-concentrator'))
  const camera=await run(()=>window.__three.getState().camera.position.toArray())
  const drag=async(name,valid)=>{
    const from=await run(()=>window.__project('oxygen-mask')),face=await run(()=>window.__project('oxygen-face-anchor'))
    const to=valid?face:{x:from.x+110,y:from.y-170}
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...from})
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',clickCount:1})
    await wait('window.__three.getState().scene.getObjectByName("oxygen-mask").userData.maskState==="dragging"','mask picked up')
    for(let i=1;i<=12;i++){
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+(to.x-from.x)*i/12,y:from.y+(to.y-from.y)*i/12,button:'left',buttons:1})
      await sleep(25)
    }
    const hose=await run(()=>{
      const g=window.__three.getState().scene.getObjectByName('oxygen-delivery-hose').geometry
      return [...g.getAttribute('position').array]
    })
    assert.ok(hose.every(Number.isFinite))
    assert.ok(Math.max(...hose)-Math.min(...hose)>.5,'hose spans the scene while moving')
    await shot(name+'-dragging')
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',clickCount:1})
    await wait('window.__three.getState().scene.getObjectByName("oxygen-mask").userData.maskState!=="dragging"','release')
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  }
  await drag('oxygen-invalid-drop',false)
  assert.equal(await evaluate('window.__sim.getState().attempt.completed.includes("oxygen")'),false,'invalid drop does not administer oxygen')
  assert.equal(await evaluate('window.__three.getState().scene.getObjectByName("oxygen-mask").userData.maskState'),'docked')
  await drag('oxygen-mask',true)
  await wait('window.__sim.getState().attempt.completed.includes("oxygen")','oxygen action performed by drop')
  assert.equal(await evaluate('window.__three.getState().scene.getObjectByName("oxygen-mask").userData.maskState'),'attached')
  assert.deepEqual(await run(()=>window.__pose('oxygen-concentrator')),device,'concentrator never moves or scales when connecting')
  assert.deepEqual(await run(()=>window.__three.getState().camera.position.toArray()),camera,'dragging does not orbit camera')
  const error=await run(()=>{
    const T=window.__T,{scene}=window.__three.getState(),mask=scene.getObjectByName('oxygen-mask'),face=scene.getObjectByName('oxygen-face-anchor')
    return mask.getWorldPosition(new T.Vector3()).distanceTo(face.getWorldPosition(new T.Vector3()))
  })
  assert.ok(error<.005,'mask snaps onto face')
  await shot('oxygen-mask-attached')
  await run(()=>window.__sim.getState().act('semi-sitting'))
  // Clinical case rejects unsafe posture; use scene state to verify the visual attachment independently.
  await run(()=>window.__sim.setState(s=>({attempt:{...s.attempt,patient:{...s.attempt.patient,position:'semiSitting'}}})))
  await sleep(1600)
  const follow=await run(()=>{
    const T=window.__T,{scene}=window.__three.getState()
    return scene.getObjectByName('oxygen-mask').getWorldPosition(new T.Vector3()).distanceTo(scene.getObjectByName('oxygen-face-anchor').getWorldPosition(new T.Vector3()))
  })
  assert.ok(follow<.02,'mask follows articulated patient head')
  await shot('oxygen-mask-raised-bed')
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:30,y:80})
  await run(()=>{
    const T=window.__T,{scene,camera,controls}=window.__three.getState(),p=scene.getObjectByName('oxygen-face-anchor').getWorldPosition(new T.Vector3())
    camera.position.copy(p).add(new T.Vector3(.45,.25,.75));controls.target.copy(p);camera.lookAt(p);camera.clearViewOffset();camera.updateProjectionMatrix()
  })
  await sleep(250)
  await shot('oxygen-mask-face-detail')
  assert.equal(exceptions.length,0,JSON.stringify(exceptions))
  console.log('Oxygen passed: pointer drag, invalid drop, attached face, moving hose, fixed concentrator and camera, head follows bed posture.')
} finally {
  ws?.close();chrome.kill('SIGTERM');chrome.stderr.destroy();chrome.unref()
  await sleep(300)
  await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:150})
}

