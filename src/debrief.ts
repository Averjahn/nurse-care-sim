import { actionById, getCase, type ActionId, type Severity } from './scenario.ts'
import { elapsed, type Attempt } from './simulation.ts'

export const formatDuration = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds))
  return `${Math.floor(total / 60)} мин ${String(total % 60).padStart(2, '0')} с`
}
export interface DebriefStep {
  action: ActionId
  title: string
  at: number
  tone: 'correct' | 'warning' | 'critical'
  severity?: Severity
  performed: boolean
  reasons: string[]
  episode: string
  automatic: boolean
}
export function actualSteps(a: Attempt): DebriefStep[] {
  const steps: DebriefStep[] = a.actionHistory.map(entry => {
    const severity = entry.issues.some(issue => issue.severity === 'critical') ? 'critical' : entry.issues.some(issue => issue.severity === 'major') ? 'major' : entry.issues.length ? 'minor' : undefined
    return {
      action: entry.action, title: actionById(entry.action).title, at: entry.at, episode: getCase(entry.episode).title,
      performed: entry.performed, severity, tone: severity === 'critical' ? 'critical' : severity || !entry.performed ? 'warning' : 'correct',
      reasons: entry.issues.length ? entry.issues.map(issue => issue.why) : entry.performed ? [] : [entry.feedback], automatic: false,
    }
  })
  // Missed deadlines are recorded by the clock, even if no object was clicked.
  for (const issue of a.errors) {
    if (a.actionHistory.some(entry => entry.at === issue.at && entry.issues.some(item => item.why === issue.why))) continue
    const plan = a.carePlans.findLast(plan => plan.at <= issue.at)
    steps.push({ action: issue.action, title: `Пропущен срок: ${actionById(issue.action).title}`, at: issue.at, episode: getCase(plan?.episode ?? a.caseId).title, severity: issue.severity, tone: issue.severity === 'critical' ? 'critical' : 'warning', performed: false, reasons: [issue.why], automatic: true })
  }
  return steps.sort((x, y) => x.at - y.at)
}
export function referenceSteps(a: Attempt) {
  const fulfilled = new Set(a.actionHistory.flatMap(entry => entry.performed ? [entry.action, ...entry.fulfilled] : []))
  return a.carePlans.map((plan, index) => ({
    at: plan.at, title: plan.resuscitation ? 'Ветвь при отсутствии нормального дыхания' : getCase(plan.episode).title,
    changed: index > 0,
    tiers: plan.tiers.map(tier => tier.filter(id => index === a.carePlans.length - 1 || !['repeat-measure', 'record', 'handoff'].includes(id))).filter(tier => tier.length).map(tier => tier.map(id => ({ id, title: actionById(id).title, done: fulfilled.has(id) }))),
  }))
}
/** One reference node per intervention, including requirements fulfilled by the same click. */
export function referenceDiagram(a: Attempt) {
  const usedEntries = new Set<number>()
  return referenceSteps(a).map(plan => ({
    ...plan,
    steps: plan.tiers.flatMap((tier, tierIndex) => {
      const groups = new Map<number | ActionId, { id: ActionId; title: string; covered: string[]; status: 'done' | 'missing' | 'late'; priority: boolean; order: number }>()
      for (const step of tier) {
        const entryIndex = a.actionHistory.findIndex(entry => entry.performed && (entry.action === step.id || entry.fulfilled.includes(step.id)))
        const entry = a.actionHistory[entryIndex]
        if (entry && usedEntries.has(entryIndex)) continue
        const key = entry ? entryIndex : step.id
        const group = groups.get(key)
        if (group) { group.covered.push(step.title); continue }
        const id = entry && tier.some(item => item.id === entry.action) ? entry.action : step.id
        const late = entry && (entry.issues.length > 0 || a.errors.some(issue => issue.action === step.id && issue.at <= entry.at && /срок|секунд|минут/.test(issue.why)))
        groups.set(key, { id, title: actionById(id).title, covered: [step.title], status: !entry ? 'missing' : late ? 'late' : 'done', priority: tierIndex === 0, order: entry ? entryIndex : Infinity })
      }
      for (const key of groups.keys()) if (typeof key === 'number') usedEntries.add(key)
      return [...groups.values()].sort((x, y) => x.order - y.order)
    }),
  }))
}
export const passageTime = (a: Attempt) => formatDuration(elapsed(a))
