import type { Attempt, PatientState } from './simulation.ts'

export type CaseId = 'collapse' | 'hypertension' | 'chest-pain' | 'syncope' | 'anaphylaxis' | 'abdomen'
export type ObjectId = 'patient' | 'bed-controls' | 'call-bell' | 'monitor' | 'chart' | 'medications' | 'oxygen' | 'blanket' | 'heater' | 'sink' | 'injection' | 'cpr' | 'linen' | 'equipment'
export type Severity = 'critical' | 'major' | 'minor'
export type Stage = 1 | 2 | 3 | 4 | 5
export type ActionId = 'talk' | 'inspect' | 'measure' | 'repeat-measure' | 'baseline' | 'call-doctor' | 'call-team' | 'ecg' | 'supine' | 'legs-up' | 'semi-sitting' | 'sitting' | 'clothing' | 'airway' | 'oxygen' | 'blanket' | 'heat' | 'linen' | 'prepare-iv' | 'calm' | 'protocol' | 'nitro' | 'aspirin' | 'captopril' | 'adrenaline' | 'antihistamine' | 'stop-infusion' | 'stop-bleeding' | 'stop-trigger' | 'continue-infusion' | 'pain-response' | 'withhold-nitro' | 'observe-recovery' | 'avoid-intervention' | 'enema' | 'rub' | 'tea' | 'ammonia' | 'record' | 'handoff' | 'check-breathing' | 'chest-location' | 'wrong-location' | 'compression' | 'ventilate' | 'aed'

export const stageTitles = ['Распознать', 'Вызвать помощь', 'Стабилизировать', 'Действовать по протоколу', 'Наблюдать и записать']
export const objectLabels: Record<ObjectId, string> = {
  patient: 'Пациентка', 'bed-controls': 'Функциональная кровать', 'call-bell': 'Пост и вызов помощи', monitor: 'Тонометр и пульс', chart: 'Температурный лист', medications: 'Аптечка', oxygen: 'Кислород', blanket: 'Одеяло', heater: 'Грелка', sink: 'Умывальник', injection: 'Инъекция и система', cpr: 'Реанимация', linen: 'Чистое бельё', equipment: 'Инструменты',
}
export interface Step {
  id: ActionId
  title: string
  stage: Stage
  target: { object: ObjectId; action: ActionId }
  deadlineSec?: number
  when?: (attempt: Attempt) => boolean
  forbidden?: { when: (attempt: Attempt) => boolean; severity: Severity; why: string }[]
  effect?: (state: PatientState) => PatientState
  order?: 'strict' | 'any'
}
export const actions: Step[] = [
  ['talk', 'Спросить о жалобах', 1, 'patient'], ['inspect', 'Оценить сознание, кожу и дыхание', 1, 'patient'],
  ['measure', 'Измерить давление и пульс', 1, 'monitor'], ['repeat-measure', 'Повторно измерить давление и пульс', 5, 'monitor'], ['baseline', 'Прочитать исходные показатели', 1, 'chart'],
  ['call-doctor', 'Срочно вызвать врача · H', 2, 'call-bell'], ['call-team', 'Вызвать реанимационную бригаду', 2, 'call-bell'], ['ecg', 'Вызвать специалиста для ЭКГ', 4, 'call-bell'],
  ['supine', 'Уложить на спину', 3, 'bed-controls'], ['legs-up', 'Поднять ноги, убрать подушку', 3, 'bed-controls'], ['semi-sitting', 'Помочь принять полусидячее положение', 3, 'bed-controls'], ['sitting', 'Посадить на край кровати', 3, 'bed-controls'],
  ['clothing', 'Освободить от стесняющей одежды', 3, 'patient'], ['airway', 'Проверить проходимость дыхательных путей', 3, 'patient'], ['oxygen', 'Подготовить и подать кислород по протоколу', 3, 'oxygen'],
  ['blanket', 'Укрыть одеялом', 3, 'blanket'], ['heat', 'Приложить грелку', 3, 'heater'], ['linen', 'Сменить влажное бельё', 3, 'linen'], ['prepare-iv', 'Подготовить инструменты для врача', 4, 'equipment'], ['calm', 'Успокоить, сохранять контакт', 3, 'patient'],
  ['protocol', 'Сверить учебное назначение и противопоказания', 4, 'medications'], ['nitro', 'Нитроглицерин по назначению', 4, 'medications'], ['aspirin', 'Ацетилсалициловая кислота по назначению', 4, 'medications'], ['captopril', 'Каптоприл по назначению врача', 4, 'medications'], ['adrenaline', 'Внутримышечный адреналин по экстренному протоколу', 4, 'medications'], ['antihistamine', 'Антигистаминный вместо адреналина', 4, 'medications'],
  ['stop-infusion', 'Прекратить инфузию, сохранить венозный доступ', 3, 'injection'], ['stop-bleeding', 'Остановить видимое наружное кровотечение прямым давлением', 3, 'equipment'], ['stop-trigger', 'Прекратить контакт с предполагаемым аллергеном', 3, 'injection'], ['continue-infusion', 'Продолжить введение препарата', 4, 'injection'],
  ['pain-response', 'Уточнить боль после вмешательства', 4, 'patient'], ['withhold-nitro', 'Воздержаться от нитроглицерина, передать врачу', 4, 'medications'], ['observe-recovery', 'Оценить возвращение сознания', 4, 'patient'], ['avoid-intervention', 'Отказаться от грелки и клизмы', 4, 'equipment'], ['enema', 'Поставить клизму', 4, 'equipment'], ['rub', 'Растирать конечности / массировать живот', 3, 'patient'], ['tea', 'Предложить питьё', 4, 'sink'], ['ammonia', 'Использовать нашатырный спирт', 4, 'sink'],
  ['record', 'Записать фактические показатели и действия', 5, 'chart'], ['handoff', 'Передать пациентку прибывшему врачу', 5, 'call-bell'], ['check-breathing', 'Проверить реакцию и нормальное дыхание', 1, 'cpr'], ['chest-location', 'Выбрать центр грудной клетки', 3, 'cpr'], ['wrong-location', 'Выбрать область живота', 3, 'cpr'], ['compression', 'Выполнить компрессию', 3, 'cpr'], ['ventilate', 'Выполнить 2 вдоха после 30 компрессий', 3, 'cpr'], ['aed', 'Попросить принести АНД и следовать его командам', 3, 'cpr'],
].map(([id, title, stage, object]) => ({ id: id as ActionId, title: title as string, stage: stage as Stage, target: { object: object as ObjectId, action: id as ActionId }, order: 'any' }))

