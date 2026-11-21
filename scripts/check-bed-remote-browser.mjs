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
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('careflow-scene-editor-v1',JSON.stringify({version:1,presetRevision:2,objects:{'bed-controls':{hintScale:3}},hintColor:'#FFD500'}))"})
  await send('Page.navigate',{url})
  await wait('document.querySelectorAll(".case-card").length===6','menu')
  await click('.case-card','Острая боль в животе');await click('button','Начать эпизод')
  await run(async()=>{
    const app=await(await fetch('/src/App.tsx')).text()
    window.__sim=(await import(app.match(/from ["']([^"']*\/store\.ts[^"']*)["']/)[1])).useSimulationStore
    // Isolate the clinical clock from slow software-rendered screenshots; the
    // bed and camera animation clocks continue to run normally.
    window.__sim.setState({tick:()=>{}})
    window.__remote=(await import(app.match(/from ["']([^"']*bedRemoteStore[^"']*)["']/)[1])).useBedRemote
    const source=await(await fetch('/src/RoomScene.tsx')).text()
    window.__T=await import(source.match(/import [*] as THREE from ["']([^"']+)["']/)[1])
    const fiber=await import(source.match(/from ["']([^"']*react-three_fiber[^"']*)["']/)[1])
    window.__three=[...fiber._roots.values()][0].store
  })
  await wait('Boolean(window.__three.getState().scene.getObjectByName("bed-button-knees-up"))','physical remote loaded')
  await wait('(()=>{let ready=false;window.__three.getState().scene.traverse(o=>{if(o.userData.patientRenderer==="rigged")ready=true});return ready})()','rig')
  const point=async name=>run(name=>{
    const T=window.__T,{scene,camera,gl}=window.__three.getState();scene.updateMatrixWorld(true)
    const root=scene.getObjectByName(name)
    const p=root.localToWorld(new T.Vector3(0,0,name.startsWith('bed-button-')?.02:.09)).project(camera),rect=gl.domElement.getBoundingClientRect()
    return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2}
  },name)
  const tap=async p=>{
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p})
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1})
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1})
  }
  const press=async id=>tap(await point('bed-button-'+id))
  const frames=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const phase=name=>'window.__remote.getState().phase==='+JSON.stringify(name)
  await run(()=>{window.__sim.getState().act('call-doctor');window.__sim.getState().act('inspect')})
  const before=await run(()=>window.__three.getState().camera.position.toArray())
  await tap(await point('interaction-bed-controls'))
  await wait(phase('approaching'),'camera approach')
  assert.equal(await evaluate('document.querySelector(".action-panel")'),null,'No old action menu')
  await frames()
  assert.equal(await evaluate('window.__sim.getState().attempt.patient.position'),'supine')
  assert.notDeepEqual(await run(()=>window.__three.getState().camera.position.toArray()),before,'Camera moves gradually')
  await wait(phase('ready'),'close view ready')
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".patient-panel")).display'),'none')
  const buttons=await run(()=>{
    const scene=window.__three.getState().scene,buttons=[]
    scene.traverse(o=>{if(o.name.startsWith('bed-button-')){let texture=false;o.traverse(m=>{if(m.material?.map?.image?.width===256)texture=true});buttons.push({name:o.name,scale:o.scale.toArray(),hinted:o.userData.hinted,texture})}})
    return buttons
  })
  assert.equal(buttons.length,6)
  assert.ok(buttons.every(b=>b.texture),'All buttons have rendered position icons')
  assert.deepEqual(buttons.filter(b=>b.hinted).map(b=>b.name),['bed-button-knees-up'])
  for(let i=0;i<5;i++){await frames();assert.ok(await run(()=>{let ok=true;window.__three.getState().scene.traverse(o=>{if(o.name.startsWith('bed-button-')&&o.scale.x!==1)ok=false});return ok}),'Hints never enlarge buttons, even with a saved 3x preference')}
  const hoverPoint=await point('bed-button-knees-up')
  await shot('bed-remote-close-desktop')
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:20,y:500})
  await frames()
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...hoverPoint})
  await wait('[...document.querySelectorAll(".bed-button-tooltip")].some(el=>el.textContent.includes("согнуть ноги"))','button hover explains function')
  await shot('bed-remote-close-desktop')
  await run(()=>{
    window.__commits=[]
    window.__pressFrames=[]
    const button=window.__three.getState().scene.getObjectByName('bed-button-knees-up')
    window.__sample=window.setInterval(()=>window.__pressFrames.push({phase:window.__remote.getState().phase,depth:button.userData.pressDepth,position:window.__sim.getState().attempt.patient.position}),25)
    window.__unsubscribe=window.__sim.subscribe((s,previous)=>{
      if(s.attempt?.actionHistory.length>previous.attempt?.actionHistory.length){
        const last=s.attempt.actionHistory.at(-1)
        if(['supine','legs-up','semi-sitting','knees-up','sitting','firm-surface'].includes(last.action))window.__commits.push({action:last.action,phase:window.__remote.getState().phase,camera:window.__three.getState().camera.position.toArray()})
      }
    })
  })
  await press('knees-up')
  await wait(phase('idle'),'overview restored')
  const sampled=await run(()=>{clearInterval(window.__sample);return window.__pressFrames})
  const maxDepth=await run(()=>window.__three.getState().scene.getObjectByName('bed-button-knees-up').userData.maxPressDepth??0)
  console.log('press cycle', {maxDepth,phases:[...new Set(sampled.map(s=>s.phase))],commits:await run(()=>window.__commits)})
  assert.ok(maxDepth>.001,'Button visibly moves into the housing')
  assert.ok(sampled.some(s=>s.phase==='returning'),'Camera has a return phase')
  assert.ok(sampled.filter(s=>s.phase!=='idle').every(s=>s.position==='supine'),'No bed motion before observation camera returns')
  await wait('window.__sim.getState().attempt.patient.position==="kneesUp"','bed action committed')
  assert.equal(await evaluate('document.querySelector(".bed-button-tooltip")'),null,'No stale tooltip obscures the bed animation')
  const commits=await run(()=>window.__commits)
  assert.equal(commits.length,1)
  assert.equal(commits[0].phase,'idle')
  for(let i=0;i<3;i++)assert.ok(Math.abs(commits[0].camera[i]-[5.02,6.37,3.8][i])<.01,'Camera reaches observation pose before treatment')
  await wait('Math.abs(window.__three.getState().scene.getObjectByName("restored-original-bed").userData.bedAngles.thigh-.65)<.001','bed moves afterwards')
  await shot('bed-remote-observation')
  assert.equal(await evaluate('document.querySelector(".action-panel")'),null)
  // Cancel restores the actual pre-flight view and never applies a choice.
  const history=await evaluate('window.__sim.getState().attempt.actionHistory.length')
  await tap(await point('interaction-bed-controls'));await wait(phase('ready'),'reopen')
  await click('.bed-remote-overlay button','Вернуться без изменения')
  await wait(phase('idle'),'cancel restores overview')
  assert.equal(await evaluate('window.__sim.getState().attempt.actionHistory.length'),history)
  // An unsafe choice is still judged by the clinical engine.
  await run(()=>{window.__sim.getState().start('collapse');window.__sim.getState().act('call-doctor');window.__sim.getState().act('inspect')})
  await tap(await point('interaction-bed-controls'));await wait(phase('ready'),'collapse remote')
  await press('semi-sitting');await wait(phase('idle'),'unsafe selection returns')
  assert.equal(await evaluate('window.__sim.getState().attempt.patient.position'),'supine')
  assert.equal(await evaluate('window.__sim.getState().attempt.errors.at(-1).severity'),'critical')
  assert.ok(await evaluate('document.querySelector(".bed-feedback").textContent.includes("нельзя")'))
  // First-person input is suspended during the flight; committing restores the ward overview.
  await run(()=>{window.__sim.getState().start('chest-pain');window.__sim.getState().act('call-team');window.__sim.getState().act('inspect')})
  await click('.header-actions button','От первого лица')
  await wait('document.querySelector(".crosshair")!==null','first person')
  await run(()=>{
    const T=window.__T,{camera,scene}=window.__three.getState(),root=scene.getObjectByName('interaction-bed-controls')
    const center=root.getWorldPosition(new T.Vector3());camera.position.copy(center).add(new T.Vector3(2,.5,.3));camera.lookAt(center);camera.updateMatrixWorld()
  })
  await tap(await point('interaction-bed-controls'));await wait(phase('ready'),'first-person remote')
  await press('semi-sitting');await wait(phase('idle'),'first-person return')
  await wait('document.querySelector(".crosshair")===null','overview replaces first person after selection')
  assert.equal(await evaluate('window.__sim.getState().attempt.patient.position'),'semiSitting')
  // Phone: the real buttons fit the available viewport and remain clickable.
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  await wait('window.__three.getState().size.width===390','mobile canvas resized')
  await frames()
  await tap(await point('interaction-bed-controls'));await wait(phase('ready'),'mobile remote')
  const mobilePoints=[]
  for(const b of buttons){const p=await point(b.name);mobilePoints.push(p);assert.ok(p.x>12&&p.x<378&&p.y>65&&p.y<650,'Button fits phone viewport: '+JSON.stringify(p))}
  await shot('bed-remote-close-mobile')
  await click('.bed-remote-overlay button','Вернуться без изменения');await wait(phase('idle'),'mobile cancel')
  assert.ok(await evaluate('window.__three.getState().gl.info.programs.every(p=>p.diagnostics?.runnable!==false)'),'Shaders compile')
  await run(()=>window.__unsubscribe())
  assert.equal(exceptions.length,0,JSON.stringify(exceptions))
  console.log('Bed remote passed: 6 functional icons, real mesh clicks, tooltip, precise non-growing hint, press travel, deferred treatment, camera return, clinical guards, cancel, first-person flow and phone layout.')
} finally {
  ws?.close();chrome.kill('SIGTERM');chrome.stderr.destroy();chrome.unref()
  await sleep(300)
  await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:150})
}

