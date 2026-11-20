import test from 'node:test'
import assert from 'node:assert/strict'
import { createAttempt, performAction, tickAttempt, requiredActions, stageScores, nextObject } from '../src/simulation.ts'
import { emergencyCases } from '../src/scenario.ts'
const act = (a, ...ids) => ids.reduce((state, id) => performAction(state, id), a)
const called = (id, options = {}) => act(createAttempt(id, options), 'call-doctor')
function completeCase(id, options = {}) {
  let a = called(id, options)
  for (let i = 0; i < 80; i++) {
    const next = requiredActions(a).find(id => !a.completed.includes(id))
    if (!next || next === 'repeat-measure') break
    if (next === 'observe-recovery') a = tickAttempt(a, 25)
    a = act(a, next)
  }
  assert.notEqual(a.stableAt, null, `${id}: not stable; missing ${requiredActions(a).filter(id => !a.completed.includes(id))}; feedback ${a.feedback}`)
  a = tickAttempt(a, 91)
  a = act(a, 'measure', 'record', 'handoff')
  assert.equal(a.phase, 'finished', `${id}: ${a.feedback}`)
  assert.equal(a.errors.length, 0, `${id}: ${JSON.stringify(a.errors)}`)
  return a
}
for (const c of emergencyCases) test(`complete ${c.id}`, () => completeCase(c.id, c.id === 'syncope' ? { variant: 'brief' } : c.id === 'collapse' ? { variant: 'fever' } : { variant: 'persistent' }))
for (const route of ['subcutaneous', 'intramuscular', 'intravenous']) test(`anaphylaxis route ${route}`, () => { const a = completeCase('anaphylaxis', { route }); assert.ok(a.completed.includes(route === 'intravenous' ? 'stop-infusion' : 'stop-trigger')) })
test('unsafe abdomen interventions are rejected without changing patient', () => {
  const before = called('abdomen')
  const a = act(before, 'heat', 'enema')
  assert.equal(a.errors.length, 2); assert.ok(a.errors.every(e => e.severity === 'critical'))
  assert.deepEqual(a.patient, before.patient); assert.deepEqual(before.errors, [])
  assert.ok(!a.completed.includes('heat')); assert.ok(!a.completed.includes('enema'))
})
test('nitro requires a fresh measurement before each dose', () => {
  let a = called('chest-pain', { nitroMinSbp: 100, variant: 'responsive' })
  a = act(a, 'drug-history', 'protocol', 'nitro')
  assert.equal(a.patient.nitroDoses, 0)
  a = act(a, 'measure', 'nitro')
  assert.equal(a.patient.nitroDoses, 1)
  a = act(a, 'nitro')
  assert.equal(a.patient.nitroDoses, 1); assert.match(a.feedback, /заново измерить/)
})
test('nitro threshold is instructor-supplied and enforced', () => {
  let a = act(called('chest-pain'), 'measure', 'drug-history', 'protocol', 'nitro')
  assert.equal(a.patient.nitroDoses, 0); assert.match(a.feedback, /не задан порог/)
  a = act(called('chest-pain', { nitroMinSbp: 140 }), 'measure', 'drug-history', 'protocol', 'nitro')
  assert.equal(a.patient.nitroDoses, 0); assert.equal(a.errors.at(-1).severity, 'critical')
})
test('nitro cannot exceed three doses or repeat before interval', () => {
  let a = act(called('chest-pain', { nitroMinSbp: 80, variant: 'responsive' }), 'measure', 'drug-history', 'protocol', 'nitro')
  a = tickAttempt(a, 1); a = act(a, 'measure', 'nitro')
  assert.equal(a.patient.nitroDoses, 1); assert.match(a.feedback, /5 минут/)
  // Boundary state isolates dose-limit guards from the deterioration clock.
  a = { ...a, patient: { ...a.patient, nitroDoses: 3 } }
  const after = act(a, 'nitro')
  assert.equal(after.patient.nitroDoses, 3); assert.equal(after.errors.at(-1).severity, 'critical')
})
test('nitro response does not establish diagnosis', () => {
  let a = act(called('chest-pain', { nitroMinSbp: 100, variant: 'responsive' }), 'measure', 'drug-history', 'protocol', 'nitro', 'pain-response')
  assert.equal(a.patient.chestPainRelieved, true); assert.match(a.feedback, /не устанавливает диагноз/)
  a = act(called('chest-pain', { nitroMinSbp: 100, variant: 'persistent' }), 'measure', 'drug-history', 'protocol', 'nitro', 'pain-response')
  assert.equal(a.patient.chestPainRelieved, false); assert.ok(requiredActions(a).includes('call-team'))
})
test('hypertension requires baseline and can branch to chest pain', () => {
  let a = act(called('hypertension'), 'measure', 'protocol', 'captopril')
  assert.ok(!a.completed.includes('captopril'))
  a = act(a, 'baseline', 'neuro', 'captopril'); assert.ok(a.completed.includes('captopril'))
  const branch = tickAttempt(called('hypertension'), 75)
  assert.equal(branch.episode, 'chest-pain'); assert.equal(branch.patient.complaint, 'chestPain')
})
test('prolonged syncope branches to collapse after positioning', () => {
  let a = act(called('syncope', { variant: 'prolonged' }), 'check-injury', 'position-on-site', 'airway')
  a = tickAttempt(a, 30)
  assert.equal(a.episode, 'collapse'); assert.ok(requiredActions(a).includes('prepare-iv'))
})
test('deterioration runs independently of actions and ignores paused time', () => {
  let a = createAttempt('collapse')
  const paused = { ...a, paused: true }
  assert.equal(tickAttempt(paused, 100), paused)
  a = tickAttempt(a, 60); assert.equal(a.patient.consciousness, 'dim')
  a = tickAttempt(a, 60); assert.equal(a.patient.consciousness, 'lost')
  a = tickAttempt(a, 60); assert.equal(a.phase, 'arrest'); assert.equal(a.patient.breathing, false)
})
test('critical timing and first-call metrics are recorded once', () => {
  let a = tickAttempt(createAttempt('abdomen'), 31)
  a = tickAttempt(a, 4); assert.equal(a.errors.length, 1)
  a = act(a, 'call-doctor'); assert.equal(a.doctorCalledAt, 35)
  a = tickAttempt(a, 2); a = act(a, 'call-doctor'); assert.equal(a.doctorCalledAt, 35)
})
test('calling without treating does not stabilize patient', () => { const a = tickAttempt(called('collapse'), 180); assert.equal(a.phase, 'arrest'); assert.equal(a.doctorArrived, true) })
test('unsafe anaphylaxis treatment cannot complete a step', () => {
  const a = act(called('anaphylaxis', { route: 'intravenous' }), 'continue-infusion', 'antihistamine')
  assert.equal(a.errors.length, 2); assert.ok(!a.completed.includes('adrenaline'))
})
test('no fabricated chart entries before repeat measurement', () => {
  const a = act(called('abdomen'), 'record')
  assert.ok(!a.completed.includes('record')); assert.match(a.feedback, /повторное измерение/)
})
test('CPR uses one action per series, AED workflow and bag-mask ventilation before handoff', () => {
  let a = tickAttempt(createAttempt('collapse'), 180)
  a = act(a, 'check-breathing', 'call-team', 'firm-surface', 'chest-location', 'aed', 'compression')
  assert.equal(a.cycleCompressions, 30)
  a = act(a, 'aed-pads', 'aed-follow', 'open-airway', 'cpr-oxygen', 'ventilate')
  a = tickAttempt(a, 45)
  assert.equal(a.phase, 'active'); assert.equal(a.patient.breathing, true)
  a = act(a, 'measure', 'record', 'handoff'); assert.equal(a.phase, 'finished')
})
test('CPR timeout is a training outcome, and terminal attempts cannot change', () => {
  let a = tickAttempt(createAttempt('abdomen'), 180)
  a = tickAttempt(a, 240); assert.equal(a.phase, 'failed')
  assert.equal(tickAttempt(a, 10), a); assert.equal(performAction(a, 'call-doctor'), a)
})
test('every completed episode has five stage scores', () => { const a = completeCase('abdomen'); assert.deepEqual(stageScores(a), [100, 100, 100, 100, 100]) })
for (const variant of ['bleeding', 'medication']) test(`collapse variant ${variant} completes`, () => completeCase('collapse', { variant }))
test('bleeding prohibits warming and massage, and requires bleeding control', () => {
  let a = called('collapse', { variant: 'bleeding' })
  assert.ok(requiredActions(a).includes('stop-bleeding'))
  a = act(a, 'heat', 'rub')
  assert.equal(a.errors.length, 2); assert.ok(a.errors.every(e => e.severity === 'critical'))
})
test('anaphylaxis checks original injection route', () => {
  const a = act(called('anaphylaxis', { route: 'intramuscular' }), 'stop-infusion')
  assert.ok(!a.completed.includes('stop-infusion')); assert.match(a.feedback, /нет внутривенной инфузии/)
})
test('first correct action excludes irrelevant choices', () => {
  let a = createAttempt('abdomen')
  a = act(a, 'baseline'); assert.equal(a.firstCorrectAt, null)
  a = tickAttempt(a, 5); a = act(a, 'call-doctor'); assert.equal(a.firstCorrectAt, 5)
})
test('critical error fails its stage while allowing corrective practice', () => {
  const a = act(called('abdomen'), 'heat', 'avoid-intervention')
  assert.equal(stageScores(a)[2], 0)
  assert.equal(a.phase, 'active'); assert.ok(a.completed.includes('avoid-intervention'))
})
test('CPR rejects bad location and oral treatment', () => {
  let a = tickAttempt(createAttempt('collapse'), 180)
  a = act(a, 'wrong-location', 'aspirin', 'compression')
  assert.equal(a.compressions, 0); assert.equal(a.chestSelected, false)
  assert.equal(a.errors.filter(e => e.severity === 'critical').length, 3) // missed call plus two unsafe actions
})
test('oral medication and drinking are rejected when unconscious', () => {
  const a = act(tickAttempt(called('chest-pain'), 120), 'aspirin', 'tea')
  assert.ok(!a.completed.includes('aspirin')); assert.ok(!a.completed.includes('tea'))
  assert.equal(a.errors.filter(e => e.severity === 'critical').length, 2)
})
test('store reset isolates attempts, and exam mode cannot be paused', async () => {
  const { useSimulationStore } = await import('../src/store.ts')
  useSimulationStore.getState().start('abdomen')
  useSimulationStore.getState().act('call-doctor')
  const old = useSimulationStore.getState().attempt
  useSimulationStore.getState().start('hypertension', { mode: 'exam' })
  const fresh = useSimulationStore.getState().attempt
  assert.notEqual(fresh.id, old.id); assert.deepEqual(fresh.completed, []); assert.equal(fresh.doctorCalledAt, null)
  useSimulationStore.getState().pause(); assert.equal(useSimulationStore.getState().attempt.paused, false)
  useSimulationStore.getState().leave(); assert.equal(useSimulationStore.getState().attempt, null)
})