export const actionById = (id: ActionId): Step => actions.find(action => action.id === id)!
export interface EmergencyCase {
  id: CaseId
  title: string
  description: string
  cue: string
  initial: Partial<PatientState>
  required: ActionId[]
}
export const emergencyCases: EmergencyCase[] = [
  { id: 'collapse', title: 'Лихорадка → коллапс', description: 'После периода жара температура резко падает. Слабость и холодный пот.', cue: 'Жар прошёл… Но мне вдруг очень холодно. Темнеет в глазах.', initial: { tempC: 39.2, sbp: 85, pulse: 118, complaint: 'weakDizzy', skin: 'coldSweat' }, required: ['talk', 'inspect', 'measure', 'baseline', 'call-doctor', 'legs-up', 'clothing', 'airway', 'oxygen', 'blanket', 'linen', 'prepare-iv', 'record', 'handoff'] },
  { id: 'hypertension', title: 'Гипертонический криз', description: 'Тревожная новость, головная боль и нарушение зрения. Сравните АД с привычным.', cue: 'Голова раскалывается… Перед глазами мушки, в ушах шумит.', initial: { sbp: 200, pulse: 106, complaint: 'headacheVision', skin: 'flushed' }, required: ['talk', 'inspect', 'measure', 'baseline', 'call-doctor', 'supine', 'calm', 'clothing', 'protocol', 'captopril', 'record', 'handoff'] },
  { id: 'chest-pain', title: 'Боль в груди', description: 'Давление за грудиной. Нужны оценка, ЭКГ и наблюдение за ответом на помощь.', cue: 'Давит в груди, отдаёт в левую руку. Мне страшно…', initial: { sbp: 135, pulse: 102, complaint: 'chestPain', skin: 'pale' }, required: ['talk', 'inspect', 'measure', 'baseline', 'call-doctor', 'semi-sitting', 'calm', 'clothing', 'protocol', 'aspirin', 'ecg', 'pain-response', 'record', 'handoff'] },
  { id: 'syncope', title: 'Обморок или коллапс?', description: 'У умывальника пациентке стало плохо. Проследите за восстановлением сознания.', cue: 'В ушах звенит… Кажется, я сейчас упаду.', initial: { sbp: 88, pulse: 108, complaint: 'weakDizzy', skin: 'pale', position: 'sitting', consciousness: 'dim' }, required: ['talk', 'inspect', 'measure', 'call-doctor', 'legs-up', 'clothing', 'airway', 'observe-recovery', 'record', 'handoff'] },
  { id: 'anaphylaxis', title: 'Реакция после инъекции', description: 'После введения лекарства появились зуд, сыпь и затруднение дыхания.', cue: 'Всё чешется… Тяжело дышать. Что со мной?', initial: { sbp: 82, pulse: 124, complaint: 'itchBreath', skin: 'rash' }, required: ['talk', 'inspect', 'measure', 'call-doctor', 'call-team', 'legs-up', 'airway', 'oxygen', 'protocol', 'adrenaline', 'record', 'handoff'] },
  { id: 'abdomen', title: 'Острая боль в животе', description: 'Причина боли неизвестна. Решите, какие вмешательства нужно исключить.', cue: 'Очень сильно болит живот. Может, приложить что-нибудь тёплое?', initial: { sbp: 110, pulse: 104, complaint: 'abdomenPain', skin: 'pale' }, required: ['talk', 'inspect', 'measure', 'call-doctor', 'supine', 'avoid-intervention', 'record', 'handoff'] },
]
export const getCase = (id: CaseId) => emergencyCases.find(item => item.id === id)!

