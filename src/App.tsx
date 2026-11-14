import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  Check,
  CheckCircle2,
  HeartPulse,
  Info,
  PersonStanding,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react'
import RoomScene, {
  type BlanketTransform,
  type PatientTransform,
  type SceneAction,
} from './RoomScene'
import { scenario, sourceReferences, type TaskId } from './scenario'
import './App.css'

const sceneActionsByStep: Partial<Record<string, SceneAction>> = {
  'hand-hygiene:1': 'sink',
  'identification:1': 'patient',
  'assessment:0': 'patient',
  'assessment:1': 'patient',
  'vitals:1': 'patient',
  'environment:1': 'thermostat-up',
  'comfort:1': 'blanket',
  'fall-prevention:0': 'bed-controls',
  'fall-prevention:2': 'call-bell',
  'mobility-skin:1': 'mobility',
}

const PATIENT_TRANSFORM_STORAGE_KEY = 'careflow-patient-transform-v2'
const BLANKET_TRANSFORM_STORAGE_KEY = 'careflow-blanket-transform-v1'
const FIRST_PERSON_CAMERA_HEIGHT_STORAGE_KEY = 'careflow-first-person-camera-height-v2'
const DEFAULT_PATIENT_TRANSFORM: PatientTransform = { x: 0, y: 0, z: 0, scale: 1 }
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
    const stored: unknown = JSON.parse(localStorage.getItem(PATIENT_TRANSFORM_STORAGE_KEY) ?? 'null')
    if (typeof stored !== 'object' || stored === null) return DEFAULT_PATIENT_TRANSFORM

    const values = stored as Record<string, unknown>
    return {
      x: typeof values.x === 'number' && Number.isFinite(values.x) ? Math.max(-1, Math.min(1, values.x)) : 0,
      y: typeof values.y === 'number' && Number.isFinite(values.y) ? Math.max(-0.5, Math.min(0.8, values.y)) : 0,
      z: typeof values.z === 'number' && Number.isFinite(values.z) ? Math.max(-1, Math.min(1, values.z)) : 0,
      scale: typeof values.scale === 'number' && Number.isFinite(values.scale)
        ? Math.max(0.5, Math.min(1.5, values.scale))
        : 1,
    }
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

