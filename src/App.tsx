import { actionMenu, actionMenuComplete, shouldCloseActionMenu } from './actionMenu'
import PulseTrace from './PulseTrace'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Activity, X, ArrowLeft, Check } from 'lucide-react'
import RoomScene, { type BlanketTransform, type PatientTransform } from './RoomScene'
import { actionById, emergencyCases, getCase, objectLabels, stageTitles, type ActionId, type CaseId, type ObjectId } from './scenario'
import { consciousnessLabels, elapsed, nextObject, patientCue, positionLabels, requiredActions, routeLabels, skinLabels, stageScores, type Attempt } from './simulation'
import { useSimulationStore } from './store'
import { placeActionPopover, type ScreenPoint } from './actionPopover'
import SceneEditor from './SceneEditor'
import DoctorDialog from './DoctorDialog'
import { useSceneEditor } from './sceneEditorStore'
import './App.css'

const PATIENT_TRANSFORM_STORAGE_KEY = 'careflow-patient-transform-v3'
const LEGACY_PATIENT_TRANSFORM_STORAGE_KEY = 'careflow-patient-transform-v2'
const BLANKET_TRANSFORM_STORAGE_KEY = 'careflow-blanket-transform-v1'
const LEGACY_DEFAULT_PATIENT_TRANSFORM: PatientTransform = { x: 0, y: 0, z: 0, scale: 1 }
const DEFAULT_PATIENT_TRANSFORM: PatientTransform = { x: 0, y: -0.28, z: -0.21, scale: 1.5 }
const DEFAULT_BLANKET_TRANSFORM: BlanketTransform = { x: 0, y: 0, z: 0, scale: 1 }
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

