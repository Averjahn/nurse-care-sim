import { CanvasTexture, SRGBColorSpace } from 'three'
import type { BedButtonId } from './bedRemoteStore'

export function bedButtonTexture(id: BedButtonId, label: string) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 208
  const c = canvas.getContext('2d')!
  c.strokeStyle = '#204e48'; c.fillStyle = '#204e48'; c.lineWidth = 8; c.lineCap = 'round'; c.lineJoin = 'round'
  const line = (points: number[][]) => { c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke() }
  const head = (x: number, y: number) => { c.beginPath(); c.arc(x, y, 11, 0, Math.PI * 2); c.fill() }
  line([[30, 126], [225, 126]]); line([[38, 126], [38, 143]]); line([[215, 126], [215, 143]])
  switch (id) {
    case 'semi-sitting': head(55, 44); line([[66, 64], [117, 111], [213, 111]]); line([[34, 68], [104, 119], [225, 119]]); break
    case 'legs-up': head(51, 89); line([[73, 104], [126, 104], [212, 69]]); line([[34, 115], [128, 115], [225, 77]]); break
    case 'knees-up': head(51, 87); line([[73, 102], [121, 102], [167, 65], [210, 104]]); line([[34, 114], [124, 114], [169, 77], [225, 114]]); break
    case 'sitting': head(105, 35); line([[106, 58], [106, 97], [162, 97], [162, 140], [185, 140]]); break
    default: head(51, 89); line([[73, 104], [213, 104]]); line([[34, 115], [225, 115]])
  }
  if (id === 'firm-surface') { c.fillStyle = '#a94848'; c.fillRect(127, 37, 12, 44); c.fillRect(111, 53, 44, 12) }
  c.fillStyle = '#204e48'; c.font = 'bold 25px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(label, 128, 190)
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace
  return texture
}
