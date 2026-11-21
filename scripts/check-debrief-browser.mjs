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

  const run = (fn, ...args) => evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')')
  await send('Page.enable'); await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('careflow-scene-editor-v1', JSON.stringify({version:1,presetRevision:1,objects:{monitor:{hintScale:1.3}},hintColor:'#FFD500',camera:{position:[5.4,6.4,3.8],target:[.15,1.3,-2.1],fov:36,eyeHeight:3.4}}))" })
  await send('Page.navigate', { url })
  await wait('document.querySelectorAll(".case-card").length === 6', 'menu')
  for (const name of ['Боль в груди', 'Гипертонический криз']) {
    await click('.case-card', name)
    assert.equal(await evaluate('document.querySelectorAll(".setup-row input, .setup-row select").length'), 0, 'Prescription has no student input')
  }
  await run(async () => {
    window.__sim = (await import('/src/store.ts')).useSimulationStore
    window.__logic = await import('/src/simulation.ts')
    window.__editor = (await import('/src/sceneEditorStore.ts')).useSceneEditor
    const source = await (await fetch('/src/RoomScene.tsx')).text()
    const spec = source.match(/from ["']([^"']*react-three_fiber[^"']*)["']/)[1]
    window.__fiber = await import(spec)
  })
  await wait('Boolean([...window.__fiber._roots.values()][0]?.store.getState().controls)', '3D camera controls')
  const camera = await run(() => {
    const state = [...window.__fiber._roots.values()][0].store.getState()
    return { position: state.camera.position.toArray(), target: state.controls.target.toArray(), settings: window.__editor.getState().settings }
  })
  assert.deepEqual(camera.settings.camera.position, [5.02,6.37,3.8])
  assert.deepEqual(camera.settings.camera.target, [1.09,2.12,-2.1])
  assert.equal(camera.settings.objects.monitor.hintScale, 1.3)
  for (let i=0;i<3;i++) {
    assert.ok(Math.abs(camera.position[i]-[5.02,6.37,3.8][i])<.01)
    assert.ok(Math.abs(camera.target[i]-[1.09,2.12,-2.1][i])<.01)
  }
  await shot('debrief-new-camera')
  await run(() => {
    window.__prepare = (caseId, mistakes=false) => {
      const store = window.__sim, logic = window.__logic
      store.getState().start(caseId, { mode:'training', variant:caseId==='syncope'?'brief':caseId==='chest-pain'?'persistent':'fever', route:'intravenous' })
      if (mistakes) {
        for (const id of ['call-doctor','inspect','measure','ice','heat','heat']) store.getState().act(id)
      }
      for (let i=0;i<80;i++) {
        const a=store.getState().attempt, next=logic.requiredActions(a).find(id=>!a.completed.includes(id))
        if (next==='repeat-measure') break
        if (!next) throw new Error('No next step')
        if (next==='observe-recovery') store.getState().tick(25)
        store.getState().act(next)
      }
      const a=store.getState().attempt
      if(a.stableAt===null)throw new Error('Not stable: '+a.feedback)
      store.getState().tick(91)
    }
  })
  await click('.case-card', 'Острая боль в животе')
  await click('button', 'Начать эпизод')
  await run(() => window.__prepare('abdomen', true))
  await wait('document.querySelector(".doctor-dialog")?.open', 'doctor arrives')
  assert.equal(await evaluate('document.querySelector(".doctor-dialog .primary-button").disabled'), true)
  await click('.doctor-close', '')
  await run(() => { window.__sim.getState().act('repeat-measure');window.__sim.getState().act('record') })
  await wait('document.querySelector(".doctor-dialog")?.open && !document.querySelector(".doctor-dialog .primary-button").disabled', 'ready to handoff')
  await click('.doctor-dialog .primary-button', 'Передать пациента врачу')
  await wait('document.querySelector(".timeline-comparison") !== null', 'two diagrams after actual handoff')
  assert.equal(await evaluate('document.querySelectorAll(".timeline-lane").length'), 2)
  assert.equal(await evaluate('document.querySelectorAll(".result-metrics, .stage-scores, .error-list, progress").length'), 0)
  assert.ok(await evaluate('document.querySelector(".passage-time").textContent.includes("Время прохождения") && /\\d+ мин \\d{2} с/.test(document.querySelector(".passage-time strong").textContent)'))
  assert.equal(await evaluate('document.querySelectorAll(".actual-lane [data-action=heat].critical").length'), 2, 'Both rejected selections retained')
  assert.ok(await evaluate('document.querySelectorAll(".actual-lane .warning").length >= 2'), 'Minor and major issues are yellow')
  assert.ok(await evaluate('document.querySelector(".actual-lane [data-action=ice]").textContent.includes("Незначительная ошибка")'))
  assert.ok(await evaluate('document.querySelector(".actual-lane [data-action=measure]").textContent.includes("приоритет")'))
  assert.ok(await evaluate('document.querySelectorAll(".actual-lane .correct").length > 5'))
  assert.ok(await evaluate('document.querySelectorAll(".diagram-arrow").length > 10'))
  assert.ok(await evaluate('!document.querySelector(".results-panel").textContent.includes("%")'))
  await shot('debrief-comparison-desktop')
  const stableTime = await evaluate('document.querySelector(".passage-time strong").textContent')
  await run(() => window.__sim.getState().tick(120))
  assert.equal(await evaluate('document.querySelector(".passage-time strong").textContent'), stableTime)
  await send('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:true })
  const widths = await run(() => {
    const panel=document.querySelector('.results-panel'), lanes=[...document.querySelectorAll('.timeline-lane')].map(el=>el.getBoundingClientRect())
    panel.scrollTop=0
    return { panel:panel.getBoundingClientRect().width, scroll:panel.scrollWidth, lanes:lanes.map(r=>({x:r.x,width:r.width,right:r.right})) }
  })
  assert.ok(widths.scroll<=widths.panel+1,'No horizontal overflow in results')
  assert.ok(widths.lanes[0].right<=widths.lanes[1].x && widths.lanes.every(r=>r.width>120), 'Both diagrams remain alongside each other on mobile')
  await shot('debrief-comparison-mobile')
  await run(() => { const panel=document.querySelector('.results-panel');panel.scrollTop=panel.scrollHeight })
  await shot('debrief-comparison-mobile-bottom')
  await send('Emulation.setDeviceMetricsOverride', { width:1440, height:1000, deviceScaleFactor:1, mobile:false })
  await click('button','Выбрать другой')
  // Exercise every reference path through the real simulation and actual handoff control.
  for (const id of ['collapse','hypertension','chest-pain','syncope','anaphylaxis','abdomen']) {
    await run(id => window.__prepare(id), id)
    await run(() => {window.__sim.getState().act('repeat-measure');window.__sim.getState().act('record')})
    await wait('document.querySelector(".doctor-dialog")?.open && !document.querySelector(".doctor-dialog .primary-button").disabled', id+': handoff')
    await click('.doctor-dialog .primary-button','Передать пациента врачу')
    await wait('document.querySelector(".timeline-comparison") !== null', id+': diagrams')
    assert.equal(await evaluate('document.querySelectorAll(".reference-check.missing").length'),0,id+': all reference steps accounted for')
    assert.equal(await evaluate('window.__sim.getState().attempt.errors.length'),0,id+': error-free reference')
    await click('button','Выбрать другой')
  }
  assert.equal(exceptions.length,0,JSON.stringify(exceptions))
  console.log('Debrief passed: actual handoff, two arrow diagrams, repeated rejections, error colors and reasons, explicit duration, frozen finish time, all six reference paths, case prescription, camera migration and mobile layout.')
} finally {
  ws?.close();chrome.kill('SIGTERM');chrome.stderr.destroy();chrome.unref()
  await sleep(300)
  await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:150})
}

