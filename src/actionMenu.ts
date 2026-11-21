import { actions, actionInCase, type ObjectId } from './scenario.ts'
import { requiredActions, type Attempt } from './simulation.ts'

export function actionMenu(a: Attempt | null, object: ObjectId | null) {
  const required = a ? requiredActions(a) : []
  return actions.filter(action => {
    if (action.target.object !== object || (a && !actionInCase(action.id, a.episode))) return false
    if (action.id === 'repeat-measure' && a?.stableAt === null) return false
    if (action.id === 'measure' && a?.stableAt !== null) return false
    if (a) {
      if (action.id === 'record' && (a.stableAt === null || !a.repeatMeasurement)) return false
      if (action.id === 'handoff' && ((!a.doctorArrived && !a.teamArrived) || required.some(id => id !== 'handoff' && !a.completed.includes(id)))) return false
    }
    const resuscitation = ['check-breathing', 'call-team', 'cpr-oxygen', 'firm-surface', 'chest-location', 'wrong-location', 'compression', 'open-airway', 'ventilate', 'aed', 'aed-pads', 'aed-follow']
    return a?.phase === 'arrest' ? resuscitation.includes(action.id) : action.target.object !== 'cpr' && !['cpr-oxygen', 'firm-surface', 'aed-pads', 'aed-follow', 'ventilate'].includes(action.id)
  }).sort((x, y) => {
    const rank = (id: typeof x.id) => {
      const i = required.indexOf(id)
      return i < 0 ? 2000 : a?.completed.includes(id) ? 1000 + i : i
    }
    return rank(x.id) - rank(y.id)
  })
}

export function actionMenuComplete(a: Attempt, object: ObjectId) {
  const required = requiredActions(a)
  return !actionMenu(a, object).some(action => required.includes(action.id) && !a.completed.includes(action.id))
}

export function shouldCloseActionMenu(before: Attempt, after: Attempt, object: ObjectId | null) {
  const progressed = after.completed.length > before.completed.length || after.compressions > before.compressions || after.ventilations > before.ventilations || after.events.slice(before.events.length).some(event => event.kind === 'action')
  return progressed && (after.mode === 'training' || (!!object && actionMenuComplete(after, object)))
}
