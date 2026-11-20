import test from 'node:test'
import assert from 'node:assert/strict'
import { createAttempt, performAction, requiredActions, tickAttempt } from '../src/simulation.ts'
import { clinicalTiers, oxygenNeeded } from '../src/clinicalFlow.ts'
const act = (a, ...ids) => ids.reduce((s, id) => performAction(s, id), a)
test('ABC may precede the help call without a first-action penalty', () => {
  const a = act(createAttempt('collapse'), 'inspect', 'call-doctor')
  assert.equal(a.errors.length, 0)
  assert.ok(a.completed.includes('airway'))
})
test('life-saving positions precede secondary measurements and care', () => {
  for (const episode of ['collapse', 'hypertension', 'abdomen']) {
    const a = act(createAttempt(episode), 'call-doctor', 'inspect', 'measure')
    assert.ok(a.errors.some(e => e.action === 'measure' && /приоритет/.test(e.why)))
  }
  const a = act(createAttempt('collapse'), 'call-doctor', 'inspect', 'legs-up', 'measure')
  assert.equal(a.errors.length, 0)
})
test('actions in one priority tier can be performed in any order', () => {
  const a = act(createAttempt('abdomen'), 'inspect', 'call-doctor', 'knees-up', 'temperature', 'saturation', 'measure')
  assert.equal(a.errors.length, 0)
})
test('glucose is required in weak or neurologic presentations and captures once clicked', () => {
  for (const episode of ['collapse', 'hypertension', 'syncope']) {
    let a = createAttempt(episode)
    assert.ok(requiredActions(a).includes('glucose'))
    a = act(a, 'glucose')
    assert.deepEqual(a.glucoseMeasurement, { at: 0, value: 5.4 })
  }
})
test('oxygen has separate ACS and general acute targets, with immediate use in anaphylaxis', () => {
  for (const [episode, spo2, needed] of [['chest-pain', 92, false], ['chest-pain', 89, true], ['collapse', 93, true], ['collapse', 94, false], ['anaphylaxis', 97, true]]) {
    const a = createAttempt(episode); a.patient.spo2 = spo2
    assert.equal(oxygenNeeded(a), needed)
  }
})
test('ACS calls the team and records ECG early in either pain variant', () => {
  for (const variant of ['responsive', 'persistent']) {
    const a = createAttempt('chest-pain', { variant })
    assert.ok(clinicalTiers(a)[0].includes('call-team'))
    assert.ok(clinicalTiers(a)[1].includes('ecg'))
    assert.ok(requiredActions(a).includes('pain-onset'))
    assert.ok(requiredActions(a).includes('prepare-iv'))
  }
})
test('withholding nitrate does not rewrite the pain variant', () => {
  const a = act(createAttempt('chest-pain', { variant: 'responsive' }), 'withhold-nitro', 'pain-response')
  assert.equal(a.variant, 'responsive')
  assert.equal(a.patient.chestPainRelieved, false)
})
test('nitrate history and clinical contraindications are enforced beyond instructor threshold', () => {
  for (const options of [{ nitrateRisk: true }, {}]) {
    let a = act(createAttempt('chest-pain', { ...options, nitroMinSbp: 80 }), 'measure', 'drug-history', 'protocol')
    if (!options.nitrateRisk) a.patient.sbp = 89
    a = act(a, 'nitro')
    assert.equal(a.patient.nitroDoses, 0)
  }
})
test('neurologic signs or captopril contraindications redirect to clinician rather than oral treatment', () => {
  for (const options of [{ neuroSigns: true }, { captoprilRisk: true }]) {
    let a = act(createAttempt('hypertension', options), 'measure', 'baseline', 'neuro', 'protocol', 'captopril')
    assert.ok(!a.completed.includes('captopril'))
    assert.ok(!requiredActions(a).includes('captopril'))
    if (options.neuroSigns) assert.ok(requiredActions(a).includes('call-team'))
  }
})
test('anaphylaxis adrenaline never waits for a medication-chart action', () => {
  const a = act(createAttempt('anaphylaxis', { route: 'intravenous' }), 'call-team', 'inspect', 'stop-infusion', 'legs-up', 'adrenaline')
  assert.ok(a.completed.includes('adrenaline'))
  assert.ok(!a.completed.includes('protocol'))
  assert.equal(a.errors.length, 0)
  assert.equal(a.adrenalineGivenAt, 0)
})
test('persistent anaphylaxis allows a timed repeat while refusing premature doses', () => {
  let a = act(createAttempt('anaphylaxis', { variant: 'refractory' }), 'call-team', 'inspect', 'stop-trigger', 'legs-up', 'adrenaline', 'oxygen', 'crystalloids', 'repeat-adrenaline')
  assert.ok(!a.completed.includes('repeat-adrenaline'))
  a = tickAttempt(a, 300)
  assert.equal(a.phase, 'active')
  assert.ok(requiredActions(a).includes('repeat-adrenaline'))
  a = act(a, 'repeat-adrenaline')
  assert.ok(a.completed.includes('repeat-adrenaline'))
})
test('CPR requires airway opening before bag-mask ventilation and pads before AED commands', () => {
  let a = tickAttempt(createAttempt('abdomen'), 180)
  a = act(a, 'check-breathing', 'chest-location', 'compression', 'ventilate', 'aed-follow')
  assert.equal(a.compressions, 30)
  assert.ok(!a.completed.includes('ventilate'))
  assert.ok(!a.completed.includes('aed-follow'))
  a = act(a, 'open-airway', 'cpr-oxygen', 'ventilate', 'aed', 'aed-pads', 'aed-follow')
  assert.ok(a.completed.includes('ventilate'))
  assert.ok(a.completed.includes('aed-follow'))
})

for (const [episode, options] of [['hypertension', { neuroSigns: true }], ['hypertension', { captoprilRisk: true }], ['chest-pain', { nitrateRisk: true }], ['anaphylaxis', { variant: 'refractory' }]]) {
  test(`complete altered ${episode}: ${JSON.stringify(options)}`, () => {
    let a = createAttempt(episode, options)
    for (let i = 0; i < 90 && a.phase !== 'finished'; i++) {
      let next = requiredActions(a).find(id => !a.completed.includes(id))
      if (next === 'repeat-measure' && a.stableAt === null) {
        a = tickAttempt(a, episode === 'anaphylaxis' ? 300 : 90)
        next = requiredActions(a).find(id => !a.completed.includes(id))
      }
      if (next === 'handoff' && !a.doctorArrived && !a.teamArrived) a = tickAttempt(a, 90)
      a = act(a, next)
    }
    assert.equal(a.phase, 'finished', `${a.feedback}: ${requiredActions(a).filter(id => !a.completed.includes(id))}`)
    assert.equal(a.errors.length, 0, JSON.stringify(a.errors))
  })
}
