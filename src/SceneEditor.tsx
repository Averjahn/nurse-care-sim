import { useMemo, useRef, useState } from 'react'
import { Camera, Check, Copy, Move3D, Redo2, RotateCcw, Undo2, X } from 'lucide-react'
import { supportIds, useSceneEditor, useObjectSettings } from './sceneEditorStore'
import { emergencyCases } from './scenario'
import type { Vec3, SceneSettings } from './sceneSettings'
import './SceneEditor.css'

function NumberField({ label, value, onChange, step = 0.01, min = -100, max = 100, suffix, shortLabel }: { label: string; value: number; onChange: (value: number) => void; step?: number; min?: number; max?: number; suffix?: string; shortLabel?: string }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState('')
  return <label className="editor-number"><span>{shortLabel ?? label}</span><div><input type="number" aria-label={label} min={min} max={max} step={step} value={editing ? draft : Number(value.toFixed(3))}
    onFocus={() => { setDraft(String(Number(value.toFixed(3)))); setEditing(true) }}
    onChange={e => { setDraft(e.target.value); const n = e.target.valueAsNumber; if (Number.isFinite(n) && n >= min && n <= max) onChange(n) }} onBlur={() => setEditing(false)} />{suffix && <small>{suffix}</small>}</div></label>
}
function VectorFields({ label, value, onChange, lockedX = false }: { label: string; value: Vec3; onChange: (point: Vec3) => void; lockedX?: boolean }) {
  return <div className="editor-vector">{(['X', 'Y', 'Z'] as const).map((axis, i) => axis === 'X' && lockedX ? <div key={axis} className="editor-number"><span>X</span><div style={{ minHeight: 36 }}><small>В стене</small></div></div> : <NumberField key={axis} shortLabel={axis} label={`${label} · ${axis}`} value={value[i]} suffix="м" onChange={n => { const point: Vec3 = [...value]; point[i] = n; onChange(point) }} />)}</div>
}
export default function SceneEditor() {
  const state = useSceneEditor()
  const [tab, setTab] = useState<'objects' | 'camera'>('objects')
  const [codeOpen, setCodeOpen] = useState(false), [code, setCode] = useState(''), [notice, setNotice] = useState('')
  const codeRef = useRef<HTMLTextAreaElement>(null)
  const exported = useMemo(() => JSON.stringify(state.settings, null, 2), [state.settings])
  const target = state.targets[state.selected]
  const object = useObjectSettings(state.selected) ?? {}
  const color = object.hintColor ?? state.settings.hintColor
  const maxScale = state.selected === 'patient' ? 1 : object.hintScale ?? target?.hintScale ?? 1.3
  const updateCamera = (patch: Partial<SceneSettings['camera']>) => {
    try { state.updateCamera(patch); setNotice('') }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Проверьте настройки камеры') }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(exported); setNotice('Настройки скопированы') }
    catch { setCode(exported); setCodeOpen(true); setNotice('Выделите и скопируйте конфигурацию ниже'); requestAnimationFrame(() => codeRef.current?.select()) }
  }
  return <>
    <div className="editor-scene-tip"><span className="editor-mode-label"><Move3D size={15}/> Редактор сцены</span><p>Выберите объект в палате. Тяните цветные стрелки, чтобы переместить его.</p><small>Мышь — повернуть · колёсико — приблизить · ПКМ — сдвинуть вид</small></div>
    <aside className="scene-editor" role="dialog" aria-label="Редактор сцены">
      <header className="editor-heading"><div><h1>Настройка сцены</h1><span><Check size={12}/> Изменения применяются сразу</span></div><button className="editor-icon" onClick={state.toggle} aria-label="Закрыть редактор"><X size={19}/></button></header>
      <div className="editor-history"><span>{state.storageError ? 'Настройки в текущей вкладке' : 'Сохранено в этом браузере'}</span><button className="editor-icon" disabled={!state.undoStack.length} onClick={state.undo} aria-label="Отменить изменение"><Undo2 size={17}/></button><button className="editor-icon" disabled={!state.redoStack.length} onClick={state.redo} aria-label="Повторить изменение"><Redo2 size={17}/></button></div>
      <div className="editor-tabs" role="tablist" aria-label="Раздел настроек"><button role="tab" aria-selected={tab === 'objects'} onClick={() => setTab('objects')}>Объекты</button><button role="tab" aria-selected={tab === 'camera'} onClick={() => setTab('camera')}>Камера</button></div>
      <div className="editor-content">
        <label className="editor-label">Расстановка<select aria-label="Расстановка кейса" value={state.layout} onChange={e => state.setLayout(e.target.value)}><option value="">Общая для всех кейсов</option>{emergencyCases.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <label className="editor-switch"><input type="checkbox" checked={state.catalog} onChange={e => state.setCatalog(e.target.checked)}/> Все доступные предметы и места размещения</label>
        <p className="editor-help">{state.layout ? 'Изменения сохраняются только для выбранного кейса. Неизменённые предметы наследуют общую расстановку.' : 'Общая расстановка используется как основа для всех кейсов.'}</p>
        {tab === 'objects' ? <>
          <label className="editor-label">Объект<select aria-label="Объект сцены" value={target ? state.selected : ''} onChange={e => state.select(e.target.value)}><option value="" disabled>Выберите объект в сцене</option>{[false, true].map(support => <optgroup key={String(support)} label={support ? 'Места размещения' : 'Интерактивные предметы'}>{Object.values(state.targets).filter(t => supportIds.includes(t.id) === support).sort((a, b) => a.label.localeCompare(b.label, 'ru')).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>)}</select></label>
          {target ? <>
            {target.id.startsWith('imported-') && <p className="editor-help">Декоративный объект — скрыт в учебном режиме.</p>}
            <section><div className="editor-section-heading"><h2>Положение</h2><span>метры</span></div><VectorFields label="Положение" lockedX={target.id === 'window'} value={object.position ?? target.position} onChange={position => state.updateObject(target.id, { position }, 'position')} /><p className="editor-help">{target.id === 'window' ? 'Y — высота, Z — вдоль стены. Окно закреплено в проёме.' : 'X — влево/вправо, Y — высота, Z — вперёд/назад.'}</p></section>
            <section><div className="editor-section-heading"><h2>Размер</h2><NumberField label="Размер объекта" value={(object.scale ?? 1) * 100} min={5} max={500} step={1} suffix="%" onChange={n => state.updateObject(target.id, { scale: n / 100 })}/></div><input aria-label="Размер объекта ползунок" type="range" min="5" max="500" step="1" value={(object.scale ?? 1) * 100} onChange={e => state.updateObject(target.id, { scale: Number(e.target.value) / 100 })}/><p className="editor-help">100% — исходный размер. Пропорции сохраняются.</p></section>
            {target.id !== 'window' && <section><div className="editor-section-heading"><h2>Мигание</h2><label className="editor-switch"><input type="checkbox" checked={state.preview} onChange={e => state.setPreview(e.target.checked)}/> Предпросмотр</label></div>
              <label className="editor-color">Цвет этого объекта<input aria-label="Цвет мигания объекта" type="color" value={color} onChange={e => state.updateObject(target.id, { hintColor: e.target.value })}/><code>{color.toUpperCase()}</code></label>
              <div className="editor-section-heading"><label htmlFor="editor-hint-scale">Максимальное увеличение</label><strong>{maxScale.toFixed(2)}×</strong></div><input id="editor-hint-scale" type="range" min="1" max="3" step="0.05" disabled={target.id === 'patient'} value={maxScale} onChange={e => state.updateObject(target.id, { hintScale: Number(e.target.value) })}/>
              <p className="editor-help">{target.id === 'patient' ? 'Пациентка мигает без изменения размера.' : '1× — только цвет, без увеличения объекта.'}</p>
              <details className="editor-details"><summary>Общий цвет подсказок</summary><label className="editor-color">Для всех объектов<input aria-label="Общий цвет мигания" type="color" value={state.settings.hintColor} onChange={e => state.setHintColor(e.target.value)}/></label><button className="editor-text" onClick={() => state.updateObject(target.id, { hintColor: undefined, hintScale: undefined })}>Вернуть этому объекту общие настройки</button></details>
            </section>}
            <button className="editor-secondary" onClick={() => state.resetObject(target.id)}><RotateCcw size={14}/> Сбросить этот объект</button>
          </> : <p className="editor-help">Объекты появятся в списке после загрузки 3D-сцены.</p>}
        </> : <>
          <section><h2>Начальный ракурс</h2><p className="editor-help">Поверните и приблизьте сцену мышью, затем сохраните понравившийся вид.</p><button className="editor-primary" disabled={!state.captureView} onClick={() => { if (state.captureView) { updateCamera(state.captureView()); setNotice('Начальный ракурс сохранён') } }}><Camera size={17}/> Сохранить текущий ракурс</button></section>
          <section><h2>Положение камеры</h2><VectorFields label="Камера" value={state.settings.camera.position} onChange={position => updateCamera({ position })}/></section>
          <section><h2>Куда смотрит камера</h2><VectorFields label="Точка взгляда" value={state.settings.camera.target} onChange={target => updateCamera({ target })}/></section>
          <section><div className="editor-section-heading"><h2>Угол обзора</h2><strong>{state.settings.camera.fov}°</strong></div><input aria-label="Угол обзора камеры" type="range" min="20" max="80" value={state.settings.camera.fov} onChange={e => updateCamera({ fov: Number(e.target.value) })}/></section>
          <section><h2>Вид от первого лица</h2><NumberField label="Высота глаз" value={state.settings.camera.eyeHeight} min={1.2} max={4.5} step={0.05} suffix="м" onChange={eyeHeight => updateCamera({ eyeHeight })}/></section>
        </>}
        <details className="editor-details" open={codeOpen} onToggle={e => setCodeOpen(e.currentTarget.open)}><summary>Перенести настройки</summary><p className="editor-help">Скопируйте JSON, чтобы передать настройки в проект или открыть их в другом браузере.</p><textarea ref={codeRef} aria-label="Конфигурация сцены" spellCheck={false} value={code || exported} onChange={e => setCode(e.target.value)}/><button className="editor-secondary" onClick={() => { try { state.importSettings(JSON.parse(code || exported)); setCode(''); setNotice('Конфигурация применена') } catch (e) { setNotice(e instanceof Error ? e.message : 'Не удалось прочитать конфигурацию') } }}>Применить вставленные настройки</button></details>
        <button className="editor-text" onClick={state.resetAll}>Сбросить всю сцену</button>
      </div>
      <footer className="editor-footer"><button className="editor-primary" onClick={() => void copy()}><Copy size={16}/> Копировать настройки</button><p role="status">{state.storageError || notice || 'Q → W → E или Esc — закрыть редактор'}</p></footer>
    </aside>
  </>
}
