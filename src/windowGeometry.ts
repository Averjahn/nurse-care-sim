import type { ObjectSettings, Vec3 } from './sceneSettings'

export const WINDOW_WIDTH = 1.9
export const WINDOW_HEIGHT = 2.1
export const WINDOW_Y = 2.75
export const WINDOW_Z = -0.35
export interface WallRectangle { left: number; right: number; bottom: number; top: number }

/** Split a wall band around a true through-opening, without overlapping faces. */
export function subtractOpening(band: WallRectangle, hole: WallRectangle): WallRectangle[] {
  const left = Math.max(band.left, hole.left), right = Math.min(band.right, hole.right)
  const bottom = Math.max(band.bottom, hole.bottom), top = Math.min(band.top, hole.top)
  if (right <= left || top <= bottom) return [band]
  return [
    { ...band, top: bottom }, { ...band, bottom: top },
    { left: band.left, right: left, bottom, top },
    { left: right, right: band.right, bottom, top },
  ].filter(rect => rect.right - rect.left > 0.00001 && rect.top - rect.bottom > 0.00001)
}

export function windowLayout(center: Vec3, size: Vec3, wall: ObjectSettings = {}, window: ObjectSettings = {}) {
  const wallPosition = wall.position ?? center, wallScale = wall.scale ?? 1, scale = window.scale ?? 1
  const y = window.position?.[1] ?? WINDOW_Y, z = window.position?.[2] ?? WINDOW_Z
  const halfWidth = WINDOW_WIDTH * scale / (2 * wallScale), halfHeight = WINDOW_HEIGHT * scale / (2 * wallScale)
  const horizontal = (z - wallPosition[2]) / wallScale, vertical = (y - wallPosition[1]) / wallScale
  return {
    position: [wallPosition[0], y, z] as Vec3,
    // Normal-axis motion is fixed to the wall, including legacy editor settings.
    wallX: wallPosition[0], depth: size[0] * wallScale / scale,
    opening: { left: horizontal - halfWidth, right: horizontal + halfWidth, bottom: vertical - halfHeight, top: vertical + halfHeight },
  }
}
