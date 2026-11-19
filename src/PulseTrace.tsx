import { useEffect, useRef } from 'react'
import { drawMonitor } from './pulseWave'
export default function PulseTrace({ bpm, connected, paused, spo2, sbp }: { bpm: number; connected: boolean; paused: boolean; spo2?: number; sbp?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const clock = useRef(0)
  useEffect(() => {
    const initial = canvas.current?.getContext('2d')
    if (initial) drawMonitor(initial, 560, 170, clock.current, bpm, connected, spo2, sbp)
    let frame = 0, last = 0, drawn = 0
    const render = (now: number) => {
      if (last && !paused) clock.current += Math.min(.1, (now - last) / 1000)
      last = now
      if (now - drawn > 32) {
        const ctx = canvas.current?.getContext('2d')
        if (ctx) drawMonitor(ctx, 560, 170, clock.current, bpm, connected, spo2, sbp)
        drawn = now
      }
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    return () => cancelAnimationFrame(frame)
  }, [bpm, connected, paused, spo2, sbp])
  return <canvas ref={canvas} width={560} height={170} className="pulse-trace" role="img" aria-label={connected ? `Учебная пульсовая кривая, ${bpm} ударов в минуту` : 'Монитор: датчики не подключены'}/>
}
