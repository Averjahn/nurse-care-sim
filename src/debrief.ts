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
export const passageTime = (a: Attempt) => formatDuration(elapsed(a))
