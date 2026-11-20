import type { Attempt, PatientState } from './simulation.ts'

export type CaseId = 'collapse' | 'hypertension' | 'chest-pain' | 'syncope' | 'anaphylaxis' | 'abdomen'
export type ObjectId = ClinicalObjectId | 'tonometer' | 'patient' | 'bed-controls' | 'call-bell' | 'monitor' | 'chart' | 'medications' | 'oxygen' | 'blanket' | 'heater' | 'sink' | 'injection' | 'cpr' | 'linen' | 'equipment' | 'thermometer' | 'pulseox' | 'ecg-device' | 'shock-kit' | 'iv-stand' | 'ice-pack' | 'analgesics' | 'enema-kit' | 'food-water'
export type Severity = 'critical' | 'major' | 'minor'
// Clinical extensions keep every action tied to a physical interaction target.
export type ClinicalObjectId = 'glucometer' | 'aed-device' | 'bag-mask'
export type ClinicalActionId = 'cpr-oxygen' | 'glucose' | 'neuro' | 'differential' | 'pain-onset' | 'drug-history' | 'rapid-bp' | 'position-on-site' | 'orthostatic' | 'observe-anaphylaxis' | 'crystalloids' | 'repeat-adrenaline' | 'firm-surface' | 'open-airway' | 'aed-pads' | 'aed-follow' | 'abdomen-history'
export type Stage = 1 | 2 | 3 | 4 | 5
export type ActionId = ClinicalActionId | 'talk' | 'inspect' | 'measure' | 'repeat-measure' | 'baseline' | 'call-doctor' | 'call-team' | 'ecg' | 'supine' | 'legs-up' | 'semi-sitting' | 'sitting' | 'clothing' | 'airway' | 'oxygen' | 'blanket' | 'heat' | 'linen' | 'prepare-iv' | 'calm' | 'protocol' | 'nitro' | 'aspirin' | 'captopril' | 'adrenaline' | 'antihistamine' | 'stop-infusion' | 'stop-bleeding' | 'stop-trigger' | 'continue-infusion' | 'pain-response' | 'withhold-nitro' | 'observe-recovery' | 'avoid-intervention' | 'enema' | 'rub' | 'tea' | 'ammonia' | 'record' | 'handoff' | 'check-breathing' | 'chest-location' | 'wrong-location' | 'compression' | 'ventilate' | 'aed' | 'temperature' | 'saturation' | 'connect-monitor' | 'attach-electrodes' | 'knees-up' | 'check-injury' | 'transfer' | 'remove-catheter' | 'ice' | 'self-analgesia' | 'request-analgesia' | 'food' | 'antipyretic' | 'multiple-drugs'

