import type { ActionId } from './scenario.ts'
import type { Attempt } from './simulation.ts'

/** Tiers model one student's priorities; work inside a tier may run in parallel. */
export function clinicalTiers(a: Attempt): ActionId[][] {
  const finish: ActionId[][] = [['repeat-measure'], ['record'], ['handoff']]
  if (a.phase === 'arrest' || a.arrestAt !== null) return [
    ['check-breathing', 'call-team'], ['firm-surface', 'chest-location', 'aed', 'compression'],
    ['aed-pads', 'aed-follow', 'open-airway', 'cpr-oxygen', 'ventilate'], ...finish,
  ]
  const first: ActionId[] = ['call-doctor', 'inspect']
  const oxygen: ActionId[] = oxygenNeeded(a) ? ['oxygen'] : []
  switch (a.episode) {
    case 'collapse': return [first, ['legs-up', ...(a.variant === 'bleeding' ? ['stop-bleeding' as ActionId] : [])],
      ['measure', 'saturation', ...oxygen, 'connect-monitor'], ['talk', 'temperature', 'glucose', 'baseline', 'differential', 'protocol', 'prepare-iv'],
      ['clothing', 'blanket', 'linen'], ...finish]
    case 'hypertension': return [[...first, ...(a.neuroSigns ? ['call-team' as ActionId] : [])], ['semi-sitting'], ['measure', 'saturation', ...oxygen, 'neuro', 'glucose', 'baseline'],
      ['talk', 'protocol', ...(a.neuroSigns || a.captoprilRisk ? [] : ['captopril' as ActionId])], ['calm', 'clothing'], ...finish]
    case 'chest-pain': return [[...first, 'call-team'], ['semi-sitting', 'pain-onset', 'measure', 'saturation', ...oxygen, 'connect-monitor', 'attach-electrodes', 'ecg'],
      ['talk', 'baseline', 'drug-history', 'protocol', 'aspirin', 'prepare-iv', 'aed', ...(a.completed.includes('nitro') ? ['nitro' as ActionId] : ['withhold-nitro' as ActionId]), 'pain-response'], ['calm', 'clothing'], ...finish]
    case 'syncope': return [first, ['check-injury', 'position-on-site'], ['measure', 'saturation', ...oxygen, 'glucose', 'attach-electrodes', 'ecg'],
      ['talk', 'clothing', 'observe-recovery', 'transfer'], ...finish]
    case 'anaphylaxis': return [[...first, 'call-team'], [a.patient.injectionRoute === 'intravenous' ? 'stop-infusion' : 'stop-trigger', 'legs-up', 'adrenaline', 'oxygen'],
      ['measure', 'saturation', 'connect-monitor', 'crystalloids', ...(a.adrenalineRepeatDue ? ['repeat-adrenaline' as ActionId] : [])],
      ['talk', 'observe-anaphylaxis'], ...finish]
    case 'abdomen': return [first, ['knees-up'], ['measure', 'saturation', ...oxygen, 'temperature'],
      ['talk', 'abdomen-history', 'request-analgesia', 'avoid-intervention'], ...finish]
  }
}
export function oxygenNeeded(a: Attempt) {
  return a.episode === 'anaphylaxis' || a.patient.spo2 < (a.episode === 'chest-pain' ? 90 : 94)
}
export function priorityInversion(a: Attempt, action: ActionId): ActionId | undefined {
  if (a.completed.includes(action) || ['inspect', 'airway', 'call-doctor', 'call-team', 'check-injury', 'check-breathing'].includes(action)) return
  const tiers = clinicalTiers(a), tier = tiers.findIndex(t => t.includes(action))
  if (tier < 0) return
  return tiers.slice(0, tier).flat().find(id => !a.completed.includes(id))
}
