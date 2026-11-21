import { useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useBedRemote } from './bedRemoteStore'
import './BedRemote.css'

export default function BedRemoteOverlay() {
  const phase = useBedRemote(s => s.phase)
  const cancellable = phase === 'approaching' || phase === 'ready'
  useEffect(() => {
    if (!cancellable) return
    const escape = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); useBedRemote.getState().cancel() } }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [cancellable])
  if (phase === 'idle') return null
  return <aside className="bed-remote-overlay glass-panel" aria-label="Управление кроватью">
    <strong>Управление кроватью</strong>
    <p role="status">{phase === 'approaching' ? 'Приближаемся к пульту…' : phase === 'ready' ? 'Выберите положение на пульте. Наведите на кнопку, чтобы узнать её действие.' : phase === 'pressing' ? 'Кнопка нажата' : 'Возвращаем обзор палаты…'}</p>
    {cancellable && <button className="secondary-button" onClick={() => useBedRemote.getState().cancel()}><ArrowLeft size={15}/>Вернуться без изменения</button>}
  </aside>
}