export const stageTitles = ['Распознать', 'Вызвать помощь', 'Стабилизировать', 'Действовать по протоколу', 'Наблюдать и записать']
export const objectLabels: Record<ObjectId, string> = {
  glucometer: 'Глюкометр', 'aed-device': 'Автоматический дефибриллятор (АНД)', 'bag-mask': 'Мешок Амбу с маской',
  tonometer: 'Тонометр',
  patient: 'Пациентка', 'bed-controls': 'Функциональная кровать', 'call-bell': 'Пост и вызов помощи', monitor: 'Прикроватный монитор', chart: 'Температурный лист', medications: 'Аптечка', oxygen: 'Кислород', blanket: 'Одеяло', heater: 'Грелка', sink: 'Умывальник', injection: 'Инъекция и система', cpr: 'Реанимация', linen: 'Чистое бельё', equipment: 'Инструменты', thermometer: 'Термометр', pulseox: 'Пульсоксиметр', 'ecg-device': 'Электрокардиограф', 'shock-kit': 'Противошоковая укладка', 'iv-stand': 'Инфузионная стойка', 'ice-pack': 'Пузырь со льдом', analgesics: 'Обезболивающее', 'enema-kit': 'Клизма', 'food-water': 'Вода и еда',
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
  ['talk', 'Спросить о жалобах', 1, 'patient'], ['inspect', 'Оценить безопасность, сознание и ABC', 1, 'patient'],
  ['glucose', 'Измерить глюкозу крови', 1, 'glucometer'],
  ['neuro', 'Проверить лицо, руки и речь', 1, 'patient'],
  ['differential', 'Оценить признаки инфекции, кровопотери и шока', 1, 'patient'],
  ['pain-onset', 'Уточнить время начала боли', 1, 'patient'],
  ['drug-history', 'Уточнить приём ФДЭ-5 и противопоказания к нитратам', 4, 'patient'],
  ['rapid-bp', 'Попытаться резко снизить давление', 4, 'medications'],
  ['position-on-site', 'Безопасно уложить на месте и приподнять ноги', 3, 'sink'],
  ['orthostatic', 'Ортостатическая проба после восстановления по назначению', 5, 'tonometer'],
  ['observe-anaphylaxis', 'Организовать дальнейшее наблюдение после анафилаксии', 5, 'monitor'],
  ['crystalloids', 'Ввести кристаллоид по экстренному протоколу', 4, 'iv-stand'],
  ['repeat-adrenaline', 'Повторить адреналин через 5 минут при сохраняющихся ABC-нарушениях', 4, 'shock-kit'],
  ['firm-surface', 'Подготовить кровать для СЛР, убрать подушку', 3, 'bed-controls'],
  ['open-airway', 'Открыть дыхательные пути перед вентиляцией', 3, 'cpr'],
  ['cpr-oxygen', 'Подключить кислород к мешку Амбу', 3, 'oxygen'],
  ['aed-pads', 'Наклеить электроды АНД', 3, 'aed-device'],
  ['aed-follow', 'Выполнить команды АНД и возобновить компрессии', 3, 'aed-device'],
  ['abdomen-history', 'Уточнить анамнез боли и гинекологический анамнез', 1, 'patient'],
  ['measure', 'Измерить давление и пульс', 1, 'tonometer'], ['repeat-measure', 'Повторно измерить давление и пульс', 5, 'tonometer'], ['baseline', 'Прочитать исходные показатели', 1, 'chart'],
  ['call-doctor', 'Срочно вызвать врача · H', 2, 'call-bell'], ['call-team', 'Вызвать реанимационную бригаду', 2, 'call-bell'], ['ecg', 'Снять ЭКГ и подготовить запись врачу', 4, 'ecg-device'],
  ['supine', 'Уложить на спину', 3, 'bed-controls'], ['legs-up', 'Поднять ноги, убрать подушку', 3, 'bed-controls'], ['semi-sitting', 'Помочь принять полусидячее положение', 3, 'bed-controls'], ['sitting', 'Посадить на край кровати', 3, 'bed-controls'],
  ['clothing', 'Освободить от стесняющей одежды', 3, 'patient'], ['airway', 'Проверить проходимость дыхательных путей', 3, 'patient'], ['oxygen', 'Подготовить и подать кислород по протоколу', 3, 'oxygen'],
  ['blanket', 'Укрыть одеялом', 3, 'blanket'], ['heat', 'Приложить грелку', 3, 'heater'], ['linen', 'Сменить влажное бельё', 3, 'linen'], ['prepare-iv', 'Подготовить инфузию по назначению, сохранить доступ', 4, 'iv-stand'], ['calm', 'Успокоить, сохранять контакт', 3, 'patient'],
  ['protocol', 'Сверить учебное назначение и противопоказания', 4, 'medications'], ['nitro', 'Нитроглицерин по назначению', 4, 'medications'], ['aspirin', 'Ацетилсалициловая кислота по назначению', 4, 'medications'], ['captopril', 'Каптоприл по назначению врача', 4, 'medications'], ['adrenaline', 'Ввести адреналин в/м в наружную поверхность бедра', 4, 'shock-kit'], ['antihistamine', 'Антигистаминный вместо адреналина', 4, 'medications'],
  ['stop-infusion', 'Прекратить инфузию, сохранить венозный доступ', 3, 'injection'], ['stop-bleeding', 'Остановить видимое наружное кровотечение прямым давлением', 3, 'equipment'], ['stop-trigger', 'Прекратить контакт с предполагаемым аллергеном', 3, 'injection'], ['continue-infusion', 'Продолжить введение препарата', 4, 'injection'],
  ['pain-response', 'Уточнить боль после вмешательства', 4, 'patient'], ['withhold-nitro', 'Воздержаться от нитроглицерина, передать врачу', 4, 'medications'], ['observe-recovery', 'Оценить возвращение сознания', 4, 'patient'], ['avoid-intervention', 'Отказаться от грелки и клизмы', 4, 'equipment'], ['enema', 'Поставить клизму', 4, 'enema-kit'], ['rub', 'Растирать конечности / массировать живот', 3, 'patient'], ['tea', 'Предложить питьё', 4, 'food-water'], ['ammonia', 'Использовать нашатырный спирт', 4, 'sink'],
  ['record', 'Записать фактические показатели и действия', 5, 'chart'], ['handoff', 'Передать пациентку прибывшему врачу', 5, 'call-bell'], ['check-breathing', 'Проверить реакцию и нормальное дыхание', 1, 'cpr'], ['chest-location', 'Выбрать центр грудной клетки', 3, 'cpr'], ['wrong-location', 'Выбрать область живота', 3, 'cpr'], ['compression', 'Выполнить 30 компрессий грудной клетки', 3, 'cpr'], ['ventilate', 'Выполнить 2 вдоха мешком Амбу после 30 компрессий', 3, 'bag-mask'], ['aed', 'Подготовить АНД', 3, 'aed-device'],
  ['temperature', 'Измерить температуру', 1, 'thermometer'], ['saturation', 'Установить датчик SpO₂', 1, 'pulseox'], ['connect-monitor', 'Подключить непрерывный мониторинг', 3, 'monitor'],
  ['attach-electrodes', 'Наложить электроды ЭКГ', 4, 'ecg-device'], ['knees-up', 'На спину, согнуть ноги в коленях', 3, 'bed-controls'],
  ['check-injury', 'Оценить травмы и безопасность перемещения', 1, 'sink'], ['transfer', 'Переместить на кровать с помощью персонала', 3, 'sink'],
  ['remove-catheter', 'Удалить венозный катетер', 3, 'injection'], ['ice', 'Подготовить холод через ткань по назначению', 4, 'ice-pack'],
  ['self-analgesia', 'Дать обезболивающее без назначения', 4, 'analgesics'], ['request-analgesia', 'Запросить у врача обезболивание', 4, 'analgesics'],
  ['food', 'Предложить еду', 4, 'food-water'], ['antipyretic', 'Дать жаропонижающее', 4, 'medications'], ['multiple-drugs', 'Дать несколько гипотензивных сразу', 4, 'medications'],
].map(([id, title, stage, object]) => ({ id: id as ActionId, title: title as string, stage: stage as Stage, target: { object: object as ObjectId, action: id as ActionId }, order: 'any' }))

