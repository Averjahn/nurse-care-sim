import { actionById, getCase, type ActionId, type CaseId, type ObjectId, type Severity, type Stage } from './scenario.ts'

export type Complaint = 'none' | 'chestPain' | 'headacheVision' | 'weakDizzy' | 'itchBreath' | 'abdomenPain'
export type Route = 'none' | 'subcutaneous' | 'intramuscular' | 'intravenous'
export interface PatientState {
  tempC: number
  sbp: number
  habitualSbp: number
  pulse: number
  consciousness: 'ok' | 'dim' | 'lost'
  complaint: Complaint
  position: 'supine' | 'semiSitting' | 'sitting' | 'legsUp'
  skin: 'normal' | 'pale' | 'flushed' | 'coldSweat' | 'rash'
  nitroDoses: number
  chestPainRelieved: boolean
  injectionRoute: Route
  doctorCalled: boolean
  secondsSinceOnset: number
  breathing: boolean
  anxiety: number
}
export interface Measurement { at: number; sbp: number; pulse: number; tempC: number }
export interface Mistake { action: ActionId; severity: Severity; why: string; at: number; stage: Stage }
export interface Event { at: number; text: string; kind: 'action' | 'patient' | 'system' | 'error' }
export interface Attempt {
  id: string
  caseId: CaseId
  episode: CaseId
  variant: string
  mode: 'training' | 'exam'
  speed: number
  paused: boolean
  phase: 'active' | 'arrest' | 'finished' | 'failed'
  patient: PatientState
  completed: ActionId[]
  errors: Mistake[]
  events: Event[]
  measurement: Measurement | null
  repeatMeasurement: Measurement | null
  baselineRead: boolean
  doctorCalledAt: number | null
  doctorArrived: boolean
  teamCalledAt: number | null
  teamArrived: boolean
  firstCorrectAt: number | null
  lastNitroAt: number
  nitroMinSbp: number | null
  nitroGivenAt: number | null
  stableAt: number | null
  positionedAt: number | null
  arrestAt: number | null
  chestSelected: boolean
  compressions: number
  goodCompressions: number
  lastCompressionAt: number | null
  cycleCompressions: number
  ventilations: number
  cprStartedAt: number | null
  outcome: string
  feedback: string
}
export interface AttemptOptions {
  mode?: 'training' | 'exam'
  speed?: number
  variant?: string
  route?: Route
  nitroMinSbp?: number | null
}
export const basePatient: PatientState = {
  tempC: 37, sbp: 120, habitualSbp: 120, pulse: 80, consciousness: 'ok', complaint: 'none', position: 'supine', skin: 'normal', nitroDoses: 0, chestPainRelieved: false, injectionRoute: 'none', doctorCalled: false, secondsSinceOnset: 0, breathing: true, anxiety: 3,
}
const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)]
export function createAttempt(caseId: CaseId, options: AttemptOptions = {}): Attempt {
  const c = getCase(caseId)
  const variant = options.variant ?? (caseId === 'chest-pain' ? pick(['responsive', 'persistent']) : caseId === 'syncope' ? pick(['brief', 'prolonged']) : caseId === 'collapse' ? pick(['fever', 'bleeding', 'medication']) : 'default')
  const patient = { ...basePatient, ...c.initial }
  if (caseId === 'anaphylaxis') patient.injectionRoute = options.route ?? pick<Route>(['subcutaneous', 'intramuscular', 'intravenous'])
  return {
    id: globalThis.crypto.randomUUID(), caseId, episode: caseId, variant, mode: options.mode ?? 'training', speed: options.speed ?? 1, paused: false, phase: 'active', patient, completed: [], errors: [], events: [{ at: 0, text: c.cue, kind: 'patient' }], measurement: null, repeatMeasurement: null, baselineRead: false, doctorCalledAt: null, doctorArrived: false, teamCalledAt: null, teamArrived: false, firstCorrectAt: null, lastNitroAt: -1, nitroMinSbp: options.nitroMinSbp ?? null, nitroGivenAt: null, stableAt: null, positionedAt: null, arrestAt: null, chestSelected: false, compressions: 0, goodCompressions: 0, lastCompressionAt: null, cycleCompressions: 0, ventilations: 0, cprStartedAt: null, outcome: '', feedback: 'Эпизод начался. Кнопка вызова врача доступна всегда: H.',
  }
}
export const elapsed = (a: Attempt) => a.patient.secondsSinceOnset
function log(a: Attempt, text: string, kind: Event['kind'] = 'system') { a.events.push({ at: elapsed(a), text, kind }) }
function complete(a: Attempt, action: ActionId) {
  if (!a.completed.includes(action)) a.completed.push(action)
  if (a.firstCorrectAt === null && requiredActions(a).includes(action)) a.firstCorrectAt = elapsed(a)
}
function error(a: Attempt, action: ActionId, severity: Severity, why: string) {
  a.feedback = why
  // Repeated clicks on an already rejected choice do not inflate the score penalty.
  if (!a.errors.some(e => e.action === action && e.why === why)) {
    a.errors.push({ action, severity, why, at: elapsed(a), stage: actionById(action).stage })
    log(a, why, 'error')
  }
}
export function requiredActions(a: Attempt): ActionId[] {
  if (a.phase === 'arrest' || a.arrestAt !== null) return ['check-breathing', 'call-team', 'chest-location', 'aed', 'compression', 'ventilate', 'repeat-measure', 'record', 'handoff']
  const required: ActionId[] = ['call-doctor', ...getCase(a.episode).required.filter(id => id !== 'call-doctor')]
  required.splice(required.indexOf('record'), 0, 'repeat-measure')
  if (a.episode === 'anaphylaxis') required.push(a.patient.injectionRoute === 'intravenous' ? 'stop-infusion' : 'stop-trigger')
  if (a.episode === 'chest-pain') {
    required.push(a.completed.includes('nitro') ? 'nitro' : 'withhold-nitro')
    if (a.variant === 'persistent' && a.completed.includes('pain-response')) required.push('call-team', 'oxygen')
  }
  if (a.episode === 'collapse' && a.variant === 'bleeding') required.push('stop-bleeding')
  return required
}
const treatment = (a: Attempt) => requiredActions(a).filter(id => [3, 4].includes(actionById(id).stage))
export function currentStage(a: Attempt): Stage {
  const missing = requiredActions(a).find(id => !a.completed.includes(id))
  return missing ? actionById(missing).stage : 5
}
export function nextObject(a: Attempt): ObjectId | null {
  const missing = requiredActions(a).find(id => !a.completed.includes(id))
  return missing ? actionById(missing).target.object : null
}
export function patientCue(a: Attempt): string {
  if (!a.patient.breathing) return 'Пациентка не реагирует. Нормальное дыхание отсутствует.'
  if (a.patient.consciousness === 'lost') return 'Пациентка не отвечает на обращение. Проверьте реакцию и дыхание.'
  if (a.patient.consciousness === 'dim') return 'Мне всё труднее вас слышать… Очень слабо…'
  if (a.stableAt !== null) return 'Мне немного лучше. Пожалуйста, побудьте рядом до прихода врача.'
  if (a.episode === 'chest-pain' && a.completed.includes('pain-response') && !a.patient.chestPainRelieved) return 'Не отпускает… Боль по-прежнему сильная. Я боюсь.'
  if (a.patient.chestPainRelieved) return 'Боль стала меньше. Но мне всё ещё страшно.'
  if (a.patient.anxiety < 3) return `${getCase(a.episode).cue} Спасибо, что вы рядом.`
  return getCase(a.episode).cue
}
function maybeStable(a: Attempt) {
  if (a.phase !== 'active' || a.stableAt !== null || a.doctorCalledAt === null) return
  if (!a.measurement || !a.completed.includes('inspect') || !treatment(a).every(id => a.completed.includes(id))) return
  if (a.episode === 'syncope' && a.patient.consciousness !== 'ok') return
  a.stableAt = elapsed(a)
  a.patient.consciousness = 'ok'
  a.patient.breathing = true
  a.patient.sbp = a.episode === 'hypertension' ? 160 : 110
  a.patient.pulse = 92
  log(a, 'Учебная динамика: состояние стабилизируется. Повторите измерение и передайте данные врачу.')
}
function copy(a: Attempt): Attempt { return { ...a, patient: { ...a.patient }, completed: [...a.completed], errors: [...a.errors], events: [...a.events] } }
function transitionToChest(a: Attempt) {
  a.episode = 'chest-pain'
  a.variant = 'persistent'
  a.patient.complaint = 'chestPain'
  a.patient.skin = 'coldSweat'
  a.completed = a.completed.filter(id => !['record', 'handoff', 'protocol', 'pain-response'].includes(id))
  a.stableAt = null
  log(a, 'Новый симптом: давящая боль за грудиной. Перейдите к оценке боли в груди.', 'patient')
}
export function tickAttempt(previous: Attempt, deltaSec: number): Attempt {
  if (previous.paused || !['active', 'arrest'].includes(previous.phase) || !Number.isFinite(deltaSec) || deltaSec <= 0) return previous
  const a = copy(previous)
  const before = elapsed(a)
  a.patient.secondsSinceOnset += deltaSec
  const now = elapsed(a)
  if (a.doctorCalledAt !== null && !a.doctorArrived && now - a.doctorCalledAt >= 90) { a.doctorArrived = true; log(a, 'Врач прибыл в палату. Подготовьте передачу наблюдений.') }
  if (a.teamCalledAt !== null && !a.teamArrived && now - a.teamCalledAt >= 45) { a.teamArrived = true; log(a, 'Реанимационная бригада прибыла.') }
  if (a.phase === 'arrest') {
    if (a.teamArrived && a.goodCompressions >= 29 && a.ventilations >= 1 && a.completed.includes('aed')) {
      a.phase = 'active'; a.stableAt = now; a.patient.breathing = true; a.patient.consciousness = 'dim'; a.patient.pulse = 90; a.patient.sbp = 100
      log(a, 'Бригада приняла реанимацию. Учебный этап компрессий завершён; запишите события и передайте данные.')
    } else if (a.arrestAt !== null && now - a.arrestAt >= 240) {
      a.phase = 'failed'; a.outcome = 'Учебное время реанимационного этапа истекло. Разберите задержки вызова и начала помощи.'
      log(a, a.outcome)
    }
    return a
  }
  if (a.arrestAt !== null) return a
  if (a.caseId === 'collapse' && a.variant === 'fever') a.patient.tempC = Math.max(36.2, 39.2 - now * 0.1)
  if (a.episode === 'syncope' && a.positionedAt !== null && a.variant === 'brief' && now - a.positionedAt >= 25 && a.completed.includes('airway')) {
    if (a.patient.consciousness !== 'ok') log(a, 'В горизонтальном положении сознание вернулось. Продолжайте наблюдение.', 'patient')
    a.patient.consciousness = 'ok'
  }
  if (a.episode === 'syncope' && a.variant === 'prolonged' && a.positionedAt !== null && now - a.positionedAt >= 30) {
    a.episode = 'collapse'; a.variant = 'orthostatic'; a.patient.consciousness = 'dim'
    log(a, 'Сознание не восстановилось за игровое окно наблюдения. Продолжайте помощь при коллапсе.')
  }
  if (a.episode === 'hypertension' && before < 75 && now >= 75 && !a.completed.includes('captopril')) transitionToChest(a)
  maybeStable(a)
  if (a.stableAt === null) {
    if (now >= 180) {
      a.phase = 'arrest'; a.arrestAt = 180; a.patient.consciousness = 'lost'; a.patient.breathing = false; a.patient.pulse = 0; a.patient.sbp = 0
      a.completed = a.completed.filter(id => !['record', 'handoff'].includes(id))
      a.feedback = 'Нет реакции и нормального дыхания. Вызовите бригаду и начните реанимационный этап.'
      log(a, a.feedback, 'patient')
      // Background tabs can deliver a single delayed tick across both deadlines.
      if (now >= a.arrestAt + 240) {
        a.patient.secondsSinceOnset = a.arrestAt + 240
        a.phase = 'failed'
        a.outcome = 'Учебное время реанимационного этапа истекло. Разберите задержки вызова и начала помощи.'
        log(a, a.outcome)
      }
    } else if (now >= 120 && !(a.episode === 'syncope' && a.variant === 'brief' && a.patient.consciousness === 'ok')) {
      a.patient.consciousness = 'lost'
      if (before < 120) log(a, 'Пациентка перестала отвечать. Нормальное дыхание пока сохранено.', 'patient')
    } else if (now >= 60 && a.episode !== 'syncope') {
      a.patient.consciousness = 'dim'
      if (before < 60) log(a, 'Пациентка слабеет и отвечает с задержкой.', 'patient')
    }
  }
  if (a.doctorCalledAt === null && now > 30) error(a, 'call-doctor', 'critical', 'Врач не вызван в первые 30 игровых секунд. Это учебный срок оценки своевременности.')
  return a
}
const drugs: ActionId[] = ['nitro', 'aspirin', 'captopril', 'adrenaline']
export function performAction(previous: Attempt, action: ActionId, realNowMs = performance.now()): Attempt {
  if (!['active', 'arrest'].includes(previous.phase) || previous.paused) return previous
  const a = copy(previous)
  const p = a.patient
  const step = actionById(action)
  const now = elapsed(a)
  const fail = (severity: Severity, why: string) => { error(a, action, severity, why); return a }
  if (action === 'call-doctor' || action === 'call-team') {
    if (action === 'call-doctor' && a.doctorCalledAt === null) {
      a.doctorCalledAt = now; p.doctorCalled = true
      if (now > 30) error(a, action, 'critical', 'Врач не вызван в первые 30 игровых секунд. Это учебный срок оценки своевременности.')
      if (a.completed.length > 0) error(a, action, 'major', 'Вызов врача не был первым действием. При очевидной экстренной ситуации вызовите помощь сразу.')
    }
    if (action === 'call-team' && a.teamCalledAt === null) {
      a.teamCalledAt = now
      if (a.doctorCalledAt === null) {
        a.doctorCalledAt = now; p.doctorCalled = true
        if (now > 30) error(a, 'call-doctor', 'critical', 'Врач не вызван в первые 30 игровых секунд. Это учебный срок оценки своевременности.')
        complete(a, 'call-doctor')
      }
    }
    complete(a, action); a.feedback = action === 'call-doctor' ? 'Вызов принят. Врач прибудет через 90 игровых секунд. Продолжайте помощь.' : 'Вызов принят. Бригада прибудет через 45 игровых секунд.'
    log(a, a.feedback, 'action'); return a
  }
  if (a.phase === 'arrest') {
    if (action === 'check-breathing') { complete(a, action); a.feedback = 'Реакции и нормального дыхания нет. Нужны вызов бригады, компрессии и АНД.' }
    else if (action === 'wrong-location') return fail('critical', 'Компрессии выполняют в центре грудной клетки, не на животе.')
    else if (action === 'chest-location') { a.chestSelected = true; complete(a, action); a.feedback = 'Место выбрано: центр грудной клетки. Начинайте компрессии.' }
    else if (action === 'aed') { complete(a, action); a.feedback = 'АНД запрошен. Следуйте его командам; не прерывайте компрессии без необходимости.' }
    else if (action === 'compression') {
      if (!a.chestSelected) return fail('major', 'Сначала выберите место компрессий в центре грудной клетки.')
      const interval = a.lastCompressionAt === null ? null : realNowMs - a.lastCompressionAt
      a.compressions++; a.cycleCompressions++; a.lastCompressionAt = realNowMs
      if (a.cprStartedAt === null) a.cprStartedAt = now
      if (interval !== null && interval >= 500 && interval <= 600) a.goodCompressions++
      a.feedback = interval === null ? 'Начало компрессий. Держите ритм 100–120 в минуту.' : interval >= 500 && interval <= 600 ? 'Ритм в целевом диапазоне.' : interval < 500 ? 'Слишком быстро. Снизьте темп.' : 'Слишком медленно. Ускорьте темп.'
      if (a.cycleCompressions >= 30) { complete(a, action); a.feedback += ' Выполнено 30 компрессий: переходите к двум вдохам, если обучены.' }
      return a
    } else if (action === 'ventilate') {
      if (a.cycleCompressions < 30) return fail('major', 'В учебном цикле сначала выполните 30 компрессий, затем два вдоха.')
      a.ventilations++; a.cycleCompressions = 0; a.lastCompressionAt = null; complete(a, action); a.feedback = 'Два вдоха выполнены. Возобновите компрессии.'
    } else return fail('critical', 'При отсутствии нормального дыхания приоритет — реанимационная помощь. Это действие сейчас небезопасно.')
    log(a, step.title, 'action'); return a
  }
  // Any rejected action leaves the patient and completion flags unchanged.
  if ((action === 'heat' || action === 'enema') && a.episode === 'abdomen') return fail('critical', 'При острой боли в животе неясной причины грелка и клизма запрещены. Сообщите врачу.')
  if (action === 'heat' && ['bleeding', 'trauma'].includes(a.variant)) return fail('critical', 'При кровотечении или травме грелка небезопасна. Сначала остановите кровотечение и вызовите помощь.')
  if (action === 'heat' && p.consciousness === 'lost') return fail('critical', 'Грелка при отсутствии сознания небезопасна: риск ожога.')
  if (action === 'rub' && ['bleeding', 'trauma'].includes(a.variant)) return fail('critical', 'При кровотечении или травме растирание и массаж живота запрещены.')
  if (['sitting', 'semi-sitting'].includes(action) && ['collapse', 'syncope', 'anaphylaxis'].includes(a.episode)) return fail('critical', 'При этом состоянии нельзя оставлять пациентку сидя. Выберите безопасное горизонтальное положение.')
  if (action === 'stop-infusion' && (a.episode !== 'anaphylaxis' || p.injectionRoute !== 'intravenous')) return fail('major', 'В текущем эпизоде нет внутривенной инфузии, которую требуется остановить. Проверьте путь исходного препарата.')
  if (action === 'stop-trigger' && (a.episode !== 'anaphylaxis' || p.injectionRoute === 'intravenous')) return fail('major', 'Проверьте путь исходного препарата: при внутривенном введении нужно прекратить именно инфузию.')
  if (action === 'continue-infusion' && a.episode === 'anaphylaxis') return fail('critical', 'Продолжение введения предполагаемого аллергена опасно. Немедленно прекратите введение.')
  if (action === 'antihistamine' && a.episode === 'anaphylaxis') return fail('critical', 'Антигистаминный не заменяет адреналин и не должен задерживать его введение.')
  if (action === 'ammonia') return fail('major', 'Нашатырный спирт исключён из этой версии протокола. Оцените дыхание, положение и вызов помощи.')
  if (action === 'tea' && a.episode === 'abdomen') return fail('major', 'При неясной острой боли в животе не предлагайте питьё до оценки врача.')
  if (action === 'tea' && p.consciousness !== 'ok') return fail('critical', 'Нельзя давать питьё при нарушенном сознании: риск аспирации.')
  if (drugs.includes(action) && p.consciousness !== 'ok' && action !== 'adrenaline') return fail('critical', 'Пероральное лекарство при нарушении сознания небезопасно.')
  if (step.forbidden) for (const guard of step.forbidden) if (guard.when(a)) return fail(guard.severity, guard.why)
  if (action === 'nitro' && a.nitroMinSbp === null) return fail('major', 'В учебном назначении не задан порог АД. Воздержитесь от нитроглицерина и передайте решение врачу.')
  if (step.when && !step.when(a)) return fail('major', 'Это действие не показано в текущем эпизоде.')
  if (drugs.includes(action) && !a.completed.includes('protocol')) return fail('major', 'Сначала сверяйте учебное назначение и противопоказания в аптечке.')
  if (action === 'captopril' && (a.episode !== 'hypertension' || !a.baselineRead || !a.measurement)) return fail('major', 'Нужно измерить АД, сравнить с привычным и убедиться в показании по назначению.')
  if (action === 'adrenaline' && a.episode !== 'anaphylaxis') return fail('critical', 'Нет показания к этому экстренному препарату в текущем учебном эпизоде.')
  if (action === 'aspirin' && a.episode !== 'chest-pain') return fail('major', 'Этот препарат не назначен в текущем эпизоде.')
  if (action === 'nitro' && a.nitroGivenAt !== null && now - a.nitroGivenAt < 300) return fail('major', 'Повторная доза пока недоступна: интервал учебного назначения — не менее 5 минут.')
  if (action === 'withhold-nitro' && a.episode !== 'chest-pain') return fail('minor', 'Сейчас нет назначения нитроглицерина.')
  if (action === 'pain-response' && !a.completed.includes('nitro') && !a.completed.includes('withhold-nitro')) return fail('minor', 'Сначала примите решение по учебному назначению и затем оцените ответ.')
  if (action === 'observe-recovery' && (a.episode !== 'syncope' || p.consciousness !== 'ok')) return fail('major', 'Сознание пока не восстановилось. Продолжайте оценку и помощь; затяжной эпизод переходит в коллапс.')
  if (action === 'repeat-measure' && a.stableAt === null) return fail('minor', 'Повторная итоговая оценка нужна после стабилизации. Сейчас выполните первичное измерение и продолжайте помощь.')
  if (action === 'record' && (a.stableAt === null || !a.repeatMeasurement)) return fail('minor', 'До записи результата нужны стабилизация в сценарии и повторное измерение. Не записывайте неизмеренные показатели.')
  if (action === 'handoff') {
    if (!a.doctorArrived && !a.teamArrived) { a.feedback = 'Помощь ещё в пути. Наблюдайте за состоянием и повторяйте измерения.'; return a }
    if (!a.completed.includes('record') || requiredActions(a).some(id => id !== 'handoff' && !a.completed.includes(id))) return fail('major', 'Перед передачей завершите необходимые действия, повторную оценку и запись фактических данных.')
  }
  switch (action) {
    case 'talk': log(a, patientCue(a), 'patient'); break
    case 'inspect': a.feedback = `Сознание: ${consciousnessLabels[p.consciousness]}. Кожа: ${skinLabels[p.skin]}. ${p.breathing ? 'Дыхание сохранено.' : 'Нормального дыхания нет.'}`; break
    case 'repeat-measure': case 'measure': {
      const value = { at: now, sbp: p.sbp, pulse: p.pulse, tempC: Math.round(p.tempC * 10) / 10 }
      a.measurement = value
      if (a.stableAt !== null) { a.repeatMeasurement = value; complete(a, 'repeat-measure') }
      a.feedback = `Измерено: САД ${value.sbp} мм рт. ст., пульс ${value.pulse}/мин, T ${value.tempC} °C.`
      break
    }
    case 'baseline': a.baselineRead = true; a.feedback = `В температурном листе: привычное САД ${p.habitualSbp} мм рт. ст., пульс 80/мин. Текущие значения узнаются только измерением.`; break
    case 'supine': p.position = 'supine'; break
    case 'legs-up': p.position = 'legsUp'; a.positionedAt ??= now; break
    case 'semi-sitting': p.position = 'semiSitting'; break
    case 'sitting': p.position = 'sitting'; break
    case 'calm': p.anxiety = Math.max(0, p.anxiety - 1); break
    case 'nitro':
      if (step.effect) a.patient = step.effect(p)
      a.lastNitroAt = a.measurement!.at; a.nitroGivenAt = now
      a.patient.chestPainRelieved = a.variant === 'responsive'; a.patient.sbp = Math.max(80, p.sbp - (a.variant === 'persistent' ? 30 : 10))
      log(a, 'Пациентка предупреждена о возможной головной боли. Эффект препарата требует повторной оценки.', 'action')
      break
    case 'pain-response':
      if (a.completed.includes('nitro') && a.variant === 'responsive') a.feedback = 'Боль уменьшилась. Это не устанавливает диагноз: ЭКГ и оценка врача всё равно нужны.'
      else { a.variant = 'persistent'; a.feedback = 'Боль сохраняется. Подозрение на ОКС: строгий покой, ЭКГ, реанимационная бригада и кислород по протоколу.' }
      log(a, a.feedback, 'patient'); break
    case 'stop-bleeding': case 'stop-infusion': case 'stop-trigger': a.feedback = a.episode === 'anaphylaxis' ? `Триггер устранён. Путь исходной инъекции: ${routeLabels[p.injectionRoute]}. Адреналин вводят внутримышечно независимо от пути триггера.` : 'Начата остановка видимого наружного кровотечения прямым давлением. Врач вызван.'; break
    case 'protocol': a.feedback = 'Учебное назначение сверено: показание, аллергии, сознание, актуальные показатели и способ введения. Дозы в симуляторе не задаются.'; break
    case 'handoff': a.phase = 'finished'; a.outcome = a.arrestAt !== null ? 'Бригада приняла реанимацию и данные наблюдения. Исход пациента не прогнозируется симулятором.' : 'Врач прибыл, состояние в учебной модели стабильно. Наблюдения переданы.'; break
    default: break
  }
  complete(a, action)
  if (!['inspect', 'measure', 'repeat-measure', 'baseline', 'pain-response', 'stop-infusion', 'stop-trigger', 'stop-bleeding', 'protocol', 'handoff'].includes(action)) a.feedback = `${step.title}: выполнено.`
  log(a, a.feedback, 'action')
  maybeStable(a)
  return a
}
export const consciousnessLabels = { ok: 'ясное', dim: 'заторможена', lost: 'нет реакции' }
export const skinLabels = { normal: 'обычная', pale: 'бледная', flushed: 'покраснение', coldSweat: 'холодный липкий пот', rash: 'сыпь' }
export const routeLabels: Record<Route, string> = { none: 'нет', subcutaneous: 'подкожный', intramuscular: 'внутримышечный', intravenous: 'внутривенный' }
export const positionLabels = { supine: 'на спине', semiSitting: 'полусидя', sitting: 'сидя на краю', legsUp: 'ноги приподняты' }
export function stageScores(a: Attempt): number[] {
  return ([1, 2, 3, 4, 5] as Stage[]).map(stage => {
    const required = requiredActions(a).filter(id => actionById(id).stage === stage)
    const completion = required.length ? required.filter(id => a.completed.includes(id)).length / required.length : 1
    if (a.errors.some(e => e.stage === stage && e.severity === 'critical')) return 0
    const penalties = a.errors.filter(e => e.stage === stage).reduce((sum, e) => sum + ({ critical: 50, major: 20, minor: 5 }[e.severity]), 0)
    return Math.max(0, Math.round(completion * 100 - penalties))
  })
}
