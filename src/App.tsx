import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, HeartPulse, PhoneCall, RotateCcw, X, Pause, Play, Info, ClipboardList, ArrowLeft, Check, Siren } from 'lucide-react'
import RoomScene, { type BlanketTransform, type PatientTransform } from './RoomScene'
import { actions, actionById, emergencyCases, getCase, objectLabels, sourceReferences, stageTitles, type ActionId, type CaseId, type ObjectId } from './scenario'
import { consciousnessLabels, currentStage, elapsed, nextObject, patientCue, positionLabels, requiredActions, routeLabels, skinLabels, stageScores, type Attempt } from './simulation'
import { useSimulationStore } from './store'
import './App.css'

const PATIENT_TRANSFORM_STORAGE_KEY = 'careflow-patient-transform-v3'
const LEGACY_PATIENT_TRANSFORM_STORAGE_KEY = 'careflow-patient-transform-v2'
const BLANKET_TRANSFORM_STORAGE_KEY = 'careflow-blanket-transform-v1'
const FIRST_PERSON_CAMERA_HEIGHT_STORAGE_KEY = 'careflow-first-person-camera-height-v2'
const LEGACY_DEFAULT_PATIENT_TRANSFORM: PatientTransform = { x: 0, y: 0, z: 0, scale: 1 }
const DEFAULT_PATIENT_TRANSFORM: PatientTransform = { x: 0, y: -0.28, z: -0.21, scale: 1.5 }
const DEFAULT_BLANKET_TRANSFORM: BlanketTransform = { x: 0, y: 0, z: 0, scale: 1 }
const DEFAULT_FIRST_PERSON_CAMERA_HEIGHT = 3.4
const MIN_FIRST_PERSON_CAMERA_HEIGHT = 1.6
const MAX_FIRST_PERSON_CAMERA_HEIGHT = 4.2

const patientControls: Array<{
  key: keyof PatientTransform
  label: string
  min: number
  max: number
  step: number
  unit: string
}> = [
  { key: 'x', label: 'X · влево / вправо', min: -1, max: 1, step: 0.01, unit: 'м' },
  { key: 'y', label: 'Y · вниз / вверх', min: -0.5, max: 0.8, step: 0.01, unit: 'м' },
  { key: 'z', label: 'Z · к изголовью / ногам', min: -1, max: 1, step: 0.01, unit: 'м' },
  { key: 'scale', label: 'Размер пациента', min: 0.5, max: 1.5, step: 0.01, unit: '×' },
]

const blanketControls: Array<{
  key: keyof BlanketTransform
  label: string
  min: number
  max: number
  step: number
  unit: string
}> = [
  { key: 'x', label: 'Одеяло · X · влево / вправо', min: -0.8, max: 0.8, step: 0.01, unit: 'м' },
  { key: 'y', label: 'Одеяло · Y · вниз / вверх', min: -0.4, max: 0.6, step: 0.01, unit: 'м' },
  { key: 'z', label: 'Одеяло · Z · к изголовью / ногам', min: -0.8, max: 0.8, step: 0.01, unit: 'м' },
  { key: 'scale', label: 'Размер одеяла', min: 0.5, max: 1.5, step: 0.01, unit: '×' },
]

function readPatientTransform(): PatientTransform {
  try {
    const storedInCurrentKey = localStorage.getItem(PATIENT_TRANSFORM_STORAGE_KEY)
    const stored: unknown = JSON.parse(
      storedInCurrentKey ?? localStorage.getItem(LEGACY_PATIENT_TRANSFORM_STORAGE_KEY) ?? 'null',
    )
    if (typeof stored !== 'object' || stored === null) return DEFAULT_PATIENT_TRANSFORM

    const values = stored as Record<string, unknown>
    const transform: PatientTransform = {
      x: typeof values.x === 'number' && Number.isFinite(values.x) ? Math.max(-1, Math.min(1, values.x)) : 0,
      y: typeof values.y === 'number' && Number.isFinite(values.y) ? Math.max(-0.5, Math.min(0.8, values.y)) : DEFAULT_PATIENT_TRANSFORM.y,
      z: typeof values.z === 'number' && Number.isFinite(values.z) ? Math.max(-1, Math.min(1, values.z)) : DEFAULT_PATIENT_TRANSFORM.z,
      scale: typeof values.scale === 'number' && Number.isFinite(values.scale)
        ? Math.max(0.5, Math.min(1.5, values.scale))
        : DEFAULT_PATIENT_TRANSFORM.scale,
    }

    if (
      !storedInCurrentKey
      && transform.x === LEGACY_DEFAULT_PATIENT_TRANSFORM.x
      && transform.y === LEGACY_DEFAULT_PATIENT_TRANSFORM.y
      && transform.z === LEGACY_DEFAULT_PATIENT_TRANSFORM.z
      && transform.scale === LEGACY_DEFAULT_PATIENT_TRANSFORM.scale
    ) {
      return DEFAULT_PATIENT_TRANSFORM
    }

    return transform
  } catch (error) {
    console.error('Не удалось загрузить настройки положения пациента:', error)
    return DEFAULT_PATIENT_TRANSFORM
  }
}