test('training hints prioritize calling help and repeat measurement before charting', () => {
  assert.equal(nextObject(createAttempt('collapse')), 'call-bell')
  let a = act(called('abdomen'), 'inspect', 'airway', 'knees-up', 'measure', 'temperature', 'saturation', 'talk', 'abdomen-history', 'request-analgesia', 'avoid-intervention')
  assert.notEqual(a.stableAt, null)
  assert.equal(nextObject(a), 'tonometer')
  a = act(a, 'measure')
  assert.equal(nextObject(a), 'chart')
})

test('a delayed background tick cannot extend the deterioration or resuscitation deadline', () => {
  const a = tickAttempt(createAttempt('abdomen'), 600)
  assert.equal(a.arrestAt, 180)
  assert.equal(a.phase, 'failed')
  assert.equal(a.patient.secondsSinceOnset, 420)
})

// Animation is a read-only projection; these tests do not alter the simulation.
const { PATIENT_POSES, POSE_CLIPS, CORE_TRANSITION_CLIPS, PATIENT_MORPHS, patientPose, poseTransitionRoute, animationPlan, animationTimeScale, bedAngles, patientMorphs, validatePatientRig, patientRenderer } = await import('../src/patientAnimation.ts')
const { RigPlayback, CompressionPlayback } = await import('../src/rigPlayback.ts')
const { AnimationMixer, AnimationClip, NumberKeyframeTrack, Object3D, Bone, QuaternionKeyframeTrack } = await import('three')
const completeClips = [...Object.values(POSE_CLIPS), ...CORE_TRANSITION_CLIPS, 'compression']
const goodRig = () => ({ skinnedMeshes: 1, bones: ['mixamorig:Hips','mixamorig:Spine','mixamorig:Head'], clips: [...completeClips], morphs: [...PATIENT_MORPHS] })
for (const [position, pose] of [['supine','lying'],['semiSitting','semifowler'],['sitting','sitting_edge'],['legsUp','legs_elevated']]) test(`animation maps ${position} to ${pose}`, () => {
  const patient = { ...createAttempt('abdomen').patient, position }
  const before = structuredClone(patient)
  assert.equal(patientPose(patient),pose); assert.ok(POSE_CLIPS[pose]); assert.deepEqual(patient,before)
})
test('loss of consciousness and arrest override normal postures', () => {
  const p=createAttempt('abdomen').patient
  assert.equal(patientPose({...p,consciousness:'lost'}),'collapsed')
  assert.equal(patientPose({...p,position:'sitting',consciousness:'dim'}),'collapsed')
  assert.equal(patientPose({...p,consciousness:'lost',breathing:false}),'arrest')
})
for (const from of PATIENT_POSES) for (const to of PATIENT_POSES) test(`animation route ${from} → ${to} is valid`, () => {
  const route = poseTransitionRoute(from,to)
  assert.equal(route.length===0,from===to)
  if (route.length) {assert.equal(route[0].from,from);assert.equal(route.at(-1).to,to)}
  for (let i=1;i<route.length;i++) assert.equal(route[i-1].to,route[i].from)
  const plan=animationPlan(from,to,completeClips)
  assert.equal(plan.at(-1).clip,POSE_CLIPS[to]); assert.equal(plan.at(-1).once,false)
  assert.ok(plan.every(s=>completeClips.includes(s.clip)))
  if(to==='arrest') assert.equal(plan.length,1)
})
test('asset failures, missing skin and missing clips select the fallback', () => {
  assert.equal(validatePatientRig(goodRig()).ok,true)
  const invalid=validatePatientRig({...goodRig(),skinnedMeshes:0})
  assert.equal(patientRenderer(true,invalid),'fallback')
  assert.equal(patientRenderer(true,validatePatientRig(goodRig()),true),'fallback')
  assert.equal(patientRenderer(false,null),'fallback')
  assert.equal(patientRenderer(true,validatePatientRig(goodRig())),'rigged')
  for(const clip of completeClips.filter(c => c !== 'knees_flexed_idle')) assert.equal(validatePatientRig({...goodRig(),clips:completeClips.filter(c=>c!==clip)}).ok,false)
})
function animationFixture() {
  const root=new Object3D();root.value=0
  const clips=completeClips.map(name=>new AnimationClip(name,1,[new NumberKeyframeTrack('.value',[0,1],[0,1])]))
  const mixer=new AnimationMixer(root), actions=Object.fromEntries(clips.map(c=>[c.name,mixer.clipAction(c)]))
  return {root,clips,mixer,actions}
}
test('one-shot clips finish into idle with crossfade and clamp', () => {
  const {mixer,actions}=animationFixture(), playback=new RigPlayback(mixer,actions,'lying')
  playback.transition('sitting_edge');assert.equal(playback.current.getClip().name,'lying_to_sit_edge');assert.equal(playback.current.clampWhenFinished,true)
  mixer.update(1.05);assert.equal(playback.current.getClip().name,'sit_edge_idle')
  playback.transition('collapsed');assert.equal(playback.current.getClip().name,'faint_from_sit')
  mixer.update(1.05);assert.equal(playback.current.getClip().name,'collapsed_idle');playback.dispose()
})
test('arrest preempts a pending transition and cannot return to stale idle', () => {
  const {mixer,actions}=animationFixture(), playback=new RigPlayback(mixer,actions,'lying')
  playback.transition('sitting_edge');mixer.update(0.2);playback.transition('arrest');mixer.update(2)
  assert.equal(playback.current.getClip().name,'arrest_idle');assert.equal(playback.queue.length,0);playback.dispose()
})
test('animation pause freezes local action time; 2× and 4× follow game clock', () => {
  for(const speed of [1,2,4]) {
    const {mixer,actions}=animationFixture(),playback=new RigPlayback(mixer,actions,'lying')
    playback.clock(speed,false);mixer.update(0.1);assert.ok(Math.abs(playback.current.time-0.1*speed)<1e-8)
    const time=playback.current.time;playback.clock(speed,true);mixer.update(4);assert.equal(playback.current.time,time)
    playback.clock(speed,false);mixer.update(0.1);assert.notEqual(playback.current.time,time);playback.dispose()
  }
})
test('compression pulses follow count, run in real time and pause with training', () => {
  const {mixer,actions}=animationFixture(),pulse=new CompressionPlayback(mixer,actions.compression,0)
  pulse.count(1);pulse.clock(false);mixer.update(0.1);assert.ok(Math.abs(actions.compression.time-0.1)<1e-8)
  pulse.count(1);mixer.update(0.1);assert.ok(Math.abs(actions.compression.time-0.2)<1e-8)
  pulse.count(2);assert.equal(actions.compression.time,0)
  pulse.clock(true);mixer.update(10);assert.equal(actions.compression.time,0)
  assert.equal(animationTimeScale(4,false,true),1);pulse.dispose()
})
test('bed and morph effects follow posture and observable state', () => {
  assert.equal(bedAngles('semifowler').Bed_Head,Math.PI/4)
  assert.ok(bedAngles('legs_elevated').Bed_FootEnd<0)
  assert.deepEqual(bedAngles('arrest'),{Bed_Head:0,Bed_Knee:0,Bed_FootEnd:0})
  const p=createAttempt('anaphylaxis').patient
  const allergic=patientMorphs(p,1);assert.ok(allergic.face_swelling>0);assert.ok(allergic.lips_swelling>0)
  const arrest=patientMorphs({...p,consciousness:'lost',breathing:false},1)
  assert.equal(arrest.eyes_closed,1);assert.equal(arrest.chest_rise,0)
})
test('separate animation tracks bind compatible Mixamo names and reject mismatched rigs', async () => {
  const {bindRigClips}=await import('../src/rigAssets.ts')
  const root=new Object3D();root.name='Patient';const hips=new Bone();hips.name='mixamorigHips';root.add(hips)
  const clip=new AnimationClip('lying_idle',1,[new QuaternionKeyframeTrack('mixamorig:Hips.quaternion',[0,1],[0,0,0,1,0,0,0,1])])
  const [bound]=bindRigClips(root,[clip]);assert.equal(bound.tracks[0].name,'mixamorigHips.quaternion');assert.notEqual(bound,clip)
  const invalid=clip.clone();invalid.tracks[0].name='Missing.quaternion'
  assert.throws(()=>bindRigClips(root,[invalid]),/не найден узел/)
})
test('GLB metadata checker rejects the original static model and accepts skinned fixture', async () => {
  const {rigFixture}=await import('./fixtures/rig-glb.mjs')
  const {readGlb,glbInventory}=await import('../scripts/lib/glb.mjs')
  assert.equal(validatePatientRig(glbInventory(readGlb(rigFixture()))).ok,true)
  assert.throws(()=>readGlb(rigFixture({invalid:true})),/GLB/)
  const {readFile}=await import('node:fs/promises')
  assert.equal(validatePatientRig(glbInventory(readGlb(await readFile(new URL('../public/models/patient.glb',import.meta.url))))).ok,false)
})

test('A-pose dry-run uses separate output and never needs credentials', async () => {
  const {execFileSync}=await import('node:child_process')
  const output=execFileSync(process.execPath,['scripts/generate-patient.mjs','--variant','2','--dry-run'],{cwd:new URL('..',import.meta.url),env:{...process.env,GEN_API_ENV_FILE:'/nonexistent/credentials'},encoding:'utf8'})
  const request=JSON.parse(output)
  assert.ok(request.output.endsWith('patient-a-pose-2.glb'))
  assert.match(request.payload.prompt,/standing in a neutral A-pose/)
  assert.equal(request.payload.pbr,true);assert.equal(request.payload.face_limit,50000)
})
test('generator help and unknown arguments cannot send a paid request', async () => {
  const {spawnSync}=await import('node:child_process')
  const help=spawnSync(process.execPath,['scripts/generate-patient.mjs','--help'],{encoding:'utf8'})
  assert.equal(help.status,0);assert.match(help.stdout,/Usage/)
  const invalid=spawnSync(process.execPath,['scripts/generate-patient.mjs','--unknown-argument'],{encoding:'utf8'})
  assert.equal(invalid.status,1);assert.match(invalid.stderr,/запрос не отправлен/)
})