export const actionById = (id: ActionId): Step => actions.find(action => action.id === id)!
export interface EmergencyCase {
  id: CaseId
  title: string
  description: string
  cue: string
  initial: Partial<PatientState>
}
export const emergencyCases: EmergencyCase[] = [
  { id: 'collapse', title: 'Лихорадка → коллапс', description: 'После периода жара температура резко падает. Слабость и холодный пот.', cue: 'Жар прошёл… Но мне вдруг очень холодно. Темнеет в глазах.', initial: { tempC: 39.2, sbp: 85, pulse: 118, complaint: 'weakDizzy', skin: 'coldSweat' } },
  { id: 'hypertension', title: 'Гипертонический криз', description: 'Тревожная новость, головная боль и нарушение зрения. Сравните АД с привычным.', cue: 'Голова раскалывается… Перед глазами мушки, в ушах шумит.', initial: { sbp: 200, pulse: 106, complaint: 'headacheVision', skin: 'flushed' } },
  { id: 'chest-pain', title: 'Боль в груди', description: 'Давление за грудиной. Нужны оценка, ЭКГ и наблюдение за ответом на помощь.', cue: 'Давит в груди, отдаёт в левую руку. Мне страшно…', initial: { sbp: 135, pulse: 102, complaint: 'chestPain', skin: 'pale' } },
  { id: 'syncope', title: 'Обморок или коллапс?', description: 'У умывальника пациентке стало плохо. Проследите за восстановлением сознания.', cue: 'В ушах звенит… Кажется, я сейчас упаду.', initial: { sbp: 88, pulse: 108, complaint: 'weakDizzy', skin: 'pale', position: 'sitting', consciousness: 'dim' } },
  { id: 'anaphylaxis', title: 'Реакция после инъекции', description: 'После введения лекарства появились зуд, сыпь и затруднение дыхания.', cue: 'Всё чешется… Тяжело дышать. Что со мной?', initial: { sbp: 82, pulse: 124, spo2: 86, complaint: 'itchBreath', skin: 'rash' } },
  { id: 'abdomen', title: 'Острая боль в животе', description: 'Причина боли неизвестна. Решите, какие вмешательства нужно исключить.', cue: 'Очень сильно болит живот. Может, приложить что-нибудь тёплое?', initial: { sbp: 110, pulse: 104, complaint: 'abdomenPain', skin: 'pale' } },
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
  { organization: 'RCUK · ABCDE', title: 'Первичная оценка и глюкоза', summary: 'Угрозы жизни устраняют по мере выявления; оценка ABC не откладывается ради вызова или вторичных действий.', url: 'https://www.resus.org.uk/library/abcde-approach' },
  { organization: 'BTS', title: 'Кислород при острых состояниях', summary: 'Общая целевая SpO₂ 94–98%; при риске гиперкапнии цель индивидуализируют. В кейсах такой риск не задан.', url: 'https://www.brit-thoracic.org.uk/document-library/guidelines/emergency-oxygen/bts-guideline-for-oxygen-use-in-adults-in-healthcare-and-emergency-settings/' },
  { organization: 'КР РФ · 2025 · 263_2', title: 'Анафилактический шок', summary: 'Сверены в/м эпинефрин, повтор не ранее 5 минут и сохранение венозного доступа. Российские объёмы инфузии индивидуальны; подробности сверки в docs/clinical-cases.md.', url: 'https://cr.minzdrav.gov.ru/view-cr/263_2' },
  { organization: 'RCEM · 2024', title: 'Обезболивание острой боли', summary: 'Адекватное обезболивание не откладывают из опасения скрыть диагноз. В кейсе запрещено самостоятельное введение без назначения, а не обезболивание вообще.', url: 'https://rcem.ac.uk/wp-content/uploads/2024/10/Management_of_Acute_Pain_in_Adults_2024_v1.pdf' },
  { organization: 'ACC/AHA · 2025', title: 'Острый коронарный синдром', summary: 'Ранняя ЭКГ, противопоказания к нитратам и отсутствие рутинного кислорода при SpO₂ ≥ 90%. Кривая монитора не заменяет диагностическую ЭКГ.', url: 'https://www.ahajournals.org/doi/10.1161/CIR.0000000000001309' },
  { organization: 'Материалы проекта · исходник пользователя', title: 'Пациентка: A-pose и локальный риг', summary: 'Модель предоставлена владельцем проекта; генератор в метаданных — Tripo3D. Риг и базовые клипы подготовлены локально, без стороннего mocap.', url: '' },
  { organization: 'Google · Binomial LLC · Apache 2.0', title: 'Draco и Basis Universal', summary: 'Локальные декодеры сжатой геометрии и KTX2-текстур. Новые сторонние персонажи и mocap пока не включены.', url: 'https://github.com/google/draco' },
  { organization: 'RCUK · 2025', title: 'Анафилаксия и особые обстоятельства', summary: 'Адреналин внутримышечно — первая линия; антигистаминный не заменяет его.', url: 'https://www.resus.org.uk/professional-library/2025-resuscitation-guidelines/special-circumstances-guidelines' },
  { organization: 'NICE · CG95', title: 'Боль в груди: оценка и диагностика', summary: 'Ответ на нитроглицерин не используется для постановки диагноза. Нужны обследование и ЭКГ.', url: 'https://www.nice.org.uk/guidance/cg95/chapter/recommendations' },
  { organization: 'RCUK · 2025', title: 'Базовая реанимация взрослых', summary: 'Ранний вызов, компрессии 100–120/мин, АНД; 30:2 при навыке искусственного дыхания.', url: 'https://www.resus.org.uk/professional-library/2025-resuscitation-guidelines/adult-basic-life-support-guidelines' },
  { organization: 'Учебный план', title: 'Методические материалы А и Б', summary: 'Библиографические данные не приложены. Сроки ухудшения в симуляции условны; лекарственные действия требуют проверки преподавателем.', url: '' },
  { organization: 'GRADD CO · CC BY 3.0', title: 'GRADD Hospital Room', summary: 'Модель палаты: GRADD CO, Poly Pizza, лицензия CC BY 3.0.', url: 'https://poly.pizza/m/9sUalfQ76kn' },
]