function readBlanketTransform(): BlanketTransform {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(BLANKET_TRANSFORM_STORAGE_KEY) ?? 'null')
    if (typeof stored !== 'object' || stored === null) return DEFAULT_BLANKET_TRANSFORM

    const values = stored as Record<string, unknown>
    return {
      x: typeof values.x === 'number' && Number.isFinite(values.x) ? Math.max(-0.8, Math.min(0.8, values.x)) : 0,
      y: typeof values.y === 'number' && Number.isFinite(values.y) ? Math.max(-0.4, Math.min(0.6, values.y)) : 0,
      z: typeof values.z === 'number' && Number.isFinite(values.z) ? Math.max(-0.8, Math.min(0.8, values.z)) : 0,
      scale: typeof values.scale === 'number' && Number.isFinite(values.scale)
        ? Math.max(0.5, Math.min(1.5, values.scale))
        : 1,
    }
  } catch (error) {
    console.error('Не удалось загрузить настройки одеяла:', error)
    return DEFAULT_BLANKET_TRANSFORM
  }
}

function readFirstPersonCameraHeight(): number {
  try {
    const stored = Number(localStorage.getItem(FIRST_PERSON_CAMERA_HEIGHT_STORAGE_KEY))
    if (!Number.isFinite(stored) || stored === 0) return DEFAULT_FIRST_PERSON_CAMERA_HEIGHT
    return Math.max(
      MIN_FIRST_PERSON_CAMERA_HEIGHT,
      Math.min(MAX_FIRST_PERSON_CAMERA_HEIGHT, stored),
    )
  } catch (error) {
    console.error('Не удалось загрузить высоту камеры:', error)
    return DEFAULT_FIRST_PERSON_CAMERA_HEIGHT
  }
}

