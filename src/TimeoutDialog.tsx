import { useEffect, useRef } from 'react'
import { ArrowLeft, RotateCcw, TimerOff } from 'lucide-react'
import './TimeoutDialog.css'

export default function TimeoutDialog({ onRetry, onMenu }: { onRetry: () => void; onMenu: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    if (document.pointerLockElement) document.exitPointerLock()
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog ref={ref} className="timeout-dialog glass-panel" aria-labelledby="timeout-title" aria-describedby="timeout-description" onCancel={event => event.preventDefault()}>
    <span className="timeout-icon" aria-hidden="true"><TimerOff size={26}/></span>
    <h1 id="timeout-title">Время эпизода истекло</h1>
    <p id="timeout-description">Вы можете попробовать ещё раз или вернуться в главное меню.</p>
    <div className="timeout-actions"><button className="primary-button" onClick={onRetry}><RotateCcw size={17}/>Попробовать ещё раз</button><button className="secondary-button" onClick={onMenu}><ArrowLeft size={17}/>В главное меню</button></div>
  </dialog>
}
