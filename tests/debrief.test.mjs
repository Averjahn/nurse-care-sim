import test from 'node:test'
import assert from 'node:assert/strict'
import { actualSteps, formatDuration, passageTime, referenceSteps } from '../src/debrief.ts'
import { createAttempt, performAction, requiredActions, tickAttempt } from '../src/simulation.ts'
import { emergencyCases } from '../src/scenario.ts'
const act = (a, ...ids) => ids.reduce((s, id) => performAction(s, id), a)

test('duration states minutes and seconds and stops when an attempt ends', () => {
  for (const [seconds, text] of [[0,'0 мин 00 с'], [5.9,'0 мин 05 с'], [65,'1 мин 05 с'], [3601,'60 мин 01 с']]) assert.equal(formatDuration(seconds), text)
  const a = tickAttempt(createAttempt('abdomen'), 65.9)
  const end = { ...a, phase: 'finished' }
  assert.equal(passageTime(tickAttempt(end, 300)), '1 мин 05 с')
})
test('accepted actions, minor priority issues, rejected critical choices and repeated clicks are distinct steps', () => {
  const start = createAttempt('abdomen')
  const a = act(start, 'call-doctor', 'inspect', 'measure', 'heat', 'heat')
  const steps = actualSteps(a)
  assert.deepEqual(steps.map(s => s.action), ['call-doctor','inspect','measure','heat','heat'])
  assert.deepEqual(steps.map(s => s.tone), ['correct','correct','warning','critical','critical'])
  assert.equal(steps[2].performed, true)
  assert.equal(steps[2].severity, 'minor')
  assert.equal(steps[3].performed, false)
  assert.equal(steps[4].severity, 'critical')
  assert.equal(a.errors.filter(e => e.action === 'heat').length, 1, 'deduplicating penalties must not drop repeated selections from history')
  assert.equal(start.actionHistory.length, 0, 'previous state is immutable')
})
test('substantial rejections are yellow and have a concrete reason', () => {
  const step = actualSteps(act(createAttempt('chest-pain'), 'ecg'))[0]
  assert.equal(step.tone, 'warning')
  assert.equal(step.severity, 'major')
  assert.equal(step.performed, false)
  assert.ok(step.reasons.length)
})
test('clock-driven missed calls appear as red steps even without a selected action', () => {
  let a = tickAttempt(createAttempt('abdomen'), 31)
  assert.equal(actualSteps(a)[0].automatic, true)
  a = act(tickAttempt(a, 4), 'call-doctor')
  const steps = actualSteps(a)
  assert.equal(steps.length, 2)
  assert.equal(steps[0].at, 31)
  assert.equal(steps[0].tone, 'critical')
  assert.equal(steps[1].at, 35)
})
test('one medication selection is one history block despite multiple action events', () => {
  const a = act(createAttempt('chest-pain'), 'call-team','inspect','semi-sitting','measure','drug-history','protocol','nitro')
  assert.equal(a.patient.nitroDoses, 1)
  assert.equal(a.actionHistory.filter(step => step.action === 'nitro').length, 1)
  const reference = referenceSteps(a).flatMap(plan => plan.tiers.flat())
  assert.ok(reference.some(step => step.id === 'nitro'))
  assert.ok(!reference.some(step => step.id === 'withhold-nitro'))
})
test('CPR series are recorded even without a general action event', () => {
  let a = tickAttempt(createAttempt('collapse'), 180)
  a = act(a, 'check-breathing','call-team','firm-surface','chest-location','compression')
  const step = actualSteps(a).find(step => step.action === 'compression')
  assert.equal(step.performed, true)
  assert.equal(step.tone, 'correct')
  assert.equal(a.carePlans.length, 2)
  assert.equal(a.carePlans[1].resuscitation, true)
})
test('reference retains indicated oxygen after saturation improves and covers every case', () => {
  for (const c of emergencyCases) {
    const a = createAttempt(c.id)
    assert.deepEqual(referenceSteps(a).flatMap(p => p.tiers.flat().map(s => s.id)), requiredActions(a))
  }
  let a = createAttempt('anaphylaxis', { route: 'intravenous' })
  const before = structuredClone(a.carePlans)
  a = act(a, 'call-team','inspect','stop-infusion','legs-up','adrenaline','oxygen')
  assert.deepEqual(before, createAttempt('anaphylaxis', { route: 'intravenous' }).carePlans)
  a.patient.spo2 = 98
  a = tickAttempt(a, 1)
  assert.ok(referenceSteps(a).flatMap(p => p.tiers.flat()).some(s => s.id === 'oxygen'))
  assert.ok(referenceSteps(a).flatMap(p => p.tiers.flat()).find(s => s.id === 'call-doctor').done, 'team call also fulfills calling the doctor')
  let collapse = createAttempt('collapse')
  collapse.patient.spo2 = 90
  collapse = tickAttempt(collapse, 1)
  collapse = act(collapse, 'call-doctor','inspect','legs-up','measure','saturation','oxygen')
  assert.equal(collapse.patient.spo2, 97)
  assert.ok(!requiredActions(collapse).includes('oxygen'))
  assert.ok(referenceSteps(collapse).flatMap(p => p.tiers.flat()).some(s => s.id === 'oxygen' && s.done), 'resolved indication remains in the reference history')
})
test('later episode branches retain earlier history and load the case nitrate threshold', () => {
  let a = act(createAttempt('hypertension'), 'call-doctor')
  a = tickAttempt(a, 75)
  assert.equal(a.episode, 'chest-pain')
  assert.equal(a.nitroMinSbp, 100)
  const plans = referenceSteps(a)
  assert.equal(plans.length, 2)
  assert.ok(plans[0].tiers.flat().some(step => step.id === 'semi-sitting'))
  assert.ok(!plans[0].tiers.flat().some(step => step.id === 'handoff'))
  assert.ok(plans[1].tiers.flat().some(step => step.id === 'handoff'))
  assert.equal(a.actionHistory[0].episode, 'hypertension')
})
