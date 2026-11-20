import test from 'node:test'
import assert from 'node:assert/strict'
import { actions, emergencyCases, objectInCase } from '../src/scenario.ts'
import { createAttempt, performAction, tickAttempt, requiredActions } from '../src/simulation.ts'
import { patientPose } from '../src/patientAnimation.ts'
import { pulseWave } from '../src/pulseWave.ts'
const act = (a, ...ids) => ids.reduce((s, id) => performAction(s, id), a)
test('one cuff action captures BP and pulse without connecting continuous monitoring', () => {
  let a = act(createAttempt('abdomen'), 'call-doctor')
  const before = a.patient.secondsSinceOnset
  a = act(a, 'measure')
  assert.equal(a.measurement.sbp, a.patient.sbp)
  assert.equal(a.measurement.pulse, a.patient.pulse)
  assert.equal(a.patient.secondsSinceOnset, before)
  assert.ok(!a.completed.includes('connect-monitor'))
  assert.equal(actions.find(a => a.id === 'measure').target.object, 'tonometer')
  assert.equal(actions.find(a => a.id === 'repeat-measure').target.object, 'tonometer')
  assert.ok(!actions.some(a => a.target.object === 'monitor' && ['measure', 'repeat-measure'].includes(a.id)))
  a = act(a, 'connect-monitor')
  assert.ok(a.completed.includes('connect-monitor'))
})
test('every required action has an interactive object visible in its episode', () => {
  for (const c of emergencyCases) for (const id of requiredActions(createAttempt(c.id))) {
    const action = actions.find(a => a.id === id)
    assert.ok(action, id)
    assert.ok(objectInCase(action.target.object, c.id), `${c.id}: ${id}`)
  }
})
test('BP measurement does not reveal a temperature reading; thermometer captures falling fever', () => {
  let a = act(createAttempt('collapse', { variant: 'fever' }), 'call-doctor', 'measure')
  assert.equal(a.temperatureMeasurement, null)
  a = act(a, 'temperature'); assert.equal(a.temperatureMeasurement.value, 39.2)
  const before = a
  a = tickAttempt(a, 36)
  assert.equal(a.temperatureMeasurement.value, 39.2)
  a = act(a, 'temperature')
  assert.equal(a.temperatureMeasurement.value, 35.7)
  assert.equal(before.temperatureMeasurement.value, 39.2)
})
test('ECG requires electrodes and stores a completed recording', () => {
  let a = act(createAttempt('chest-pain'), 'call-doctor', 'ecg')
  assert.ok(!a.completed.includes('ecg'))
  a = act(a, 'attach-electrodes', 'ecg')
  assert.ok(a.completed.includes('ecg'))
})
test('oxygen for ACS follows oxygen saturation and cannot replace pulse oximetry', () => {
  const a = act(createAttempt('chest-pain'), 'call-doctor', 'saturation', 'oxygen')
  assert.ok(!a.completed.includes('oxygen'))
  let low = { ...a, patient: { ...a.patient, spo2: 88 } }
  assert.ok(requiredActions(low).includes('oxygen'))
  low = act(low, 'oxygen'); assert.ok(low.completed.includes('oxygen'))
  const shock = act(createAttempt('anaphylaxis'), 'call-doctor', 'oxygen')
  assert.ok(shock.completed.includes('oxygen'), 'Emergency oxygen must not wait for a saturation reading in anaphylactic shock')
})
test('syncope is positioned on site before measurements or transfer', () => {
  let a = act(createAttempt('syncope', { variant: 'brief' }), 'call-doctor', 'transfer', 'legs-up')
  assert.equal(a.patient.location, 'sink')
  a = act(a, 'check-injury', 'position-on-site', 'airway')
  assert.equal(a.patient.location, 'sink'); assert.equal(a.patient.position, 'legsUp')
  a = tickAttempt(a, 25)
  assert.equal(a.patient.consciousness, 'ok'); assert.equal(a.patient.sbp, 112)
  a = act(a, 'transfer'); assert.equal(a.patient.location, 'bed')
  assert.ok(!act(a, 'sitting').completed.includes('sitting'))
})
test('venous access is preserved and adrenaline is available without waiting for the doctor', () => {
  const a = act(createAttempt('anaphylaxis', { route: 'intravenous' }), 'call-team', 'remove-catheter', 'stop-infusion', 'protocol', 'adrenaline')
  assert.ok(!a.completed.includes('remove-catheter'))
  assert.ok(a.completed.includes('stop-infusion')); assert.ok(a.completed.includes('adrenaline'))
  assert.equal(a.doctorArrived, false)
})
test('abdomen uses flexed knees and distinguishes prescribed pain relief from self-medication', () => {
  const a = act(createAttempt('abdomen'), 'call-doctor', 'knees-up', 'request-analgesia', 'self-analgesia', 'food', 'ice')
  assert.equal(patientPose(a.patient), 'knees_flexed')
  assert.ok(a.completed.includes('request-analgesia'))
  assert.ok(!a.completed.includes('self-analgesia')); assert.ok(!a.completed.includes('food')); assert.ok(!a.completed.includes('ice'))
})
test('hypertension uses Fowler and rejects stacking or repeating drugs', () => {
  const a = act(createAttempt('hypertension'), 'call-doctor', 'supine', 'semi-sitting', 'multiple-drugs', 'measure', 'baseline', 'neuro', 'protocol', 'captopril', 'captopril')
  assert.equal(a.patient.position, 'semiSitting')
  assert.ok(!a.completed.includes('supine')); assert.ok(!a.completed.includes('multiple-drugs'))
  assert.match(a.feedback, /Повторная доза/)
})
test('synthetic trace has the prescribed beat period, is finite and becomes flat in arrest', () => {
  for (const kind of ['ecg', 'pleth']) for (const bpm of [60, 92, 124]) for (const t of [0, .123, 1.77]) {
    assert.ok(Math.abs(pulseWave(t, bpm, kind) - pulseWave(t + 60 / bpm, bpm, kind)) < 1e-10)
    assert.ok(Number.isFinite(pulseWave(t, bpm, kind)))
  }
  assert.equal(pulseWave(.38, 0), 0)
  assert.equal(pulseWave(1, NaN), 0)
  assert.ok(pulseWave(.38, 60) > .9)
})
test('anaphylaxis hints prioritize the team, trigger and adrenaline before full measurement', () => {
  const ids = requiredActions(createAttempt('anaphylaxis', { route: 'intravenous' }))
  assert.ok(ids.indexOf('call-team') < ids.indexOf('measure'))
  assert.ok(ids.indexOf('adrenaline') < ids.indexOf('measure'))
  assert.ok(ids.indexOf('stop-infusion') < ids.indexOf('adrenaline'))
})
test('loss of consciousness does not flatten already elevated legs', () => {
  const a = createAttempt('collapse')
  assert.equal(patientPose({ ...a.patient, consciousness: 'lost', position: 'legsUp' }), 'legs_elevated')
})
test('oxygen changes SpO2 gradually and repeated hypertension checks are due after 15 minutes', () => {
  let a = act(createAttempt('anaphylaxis'), 'call-doctor', 'oxygen')
  a = tickAttempt(a, 4)
  assert.equal(a.patient.spo2, 88)
  let h = act(createAttempt('hypertension'), 'call-doctor', 'measure')
  h = { ...h, stableAt: 0 }
  h = tickAttempt(h, 900)
  assert.match(h.feedback, /15 минут/)
})
