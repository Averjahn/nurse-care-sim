import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { requiredActions, type Attempt } from './simulation'

export default function DoctorDialog({ attempt, onHandoff, onOpen, suspended = false }: { attempt: Attempt; onHandoff: () => void; onOpen: () => void; suspended?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const ready = attempt.completed.includes('record') && requiredActions(attempt).every(id => id === 'handoff' || attempt.completed.includes(id))
  const stage = `${attempt.id}:${ready ? 'ready' : 'arrived'}`
  const [dismissed, setDismissed] = useState('')
  useEffect(() => {
    const element = dialog.current
    if (!element || dismissed === stage || suspended) return
    if (document.pointerLockElement) document.exitPointerLock()
    onOpen()
    element.showModal()
    return () => element.close()
  }, [stage, dismissed, onOpen, suspended])
  const close = () => { setDismissed(stage); dialog.current?.close() }
  return <dialog ref={dialog} className="doctor-dialog glass-panel" aria-labelledby="doctor-title" aria-describedby="doctor-reply" onCancel={event => { event.preventDefault(); close() }}>
    <button className="icon-button doctor-close" aria-label="Продолжить помощь пациентке" onClick={close}><X size={18}/></button>
    <img className="doctor-avatar" src={`${import.meta.env.BASE_URL}doctor-avatar.jpg`} width="160" height="160" alt="Врач в белом халате"/>
    <h2 id="doctor-title">Врач в палате</h2>
    <p id="doctor-reply">{ready ? 'Я готов принять пациентку. Передайте мне сведения о её состоянии, выполненных вмешательствах и повторных измерениях.' : 'Я рядом. Продолжайте необходимую помощь и контроль состояния. Когда закончите и внесёте наблюдения в лист, передайте мне пациентку.'}</p>
    <button className="primary-button" disabled={!ready || attempt.paused} onClick={onHandoff}>Передать пациента врачу</button>
  </dialog>
}
