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
  await sleep(1600); await shot('01-selection-desktop')
  await click('.case-card', 'Острая боль в животе')
  await click('button', 'Начать эпизод')
  await click('.call-doctor', 'Срочно вызвать врача')
  assert.ok(await evaluate('document.querySelector(".call-doctor").textContent.includes("Врач вызван")'))
  const select = name => click('.object-dock button', name)
  const action = name => click('.context-actions button', name)
  await select('Пациентка'); await action('Спросить о жалобах'); await action('Оценить сознание')
  await select('Функциональная кровать'); await action('Уложить на спину')
  await select('Инструменты'); await action('Отказаться от грелки')
  await select('Тонометр'); await action('Измерить давление')
  for (let i = 0; i < 3; i++) { await sleep(450); await click('.measurement-game button', 'Отметить пульсовую волну') }
  await wait('document.querySelector(".observed-vitals").textContent.includes("110")', 'measurement result')
  await shot('02-active-desktop')
  await evaluate(`(async()=>{ const source=await (await fetch('/src/App.tsx')).text(); const storePath=source.match(/from ["']([^"']*store[^"']*)["']/)[1]; window.__testSimulationStore=(await import(storePath)).useSimulationStore })()`)
  const stage = await evaluate('(async()=>{ const s=window.__testSimulationStore; const a=s.getState().attempt; return {phase:a.phase, stable:a.stableAt, errors:a.errors} })()')
  assert.notEqual(stage.stable, null); assert.equal(stage.errors.length, 0)
  await evaluate('(async()=>{const s=window.__testSimulationStore;s.getState().tick(91)})()')
  await action('Повторно измерить давление')
  for (let i = 0; i < 3; i++) { await sleep(450); await click('.measurement-game button', 'Отметить пульсовую волну') }
  await wait('document.querySelector(".measurement-game") === null', 'repeat measurement')
  await select('Температурный лист'); await action('Записать фактические показатели')
  await select('Пост и вызов'); await action('Передать пациентку')
  await wait('document.querySelector(".results-panel") !== null', 'successful handoff')
  assert.ok(await evaluate('document.querySelector(".results-panel").textContent.includes("критических ошибок")'))
  assert.ok(await evaluate('JSON.parse(localStorage.getItem("careflow-emergency-attempts-v1")).length === 1'))
  await shot('03-results-desktop')
  await click('button', 'Выбрать другой')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await shot('04-selection-mobile')
  await click('button', 'Начать эпизод'); await click('.call-doctor', 'Срочно вызвать врача')
  await select('Грелка'); await action('Приложить грелку')
  assert.ok(await evaluate('document.querySelector(".feedback").textContent.includes("запрещены")'))
  await shot('05-active-mobile')
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
  await click('[aria-label="История попыток"]', '')
  await wait('document.querySelector(".history-item") !== null', 'saved history')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
  await wait('document.querySelector(".emergency-modal") === null', 'modal escape')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await click('.header-actions button', 'От первого лица')
  await wait('document.querySelector(".crosshair-label") !== null', 'first-person crosshair')
  await evaluate(`(async()=>{const source=await (await fetch('/src/RoomScene.tsx')).text();const spec=source.match(/from ["']([^"']*react-three_fiber[^"']*)["']/)[1];const {_roots}=await import(spec);window.__testThreeStore=_roots.get(document.querySelector('canvas')).store})()`)
  await evaluate(`(()=>{const {camera}=window.__testThreeStore.getState();camera.position.set(1.9,1.475,0.98);camera.lookAt(1.9,1.475,-3.62);camera.updateMatrixWorld()})()`)
  await sleep(200)
  await wait('document.querySelector(".crosshair-label").textContent.includes("Кислород")', 'distant centered object remains selectable')
  await evaluate(`(()=>{const {camera}=window.__testThreeStore.getState();camera.position.set(1.9,1.475,-2.52);camera.lookAt(1.9,1.475,-3.62);camera.updateMatrixWorld()})()`)
  await wait('document.querySelector(".crosshair-label").textContent.includes("Кислород")', 'nearby centered object')
  await shot('06-first-person')
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 720, y: 500, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 720, y: 500, button: 'left', clickCount: 1 })
  await wait('document.querySelector(".action-panel")?.textContent.includes("Кислород")', 'scene click opens context menu')
  await send('Page.reload')
  await wait('document.querySelectorAll(".case-card").length === 6', 'reload returns to case selection')
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("careflow-emergency-attempts-v1")).length'), 2, 'Interrupted attempt survives reload')
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions))
  console.log('Browser passed: six case choices, 3D canvas, call, assessment, measurement mini-game, stabilization, repeat vitals, chart, handoff, history, mobile layout, forbidden action, modal Escape. Unlimited first-person interaction, scene click and reload persistence passed. No runtime exceptions.')
} finally {
  ws?.close(); chrome.kill('SIGTERM')
  await sleep(300)
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
}