/** Only episode equipment is displayed; intentionally unsafe choices stay available as distractors. */
export function objectInCase(id: ObjectId, episode?: CaseId): boolean {
  if (!episode) return true
  const episodes: Partial<Record<ObjectId, CaseId[]>> = {
    glucometer: ['collapse', 'hypertension', 'syncope'], 'ecg-device': ['chest-pain', 'hypertension', 'syncope'], 'shock-kit': ['anaphylaxis'], 'iv-stand': ['anaphylaxis', 'collapse', 'chest-pain'],
    'ice-pack': ['abdomen'], analgesics: ['abdomen'], 'enema-kit': ['abdomen'], 'food-water': ['abdomen', 'syncope'],
    heater: ['abdomen', 'collapse'], sink: ['syncope'], injection: ['anaphylaxis'], linen: ['collapse'],
    blanket: ['collapse', 'syncope'], equipment: ['abdomen', 'collapse'],
  }
  return !episodes[id] || episodes[id]!.includes(episode)
}
export function actionInCase(id: ActionId, episode: CaseId): boolean {
  const episodes: Partial<Record<ActionId, CaseId[]>> = {
    glucose: ['collapse', 'hypertension', 'syncope'], neuro: ['hypertension'], differential: ['collapse'], 'pain-onset': ['chest-pain'], 'drug-history': ['chest-pain'], 'rapid-bp': ['hypertension'], 'position-on-site': ['syncope'], orthostatic: ['syncope'], 'observe-anaphylaxis': ['anaphylaxis'], crystalloids: ['anaphylaxis'], 'repeat-adrenaline': ['anaphylaxis'], 'abdomen-history': ['abdomen'],
    nitro: ['chest-pain'], aspirin: ['chest-pain'], captopril: ['hypertension'], adrenaline: ['anaphylaxis'],
    antihistamine: ['anaphylaxis'], antipyretic: ['collapse'], 'multiple-drugs': ['hypertension'],
    'pain-response': ['chest-pain'], 'withhold-nitro': ['chest-pain'], 'observe-recovery': ['syncope'],
    'check-injury': ['syncope'], transfer: ['syncope'], 'stop-bleeding': ['collapse'], 'avoid-intervention': ['abdomen'],
    'request-analgesia': ['abdomen'], 'self-analgesia': ['abdomen'],
  }
  return !episodes[id] || episodes[id]!.includes(episode)
}
