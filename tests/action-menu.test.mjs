import test from 'node:test'
import assert from 'node:assert/strict'
import { actionMenu, actionMenuComplete } from '../src/actionMenu.ts'
import { createAttempt, performAction, requiredActions, tickAttempt } from '../src/simulation.ts'

test('a completed thermometer menu closes despite optional choices on other objects', () => {
  const a = createAttempt('collapse')
  assert.equal(actionMenuComplete(a, 'thermometer'), false)
  assert.equal(actionMenuComplete(performAction(a, 'temperature'), 'thermometer'), true)
})
test('future handoff and charting do not hold early menus open', () => {
  let a = performAction(createAttempt('collapse'), 'call-doctor')
  assert.equal(actionMenuComplete(a, 'call-bell'), true)
  assert.ok(!actionMenu(a, 'call-bell').some(s => s.id === 'handoff'))
  a = performAction(a, 'baseline')
  assert.equal(actionMenuComplete(a, 'chart'), true)
  assert.ok(!actionMenu(a, 'chart').some(s => s.id === 'record'))
})
test('an unfinished required action keeps ECG actions open', () => {
  let a = performAction(createAttempt('chest-pain'), 'attach-electrodes')
  assert.equal(actionMenuComplete(a, 'ecg-device'), false)
  a = performAction(a, 'ecg')
  assert.equal(actionMenuComplete(a, 'ecg-device'), true)
})
test('rejected actions do not complete a menu', () => {
  const a = performAction(createAttempt('chest-pain'), 'ecg')
  assert.equal(actionMenuComplete(a, 'ecg-device'), false)
})
test('repeat measurement remains available when stabilization happens during the first measurement', () => {
  let a = createAttempt('abdomen')
  for (const id of requiredActions(a).filter(id => !['measure', 'repeat-measure', 'record', 'handoff'].includes(id))) a = performAction(a, id)
  a = performAction(a, 'measure')
  assert.notEqual(a.stableAt, null)
  assert.equal(actionMenuComplete(a, 'tonometer'), false)
  a = performAction(a, 'repeat-measure')
  assert.equal(actionMenuComplete(a, 'tonometer'), true)
  a = tickAttempt(a, 90)
  a = performAction(a, 'record')
  assert.ok(actionMenu(a, 'call-bell').some(s => s.id === 'handoff'))
})
test('exam mode keeps its existing actions visible', () => {
  const a = createAttempt('collapse', { mode: 'exam' })
  assert.ok(actionMenu(a, 'call-bell').some(s => s.id === 'handoff'))
})
