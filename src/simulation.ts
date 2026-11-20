import { actionById, getCase, type ActionId, type CaseId, type ObjectId, type Severity, type Stage } from './scenario.ts'
import { clinicalTiers, oxygenNeeded, priorityInversion } from './clinicalFlow.ts'

export type Complaint = 'none' | 'chestPain' | 'headacheVision' | 'weakDizzy' | 'itchBreath' | 'abdomenPain'
export type Route = 'none' | 'subcutaneous' | 'intramuscular' | 'intravenous'
export interface PatientState {
  tempC: number
  spo2: number
  location: 'bed' | 'sink'
  sbp: number
  habitualSbp: number
  pulse: number
  consciousness: 'ok' | 'dim' | 'lost'
  complaint: Complaint
  position: 'supine' | 'semiSitting' | 'sitting' | 'legsUp' | 'kneesUp'
  skin: 'normal' | 'pale' | 'flushed' | 'coldSweat' | 'rash'
  nitroDoses: number
  chestPainRelieved: boolean
  injectionRoute: Route
  doctorCalled: boolean
  secondsSinceOnset: number
  breathing: boolean
  anxiety: number
}
export interface Measurement { at: number; sbp: number; pulse: number }
export interface Mistake { action: ActionId; severity: Severity; why: string; at: number; stage: Stage }
export interface Event { at: number; text: string; kind: 'action' | 'patient' | 'system' | 'error' }
export interface Attempt {
  glucoseMeasurement: { at: number; value: number } | null
  neuroSigns: boolean
  nitrateRisk: boolean
  captoprilRisk: boolean
  adrenalineGivenAt: number | null
  adrenalineRepeatDue: boolean
  ecgAt: number | null
  episodeStartedAt: number
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
  temperatureMeasurement: { at: number; value: number } | null
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
  neuroSigns?: boolean
  nitrateRisk?: boolean
  captoprilRisk?: boolean
  mode?: 'training' | 'exam'
  speed?: number
  variant?: string
  route?: Route
  nitroMinSbp?: number | null
}
export const basePatient: PatientState = {
  spo2: 97, location: 'bed', tempC: 37, sbp: 120, habitualSbp: 120, pulse: 80, consciousness: 'ok', complaint: 'none', position: 'supine', skin: 'normal', nitroDoses: 0, chestPainRelieved: false, injectionRoute: 'none', doctorCalled: false, secondsSinceOnset: 0, breathing: true, anxiety: 3,
}
const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)]
export function createAttempt(caseId: CaseId, options: AttemptOptions = {}): Attempt {
  const c = getCase(caseId)
  const variant = options.variant ?? (caseId === 'chest-pain' ? pick(['responsive', 'persistent']) : caseId === 'syncope' ? pick(['brief', 'prolonged']) : caseId === 'collapse' ? 'fever' : 'default')
  const patient = { ...basePatient, ...c.initial }
  if (caseId === 'syncope') { patient.location = 'sink'; if (variant === 'brief') { patient.sbp = 85; patient.pulse = 68 } }
  if (caseId === 'anaphylaxis') patient.injectionRoute = options.route ?? pick<Route>(['subcutaneous', 'intramuscular', 'intravenous'])
  return {
    glucoseMeasurement: null, neuroSigns: options.neuroSigns ?? false, nitrateRisk: options.nitrateRisk ?? false, captoprilRisk: options.captoprilRisk ?? false,
    adrenalineGivenAt: null, adrenalineRepeatDue: false, ecgAt: null, episodeStartedAt: 0,
    id: globalThis.crypto.randomUUID(), caseId, episode: caseId, variant, mode: options.mode ?? 'training', speed: options.speed ?? 1, paused: false, phase: 'active', patient, completed: [], errors: [], temperatureMeasurement: null, events: [{ at: 0, text: c.cue, kind: 'patient' }], measurement: null, repeatMeasurement: null, baselineRead: false, doctorCalledAt: null, doctorArrived: false, teamCalledAt: null, teamArrived: false, firstCorrectAt: null, lastNitroAt: -1, nitroMinSbp: options.nitroMinSbp ?? null, nitroGivenAt: null, stableAt: null, positionedAt: null, arrestAt: null, chestSelected: false, compressions: 0, goodCompressions: 0, lastCompressionAt: null, cycleCompressions: 0, ventilations: 0, cprStartedAt: null, outcome: '', feedback: 'Эпизод начался. Для вызова помощи нажмите кнопку у кровати.',
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
  return [...new Set(clinicalTiers(a).flat())]
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
  const essentials = treatment(a).filter(id => !['clothing', 'blanket', 'linen', 'calm'].includes(id))
  if (!a.measurement || !a.completed.includes('inspect') || !essentials.every(id => a.completed.includes(id))) return
  if (a.episode === 'anaphylaxis' && a.variant === 'refractory' && !a.completed.includes('repeat-adrenaline')) return
  if (a.episode === 'syncope' && a.patient.consciousness !== 'ok') return
  if (a.episode === 'hypertension' && (a.neuroSigns || a.captoprilRisk) && !a.teamArrived && !a.doctorArrived) return
  a.stableAt = elapsed(a)
  a.patient.consciousness = 'ok'
  a.patient.breathing = true
  a.patient.sbp = a.episode === 'hypertension' ? (a.neuroSigns ? 180 : 160) : 110
  a.patient.pulse = 92
  log(a, 'Учебная динамика: состояние стабилизируется. Повторите измерение и передайте данные врачу.')
}
function copy(a: Attempt): Attempt { return { ...a, patient: { ...a.patient }, completed: [...a.completed], errors: [...a.errors], events: [...a.events] } }
function transitionToChest(a: Attempt) {
  a.episode = 'chest-pain'
  a.variant = 'persistent'
  a.episodeStartedAt = elapsed(a)
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
    if (a.teamArrived && ['compression', 'ventilate', 'aed-follow'].every(id => a.completed.includes(id as ActionId))) {
      a.phase = 'active'; a.stableAt = now; a.patient.breathing = true; a.patient.consciousness = 'dim'; a.patient.pulse = 90; a.patient.sbp = 100
      log(a, 'Бригада приняла реанимацию. Учебный этап компрессий завершён; запишите события и передайте данные.')
    } else if (a.arrestAt !== null && now - a.arrestAt >= 240) {
      a.phase = 'failed'; a.outcome = 'Учебное время реанимационного этапа истекло. Разберите задержки вызова и начала помощи.'
      log(a, a.outcome)
    }
    return a
  }
  if (a.arrestAt !== null) return a
  if (a.episode === 'anaphylaxis' && a.adrenalineGivenAt !== null && a.stableAt === null && now - a.adrenalineGivenAt >= 300 && !a.completed.includes('repeat-adrenaline')) a.adrenalineRepeatDue = true
  if (a.episode === 'chest-pain' && !a.completed.includes('ecg') && now - a.episodeStartedAt >= 600) error(a, 'ecg', 'major', 'ЭКГ не зарегистрирована в первые 10 минут после начала оценки боли в груди.')
  if (a.completed.includes('oxygen') && a.patient.breathing && a.patient.spo2 < 96) a.patient.spo2 = Math.min(96, a.patient.spo2 + deltaSec * .5)
  if (a.episode === 'hypertension' && a.measurement && before < a.measurement.at + 900 && now >= a.measurement.at + 900) {
    a.feedback = 'Прошло 15 минут с измерения АД. Повторите контроль; при ухудшении измеряйте раньше.'
    log(a, a.feedback)
  }
  if (a.caseId === 'collapse' && a.variant === 'fever') a.patient.tempC = Math.max(35.7, 39.2 - now * 0.1)
  if (a.episode === 'syncope' && a.positionedAt !== null && a.variant === 'brief' && now - a.positionedAt >= 25 && a.completed.includes('airway')) {
    if (a.patient.consciousness !== 'ok') log(a, 'В горизонтальном положении сознание вернулось. Продолжайте наблюдение.', 'patient')
    a.patient.consciousness = 'ok'
    a.patient.sbp = 112
    a.patient.pulse = 88
  }
  if (a.episode === 'syncope' && a.variant === 'prolonged' && a.positionedAt !== null && now - a.positionedAt >= 30) {
    a.episode = 'collapse'; a.variant = 'persistent-hypotension'; a.patient.consciousness = 'dim'
    log(a, 'Сохраняются гипотония и нарушение сознания: продолжайте помощь при шоке. Таймер не устанавливает причину — исключайте кровопотерю, аритмию, ТЭЛА и инфекцию с врачом.')
  }
  if (a.episode === 'hypertension' && !a.neuroSigns && !a.captoprilRisk && a.stableAt === null && before < 75 && now >= 75 && !a.completed.includes('captopril')) transitionToChest(a)
  maybeStable(a)
  if (a.stableAt === null) {
    const arrestDeadline = a.episode === 'anaphylaxis' && a.adrenalineGivenAt !== null ? Math.max(600, a.adrenalineGivenAt + 360) : 180
    if (now >= arrestDeadline) {
      a.phase = 'arrest'; a.arrestAt = arrestDeadline; a.patient.consciousness = 'lost'; a.patient.breathing = false; a.patient.pulse = 0; a.patient.sbp = 0
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
  if (a.doctorCalledAt === null && now > 30) error(a, 'call-doctor', 'critical', 'Врач не вызван в первые 30 секунд. Это учебный срок оценки своевременности.')
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
      if (now > 30) error(a, action, 'critical', 'Врач не вызван в первые 30 секунд. Это учебный срок оценки своевременности.')
      if (a.completed.some(id => !['inspect', 'airway', 'check-injury', 'check-breathing'].includes(id))) error(a, action, 'major', 'Вызов помощи задержан после первичной оценки ABC и безопасности.')
    }
    if (action === 'call-team' && a.teamCalledAt === null) {
      a.teamCalledAt = now
      if (a.doctorCalledAt === null) {
        a.doctorCalledAt = now; p.doctorCalled = true
        if (now > 30) error(a, 'call-doctor', 'critical', 'Врач не вызван в первые 30 секунд. Это учебный срок оценки своевременности.')
        complete(a, 'call-doctor')
      }
    }
    complete(a, action); a.feedback = action === 'call-doctor' ? 'Вызов принят. Врач прибудет через 90 секунд. Продолжайте помощь.' : 'Вызов принят. Бригада прибудет через 45 секунд.'
    log(a, a.feedback, 'action'); return a
  }
  if (a.phase === 'arrest') {
    if (action === 'check-breathing') { complete(a, action); a.feedback = 'Реакции и нормального дыхания нет. Нужны вызов бригады, компрессии и АНД.' }
    else if (action === 'wrong-location') return fail('critical', 'Компрессии выполняют в центре грудной клетки, не на животе.')
    else if (action === 'chest-location') { a.chestSelected = true; complete(a, action); a.feedback = 'Место выбрано: центр грудной клетки. Начинайте компрессии.' }
    else if (action === 'aed') { complete(a, action); a.feedback = 'АНД запрошен. Следуйте его командам; не прерывайте компрессии без необходимости.' }
    else if (action === 'firm-surface') { p.position = 'supine'; complete(a, action); a.feedback = 'Кровать горизонтальна, подушка убрана, жёсткая опора подготовлена с помощником без задержки компрессий.' }
    else if (action === 'open-airway') { complete(a, action); a.feedback = 'Дыхательные пути открыты, подготовлена вентиляция мешком с маской и кислородом.' }
    else if (action === 'cpr-oxygen') { complete(a, action); a.feedback = 'Кислород подключён к мешку Амбу с резервуаром. Компрессии продолжаются, вентиляция — с помощником.' }
    else if (action === 'aed-pads') {
      if (!a.completed.includes('aed')) return fail('major', 'Сначала подготовьте АНД.')
      complete(a, action); a.feedback = 'Электроды АНД установлены на обнажённую грудную клетку по схеме.'
    }
    else if (action === 'aed-follow') {
      if (!a.completed.includes('aed-pads')) return fail('major', 'Сначала наклейте электроды АНД.')
      complete(a, action); a.feedback = 'Анализ ритма по команде АНД: не касаться пациентки; разряд только по команде прибора, затем сразу компрессии.'
    }
    else if (action === 'compression') {
      if (!a.completed.includes('check-breathing')) return fail('major', 'Сначала оцените реакцию и нормальное дыхание.')
      if (!a.chestSelected) return fail('major', 'Сначала выберите место компрессий в центре грудной клетки.')
      a.compressions += 30; a.cycleCompressions = 30; a.lastCompressionAt = realNowMs
      if (a.cprStartedAt === null) a.cprStartedAt = now
      a.feedback = 'Серия 30 компрессий: 100–120/мин, глубина 5–6 см, полное расправление грудной клетки и минимум пауз. Техника кликом не оценивается.'
      if (a.cycleCompressions >= 30) { complete(a, action); a.feedback += ' Выполнено 30 компрессий: переходите к двум вдохам, если обучены.' }
      return a
    } else if (action === 'ventilate') {
      if (!a.completed.includes('open-airway')) return fail('major', 'Откройте дыхательные пути перед вентиляцией.')
      if (!a.completed.includes('cpr-oxygen')) return fail('major', 'Подготовьте мешок Амбу с кислородом через кислородную систему.')
      if (a.cycleCompressions < 30) return fail('major', 'В учебном цикле сначала выполните 30 компрессий, затем два вдоха.')
      a.ventilations++; a.cycleCompressions = 0; a.lastCompressionAt = null; complete(a, action); a.feedback = 'Два вдоха выполнены. Возобновите компрессии.'
    } else return fail('critical', 'При отсутствии нормального дыхания приоритет — реанимационная помощь. Это действие сейчас небезопасно.')
    log(a, step.title, 'action'); return a
  }
  // Any rejected action leaves the patient and completion flags unchanged.
  if (action === 'rapid-bp') return fail('critical', 'Резкое снижение АД без индивидуального назначения опасно. Исключите поражение органов-мишеней; дальнейшую тактику определяет врач.')
  if (action === 'captopril' && (!a.completed.includes('neuro') || a.neuroSigns || a.captoprilRisk)) return fail('major', 'Сначала оцените неврологические симптомы и противопоказания: ангиоотёк, беременность, стеноз почечных артерий, гиперкалиемия. При подозрении на осложнённый криз срочно передайте решение врачу.')
  if (action === 'nitro' && (!a.completed.includes('drug-history') || a.nitrateRisk || p.sbp < 90 || p.sbp < p.habitualSbp - 30)) return fail('critical', 'До нитрата уточните приём ФДЭ-5 за последние 24–48 ч и подозрение на инфаркт правого желудочка; исключите САД <90 и падение более 30 мм рт. ст. от исходного.')
  if (action === 'crystalloids' && !a.completed.includes('adrenaline')) return fail('major', 'Кристаллоиды дополняют адреналин, а не задерживают его. Сначала введите адреналин по экстренному протоколу.')
  if (action === 'repeat-adrenaline' && (!a.adrenalineRepeatDue || a.adrenalineGivenAt === null || now - a.adrenalineGivenAt < 300)) return fail('major', 'Повтор адреналина — через 5 минут при сохраняющихся нарушениях ABC; продолжайте оценку и мониторинг.')
  if (action === 'adrenaline' && a.adrenalineGivenAt !== null) return fail('major', 'Первая доза уже введена. При сохраняющихся ABC-нарушениях используйте действие повтора через 5 минут.')
  if (action === 'orthostatic' && (a.stableAt === null || p.consciousness !== 'ok' || !a.doctorArrived)) return fail('major', 'Ортостатическая проба возможна после полного восстановления и только по решению врача с обеспечением безопасности.')
  if (action === 'prepare-iv' && !a.completed.includes('protocol')) return fail('major', 'Сначала сверьте учебное назначение. Инфузия не начинается самостоятельно.')
  if (action === 'captopril' && a.completed.includes('captopril')) return fail('major', 'Повторная доза требует нового назначения и контроля АД. Не пытайтесь резко снижать давление.')
  if (action === 'ecg' && !a.completed.includes('attach-electrodes')) return fail('major', 'Сначала наложите электроды, затем снимите ЭКГ.')
  if (action === 'oxygen' && a.episode === 'chest-pain' && p.spo2 >= 90) return fail('minor', 'При SpO₂ ≥ 90% без дыхательной недостаточности рутинный кислород при ОКС не показан.')
  if (action === 'oxygen' && !oxygenNeeded(a)) return fail('minor', 'В этом состоянии кислород не требуется рутинно. Цель для большинства острых состояний — SpO₂ 94–98%; при риске гиперкапнии цель назначается отдельно.')
  if (action === 'oxygen' && !a.completed.includes('saturation') && a.episode !== 'anaphylaxis' && p.sbp >= 90) return fail('major', 'Подключите пульсоксиметр для оценки и контроля кислорода.')
  if (action === 'transfer' && !a.completed.includes('check-injury')) return fail('major', 'Сначала оцените безопасность и признаки травмы; при подозрении на травму вызывайте помощь без самостоятельного перемещения.')
  if (['supine', 'legs-up', 'knees-up'].includes(action) && p.location === 'sink') return fail('major', 'Уложите пациентку на месте через умывальник: не задерживайте безопасное положение ради переноса на кровать.')
  if (action === 'position-on-site' && !a.completed.includes('check-injury')) return fail('major', 'Быстро оцените безопасность и возможную травму, затем уложите на месте.')
  if (action === 'transfer' && p.consciousness !== 'ok') return fail('major', 'Сначала помощь и наблюдение на месте. Перемещение с персоналом — после восстановления; при подозрении на травму решение принимает врач.')
  if (action === 'remove-catheter' && a.episode === 'anaphylaxis') return fail('critical', 'Не удаляйте катетер при шоке: остановите введение аллергена и сохраните венозный доступ.')
  if (action === 'antipyretic' && a.episode === 'collapse') return fail('critical', 'При падении температуры и гипотонии жаропонижающее не устраняет причину коллапса.')
  if (action === 'multiple-drugs') return fail('critical', 'Нельзя резко снижать АД несколькими препаратами без назначения и контроля.')
  if (action === 'self-analgesia') return fail('major', 'Самостоятельное введение без назначения недопустимо. Запросите обезболивание: его не следует откладывать только ради сохранения симптомов.')
  if (action === 'food' && a.episode === 'abdomen') return fail('major', 'До оценки врача не предлагайте еду при неясной острой боли в животе.')
  if (action === 'ice' && (a.episode !== 'abdomen' || !a.doctorArrived)) return fail('minor', 'Холод не является обязательным лечением. Подготовьте его только по решению осмотревшего врача, через ткань.')
  if (action === 'supine' && a.episode === 'hypertension') return fail('major', 'В этом эпизоде выберите удобное полусидячее положение 30–45°. Дальнейшие назначения определяет врач.')
  if ((action === 'heat' || action === 'enema') && a.episode === 'abdomen') return fail('critical', 'При острой боли в животе неясной причины грелка и клизма запрещены. Сообщите врачу.')
  if (action === 'heat' && ['bleeding', 'trauma'].includes(a.variant)) return fail('critical', 'При кровотечении или травме грелка небезопасна. Сначала остановите кровотечение и вызовите помощь.')
  if (action === 'heat' && p.consciousness === 'lost') return fail('critical', 'Грелка при отсутствии сознания небезопасна: риск ожога.')
  if (action === 'rub' && ['bleeding', 'trauma'].includes(a.variant)) return fail('critical', 'При кровотечении или травме растирание и массаж живота запрещены.')
  if (['sitting', 'semi-sitting'].includes(action) && (['collapse', 'syncope'].includes(a.episode) || (a.episode === 'anaphylaxis' && (p.sbp < 90 || action === 'sitting')))) return fail('critical', 'При этом состоянии нельзя оставлять пациентку сидя. Выберите безопасное горизонтальное положение.')
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
  if (drugs.includes(action) && action !== 'adrenaline' && !a.completed.includes('protocol')) return fail('major', 'Сначала сверяйте учебное назначение и противопоказания в аптечке.')
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
  const missedPriority = priorityInversion(a, action)
  switch (action) {
    case 'talk': log(a, patientCue(a), 'patient'); break
    case 'inspect': complete(a, 'airway'); a.feedback = `Безопасность и проходимость дыхательных путей оценены. ABC: сознание ${consciousnessLabels[p.consciousness]}, кожа ${skinLabels[p.skin]}. ${p.breathing ? 'Дыхание сохранено, центральный пульс определяется.' : 'Нормального дыхания нет — реанимационная помощь.'}`; break
    case 'glucose': a.glucoseMeasurement = { at: now, value: 5.4 }; a.feedback = 'Глюкоза 5,4 ммоль/л: гипогликемия не выявлена. Результат не исключает другие причины нарушения сознания.'; break
    case 'neuro': a.feedback = a.neuroSigns ? 'Выявлены асимметрия лица / слабость руки / нарушение речи. Подозрение на инсульт: срочно вызовите бригаду, уточните время последнего нормального состояния, не снижайте АД самостоятельно.' : 'Лицо симметрично, обе руки удерживает, речь сохранена. Врач оценивает другие признаки поражения органов-мишеней.'; break
    case 'differential': a.feedback = 'Гипотония после лихорадки не объясняется только падением температуры: сообщите врачу о возможном сепсисе, скрытой кровопотере и лекарственной причине. Подготовьте венозный доступ и исследования, включая лактат и посевы, по назначению без задержки помощи.'; break
    case 'pain-onset': a.feedback = 'Начало боли: около 20 минут до начала эпизода. Время начала и динамика передаются бригаде для решения о реперфузии.'; break
    case 'drug-history': a.feedback = a.nitrateRisk ? 'Есть риск: недавний приём ФДЭ-5 или подозрение на инфаркт правого желудочка. Воздержитесь от нитрата, решение передайте врачу.' : 'Приём ФДЭ-5 за последние 24–48 часов отрицает; известных данных за инфаркт правого желудочка нет. Окончательная оценка — врачом по ЭКГ и клинике.'; break
    case 'abdomen-history': a.feedback = 'Уточнены начало, локализация боли, рвота, стул, кровотечение и операции. Пациентке 68 лет, постменопауза; сообщите врачу о любых кровянистых выделениях. У пациенток репродуктивного возраста дополнительно уточняют возможность беременности и дату последней менструации.'; break
    case 'position-on-site': p.position = 'legsUp'; a.positionedAt ??= now; complete(a, 'legs-up'); a.feedback = 'Пациентка безопасно уложена на месте у умывальника, ноги приподняты. Оценка и помощь продолжаются до переноса.'; break
    case 'crystalloids': a.feedback = 'По экстренному протоколу начата инфузия кристаллоида: взрослому первоначально 500–1000 мл с повторной оценкой АД, дыхания и признаков перегрузки. Венозный доступ сохранён.'; break
    case 'adrenaline': a.adrenalineGivenAt = now; a.feedback = 'Адреналин 0,5 мг (0,5 мл раствора 1 мг/мл) в/м в наружную поверхность средней трети бедра по взрослому экстренному протоколу. При сохраняющихся ABC-нарушениях повтор через 5 минут; абсолютные противопоказания при анафилаксии отсутствуют.'; break
    case 'repeat-adrenaline': a.adrenalineRepeatDue = false; a.feedback = 'Повторная в/м доза по экстренному протоколу выполнена. При рефрактерном шоке дальнейшее лечение ведёт реанимационная бригада.'; break
    case 'observe-anaphylaxis': a.feedback = 'Передайте бригаде время и дозы адреналина, инфузию и динамику ABC. Организовано дальнейшее наблюдение из-за риска двухфазной реакции; его длительность определяет врач по риску, стабилизация в симуляции не означает выписку.'; break
    case 'orthostatic': a.feedback = 'По решению врача, после восстановления, организована проба лёжа и стоя под контролем персонала. Это дополнительная оценка, не действие во время обморока.'; break
    case 'ecg': a.ecgAt = now; a.feedback = 'ЭКГ зарегистрирована, передайте врачу для интерпретации. При подозрении на ОКС целевой срок — первые 10 минут от первого контакта.'; break
    case 'repeat-measure': case 'measure': {
      const value = { at: now, sbp: p.sbp, pulse: p.pulse }
      a.measurement = value
      if (a.stableAt !== null) { a.repeatMeasurement = value; complete(a, 'repeat-measure') }
      a.feedback = `Измерено: САД ${value.sbp} мм рт. ст., пульс ${value.pulse}/мин. Температура измеряется отдельным термометром.`
      break
    }
    case 'baseline': a.baselineRead = true; a.feedback = `В температурном листе: привычное САД ${p.habitualSbp} мм рт. ст., пульс 80/мин. Текущие значения узнаются только измерением.`; break
    case 'temperature': a.temperatureMeasurement = { at: now, value: Math.round(p.tempC * 10) / 10 }; a.feedback = `Термометр: ${p.tempC.toFixed(1)} °C.`; break
    case 'saturation': a.feedback = `Датчик установлен: SpO₂ ${Math.round(p.spo2)}%.`; break
    case 'connect-monitor': a.feedback = 'Монитор подключён: непрерывный контроль пульса и SpO₂, АД — отдельными измерениями.'; break
    case 'transfer': p.location = 'bed'; p.position = 'legsUp'; break
    case 'knees-up': p.position = 'kneesUp'; break
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
      else { a.feedback = 'Повторная оценка: боль сохраняется. Отказ от нитрата не меняет исходный вариант и не устанавливает диагноз. Вызов бригады требуется при подозрении на ОКС независимо от динамики боли.' }
      log(a, a.feedback, 'patient'); break
    case 'stop-bleeding': case 'stop-infusion': case 'stop-trigger': a.feedback = a.episode === 'anaphylaxis' ? `Триггер устранён. Путь исходной инъекции: ${routeLabels[p.injectionRoute]}. Адреналин вводят внутримышечно независимо от пути триггера.` : 'Начата остановка видимого наружного кровотечения прямым давлением. Врач вызван.'; break
    case 'protocol': a.feedback = a.episode === 'hypertension' ? `Назначение и противопоказания проверены: ангиоотёк в анамнезе, беременность, стеноз почечных артерий и гиперкалиемия. ${a.captoprilRisk ? 'Выявлено противопоказание: каптоприл не применять, передать решение врачу.' : 'Известных противопоказаний нет; препарат только по назначению после оценки неврологических симптомов и АД.'}` : 'Учебное назначение сверено: показание, аллергии, сознание, актуальные показатели и способ введения. Это не должно задерживать экстренный адреналин при анафилаксии.'; break
    case 'handoff': a.phase = 'finished'; a.outcome = a.arrestAt !== null ? 'Бригада приняла реанимацию и данные наблюдения. Исход пациента не прогнозируется симулятором.' : 'Врач прибыл, состояние в учебной модели стабильно. Наблюдения переданы.'; break
    default: break
  }
  complete(a, action)
  if (!['temperature', 'saturation', 'connect-monitor', 'inspect', 'measure', 'repeat-measure', 'baseline', 'pain-response', 'stop-infusion', 'stop-trigger', 'stop-bleeding', 'protocol', 'handoff', 'glucose', 'neuro', 'differential', 'pain-onset', 'drug-history', 'abdomen-history', 'position-on-site', 'crystalloids', 'adrenaline', 'repeat-adrenaline', 'observe-anaphylaxis', 'orthostatic', 'ecg'].includes(action)) a.feedback = `${step.title}: выполнено.`
  log(a, a.feedback, 'action')
  if (missedPriority) {
    const result = a.feedback
    error(a, action, 'minor', `Нарушен приоритет: сначала «${actionById(missedPriority).title}». Действие выполнено, но более срочная помощь не должна задерживаться.`)
    a.feedback = `${result} ${a.feedback}`
  }
  maybeStable(a)
  return a
}
export const consciousnessLabels = { ok: 'ясное', dim: 'заторможена', lost: 'нет реакции' }
export const skinLabels = { normal: 'обычная', pale: 'бледная', flushed: 'покраснение', coldSweat: 'холодный липкий пот', rash: 'сыпь' }
export const routeLabels: Record<Route, string> = { none: 'нет', subcutaneous: 'подкожный', intramuscular: 'внутримышечный', intravenous: 'внутривенный' }
export const positionLabels = { supine: 'на спине', semiSitting: 'полусидя', sitting: 'сидя на краю', legsUp: 'ноги приподняты', kneesUp: 'на спине, колени согнуты' }
export function stageScores(a: Attempt): number[] {
  return ([1, 2, 3, 4, 5] as Stage[]).map(stage => {
    const required = requiredActions(a).filter(id => actionById(id).stage === stage)
    const completion = required.length ? required.filter(id => a.completed.includes(id)).length / required.length : 1
    if (a.errors.some(e => e.stage === stage && e.severity === 'critical')) return 0
    const penalties = a.errors.filter(e => e.stage === stage).reduce((sum, e) => sum + ({ critical: 50, major: 20, minor: 5 }[e.severity]), 0)
    return Math.max(0, Math.round(completion * 100 - penalties))
  })
}