const time = (seconds: number | null) => seconds === null ? '—' : `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
interface Summary { id: string; title: string; date: string; outcome: string; scores: number[]; doctorTime: number | null; firstTime: number | null; critical: number; errors: Attempt['errors']; events: Attempt['events']; mode: string }
const HISTORY_KEY = 'careflow-emergency-attempts-v1'
function readHistory(): Summary[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((s): s is Summary => Boolean(s && typeof s.id === 'string' && typeof s.title === 'string' && Array.isArray(s.scores) && s.scores.length === 5 && s.scores.every((v: unknown) => typeof v === 'number') && Array.isArray(s.errors) && Array.isArray(s.events))).slice(0, 20) : []
  } catch { return [] }
}
function App() {
  const { attempt, start, act, tick, leave } = useSimulationStore()
  const [selectedCase, setSelectedCase] = useState<CaseId>('collapse')
  const [mode, setMode] = useState<'training' | 'exam'>('training')
  const [nitroThreshold, setNitroThreshold] = useState('')
  const [selectedObject, setSelectedObject] = useState<ObjectId | null>(null)
  const [actionPoint, setActionPoint] = useState<[number, number, number] | null>(null)
  const actionPanelRef = useRef<HTMLElement>(null)
  const panelSize = useRef({ width: 0, height: 0 })
  const lastAnchorPoint = useRef<ScreenPoint | null>(null)
  const actionAnchor = useMemo(() => selectedObject ? { object: selectedObject, point: actionPoint } : undefined, [selectedObject, actionPoint])
  const positionActionPanel = useCallback((point: ScreenPoint) => {
    lastAnchorPoint.current = point
    const panel = actionPanelRef.current
    if (!panel) return
    const size = panelSize.current.width ? panelSize.current : { width: panel.offsetWidth, height: panel.offsetHeight }
    const position = placeActionPopover(point, size, { width: window.innerWidth, height: window.innerHeight })
    const x = `${Math.round(position.x)}px`, y = `${Math.round(position.y)}px`
    if (panel.style.left !== x) panel.style.left = x
    if (panel.style.top !== y) panel.style.top = y
    if (panel.style.visibility !== 'visible') panel.style.visibility = 'visible'
  }, [])
  useLayoutEffect(() => {
    const panel = actionPanelRef.current
    if (!panel) return
    const measure = () => {
      panelSize.current = { width: panel.offsetWidth, height: panel.offsetHeight }
      if (lastAnchorPoint.current) positionActionPanel(lastAnchorPoint.current)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [selectedObject, positionActionPanel])
  const [acknowledgedHint, setAcknowledgedHint] = useState<string | null>(null)
  const [firstPerson, setFirstPerson] = useState(false)
  const [pointerLocked, setPointerLocked] = useState(false)
  const [focusedObject, setFocusedObject] = useState<ObjectId | null>(null)
  const handleFocusObject = useCallback((object: ObjectId | null) => setFocusedObject(object), [])
  const [navigationHint, setNavigationHint] = useState('')
  const [storageError, setStorageError] = useState('')
  const historyRef = useRef<Summary[] | null>(null)
  historyRef.current ??= readHistory()
  const [patientTransform] = useState(readPatientTransform)
  const [blanketTransform] = useState(readBlanketTransform)
  const editorOpen = useSceneEditor(s => s.open)
  const firstPersonCameraHeight = useSceneEditor(s => s.settings.camera.eyeHeight)
  const [heldItem, setHeldItem] = useState('')
  const closeActions = useCallback(() => setSelectedObject(null), [])
  const lastArchived = useRef('')
  const previousMenu = useRef<{ object: ObjectId | null; attempt: string | undefined; pending: boolean }>({ object: null, attempt: undefined, pending: false })
  useEffect(() => {
    const previous = previousMenu.current
    const pending = !!attempt && !!selectedObject && !actionMenuComplete(attempt, selectedObject)
    previousMenu.current = { object: selectedObject, attempt: attempt?.id, pending }
    if (attempt && selectedObject && previous.object === selectedObject && previous.attempt === attempt.id && previous.pending && !pending) setSelectedObject(null)
  }, [attempt, selectedObject])
  const handlePointerLockChange = useCallback((locked: boolean) => setPointerLocked(locked), [])
  const handlePointerLockError = useCallback(() => setNavigationHint('Захват мыши недоступен: осматривайтесь перетаскиванием с зажатой ЛКМ.'), [])
  const unlock = () => { if (document.pointerLockElement) document.exitPointerLock() }
  const selectObject = (object: ObjectId, point?: [number, number, number], screen?: ScreenPoint) => {
    const current = useSimulationStore.getState().attempt
    if (useSceneEditor.getState().open) { useSceneEditor.getState().select(object === 'cpr' ? 'patient' : object); return }
    if (!current || !['active', 'arrest'].includes(current.phase)) return
    unlock()
    if (object === hint) setAcknowledgedHint(hintKey)
    lastAnchorPoint.current = screen ?? null
    if (screen) positionActionPanel(screen)
    setActionPoint(point ?? null)
    setSelectedObject(object)
  }
  const saveAttempt = useCallback((a: Attempt) => {
    const summary: Summary = { id: a.id, title: getCase(a.caseId).title, date: new Date().toISOString(), outcome: a.outcome || 'Попытка прервана пользователем', scores: stageScores(a), doctorTime: a.doctorCalledAt, firstTime: a.firstCorrectAt, critical: a.errors.filter(e => e.severity === 'critical').length, errors: a.errors, events: a.events.slice(-180), mode: a.mode }
    const next = [summary, ...(historyRef.current ?? []).filter(item => item.id !== a.id)].slice(0, 20)
    historyRef.current = next
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); setStorageError('') }
    catch { setStorageError('Браузер не сохранил историю. Разбор доступен до закрытия вкладки.') }
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
      if (state && !useSceneEditor.getState().open) tick((now - previous) / 1000 * state.speed)
      previous = now
    }, 250)
    return () => window.clearInterval(interval)
  }, [tick])
  useEffect(() => {
    let matched = 0, timeout = 0
    const pressed = new Set<string>()
    const handle = (event: KeyboardEvent) => {
      if (event.code === 'Escape' && useSceneEditor.getState().open) {
        event.preventDefault(); event.stopImmediatePropagation(); useSceneEditor.getState().toggle(); return
      }
      if (event.repeat || (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.matches('input, textarea, select')))) return
      pressed.add(event.code)
      const sequence = ['KeyQ', 'KeyW', 'KeyE']
      matched = event.code === sequence[matched] ? matched + 1 : event.code === sequence[0] ? 1 : 0
      window.clearTimeout(timeout)
      if (matched === 3 || sequence.every(key => pressed.has(key))) {
        event.preventDefault(); event.stopImmediatePropagation(); unlock(); setFirstPerson(false); setSelectedObject(null)
        useSceneEditor.getState().toggle(); matched = 0; pressed.clear()
      } else timeout = window.setTimeout(() => { matched = 0 }, 3000)
    }
    const release = (event: KeyboardEvent) => pressed.delete(event.code)
    const blur = () => { pressed.clear(); matched = 0 }
    window.addEventListener('keydown', handle, true); window.addEventListener('keyup', release); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', handle, true); window.removeEventListener('keyup', release); window.removeEventListener('blur', blur); window.clearTimeout(timeout) }
  }, [])
  useEffect(() => {
    if (!heldItem) return
    const timer = window.setTimeout(() => setHeldItem(''), 2000)
    return () => window.clearTimeout(timer)
  }, [heldItem])
  const begin = (id = selectedCase) => {
    if (attempt && !['finished', 'failed'].includes(attempt.phase)) saveAttempt(attempt)
    start(id, { mode, speed: 1, nitroMinSbp: nitroThreshold ? Number(nitroThreshold) : null })
    setSelectedObject(null); setAcknowledgedHint(null); setFirstPerson(false); setHeldItem('')
  }
  const backToMenu = () => { if (attempt && !['finished', 'failed'].includes(attempt.phase)) saveAttempt(attempt); unlock(); setFirstPerson(false); leave(); setSelectedObject(null) }
  const doAction = (id: ActionId) => {
    const previous = useSimulationStore.getState().attempt
    act(id)
    if (actionById(id).target.object === 'bed-controls') setSelectedObject(null)
    const after = useSimulationStore.getState().attempt
    if (after && previous && shouldCloseActionMenu(previous, after, selectedObject)) {
      setSelectedObject(null)
      setAcknowledgedHint(null)
    }
    if (after && after.events.length > (previous?.events.length ?? 0) && after.events.at(-1)?.kind === 'action' && ['nitro', 'aspirin', 'adrenaline', 'captopril', 'oxygen', 'blanket', 'stop-infusion'].includes(id)) setHeldItem(actionById(id).title)
  }
  const active = Boolean(attempt && ['active', 'arrest'].includes(attempt.phase))
  const required = attempt ? requiredActions(attempt) : []
  const hint = active && attempt?.mode === 'training' ? nextObject(attempt) : null
  const hintKey = `${attempt?.id}:${required.find(id => !attempt?.completed.includes(id)) ?? ''}`
  const scores = attempt ? stageScores(attempt) : []
  const contextActions = actionMenu(attempt, selectedObject)
  const showThreshold = selectedCase === 'chest-pain' || selectedCase === 'hypertension'
  return <main className={`app-shell emergency-app ${attempt?.phase === 'arrest' ? 'arrest-mode' : ''}`}>
    <section className="scene-wrap"><RoomScene
      covered={attempt?.completed.includes('blanket') ?? false} firstPerson={firstPerson && active && !editorOpen}
      firstPersonCameraHeight={firstPersonCameraHeight} blanketTransform={blanketTransform} patientTransform={patientTransform}
      actionAnchor={actionAnchor} onActionPosition={positionActionPanel}
      targetAction={!editorOpen && !selectedObject && hintKey !== acknowledgedHint ? hint : null} onAction={selectObject} onFocusObject={handleFocusObject} onPointerLockChange={handlePointerLockChange} onPointerLockError={handlePointerLockError}
      animationClock={{ speed: attempt?.speed ?? 1, paused: editorOpen || (attempt?.paused ?? false), compressions: attempt?.compressions ?? 0, attemptId: attempt?.id ?? 'preview' }}
      patientState={attempt?.patient}
    /></section>
    {attempt && !editorOpen && <header className="emergency-header">
      <button className="hud-button glass-panel menu-button" onClick={backToMenu}><ArrowLeft size={17}/> Выйти в меню</button>
      {active && <time className="episode-time glass-panel" aria-label="Время эпизода">{time(elapsed(attempt))}</time>}
      {active && <div className="header-actions"><button className="hud-button glass-panel" onClick={() => { unlock(); setSelectedObject(null); setFirstPerson(value => !value) }}>{firstPerson ? 'Обзор палаты' : 'От первого лица'}</button></div>}
    </header>}
    {!attempt && !editorOpen && <section className="scenario-picker glass-panel">
      <div className="case-grid">{emergencyCases.map((c, index) => <button key={c.id} className={`case-card ${selectedCase === c.id ? 'selected' : ''}`} onClick={() => setSelectedCase(c.id)} aria-pressed={selectedCase === c.id}><span className="case-number">0{index + 1}</span><strong>{c.title}</strong><span>{c.description}</span></button>)}</div>
      <div className="setup-row"><div className="mode-picker" role="group" aria-label="Режим">{([{ id: 'training', title: 'Обучение', description: 'С подсказками' }, { id: 'exam', title: 'Экзамен', description: 'Без подсказок' }] as const).map(option => <button key={option.id} className={mode === option.id ? 'selected' : ''} aria-pressed={mode === option.id} onClick={() => setMode(option.id)}><strong>{option.title}</strong><span>{option.description}</span>{mode === option.id && <Check size={17}/>}</button>)}</div>{showThreshold && <label>Порог САД для нитро<input type="number" min="80" max="180" placeholder="Задаёт преподаватель" value={nitroThreshold} onChange={e => setNitroThreshold(e.target.value)} /><small>Без порога препарат недоступен</small></label>}</div>
      <div className="picker-bottom"><button className="primary-button start-episode" onClick={() => begin()} disabled={Boolean(nitroThreshold && (!Number.isFinite(Number(nitroThreshold)) || Number(nitroThreshold) < 80 || Number(nitroThreshold) > 180))}><span>Начать эпизод</span> <ArrowLeft size={18} style={{ transform: 'rotate(180deg)' }}/></button></div>
    </section>}
    {attempt && !editorOpen && <>
      {active && <>
        <aside className="patient-panel glass-panel"><div className="panel-heading"><div><span className="eyebrow">ПАЦИЕНТКА · 68 ЛЕТ</span><h2>Мария Андреевна</h2></div><Activity size={20}/></div><p className="patient-speech" aria-live="polite">«{patientCue(attempt)}»</p>
          <div className="patient-observations"><span>Сознание <strong>{consciousnessLabels[attempt.patient.consciousness]}</strong></span><span>Кожа <strong>{skinLabels[attempt.patient.skin]}</strong></span><span>Положение <strong>{positionLabels[attempt.patient.position]}</strong></span>{attempt.caseId === 'anaphylaxis' && <span>Исходная инъекция <strong>{routeLabels[attempt.patient.injectionRoute]}</strong></span>}{attempt.caseId === 'collapse' && <span>Контекст <strong>{({ fever: 'критическое падение T', bleeding: 'наружное кровотечение', medication: 'после гипотензивного', trauma: 'травма' } as Record<string, string>)[attempt.variant] ?? 'после смены положения'}</strong></span>}</div>
          <div className="observed-vitals"><span className="eyebrow">{attempt.measurement ? `ПОСЛЕДНЕЕ ИЗМЕРЕНИЕ · ${time(attempt.measurement.at)}` : attempt.temperatureMeasurement || attempt.completed.includes('saturation') || attempt.completed.includes('connect-monitor') ? 'ИЗМЕРЕННЫЕ ПОКАЗАТЕЛИ' : 'ПОКАЗАТЕЛИ ЕЩЁ НЕ ИЗМЕРЕНЫ'}</span><div><strong>{attempt.measurement?.sbp ?? '—'}<small>САД · мм рт. ст.</small></strong><strong>{attempt.completed.includes('saturation') || attempt.completed.includes('connect-monitor') ? attempt.patient.pulse : attempt.measurement?.pulse ?? '—'}<small>Пульс · /мин</small></strong><strong>{attempt.temperatureMeasurement?.value.toFixed(1) ?? '—'}<small>T · °C</small></strong></div></div>
          {attempt.glucoseMeasurement && <p className="context-note">Глюкоза: {attempt.glucoseMeasurement.value.toFixed(1)} ммоль/л · {time(attempt.glucoseMeasurement.at)}</p>}
          {(attempt.completed.includes('saturation') || attempt.completed.includes('connect-monitor')) && <PulseTrace bpm={attempt.patient.pulse} connected paused={attempt.paused} spo2={attempt.completed.includes('saturation') && attempt.patient.pulse > 0 ? Math.round(attempt.patient.spo2) : undefined} sbp={attempt.measurement?.sbp}/>}
        </aside>
        {selectedObject && <section ref={actionPanelRef} className="action-panel glass-panel" aria-label={`Действия: ${objectLabels[selectedObject]}`}><div className="panel-heading"><div><span className="eyebrow">ВЗАИМОДЕЙСТВИЕ</span><h2>{objectLabels[selectedObject]}</h2></div><button className="icon-button" aria-label="Закрыть действия" onClick={() => setSelectedObject(null)}><X size={18}/></button></div>
          {selectedObject === 'tonometer' && attempt.episode === 'hypertension' && <p className="context-note">Контроль АД каждые 15 минут, при ухудшении — раньше. {attempt.measurement ? `Следующий плановый контроль: ${time(attempt.measurement.at + 900)}.` : 'Начните с измерения и сравнения с привычным давлением.'}</p>}
          {selectedObject === 'chart' && <div className="chart-data"><p>Температурный лист · учебные данные</p>{attempt.baselineRead ? <p>До эпизода: САД {attempt.patient.habitualSbp} мм рт. ст.; пульс 80/мин; T 37,0 °C.</p> : <p>Откройте исходную запись, чтобы сравнить показатели.</p>}{attempt.measurement && <p>Измерено в {time(attempt.measurement.at)}: САД {attempt.measurement.sbp}; пульс {attempt.measurement.pulse}.</p>}{attempt.repeatMeasurement && <p>Повторно в {time(attempt.repeatMeasurement.at)}: САД {attempt.repeatMeasurement.sbp}; пульс {attempt.repeatMeasurement.pulse}.</p>}{attempt.temperatureMeasurement && <p>Термометр в {time(attempt.temperatureMeasurement.at)}: {attempt.temperatureMeasurement.value.toFixed(1)} °C.</p>}{attempt.completed.includes('record') && <p><Check size={14}/> Наблюдения и журнал действий внесены в лист.</p>}</div>}
          {(selectedObject === 'medications' || selectedObject === 'shock-kit') && <p className="context-note">{attempt.episode === 'anaphylaxis' ? 'Постоянный экстренный протокол: взрослому адреналин 0,5 мг в/м в наружную поверхность бедра. Не ждать назначения или прибытия врача; повтор через 5 минут при сохраняющихся ABC-нарушениях. Антигистаминный не заменяет адреналин.' : 'Сверяйте назначение, аллергии и противопоказания.'} {attempt.episode === 'chest-pain' && <>Нитрат: проверьте приём ФДЭ-5, противопоказания и свежее АД. {attempt.nitroMinSbp === null ? 'Порог САД не задан — воздержаться и обратиться к врачу.' : `Порог преподавателя ${attempt.nitroMinSbp} мм рт. ст., но не ниже 90; не более 3 доз; повтор не ранее 5 минут.`}</>}{attempt.episode === 'collapse' && 'Инфузия — по назначению; исключайте сепсис и кровопотерю. Жаропонижающее не устраняет шок.'}{attempt.episode === 'hypertension' && 'Оцените лицо, руки и речь. Проверьте противопоказания к каптоприлу; не снижайте АД резко без назначения.'}</p>}
          {selectedObject === 'injection' && <p className="context-note">Путь исходного препарата: {routeLabels[attempt.patient.injectionRoute]}. При внутривенном введении прекратите инфузию и сохраните доступ. Для других путей прекратите дальнейшее введение.</p>}
          {selectedObject === 'ecg-device' && <p className="context-note">{attempt.completed.includes('ecg') ? 'ЭКГ записана и готова к передаче врачу. Кривая монитора учебная и не заменяет диагностическую ЭКГ.' : attempt.completed.includes('attach-electrodes') ? 'Электроды наложены. Снимите запись и передайте врачу.' : 'Сначала наложите электроды, затем снимите ЭКГ.'}</p>}
          {selectedObject === 'cpr' && <p className="context-note">Одно нажатие — серия 30 компрессий: 100–120/мин, глубина 5–6 см, полное расправление грудной клетки, минимум пауз. Затем откройте дыхательные пути и выполните два вдоха мешком Амбу. Техника отрабатывается на манекене.</p>}
          <div className="context-actions">{contextActions.map(action => <button key={action.id} disabled={attempt.paused || (action.id === 'compression' && attempt.cycleCompressions >= 30)} className={`${attempt.completed.includes(action.id) ? 'done' : ''} ${hint === selectedObject && attempt.mode === 'training' && required.find(id => !attempt.completed.includes(id)) === action.id ? 'suggested' : ''}`} onClick={() => doAction(action.id)}>{attempt.completed.includes(action.id) ? <Check size={15}/> : <span className="action-bullet"/>}{action.title}</button>)}</div>
          <p className="action-feedback" role="status">{attempt.feedback}</p>
          {selectedObject === 'cpr' && <div className="cpr-stats"><span>Компрессий в серии: {attempt.cycleCompressions}/30</span><span>Циклов с вентиляцией: {attempt.ventilations}</span></div>}
        </section>}
        {firstPerson && <><div className="crosshair" aria-hidden="true">+</div><span className="crosshair-label">{focusedObject ? `${objectLabels[focusedObject]} · E` : 'Наведите прицел на предмет'}</span></>}
        {firstPerson && <div className="navigation-help glass-panel">{navigationHint || (pointerLocked ? 'WASD · Shift — быстрее · E — взаимодействие · Esc — курсор' : 'Клик по палате — управление мышью')}</div>}
        {heldItem && <div className="held-item"><span/><strong>{heldItem}</strong></div>}
      </>}
      {!active && <section className="results-panel glass-panel"><span className="eyebrow">РАЗБОР ПОПЫТКИ</span><h1>{attempt.phase === 'finished' ? 'Помощь передана' : 'Эпизод завершён'}</h1><p>{attempt.outcome}</p><div className="result-metrics"><div><strong>{time(attempt.doctorCalledAt)}</strong><span>до вызова врача</span></div><div><strong>{time(attempt.firstCorrectAt)}</strong><span>до первого верного действия</span></div><div><strong>{attempt.errors.filter(e => e.severity === 'critical').length}</strong><span>критических ошибок</span></div></div><div className="stage-scores">{scores.map((score, i) => <div key={i}><span>{i + 1}. {stageTitles[i]}</span><progress max={100} value={score}/><strong>{score}%</strong></div>)}</div><h3>Ошибки и решения</h3>{attempt.errors.length ? <ul className="error-list">{attempt.errors.map((error, i) => <li key={i} className={error.severity}><span>{time(error.at)} · {({ critical: 'Критическая', major: 'Существенная', minor: 'Незначительная' })[error.severity]}</span>{error.why}</li>)}</ul> : <p>Ошибок в выполненных действиях не зарегистрировано.</p>}<div className="result-buttons"><button className="primary-button" onClick={() => begin(attempt.caseId)}>Повторить эпизод</button><button className="secondary-button" onClick={backToMenu}>Выбрать другой</button></div></section>}
    </>}
    {storageError && <p className="storage-error" role="status">{storageError}</p>}
    {active && !editorOpen && attempt && (attempt.doctorArrived || attempt.teamArrived) && <DoctorDialog key={attempt.id} attempt={attempt} onOpen={closeActions} onHandoff={() => doAction('handoff')}/>}
    {editorOpen && <SceneEditor/>}


  </main>
}

export default App
