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

  const run = (fn,...args)=>evaluate('('+fn.toString()+')(...'+JSON.stringify(args)+')')
  await run(() => {
    window.__checkCloth = () => {
      const T=window.__THREE,scene=window.__threeStore.getState().scene
      scene.updateMatrixWorld(true)
      const cloth=scene.getObjectByName('fitted-patient-blanket'), frame=scene.getObjectByName('bed-contact-frame')
      let mesh
      scene.traverse(o=>{if(!mesh&&o.isSkinnedMesh&&o.skeleton.bones.some(b=>b.name.includes('LeftHand')))mesh=o})
      const inverse=new T.Matrix4().copy(frame.matrixWorld).invert(), matrix=inverse.clone().multiply(cloth.matrixWorld)
      const pos=cloth.geometry.getAttribute('position'), index=cloth.geometry.index, buckets=new Map(), cell=.12
      const point=i=>new T.Vector3().fromBufferAttribute(pos,i).applyMatrix4(matrix)
      for(let i=0;i<index.count;i+=3) {
        const a=point(index.getX(i)),b=point(index.getX(i+1)),c=point(index.getX(i+2))
        const minx=Math.floor(Math.min(a.x,b.x,c.x)/cell),maxx=Math.floor(Math.max(a.x,b.x,c.x)/cell),minz=Math.floor(Math.min(a.z,b.z,c.z)/cell),maxz=Math.floor(Math.max(a.z,b.z,c.z)/cell)
        for(let x=minx;x<=maxx;x++)for(let z=minz;z<=maxz;z++){const key=x+','+z;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push([a,b,c])}
      }
      const clothY=p=>{
        let height=-Infinity
        for(const [a,b,c] of buckets.get(Math.floor(p.x/cell)+','+Math.floor(p.z/cell))??[]){
          const det=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z)
          if(Math.abs(det)<1e-10)continue
          const u=((b.z-c.z)*(p.x-c.x)+(c.x-b.x)*(p.z-c.z))/det,v=((c.z-a.z)*(p.x-c.x)+(a.x-c.x)*(p.z-c.z))/det
          if(u>=-1e-5&&v>=-1e-5&&u+v<=1.00001)height=Math.max(height,u*a.y+v*b.y+(1-u-v)*c.y)
        }
        return height
      }
      const rest=mesh.geometry.getAttribute('position'), p=new T.Vector3(), reports={hands:{count:0,missing:0,min:Infinity},feet:{count:0,missing:0,min:Infinity},body:{count:0,missing:0,min:Infinity}},uncovered=[]
      for(let i=0;i<rest.count;i++){
        const x=rest.getX(i),y=rest.getY(i)
        const region=Math.abs(x)>.60&&y>.92&&y<1.18?'hands':y<.17?'feet':Math.abs(x)<.23&&y<1.3?'body':null
        if(!region)continue
        mesh.getVertexPosition(i,p);mesh.localToWorld(p).applyMatrix4(inverse)
        const h=clothY(p),r=reports[region];r.count++
        if(!Number.isFinite(h)){r.missing++;if(uncovered.length<8)uncovered.push({region,x:p.x,y:p.y,z:p.z})}
        else r.min=Math.min(r.min,h-p.y)
      }
      const hands=['Left','Right'].map(side=>{const hand=scene.getObjectByName('mixamorig'+side+'Hand');const p=hand.getWorldPosition(new T.Vector3()).applyMatrix4(inverse);return {x:p.x,y:p.y,z:p.z}})
      return {reports,uncovered,hands,updates:cloth.parent.userData.blanketFitUpdates,samples:cloth.parent.userData.blanketSamples,fitMs:cloth.parent.userData.blanketFitMs,angles:scene.getObjectByName('restored-original-bed').userData.bedAngles}
    }
  })
  await evaluate("window.__simulation.setState(s=>({attempt:{...s.attempt,paused:false,completed:[...s.attempt.completed,'blanket']}}))")
  const reports=[]
  for(const [position,head,thigh] of [['supine',0,0],['semiSitting',Math.PI/4,0],['kneesUp',0,.65],['legsUp',0,Math.PI/9]]) {
    await run(position=>window.__simulation.setState(s=>({attempt:{...s.attempt,paused:false,patient:{...s.attempt.patient,position}}})),position)
    if(position !== 'supine') {
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      const moving=await run(()=>window.__checkCloth())
      for(const region of ['hands','feet','body'])assert.ok(moving.reports[region].missing===0&&moving.reports[region].min>.005,'Coverage during motion: '+JSON.stringify(moving))
      console.log('transition',JSON.stringify(moving.angles))
    }
    await wait('(()=>{const a=window.__threeStore.getState().scene.getObjectByName("restored-original-bed").userData.bedAngles;return Math.abs(a.head-'+head+')<.0001&&Math.abs(a.thigh-'+thigh+')<.0001})()',position+' settled')
    await run(()=>window.__simulation.setState(s=>({attempt:{...s.attempt,paused:true}})))
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    const report=await run(()=>window.__checkCloth())
    console.log(position,JSON.stringify(report))
    reports.push({position,...report})
    await shot('fitted-blanket-'+position)
    assert.ok(await evaluate('window.__threeStore.getState().gl.info.programs.every(p=>p.diagnostics?.runnable!==false)'), 'Cloth shaders must compile and render')
    for(const region of ['hands','feet','body']) {
      assert.equal(report.reports[region].missing,0,position+': full '+region+' coverage')
      assert.ok(report.reports[region].min>.005,position+': fabric clears actual '+region+' surface: '+JSON.stringify(report))
    }
    for(const hand of report.hands)assert.ok(Math.abs(hand.x)<.7&&hand.y<.3,position+': hand rests beside body')
    const previous=report.updates
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))')
    assert.equal(await run(()=>window.__checkCloth().updates),previous,'Stable poses must not regenerate the blanket each frame')
  }
  console.log(JSON.stringify(reports,null,2))
  const clickPoint=await run(()=>{
    const T=window.__THREE,{scene,camera,gl}=window.__threeStore.getState(),cloth=scene.getObjectByName('fitted-patient-blanket')
    const point=new T.Vector3().fromBufferAttribute(cloth.geometry.getAttribute('position'),40*41+20).applyMatrix4(cloth.matrixWorld).project(camera),r=gl.domElement.getBoundingClientRect()
    return {x:r.left+(point.x+1)*r.width/2,y:r.top+(1-point.y)*r.height/2}
  })
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...clickPoint})
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...clickPoint,button:'left',clickCount:1})
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...clickPoint,button:'left',clickCount:1})
  await wait('document.querySelector(".action-panel h2")?.textContent.includes("Пациентка")','Covered patient remains clickable through the blanket')
  await click('[aria-label="Закрыть действия"]','')
  await run(()=>window.__simulation.setState(s=>({attempt:{...s.attempt,paused:false,patient:{...s.attempt.patient,position:'supine',breathing:false,consciousness:'lost'}}})))
  await wait('Math.abs(window.__threeStore.getState().scene.getObjectByName("restored-original-bed").userData.bedAngles.thigh)<.0001','CPR bed settled')
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const cpr=await run(()=>window.__checkCloth())
  assert.equal(cpr.reports.feet.missing,0,'CPR: feet stay covered')
  assert.ok(cpr.reports.feet.min>.005,'CPR: toes stay under cloth')
  await shot('fitted-blanket-cpr')
  assert.equal(exceptions.length,0,JSON.stringify(exceptions))
  console.log('Fitted blanket passed: all hand, toe, heel and body vertices covered in all four poses; arms rest at the sides; stable geometry is cached.')
} finally {
  ws?.close();chrome.kill('SIGTERM');chrome.stderr.destroy();chrome.unref()
  await sleep(300)
  await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:150})
}

