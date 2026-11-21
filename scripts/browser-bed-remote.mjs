// Shared adapter for older scenario checks that used the bed action popover.
export async function waitForBedRemote({ evaluate, wait }) {
  await evaluate(`(async()=>{const source=await(await fetch('/src/App.tsx')).text();window.__bedRemote=(await import(source.match(/from ["']([^"']*bedRemoteStore[^"']*)["']/)[1])).useBedRemote})()`)
  await wait('window.__bedRemote.getState().phase === "ready"', '3D bed remote ready')
}
export async function pressBedRemote(name, { evaluate, send, wait }) {
  if (!await evaluate('window.__bedRemote?.getState().phase === "ready"')) return false
  const id = await evaluate(`(async()=>{const a=await import('/src/scenario.ts');return a.actions.find(a=>a.target.object==='bed-controls'&&a.title.includes(${JSON.stringify(name)}))?.id})()`)
  if (!id) throw new Error('Unknown bed button: ' + name)
  const point = await evaluate(`(()=>{const T=window.__THREE,{scene,camera,gl}=window.__threeStore.getState(),root=scene.getObjectByName('bed-button-'+${JSON.stringify(id)}),p=root.localToWorld(new T.Vector3(0,0,.02)).project(camera),r=gl.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  await wait('window.__bedRemote.getState().phase === "idle"', 'bed button returns to observation view')
  return true
}
