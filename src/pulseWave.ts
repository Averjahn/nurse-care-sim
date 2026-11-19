/** Synthetic teaching trace, not a diagnostic ECG. Time is in real seconds. */
export function pulseWave(seconds: number, bpm: number, kind: 'ecg' | 'pleth' = 'ecg'): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(bpm) || bpm <= 0) return 0
  const t = ((seconds * bpm / 60) % 1 + 1) % 1
  const g = (center: number, width: number) => Math.exp(-(((t - center) / width) ** 2))
  return kind === 'pleth' ? 0.9 * g(.28, .12) + .23 * g(.57, .10) : .12 * g(.16, .045) - .18 * g(.34, .015) + g(.38, .012) - .3 * g(.42, .02) + .25 * g(.67, .08)
}
export function drawMonitor(ctx: CanvasRenderingContext2D, width: number, height: number, seconds: number, bpm: number, connected: boolean, spo2?: number, sbp?: number) {
  ctx.fillStyle = '#071c22'; ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = '#12343b'; ctx.lineWidth = 1
  for (let x = 0; x < width; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke() }
  for (let y = 0; y < height; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke() }
  ctx.fillStyle = '#9de9bc'; ctx.font = `${Math.round(height * .12)}px monospace`
  ctx.fillText(connected ? `HR ${Math.round(bpm)} /min   SpO2 ${spo2 ?? '--'}%   SYS ${sbp ?? '--'}` : 'Подключите датчики', 12, height * .18)
  if (!connected) return
  for (const [kind, base, color] of [['ecg', .47, '#54ef9a'], ['pleth', .86, '#59d9fa']] as const) {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath()
    for (let x = 0; x < width; x++) {
      const y = height * base - pulseWave(seconds - (width - x) / 95, bpm, kind) * height * .24
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}
