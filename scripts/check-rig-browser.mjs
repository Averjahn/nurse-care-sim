import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { rigFixture } from '../tests/fixtures/rig-glb.mjs'

// Use a fresh WebGL context for each independent asset-loading case. This
// avoids renderer/context reuse across intercepted corrupt GLB responses.
const caseIndex=process.argv.indexOf('--case')
const selectedCase=caseIndex===-1?null:process.argv[caseIndex+1]
const cases=['missing','broken','valid','embedded']
if(selectedCase && !cases.includes(selectedCase)) throw new Error('Unknown --case')
if(!selectedCase){
  for(const current of cases) await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(import.meta.url),'--case',current],{stdio:'inherit'})
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Rig case ${current} failed (${code})`)))
  })
  console.log('All four independent rig browser cases passed.')
  process.exit(0)
}
const url = process.env.SIM_URL ?? 'http://127.0.0.1:5173/'
const out = path.resolve('exports/rig-browser')
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
  const pending = new Map(), exceptions = [], consoleErrors = []
  ws.addEventListener('message', e => {
    const data = JSON.parse(e.data)
    if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') consoleErrors.push(data.params.args.map(a=>a.value ?? a.description).join(' '))
    if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails)
    if (!data.id) return
    const p = pending.get(data.id); if (!p) return
    clearTimeout(p.timer); pending.delete(data.id)
    if (data.error) p.reject(new Error(JSON.stringify(data.error))); else p.resolve(data.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, 45000)
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
    return response.result.value
  }
  const wait = async (expr, name) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expr)) return; await sleep(100) }
    throw new Error(`Not reached: ${name}\n${await evaluate('document.body.innerText')}\n${consoleErrors.join('\n')}\n${JSON.stringify(await evaluate('window.__rigDiagnostics'))}`)
  }
  const click = async (selector, text) => {
    assert.ok(await evaluate(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.includes(${JSON.stringify(text)}));if(!el || el.disabled)return false;el.click();return true})()`), `Missing control ${text}`)
    await sleep(80)
  }
  const shot = async name => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(out, `${name}.png`), Buffer.from(data, 'base64')) }
  let mode='missing'
  const fixture=rigFixture(),bedFixture=rigFixture({bed:true})
  ws.addEventListener('message',async e=>{
    const event=JSON.parse(e.data)
    if(event.method!=='Fetch.requestPaused') return
    const {requestId,request}=event.params
    try {
      const isBed=request.url.includes('bed-articulated'),isAnims=request.url.includes('patient-anims')
      const missing=mode==='missing'||(mode==='broken'&&isAnims)||(mode==='embedded'&&isAnims)
      if(missing) await send('Fetch.fulfillRequest',{requestId,responseCode:404,body:''})
      else {
        const bytes=mode==='broken'?Buffer.from('invalid model'):isBed?bedFixture:fixture
        await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'model/gltf-binary'},{name:'Content-Length',value:String(bytes.length)}],...(request.method==='HEAD'?{}:{body:bytes.toString('base64')})})
      }
    }catch(error){exceptions.push({text:error.message})}
  })
  await send('Page.enable');await send('Runtime.enable')
  await send('Fetch.enable',{patterns:[{urlPattern:'*models/patient-rigged.glb*'},{urlPattern:'*models/patient-anims.glb*'},{urlPattern:'*models/bed-articulated.glb*'}]})
  await send('Emulation.setDeviceMetricsOverride',{width:1200,height:850,deviceScaleFactor:1,mobile:false})
  for(const current of [selectedCase]){
    mode=current
    await send('Page.navigate',{url})
    await wait('document.querySelectorAll(".case-card").length===6','case selection')
    await click('.case-card','Острая боль в животе');await click('button','Начать эпизод')
    await wait(`(async()=>{const source=await(await fetch('/src/RoomScene.tsx')).text();const spec=source.match(/from ["']([^"']*react-three_fiber[^"']*)["']/)[1];const {_roots}=await import(spec);window.__rigDiagnostics={size:_roots.size,canvases:[...document.querySelectorAll('canvas')].map(c=>c.outerHTML.slice(0,200)),keys:[..._roots.keys()].map(c=>c.outerHTML?.slice(0,200)),fiber:performance.getEntriesByType('resource').filter(r=>r.name.includes('react-three_fiber')).map(r=>r.name)};const root=_roots.get(document.querySelector('canvas'))??[..._roots.values()][0];if(!root)return false;window.__rigStore=root.store;const app=await(await fetch('/src/App.tsx')).text();const statePath=app.match(/from ["']([^"']*store[^"']*)["']/)[1];window.__simulation=(await import(statePath)).useSimulationStore;return true})()`, `${current}: mounted 3D root`)
    const expected=current==='missing'||current==='broken'?'fallback':'rigged'
    await wait(`(()=>{let found=false;window.__rigStore.getState().scene.traverse(o=>{if(o.userData.patientRenderer===${JSON.stringify(expected)})found=true});return found})()`,`${current}: ${expected} renderer`)
    if(expected==='rigged'){
      await wait(`(()=>{let found=false;window.__rigStore.getState().scene.traverse(o=>{if(o.name==='Bed_Head')found=true});return found})()`,'functional bed sections loaded')
      await evaluate(`window.__simulation.getState().act('semi-sitting')`)
      await wait(`(()=>{let found=false;window.__rigStore.getState().scene.traverse(o=>{if(o.name==='Bed_Head'&&Math.abs(o.quaternion.x)>0.2)found=true});return found})()`,'bed follows semifowler')
    }
    await evaluate('window.__simulation.getState().pause()')
    await sleep(150)
    const snapshot=`(()=>{const values=[];window.__rigStore.getState().scene.traverse(o=>{if(o.type==='Bone')values.push(...o.quaternion.toArray());if(o.morphTargetInfluences)values.push(...o.morphTargetInfluences);if(o.userData.patientRenderer==='fallback')o.traverse(child=>values.push(...child.quaternion.toArray(),...child.scale.toArray()))});return values})()`
    const before=await evaluate(snapshot);await sleep(350);assert.deepEqual(await evaluate(snapshot),before,`${current}: pause freezes bones and morphs`)
    if(current==='broken') await shot('fallback-after-corrupt-glb')
    console.log(`Rig browser: ${current} → ${expected}; pause frozen${expected==='rigged'?'; bed sections connected':''}`)
  }
  // The corrupt-response case intentionally exercises loader errors; only the
  // two injected file failures are expected. All other exceptions fail QA.
  const unexpected=exceptions.filter(error=>!(selectedCase==='broken' && /Could not load .*models\/(patient-rigged|bed-articulated)\.glb:.*invalid model/.test(error.exception?.description ?? '')))
  assert.equal(unexpected.length,0,JSON.stringify(unexpected))
  console.log(`Passed ${selectedCase}: test triangles are intercepted responses, never production assets.`)
} catch(error) {
  if(ws?.readyState===WebSocket.OPEN) {
    try { ws.send(JSON.stringify({id:999999,method:'Runtime.evaluate',params:{expression:'console.error(document.body.innerText)'}}));await sleep(100) } catch {}
  }
  throw error
} finally {
  ws?.close(); chrome.kill('SIGTERM'); chrome.stderr.destroy(); chrome.unref()
  await sleep(300)
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
}
