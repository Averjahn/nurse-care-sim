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
    window.__sim.setState({tick:()=>{}})
    const source=await(await fetch('/src/RoomScene.tsx')).text()
    const fiber=await import(source.match(/from ["']([^"']*react-three_fiber[^"']*)["']/)[1])
    for(let i=0;i<100&&!fiber._roots.size;i++)await new Promise(resolve=>setTimeout(resolve,100))
    window.__three=[...fiber._roots.values()][0].store
    window.__T=await import(source.match(/import [*] as THREE from ["']([^"']+)["']/)[1])
  })
  await wait('!!window.__three.getState().scene.getObjectByName("mixamorigLeftHand")','rig')
  await run(()=>{
    const T=window.__T,{scene,camera,controls}=window.__three.getState(),bed=scene.getObjectByName('bed-contact-frame')
    controls.target.copy(bed.localToWorld(new T.Vector3(0,.65,-.1)))
    camera.position.copy(bed.localToWorld(new T.Vector3(0,3.2,3)));camera.clearViewOffset();camera.lookAt(controls.target);camera.updateProjectionMatrix()
  })
  const results=[]
  for(const [position,head,thigh] of [['supine',0,0],['semiSitting',Math.PI/4,0],['legsUp',0,Math.PI/9],['kneesUp',0,.65]]){
    await run(position=>window.__sim.setState(s=>({attempt:{...s.attempt,paused:false,patient:{...s.attempt.patient,position}}})),position)
    await wait('(()=>{const a=window.__three.getState().scene.getObjectByName("restored-original-bed").userData.bedAngles;return Math.abs(a.head-'+head+')<.0001&&Math.abs(a.thigh-'+thigh+')<.0001})()',position)
    await run(()=>window.__sim.setState(s=>({attempt:{...s.attempt,paused:true}})))
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    const report=await run(()=>{
      const T=window.__T,{scene}=window.__three.getState(),bed=scene.getObjectByName('bed-contact-frame')
      scene.updateMatrixWorld(true)
      const report={}
      for(const side of ['Left','Right']){
        report[side]={}
        for(const name of ['Shoulder','Arm','ForeArm','Hand','Hand_End']){
          const bone=scene.getObjectByName('mixamorig'+side+name)
          if(bone)report[side][name]=bed.worldToLocal(bone.getWorldPosition(new T.Vector3())).toArray()
        }
      }
      return report
    })
    results.push({position,...report});console.log(position,JSON.stringify(report))
    if(position==='semiSitting')for(const side of ['Left','Right']){
      assert.ok(Math.abs(report[side].ForeArm[0])<.5&&report[side].ForeArm[1]<.3,'elbows lowered beside torso')
      assert.ok(Math.abs(report[side].Hand[0])<.5&&report[side].Hand[1]>.22&&report[side].Hand[1]<.27,'hands supported beside thighs')
    }
    if(position==='semiSitting')await shot('arms-semi-sitting')
  }
  console.log(JSON.stringify(results,null,2))
  assert.equal(exceptions.length,0,JSON.stringify(exceptions))
} finally {
  ws?.close();chrome.kill('SIGTERM');chrome.stderr.destroy();chrome.unref()
  await sleep(300)
  await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:150})
}

