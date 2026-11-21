import test from 'node:test'
import assert from 'node:assert/strict'
import { BED_BUTTONS, suggestedBedButton, useBedRemote } from '../src/bedRemoteStore.ts'
import { useSimulationStore } from '../src/store.ts'
import { actionById } from '../src/scenario.ts'

const reset = () => { useBedRemote.getState().reset(); useSimulationStore.getState().leave() }
test('each physical button maps to a real bed action', () => {
  assert.equal(BED_BUTTONS.length, 6)
  assert.equal(new Set(BED_BUTTONS.map(b => b.id)).size, 6)
  for (const button of BED_BUTTONS) assert.equal(actionById(button.id).target.object, 'bed-controls')
})
test('camera approach, physical press and return do not execute the clinical action prematurely', () => {
  reset();useSimulationStore.getState().start('abdomen')
  const remote = useBedRemote.getState(), before = useSimulationStore.getState().attempt
  remote.open(false)
  remote.press('knees-up');assert.equal(useBedRemote.getState().phase, 'approaching')
  remote.arrived();remote.press('knees-up')
  assert.equal(useBedRemote.getState().phase, 'pressing')
  assert.equal(useBedRemote.getState().action, 'knees-up')
  remote.press('supine');assert.equal(useBedRemote.getState().action, 'knees-up', 'double selection is ignored')
  remote.released();assert.equal(useBedRemote.getState().phase, 'returning')
  assert.deepEqual(useSimulationStore.getState().attempt, before)
  reset()
})
test('cancel cancels an unselected flight without choosing a position', () => {
  reset();useSimulationStore.getState().start('collapse')
  const remote=useBedRemote.getState();remote.open(true);remote.cancel()
  assert.equal(useBedRemote.getState().phase,'returning')
  assert.equal(useBedRemote.getState().action,null)
  assert.equal(useBedRemote.getState().fromFirstPerson,true)
  assert.equal(useSimulationStore.getState().attempt.completed.length,0)
  reset()
})
test('a paused or replaced attempt cannot receive a stale button selection', () => {
  reset();useSimulationStore.getState().start('abdomen');useSimulationStore.getState().pause()
  const remote=useBedRemote.getState();remote.open(false)
  assert.equal(useBedRemote.getState().phase,'idle')
  useSimulationStore.getState().pause();remote.open(false);remote.arrived()
  useSimulationStore.getState().start('collapse');remote.press('knees-up')
  assert.equal(useBedRemote.getState().action,null)
  reset()
})
test('training suggestion follows the required position for each case and CPR', () => {
  reset()
  for (const [episode,expected] of [['collapse','legs-up'],['hypertension','semi-sitting'],['chest-pain','semi-sitting'],['abdomen','knees-up'],['anaphylaxis','legs-up']]) {
    useSimulationStore.getState().start(episode)
    assert.equal(suggestedBedButton(useSimulationStore.getState().attempt),expected)
  }
  useSimulationStore.getState().start('collapse');useSimulationStore.getState().tick(180)
  assert.equal(suggestedBedButton(useSimulationStore.getState().attempt),'firm-surface')
  const remote=useBedRemote.getState();remote.open(false);remote.arrived();remote.press('legs-up')
  assert.equal(useBedRemote.getState().action,null, 'normal positioning is disabled during CPR')
  remote.press('firm-surface');assert.equal(useBedRemote.getState().action,'firm-surface')
  reset()
})