function App() {
  const [completedSteps, setCompletedSteps] = useState<Record<TaskId, boolean[]>>(
    () => Object.fromEntries(scenario.tasks.map((task) => [task.id, task.steps.map(() => false)])) as Record<TaskId, boolean[]>,
  )
  const [covered, setCovered] = useState(false)
  const [roomTemperature, setRoomTemperature] = useState(20)
  const [patientTransform, setPatientTransform] = useState(readPatientTransform)
  const [blanketTransform, setBlanketTransform] = useState(readBlanketTransform)
  const [firstPersonCameraHeight, setFirstPersonCameraHeight] = useState(readFirstPersonCameraHeight)
  const [showPatientAdjuster, setShowPatientAdjuster] = useState(false)
  const [firstPerson, setFirstPerson] = useState(false)
  const [pointerLocked, setPointerLocked] = useState(false)
  const [pointerLockFailed, setPointerLockFailed] = useState(false)
  const [showSources, setShowSources] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [notes, setNotes] = useState('')
  const [feedback, setFeedback] = useState('Выполните текущий шаг, чтобы перейти дальше.')
  const firstPersonRef = useRef(false)

  useEffect(() => {
    let matchedKeys = 0
    let sequenceTimeout = 0
    const sequence = ['q', 'w', 'e']

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      const activeElement = document.activeElement
      if (activeElement instanceof HTMLElement && (
        activeElement.isContentEditable || activeElement.matches('input, textarea, select')
      )) return

      const key = event.key.toLowerCase()
      matchedKeys = key === sequence[matchedKeys]
        ? matchedKeys + 1
        : key === sequence[0] ? 1 : 0

      window.clearTimeout(sequenceTimeout)
      if (matchedKeys === sequence.length) {
        setShowPatientAdjuster((isOpen) => !isOpen)
        matchedKeys = 0
      } else if (matchedKeys > 0) {
        sequenceTimeout = window.setTimeout(() => { matchedKeys = 0 }, 1500)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.clearTimeout(sequenceTimeout)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(PATIENT_TRANSFORM_STORAGE_KEY, JSON.stringify(patientTransform))
    } catch (error) {
      console.error('Не удалось сохранить настройки положения пациента:', error)
    }
  }, [patientTransform])

  useEffect(() => {
    try {
      localStorage.setItem(BLANKET_TRANSFORM_STORAGE_KEY, JSON.stringify(blanketTransform))
    } catch (error) {
      console.error('Не удалось сохранить настройки одеяла:', error)
    }
  }, [blanketTransform])

  useEffect(() => {
    try {
      localStorage.setItem(FIRST_PERSON_CAMERA_HEIGHT_STORAGE_KEY, String(firstPersonCameraHeight))
    } catch (error) {
      console.error('Не удалось сохранить высоту камеры:', error)
    }
  }, [firstPersonCameraHeight])

  const totalSteps = scenario.tasks.reduce((total, task) => total + task.steps.length, 0)
  const completedCount = Object.values(completedSteps).reduce(
    (total, steps) => total + steps.filter(Boolean).length,
    0,
  )
  const progress = Math.round((completedCount / totalSteps) * 100)
  const currentStep = (() => {
    for (const task of scenario.tasks) {
      const stepIndex = completedSteps[task.id].findIndex((isComplete) => !isComplete)
      if (stepIndex !== -1) return { task, stepIndex, taskIndex: scenario.tasks.indexOf(task) }
    }
    return null
  })()
  const targetAction = currentStep
    ? sceneActionsByStep[`${currentStep.task.id}:${currentStep.stepIndex}`] ?? null
    : null

  const handlePointerLockChange = useCallback((locked: boolean) => {
    setPointerLocked(locked)
    if (locked) setPointerLockFailed(false)
  }, [])
  const handlePointerLockError = useCallback(() => {
    if (!firstPersonRef.current) return
    setPointerLockFailed(true)
    setFeedback('Браузер не разрешил захват мыши. Удерживайте левую кнопку и двигайте мышь для осмотра.')
  }, [])

  const completeCurrentStep = (message?: string) => {
    if (!currentStep) return
    setCompletedSteps((current) => {
      if (current[currentStep.task.id][currentStep.stepIndex]) return current
      const next = { ...current, [currentStep.task.id]: [...current[currentStep.task.id]] }
      next[currentStep.task.id][currentStep.stepIndex] = true
      return next
    })
    setFeedback(message ?? 'Шаг выполнен. Перейдите к следующему действию.')
  }

  const rejectOutOfSequenceAction = () => {
    setFeedback('Сначала выполните действие, указанное в текущем шаге.')
  }

  const handleSceneAction = (action: SceneAction) => {
    switch (action) {
      case 'sink':
        if (targetAction !== action) return rejectOutOfSequenceAction()
        completeCurrentStep('Гигиена рук выполнена по алгоритму учебного учреждения.')
        break
      case 'patient':
        if (targetAction !== action) return rejectOutOfSequenceAction()
        completeCurrentStep('Информация о пациентке учтена.')
        break
      case 'blanket':
        if (targetAction !== action) return rejectOutOfSequenceAction()
        setCovered((current) => !current)
        if (!covered) {
          completeCurrentStep('Пациентка укрыта. Следующим шагом уточните её самочувствие.')
        } else {
          setFeedback('Одеяло откинуто. Текущий шаг остаётся незавершённым.')
        }
        break
      case 'call-bell':
        if (targetAction !== action) return rejectOutOfSequenceAction()
        completeCurrentStep('Кнопка вызова доступна пациентке.')
        break
      case 'bed-controls':
        if (targetAction !== action) return rejectOutOfSequenceAction()
        completeCurrentStep('Положение кровати проверено.')
        break
      case 'mobility':
        if (targetAction !== action) return rejectOutOfSequenceAction()
        completeCurrentStep('Безопасное перемещение подготовлено.')
        break
      case 'thermostat-up':
      case 'thermostat-down': {
        if (currentStep?.task.id !== 'environment' || currentStep.stepIndex !== 1) {
          return rejectOutOfSequenceAction()
        }
        const change = action === 'thermostat-up' ? 1 : -1
        const nextTemperature = Math.max(16, Math.min(30, roomTemperature + change))
        setRoomTemperature(nextTemperature)
        if (nextTemperature === 21) {
          completeCurrentStep('Уставка термостата изменена до учебного значения 21 °C.')
        } else {
          setFeedback(`На термостате установлено ${nextTemperature} °C. Продолжайте настройку до 21 °C.`)
        }
        break
      }
      default:
        break
    }
  }

  const restart = () => {
    setCompletedSteps(Object.fromEntries(scenario.tasks.map((task) => [task.id, task.steps.map(() => false)])) as Record<TaskId, boolean[]>)
    setCovered(false)
    setRoomTemperature(20)
    firstPersonRef.current = false
    setFirstPerson(false)
    setPointerLocked(false)
    setPointerLockFailed(false)
    setFeedback('Сценарий начат заново. Выполните текущий шаг.')
  }

  const toggleFirstPerson = () => {
    if (firstPerson) {
      firstPersonRef.current = false
      setFirstPerson(false)
      setFeedback('Обзорная камера включена.')
    } else {
      firstPersonRef.current = true
      setFirstPerson(true)
      setFeedback('Режим от первого лица: WASD или стрелки — движение, мышь — осмотр.')
    }
    setPointerLocked(false)
    setPointerLockFailed(false)
  }

  const updatePatientTransform = (key: keyof PatientTransform, value: number) => {
    setPatientTransform((current) => ({ ...current, [key]: value }))
  }

  const updateBlanketTransform = (key: keyof BlanketTransform, value: number) => {
    setBlanketTransform((current) => ({ ...current, [key]: value }))
  }

  const resetPatientTransform = () => {
    setPatientTransform(DEFAULT_PATIENT_TRANSFORM)
    setBlanketTransform(DEFAULT_BLANKET_TRANSFORM)
    setFirstPersonCameraHeight(DEFAULT_FIRST_PERSON_CAMERA_HEIGHT)
  }

  const currentStepLabel = useMemo(() => {
    if (progress === totalSteps) return 'СЦЕНАРИЙ ЗАВЕРШЁН'
    return `ПЛАН УХОДА · ${completedCount} ИЗ ${totalSteps} ПУНКТОВ`
  }, [completedCount, progress, totalSteps])

  return (
    <main className="app-shell">
      <section className="scene-wrap">
        <RoomScene
          covered={covered}
          firstPerson={firstPerson}
          firstPersonCameraHeight={firstPersonCameraHeight}
          blanketTransform={blanketTransform}
          patientTransform={patientTransform}
          roomTemperature={roomTemperature}
          targetAction={targetAction}
          onAction={handleSceneAction}
          onPointerLockChange={handlePointerLockChange}
          onPointerLockError={handlePointerLockError}
        />
      </section>

      <header className="immersive-header">
        <button className="brand glass-panel" type="button" onClick={restart} aria-label="Начать сценарий заново">
          <span className="brand-mark"><HeartPulse size={19} /></span>
          <span className="brand-copy"><strong>care<span>flow</span></strong><small>SIM LAB</small></span>
        </button>
        <div className="immersive-module glass-panel">
          <span className="eyebrow">УЧЕБНЫЙ МОДУЛЬ</span>
          <strong>Базовый уход · Палата 204</strong>
        </div>
        <div className="immersive-header-spacer" />
        <div className="session-chip glass-panel"><span className="live-dot" /> СИМУЛЯЦИЯ</div>
        <button className="hud-button glass-panel" type="button" onClick={toggleFirstPerson}>
          <PersonStanding size={15} />{firstPerson ? 'Обзорная камера' : 'От первого лица'}
        </button>
        <button className="hud-button glass-panel" type="button" onClick={() => setShowNotes(true)}>Заметки</button>
        <button className="hud-button glass-panel" type="button" onClick={() => setShowSources(true)}><Info size={15} /> Источники</button>
        <button className="hud-icon glass-panel" type="button" onClick={restart} aria-label="Начать сценарий заново"><RotateCcw size={16} /></button>
      </header>

      {firstPerson && (
        <div className="scene-hint glass-panel" aria-live="polite">
          <span className="hint-pulse" />
          {pointerLocked
            ? 'WASD / стрелки — движение · мышь — осмотр · Esc — освободить курсор'
            : pointerLockFailed
              ? 'Удерживайте ЛКМ и двигайте мышь для осмотра · WASD / стрелки — движение'
              : 'Кликните по палате · WASD / стрелки — движение · мышь — осмотр'}
        </div>
      )}

      <section
        className={`current-step glass-panel ${targetAction === 'patient' ? 'current-step-left' : ''}`}
        aria-label="Текущий шаг чек-листа"
        aria-live="polite"
      >
        {currentStep ? (
          <>
            <div className="current-step-top">
              <span className="eyebrow">ТЕКУЩЕЕ ДЕЙСТВИЕ</span>
              <span className="step-counter">{completedCount + 1} / {totalSteps}</span>
            </div>
            <div className="current-step-heading">
              <span className="current-step-icon"><Activity size={21} /></span>
              <div>
                <span className="task-sequence">ЭТАП {currentStep.taskIndex + 1} ИЗ {scenario.tasks.length}</span>
                <h1>{currentStep.task.title}</h1>
              </div>
            </div>
            <p className="current-step-instruction">
              {currentStep.task.steps[currentStep.stepIndex]}
            </p>
            <p className="current-step-cue">«{currentStep.task.patientCue}»</p>
            {targetAction ? (
              <div className="step-action-prompt">
                <span className="hint-pulse" />
                {targetAction === 'thermostat-up'
                  ? 'Нажмите «+» на термостате в палате'
                  : 'Нажмите на подсвеченный объект в палате'}
              </div>
            ) : (
              <button className="complete-step-button" type="button" onClick={() => completeCurrentStep()}>
                <Check size={17} />
                Подтвердить выполнение
              </button>
            )}
            <details className="step-details">
              <summary>Пояснение и источник</summary>
              {currentStep.task.tip && <p>{currentStep.task.tip}</p>}
              <span>{currentStep.task.source}</span>
            </details>
            <p className="step-feedback" role="status">{feedback}</p>
          </>
        ) : (
          <div className="all-steps-complete">
            <span className="completion-mark"><CheckCircle2 size={26} /></span>
            <div><span className="eyebrow">СЦЕНАРИЙ ЗАВЕРШЁН</span><h1>План ухода выполнен</h1></div>
          </div>
        )}
      </section>

      <footer className="immersive-footer">
        <div className="progress-hud glass-panel">
          <div className="progress-hud-icon"><Activity size={17} /></div>
          <div className="progress-hud-content">
            <div><span>{currentStepLabel}</span><strong>{progress}%</strong></div>
            <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          </div>
        </div>
        <div className="safety-hud glass-panel"><ShieldCheck size={15} /><span>Учебная симуляция · Следуйте локальным протоколам</span></div>
      </footer>

      {showNotes && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowNotes(false)}>
          <section className="sources-modal notes-modal" role="dialog" aria-modal="true" aria-labelledby="notes-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading"><div><span className="eyebrow">ПЕРЕДАЧА СМЕНЫ</span><h2 id="notes-title">Заметки студента</h2></div><button className="icon-button" type="button" aria-label="Закрыть" onClick={() => setShowNotes(false)}><X size={18} /></button></div>
            <p className="modal-intro">Запишите наблюдения, которые важно передать ответственному специалисту.</p>
            <textarea className="notes-textarea" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Например: пациентка сообщила о дискомфорте при смене положения…" />
            <div className="copyright-note"><Info size={15} /> Заметки хранятся только в этой вкладке. Не вводите реальные персональные данные.</div>
          </section>
        </div>
      )}

      {showSources && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowSources(false)}>
          <section className="sources-modal" role="dialog" aria-modal="true" aria-labelledby="sources-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading"><div><span className="eyebrow">ПРОВЕРЯЕМЫЕ ПЕРВОИСТОЧНИКИ</span><h2 id="sources-title">Источники и методика</h2></div><button className="icon-button" type="button" aria-label="Закрыть" onClick={() => setShowSources(false)}><X size={18} /></button></div>
            <p className="modal-intro">Сценарий — учебная адаптация базовых принципов безопасного ухода, а не дословная копия клинического чек-листа. В практике следуйте действующим локальным протоколам, назначению и компетенциям.</p>
            <div className="source-list">
              {sourceReferences.map((source) => (
                <a className="source-card" href={source.url} target="_blank" rel="noreferrer" key={source.title}>
                  <span className="source-type">{source.organization}</span><strong>{source.title}</strong><span>{source.summary}</span><span className="source-open">Открыть источник <ArrowUpRight size={14} /></span>
                </a>
              ))}
            </div>
            <div className="copyright-note"><Info size={15} /> Формулировки чек-листа написаны для симулятора; материалы источников не воспроизводятся целиком.</div>
          </section>
        </div>
      )}

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

      <span className="visually-hidden"><CheckCircle2 /> {completedCount} из {totalSteps} действий отмечено</span>
    </main>
  )
}

export default App