// Clinical guard conditions are evaluated before any effect is applied.
const nitro = actionById('nitro')
nitro.forbidden = [
  { when: a => a.patient.nitroDoses >= 3, severity: 'critical', why: 'Превышено ограничение учебного назначения: не более трёх доз.' },
  { when: a => a.nitroMinSbp !== null && a.patient.sbp < a.nitroMinSbp, severity: 'critical', why: 'Давление ниже порога, указанного преподавателем в учебном назначении.' },
  { when: a => !a.measurement || a.measurement.at <= a.lastNitroAt, severity: 'major', why: 'Перед каждой дозой нужно заново измерить давление и пульс.' },
]
nitro.when = a => a.episode === 'chest-pain' && a.nitroMinSbp !== null
nitro.effect = p => ({ ...p, nitroDoses: p.nitroDoses + 1 })
actionById('call-doctor').deadlineSec = 30

export const scenario = { patient: { name: 'Мария Андреевна', age: 68, vitals: [
  { label: 'T', value: '37,0', unit: '°C' }, { label: 'АД', value: '120', unit: 'мм рт. ст.' }, { label: 'Пульс', value: '80', unit: '/мин' },
] } }
export const sourceReferences = [
  { organization: 'Материалы проекта · исходник пользователя', title: 'Пациентка: A-pose и локальный риг', summary: 'Модель предоставлена владельцем проекта; генератор в метаданных — Tripo3D. Риг и базовые клипы подготовлены локально, без стороннего mocap.', url: '' },
  { organization: 'Google · Binomial LLC · Apache 2.0', title: 'Draco и Basis Universal', summary: 'Локальные декодеры сжатой геометрии и KTX2-текстур. Новые сторонние персонажи и mocap пока не включены.', url: 'https://github.com/google/draco' },
  { organization: 'RCUK · 2025', title: 'Анафилаксия и особые обстоятельства', summary: 'Адреналин внутримышечно — первая линия; антигистаминный не заменяет его.', url: 'https://www.resus.org.uk/professional-library/2025-resuscitation-guidelines/special-circumstances-guidelines' },
  { organization: 'NICE · CG95', title: 'Боль в груди: оценка и диагностика', summary: 'Ответ на нитроглицерин не используется для постановки диагноза. Нужны обследование и ЭКГ.', url: 'https://www.nice.org.uk/guidance/cg95/chapter/recommendations' },
  { organization: 'RCUK · 2025', title: 'Базовая реанимация взрослых', summary: 'Ранний вызов, компрессии 100–120/мин, АНД; 30:2 при навыке искусственного дыхания.', url: 'https://www.resus.org.uk/professional-library/2025-resuscitation-guidelines/adult-basic-life-support-guidelines' },
  { organization: 'Учебный план', title: 'Методические материалы А и Б', summary: 'Библиографические данные не приложены. Сроки ухудшения — игровые; лекарственные действия требуют проверки преподавателем.', url: '' },
  { organization: 'GRADD CO · CC BY 3.0', title: 'GRADD Hospital Room', summary: 'Модель палаты: GRADD CO, Poly Pizza, лицензия CC BY 3.0.', url: 'https://poly.pizza/m/9sUalfQ76kn' },
]