const time = (seconds: number | null) => seconds === null ? '—' : `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
interface Summary { id: string; title: string; date: string; outcome: string; scores: number[]; doctorTime: number | null; firstTime: number | null; critical: number; errors: Attempt['errors']; events: Attempt['events']; mode: string }
const HISTORY_KEY = 'careflow-emergency-attempts-v1'
function readHistory(): Summary[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((s): s is Summary => Boolean(s && typeof s.id === 'string' && typeof s.title === 'string' && Array.isArray(s.scores) && s.scores.length === 5 && s.scores.every((v: unknown) => typeof v === 'number') && Array.isArray(s.errors) && Array.isArray(s.events))).slice(0, 20) : []
  } catch { return [] }
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
      if (e.key === 'Tab') {
        const items = ref.current?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]')
        if (!items?.length) return
        const first = items[0], last = items[items.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', handle, true)
    return () => { document.removeEventListener('keydown', handle, true); previous?.focus() }
  }, [onClose])
  return <div className="modal-backdrop" onClick={onClose}><section ref={ref} className="emergency-modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={e => e.stopPropagation()}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={20} /></button></div>{children}</section></div>
}
function App() {
  const { attempt, start, act, tick, pause, leave } = useSimulationStore()
  const [selectedCase, setSelectedCase] = useState<CaseId>('collapse')
  const [mode, setMode] = useState<'training' | 'exam'>('training')
  const [speed, setSpeed] = useState(1)
  const [nitroThreshold, setNitroThreshold] = useState('')
  const [selectedObject, setSelectedObject] = useState<ObjectId | null>(null)
  const [firstPerson, setFirstPerson] = useState(false)
  const [pointerLocked, setPointerLocked] = useState(false)
  const [focusedObject, setFocusedObject] = useState<ObjectId | null>(null)
  const handleFocusObject = useCallback((object: ObjectId | null) => setFocusedObject(object), [])
  const [navigationHint, setNavigationHint] = useState('')
  const [showSources, setShowSources] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<Summary[]>(readHistory)
  const [storageError, setStorageError] = useState('')
  const historyRef = useRef(history)
  const [patientTransform, setPatientTransform] = useState(readPatientTransform)
  const [blanketTransform, setBlanketTransform] = useState(readBlanketTransform)
  const [firstPersonCameraHeight, setFirstPersonCameraHeight] = useState(readFirstPersonCameraHeight)
  const [showPatientAdjuster, setShowPatientAdjuster] = useState(false)
  const [measurementProgress, setMeasurementProgress] = useState<number | null>(null)
  const [pulseTaps, setPulseTaps] = useState(0)
  const [measurementResult, setMeasurementResult] = useState('')
  const [heldItem, setHeldItem] = useState('')
  const lastArchived = useRef('')
  const measurementStarted = useRef(0)
  const closeSources = useCallback(() => setShowSources(false), [])
  const closeHistory = useCallback(() => setShowHistory(false), [])
  const handlePointerLockChange = useCallback((locked: boolean) => setPointerLocked(locked), [])
  const handlePointerLockError = useCallback(() => setNavigationHint('Захват мыши недоступен: осматривайтесь перетаскиванием с зажатой ЛКМ.'), [])
  const unlock = () => { if (document.pointerLockElement) document.exitPointerLock() }
  const selectObject = (object: ObjectId) => { unlock(); setSelectedObject(object); setMeasurementProgress(null); setPulseTaps(0); setMeasurementResult('') }
  const saveAttempt = useCallback((a: Attempt) => {
    const summary: Summary = { id: a.id, title: getCase(a.caseId).title, date: new Date().toISOString(), outcome: a.outcome || 'Попытка прервана пользователем', scores: stageScores(a), doctorTime: a.doctorCalledAt, firstTime: a.firstCorrectAt, critical: a.errors.filter(e => e.severity === 'critical').length, errors: a.errors, events: a.events.slice(-180), mode: a.mode }
    const next = [summary, ...historyRef.current.filter(item => item.id !== a.id)].slice(0, 20)
    historyRef.current = next
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); setStorageError('') }
    catch { setStorageError('Браузер не сохранил историю. Разбор доступен до закрытия вкладки.') }
    setHistory(next)
  }, [])
  useEffect(() => {
    if (!attempt) return
    if (['finished', 'failed'].includes(attempt.phase) && lastArchived.current !== attempt.id) { lastArchived.current = attempt.id; saveAttempt(attempt) }
  }, [attempt, saveAttempt])
  useEffect(() => {
    const archiveOnExit = () => {
      const current = useSimulationStore.getState().attempt
      if (current && ['active', 'arrest'].includes(current.phase)) saveAttempt(current)
    }
    window.addEventListener('pagehide', archiveOnExit)
    return () => window.removeEventListener('pagehide', archiveOnExit)
  }, [saveAttempt])
  useEffect(() => {
    let previous = performance.now()
    const interval = window.setInterval(() => {
      const now = performance.now()
      const state = useSimulationStore.getState().attempt
      if (state) tick((now - previous) / 1000 * state.speed)
      previous = now
    }, 250)
    return () => window.clearInterval(interval)
  }, [tick])
  useEffect(() => {
    if (measurementProgress === null || measurementProgress >= 100 || attempt?.paused) return
    const interval = window.setInterval(() => setMeasurementProgress(value => value === null ? null : Math.min(100, value + 5)), 150)
    return () => window.clearInterval(interval)
  }, [measurementProgress, attempt?.paused])
  useEffect(() => {
    if (measurementProgress !== 100 || pulseTaps < 3 || attempt?.paused) return
    const timer = window.setTimeout(() => {
      const current = useSimulationStore.getState().attempt
      if (current?.phase === 'active') act('measure')
      setMeasurementProgress(null); setPulseTaps(0)
      setMeasurementResult(current?.phase === 'active' ? 'Измерение завершено. Результат добавлен в наблюдения.' : 'Измерение прервано: требуется реанимационная помощь.')
    }, 0)
    return () => window.clearTimeout(timer)
  }, [measurementProgress, pulseTaps, attempt?.paused, act])
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const active = document.activeElement
      if (active instanceof HTMLElement && (active.isContentEditable || active.matches('input, textarea, select'))) return
      if (event.code === 'KeyH' && !event.repeat) { event.preventDefault(); act(useSimulationStore.getState().attempt?.phase === 'arrest' ? 'call-team' : 'call-doctor') }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [act])
  useEffect(() => {
    let matched = 0
    let timeout = 0
    const handle = (event: KeyboardEvent) => {
      if (event.repeat || (event.target instanceof HTMLElement && event.target.matches('input, textarea, select'))) return
      const sequence = ['KeyQ', 'KeyW', 'KeyE']
      matched = event.code === sequence[matched] ? matched + 1 : event.code === sequence[0] ? 1 : 0
      window.clearTimeout(timeout)
      if (matched === 3) { unlock(); setShowPatientAdjuster(open => !open); matched = 0 }
      else timeout = window.setTimeout(() => { matched = 0 }, 1500)
    }
    window.addEventListener('keydown', handle)
    return () => { window.removeEventListener('keydown', handle); window.clearTimeout(timeout) }
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(PATIENT_TRANSFORM_STORAGE_KEY, JSON.stringify(patientTransform))
      localStorage.setItem(BLANKET_TRANSFORM_STORAGE_KEY, JSON.stringify(blanketTransform))
      localStorage.setItem(FIRST_PERSON_CAMERA_HEIGHT_STORAGE_KEY, String(firstPersonCameraHeight))
    } catch { /* Calibration still works for the current tab. */ }
  }, [patientTransform, blanketTransform, firstPersonCameraHeight])
  useEffect(() => {
    if (!heldItem) return
    const timer = window.setTimeout(() => setHeldItem(''), 2000)
    return () => window.clearTimeout(timer)
  }, [heldItem])
  const begin = (id = selectedCase) => {
    if (attempt && !['finished', 'failed'].includes(attempt.phase)) saveAttempt(attempt)
    start(id, { mode, speed, nitroMinSbp: nitroThreshold ? Number(nitroThreshold) : null })
    setSelectedObject(null); setFirstPerson(false); setMeasurementProgress(null); setHeldItem(''); setMeasurementResult('')
  }
  const backToMenu = () => { if (attempt && !['finished', 'failed'].includes(attempt.phase)) saveAttempt(attempt); unlock(); setFirstPerson(false); leave(); setSelectedObject(null); setMeasurementProgress(null) }
  const doAction = (id: ActionId) => {
    if (id === 'measure' || id === 'repeat-measure') { measurementStarted.current = performance.now(); setMeasurementProgress(0); setPulseTaps(0); setMeasurementResult(''); return }
    const previous = useSimulationStore.getState().attempt
    act(id)
    if (actionById(id).target.object === 'bed-controls') setSelectedObject(null)
    const after = useSimulationStore.getState().attempt
    if (after && after.events.length > (previous?.events.length ?? 0) && after.events.at(-1)?.kind === 'action' && ['nitro', 'aspirin', 'adrenaline', 'captopril', 'oxygen', 'blanket', 'stop-infusion'].includes(id)) setHeldItem(actionById(id).title)
  }
  const updatePatientTransform = (key: keyof PatientTransform, value: number) => setPatientTransform(current => ({ ...current, [key]: value }))
  const updateBlanketTransform = (key: keyof BlanketTransform, value: number) => setBlanketTransform(current => ({ ...current, [key]: value }))
  const resetPatientTransform = () => { setPatientTransform(DEFAULT_PATIENT_TRANSFORM); setBlanketTransform(DEFAULT_BLANKET_TRANSFORM); setFirstPersonCameraHeight(DEFAULT_FIRST_PERSON_CAMERA_HEIGHT) }
  const active = Boolean(attempt && ['active', 'arrest'].includes(attempt.phase))
  const required = attempt ? requiredActions(attempt) : []
  const completed = attempt ? required.filter(id => attempt.completed.includes(id)).length : 0
  const hint = attempt?.mode === 'training' ? nextObject(attempt) : null
  const scores = attempt ? stageScores(attempt) : []
  const contextActions = actions.filter(action => action.target.object === selectedObject && (action.id !== 'repeat-measure' || attempt?.stableAt !== null) && (action.id !== 'measure' || attempt?.stableAt === null) && (
    attempt?.phase === 'arrest' ? ['cpr', 'call-bell'].includes(action.target.object) : action.target.object !== 'cpr'
  ))
  const showThreshold = selectedCase === 'chest-pain' || selectedCase === 'hypertension'
  return <main className={`app-shell emergency-app ${attempt?.phase === 'arrest' ? 'arrest-mode' : ''}`}>
    <section className="scene-wrap"><RoomScene
      covered={attempt?.completed.includes('blanket') ?? false} firstPerson={firstPerson && active}
      firstPersonCameraHeight={firstPersonCameraHeight} blanketTransform={blanketTransform} patientTransform={patientTransform}
      targetAction={hint} onAction={selectObject} onFocusObject={handleFocusObject} onPointerLockChange={handlePointerLockChange} onPointerLockError={handlePointerLockError}
      animationClock={{ speed: attempt?.speed ?? 1, paused: attempt?.paused ?? false, compressions: attempt?.compressions ?? 0, attemptId: attempt?.id ?? 'preview' }}
      patientState={attempt?.patient} doctorArrived={attempt?.doctorArrived || attempt?.teamArrived} windowOpen={attempt?.completed.includes('air')}
    /></section>
    <header className="emergency-header">
      <button className="brand glass-panel" onClick={backToMenu} aria-label="Выбор эпизода"><span className="brand-mark"><HeartPulse size={22}/></span><span className="brand-copy"><strong>care<span>flow</span></strong><small>EMERGENCY LAB</small></span></button>
      <div className="module-title glass-panel"><span className="eyebrow">ЭКСТРЕННЫЙ УХОД · ПАЛАТА 204</span><strong>{attempt ? getCase(attempt.caseId).title : 'Помощь начинается с решения'}</strong></div>
      <div className="header-actions">
        {active && <><button className="hud-button glass-panel" onClick={() => { unlock(); setSelectedObject(null); setFirstPerson(value => !value) }}>{firstPerson ? 'Обзор палаты' : 'От первого лица'}</button>{attempt?.mode === 'training' && <button className="hud-icon glass-panel" onClick={pause} aria-label={attempt.paused ? 'Продолжить' : 'Пауза'}>{attempt.paused ? <Play size={18}/> : <Pause size={18}/>}</button>}</>}
        <button className="hud-icon glass-panel" onClick={() => { unlock(); setShowHistory(true) }} aria-label="История попыток"><ClipboardList size={18}/></button>
        <button className="hud-icon glass-panel" onClick={() => { unlock(); setShowSources(true) }} aria-label="Источники и методика"><Info size={18}/></button>
      </div>
    </header>
    {!attempt && <section className="scenario-picker glass-panel">
      <div className="picker-intro"><span className="eyebrow">ПРАКТИКА ПРИНЯТИЯ РЕШЕНИЙ</span><h1>Увидеть. Позвать.<br/>Помочь вовремя.</h1><p>Одна палата, шесть экстренных эпизодов. Состояние меняется само — ваши действия определяют дальнейший ход.</p></div>
      <div className="case-grid">{emergencyCases.map((c, index) => <button key={c.id} className={`case-card ${selectedCase === c.id ? 'selected' : ''}`} onClick={() => setSelectedCase(c.id)} aria-pressed={selectedCase === c.id}><span className="case-number">0{index + 1}</span><strong>{c.title}</strong><span>{c.description}</span></button>)}</div>
      <div className="setup-row"><label>Режим<select value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="training">Обучение · подсказки и пауза</option><option value="exam">Экзамен · без подсветки и паузы</option></select></label><label>Игровое время<select value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={1}>1× · реальное время</option><option value={2}>2× · ускоренно</option><option value={4}>4× · ускоренно</option></select></label>{showThreshold && <label>Порог САД для нитро<input type="number" min="80" max="180" placeholder="Задаёт преподаватель" value={nitroThreshold} onChange={e => setNitroThreshold(e.target.value)} /><small>Без порога препарат недоступен</small></label>}</div>
      <div className="picker-bottom"><p>Ухудшение и время прибытия — условные игровые величины. Лекарственные действия моделируются без доз. Клавиша H — вызов врача.</p><button className="primary-button" onClick={() => begin()} disabled={Boolean(nitroThreshold && (!Number.isFinite(Number(nitroThreshold)) || Number(nitroThreshold) < 80 || Number(nitroThreshold) > 180))}>Начать эпизод <ArrowLeft size={18} style={{ transform: 'rotate(180deg)' }}/></button></div>
      {history.length > 0 && <button className="text-button" onClick={() => setShowHistory(true)}>Продолжить практику · сохранено попыток: {history.length}</button>}
    </section>}
    {attempt && <>
      <div className="episode-bar glass-panel"><span className={`status-dot ${attempt.phase === 'arrest' ? 'red' : ''}`}/><strong>{time(elapsed(attempt))}</strong><span>{attempt.mode === 'training' ? 'Обучение' : 'Экзамен'} · {attempt.speed}×</span><span>{attempt.phase === 'arrest' ? 'Нет нормального дыхания' : attempt.stableAt !== null ? 'Состояние стабилизируется' : 'Эпизод развивается'}</span></div>
      <button className="call-doctor" disabled={!active || attempt.paused} onClick={() => act(attempt.phase === 'arrest' ? 'call-team' : 'call-doctor')}><PhoneCall size={20}/><span>{attempt.phase === 'arrest' ? (attempt.teamCalledAt !== null ? 'Бригада вызвана' : 'Реанимационная бригада') : attempt.doctorCalledAt !== null ? (attempt.doctorArrived ? 'Врач в палате' : 'Врач вызван') : 'Срочно вызвать врача'}<small>{attempt.phase === 'arrest' ? 'Вызов экстренной помощи' : attempt.doctorCalledAt !== null ? `Вызов в ${time(attempt.doctorCalledAt)}` : 'H · доступно всегда'}</small></span></button>
      {active && <>
        <aside className="plan-panel glass-panel"><div className="panel-heading"><span className="eyebrow">ПЯТЬ ЭТАПОВ ПОМОЩИ</span><button className="icon-button" onClick={backToMenu} aria-label="Прервать и выбрать эпизод"><ArrowLeft size={17}/></button></div><ol className="stage-list">{stageTitles.map((title, index) => <li key={title} className={currentStage(attempt) === index + 1 ? 'current' : ''}><span>{index + 1}</span><div><strong>{title}</strong><small>{required.filter(id => actionById(id).stage === index + 1 && attempt.completed.includes(id)).length} / {required.filter(id => actionById(id).stage === index + 1).length}</small></div></li>)}</ol>
          <div className="plan-progress"><span style={{ width: `${required.length ? completed / required.length * 100 : 0}%` }}/></div>
          {attempt.mode === 'training' && <div className="next-action"><span className="eyebrow">СЛЕДУЮЩИЙ ОРИЕНТИР</span><p>{actionById(required.find(id => !attempt.completed.includes(id)) ?? 'handoff').title}</p><small>Порядок действий свободный. Вызов помощи — приоритет.</small></div>}
          <p className="feedback" role="status">{attempt.feedback}</p>
          <button className="text-button" onClick={() => begin(attempt.caseId)}><RotateCcw size={14}/> Начать заново</button>
        </aside>
        <aside className="patient-panel glass-panel"><div className="panel-heading"><div><span className="eyebrow">ПАЦИЕНТКА · 68 ЛЕТ</span><h2>Мария Андреевна</h2></div><Activity size={20}/></div><p className="patient-speech" aria-live="polite">«{patientCue(attempt)}»</p>
          <div className="patient-observations"><span>Сознание <strong>{consciousnessLabels[attempt.patient.consciousness]}</strong></span><span>Кожа <strong>{skinLabels[attempt.patient.skin]}</strong></span><span>Положение <strong>{positionLabels[attempt.patient.position]}</strong></span>{attempt.caseId === 'anaphylaxis' && <span>Исходная инъекция <strong>{routeLabels[attempt.patient.injectionRoute]}</strong></span>}{attempt.caseId === 'collapse' && <span>Контекст <strong>{({ fever: 'критическое падение T', bleeding: 'наружное кровотечение', medication: 'после гипотензивного', trauma: 'травма' } as Record<string, string>)[attempt.variant] ?? 'после смены положения'}</strong></span>}</div>
          <div className="observed-vitals"><span className="eyebrow">{attempt.measurement ? `ПОСЛЕДНЕЕ ИЗМЕРЕНИЕ · ${time(attempt.measurement.at)}` : 'ПОКАЗАТЕЛИ ЕЩЁ НЕ ИЗМЕРЕНЫ'}</span><div><strong>{attempt.measurement?.sbp ?? '—'}<small>САД · мм рт. ст.</small></strong><strong>{attempt.measurement?.pulse ?? '—'}<small>Пульс · /мин</small></strong><strong>{attempt.measurement?.tempC.toFixed(1) ?? '—'}<small>T · °C</small></strong></div></div>
          <details className="event-history"><summary>События и диалог · {attempt.events.length}</summary><ol>{attempt.events.slice(-15).map((event, i) => <li key={`${event.at}-${i}`} className={event.kind}><time>{time(event.at)}</time>{event.text}</li>)}</ol></details>
        </aside>
        {selectedObject && <section className="action-panel glass-panel" aria-label={`Действия: ${objectLabels[selectedObject]}`}><div className="panel-heading"><div><span className="eyebrow">ВЗАИМОДЕЙСТВИЕ</span><h2>{objectLabels[selectedObject]}</h2></div><button className="icon-button" aria-label="Закрыть действия" onClick={() => { setSelectedObject(null); setMeasurementProgress(null) }}><X size={18}/></button></div>
          {selectedObject === 'chart' && <div className="chart-data"><p>Температурный лист · учебные данные</p>{attempt.baselineRead ? <p>До эпизода: САД {attempt.patient.habitualSbp} мм рт. ст.; пульс 80/мин; T 37,0 °C.</p> : <p>Откройте исходную запись, чтобы сравнить показатели.</p>}{attempt.measurement && <p>Измерено в {time(attempt.measurement.at)}: САД {attempt.measurement.sbp}; пульс {attempt.measurement.pulse}; T {attempt.measurement.tempC} °C.</p>}{attempt.repeatMeasurement && <p>Повторно в {time(attempt.repeatMeasurement.at)}: САД {attempt.repeatMeasurement.sbp}; пульс {attempt.repeatMeasurement.pulse}.</p>}{attempt.completed.includes('record') && <p><Check size={14}/> Наблюдения и журнал действий внесены в лист.</p>}</div>}
          {selectedObject === 'medications' && <p className="context-note">Учебные назначения без доз: препараты выбираются после сверки показаний, аллергий и противопоказаний. Нитроглицерин: {attempt.nitroMinSbp === null ? 'порог САД не задан — воздержаться и обратиться к врачу' : `порог преподавателя ${attempt.nitroMinSbp} мм рт. ст.; не более 3 доз; повтор не ранее 5 минут`}. При анафилаксии адреналин не ждёт прибытия врача.</p>}
          {selectedObject === 'injection' && <p className="context-note">Путь исходного препарата: {routeLabels[attempt.patient.injectionRoute]}. При внутривенном введении прекратите инфузию и сохраните доступ. Для других путей прекратите дальнейшее введение.</p>}
          {selectedObject === 'cpr' && <p className="context-note">Ритм 100–120/мин. После 30 компрессий — 2 вдоха при соответствующем навыке. Клики не проверяют глубину и технику; необходима практика на манекене. Скорость игровых часов не меняет ритм кликов.</p>}
          {measurementProgress !== null ? <div className="measurement-game"><p>Манжета установлена · измерение {measurementProgress}%</p><progress max={100} value={measurementProgress}/><button className="primary-button" disabled={attempt.paused} onClick={() => { if (performance.now() - measurementStarted.current >= pulseTaps * 400) setPulseTaps(v => v + 1) }}>Отметить пульсовую волну · {Math.min(pulseTaps, 3)}/3</button><small>Отметьте три волны с интервалом хотя бы 0,4 с и дождитесь окончания измерения.</small></div> : <div className="context-actions">{contextActions.map(action => <button key={action.id} disabled={attempt.paused || (action.id === 'compression' && attempt.cycleCompressions >= 30)} className={`${attempt.completed.includes(action.id) ? 'done' : ''} ${hint === selectedObject && attempt.mode === 'training' && required.find(id => !attempt.completed.includes(id)) === action.id ? 'suggested' : ''}`} onClick={() => doAction(action.id)}>{attempt.completed.includes(action.id) ? <Check size={15}/> : <span className="action-bullet"/>}{action.title}</button>)}</div>}
          {measurementResult && <p role="status">{measurementResult}</p>}
          {selectedObject === 'cpr' && <div className="cpr-stats"><span>Цикл: {attempt.cycleCompressions}/30</span><span>В ритме: {attempt.goodCompressions}</span><span>Циклов с вдохами: {attempt.ventilations}</span></div>}
        </section>}
        {firstPerson && <><div className="crosshair" aria-hidden="true">+</div><span className="crosshair-label">{focusedObject ? `${objectLabels[focusedObject]} · E` : 'Наведите прицел на предмет'}</span></>}
        <div className="navigation-help glass-panel">{navigationHint || (firstPerson ? pointerLocked ? 'WASD / стрелки · Shift — скорость ×2 · E — взаимодействие · Esc — курсор' : 'Клик по палате — захват мыши · Shift — скорость ×2 · E — взаимодействие' : 'Выберите предмет в палате или на панели объектов')}</div>
        <nav className="object-dock glass-panel" aria-label="Объекты палаты">{(Object.keys(objectLabels) as ObjectId[]).filter(id => attempt.phase === 'arrest' ? ['cpr', 'call-bell'].includes(id) : id !== 'cpr').map(id => <button key={id} className={`${selectedObject === id ? 'selected' : ''} ${hint === id ? 'hinted' : ''}`} onClick={() => selectObject(id)}>{id === 'call-bell' ? <PhoneCall size={14}/> : id === 'cpr' ? <Siren size={14}/> : null}{objectLabels[id]}</button>)}</nav>
        {heldItem && <div className="held-item"><span/><strong>{heldItem}</strong></div>}
        {attempt.paused && <div className="pause-overlay"><Pause size={32}/><h2>Учебная пауза</h2><p>Игровые часы и действия приостановлены.</p><button className="primary-button" onClick={pause}>Продолжить</button></div>}
      </>}
      {!active && <section className="results-panel glass-panel"><span className="eyebrow">РАЗБОР ПОПЫТКИ</span><h1>{attempt.phase === 'finished' ? 'Помощь передана' : 'Эпизод завершён'}</h1><p>{attempt.outcome}</p><div className="result-metrics"><div><strong>{time(attempt.doctorCalledAt)}</strong><span>до вызова врача</span></div><div><strong>{time(attempt.firstCorrectAt)}</strong><span>до первого верного действия</span></div><div><strong>{attempt.errors.filter(e => e.severity === 'critical').length}</strong><span>критических ошибок</span></div></div><div className="stage-scores">{scores.map((score, i) => <div key={i}><span>{i + 1}. {stageTitles[i]}</span><progress max={100} value={score}/><strong>{score}%</strong></div>)}</div><h3>Ошибки и решения</h3>{attempt.errors.length ? <ul className="error-list">{attempt.errors.map((error, i) => <li key={i} className={error.severity}><span>{time(error.at)} · {({ critical: 'Критическая', major: 'Существенная', minor: 'Незначительная' })[error.severity]}</span>{error.why}</li>)}</ul> : <p>Ошибок в выполненных действиях не зарегистрировано.</p>}<div className="result-buttons"><button className="primary-button" onClick={() => begin(attempt.caseId)}>Повторить эпизод</button><button className="secondary-button" onClick={backToMenu}>Выбрать другой</button></div></section>}
    </>}
    {storageError && <p className="storage-error" role="status">{storageError}</p>}
    {showSources && <Modal title="Источники и методика" onClose={closeSources}><p>Учебный прототип экстренного ухода. Таймеры ухудшения 60 / 120 / 180 секунд и прибытие помощи — игровые настройки, а не прогноз состояния пациента. Порог АД для нитроглицерина задаёт преподаватель.</p><div className="source-list">{sourceReferences.map(source => <article className="source-card" key={source.title}><span className="eyebrow">{source.organization}</span><strong>{source.title}</strong><p>{source.summary}</p>{source.url && <a href={source.url} target="_blank" rel="noreferrer">Открыть источник ↗</a>}</article>)}</div><p>Медицинское содержание и локальные назначения должны пройти проверку преподавателем перед использованием в оценке студентов. Не вводите реальные данные пациентов.</p></Modal>}
    {showHistory && <Modal title="История практики" onClose={closeHistory}>{history.length === 0 ? <p>Здесь появятся завершённые и прерванные попытки. Хранение — в этом браузере.</p> : history.map(item => <details className="history-item" key={item.id}><summary><strong>{item.title}</strong><span>{new Date(item.date).toLocaleString('ru-RU')} · {item.mode === 'exam' ? 'Экзамен' : 'Обучение'}</span><span>Вызов {time(item.doctorTime)} · критических ошибок {item.critical}</span></summary><p>{item.outcome}</p><p>Оценки этапов: {item.scores.join(' / ')}. Первое верное действие: {time(item.firstTime)}.</p>{item.errors.map((e, i) => <p key={i}>{time(e.at)} · {e.why}</p>)}<details><summary>Журнал событий</summary>{item.events.map((e, i) => <p key={i}>{time(e.at)} · {e.text}</p>)}</details><button className="secondary-button" onClick={() => { const c = emergencyCases.find(c => c.title === item.title); if (c) { setSelectedCase(c.id); begin(c.id); setShowHistory(false) } }}>Повторить тему</button></details>)}</Modal>}
      {showPatientAdjuster && (
        <aside className="patient-adjuster glass-panel" role="dialog" aria-label="Настройка объектов сцены">
          <div className="modal-heading">
            <div>
              <span className="eyebrow">СЦЕНА · НАСТРОЙКА</span>
              <h2>Настройка 3D-сцены</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Закрыть настройку пациента"
              onClick={() => setShowPatientAdjuster(false)}
            >
              <X size={18} />
            </button>
          </div>
          <p className="patient-adjuster-help">
            Настройте положение и размер пациента и одеяла относительно кушетки, а также высоту камеры. Изменения сохраняются в этом браузере.
          </p>
          <div className="patient-adjuster-controls">
            {patientControls.map((control) => (
              <label className="patient-adjuster-control" key={control.key}>
                <span>
                  <strong>{control.label}</strong>
                  <output>{patientTransform[control.key].toFixed(2)} {control.unit}</output>
                </span>
                <input
                  type="range"
                  aria-label={control.label}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={patientTransform[control.key]}
                  onChange={(event) => updatePatientTransform(control.key, Number(event.target.value))}
                />
              </label>
            ))}
            {blanketControls.map((control) => (
              <label className="patient-adjuster-control" key={control.key}>
                <span>
                  <strong>{control.label}</strong>
                  <output>{blanketTransform[control.key].toFixed(2)} {control.unit}</output>
                </span>
                <input
                  type="range"
                  aria-label={control.label}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={blanketTransform[control.key]}
                  onChange={(event) => updateBlanketTransform(control.key, Number(event.target.value))}
                />
              </label>
            ))}
            <label className="patient-adjuster-control">
              <span>
                <strong>Высота камеры · от первого лица</strong>
                <output>{firstPersonCameraHeight.toFixed(2)} м</output>
              </span>
              <input
                type="range"
                aria-label="Высота камеры от первого лица"
                min={MIN_FIRST_PERSON_CAMERA_HEIGHT}
                max={MAX_FIRST_PERSON_CAMERA_HEIGHT}
                step={0.01}
                value={firstPersonCameraHeight}
                onChange={(event) => setFirstPersonCameraHeight(Number(event.target.value))}
              />
            </label>
          </div>
          <button className="patient-adjuster-reset" type="button" onClick={resetPatientTransform}>
            <RotateCcw size={15} /> Сбросить настройки сцены
          </button>
        </aside>
      )}


  </main>
}

export default App
