export interface ScreenPoint { x: number; y: number }

/** Prefer the nearest side with room, then clamp within the usable viewport. */
export function placeActionPopover(anchor: ScreenPoint, panel: { width: number; height: number }, viewport: { width: number; height: number }) {
  const margin = 12, gap = 18, top = 66
  const right = viewport.width - margin - panel.width
  const below = viewport.height - margin - panel.height
  let x = anchor.x + gap
  if (x > right || (viewport.width > 800 && x + panel.width > viewport.width - 320)) x = anchor.x - gap - panel.width
  const y = anchor.y - Math.min(80, panel.height / 3)
  return {
    x: Math.max(margin, Math.min(right, x)),
    y: Math.max(top, Math.min(Math.max(top, below), y)),
  }
}
