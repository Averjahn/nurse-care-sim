import { Vector3 } from 'three'

/** Lightweight position-based rope: gravity, inertia, fixed ends and length constraints. */
export class OxygenHose {
  readonly points: Vector3[]
  private previous: Vector3[]
  private length = 3.6
  private initialized = false
  constructor(count = 33) {
    this.points = Array.from({ length: count }, () => new Vector3())
    this.previous = this.points.map(p => p.clone())
  }
  reset(start: Vector3, end: Vector3) {
    this.length = Math.max(3.6, start.distanceTo(end) + .4)
    for (let i = 0; i < this.points.length; i++) {
      const t = i / (this.points.length - 1)
      this.points[i].lerpVectors(start, end, t)
      this.points[i].y = Math.max(.035, this.points[i].y - Math.sin(t * Math.PI) * .65)
      this.previous[i].copy(this.points[i])
    }
    this.initialized = true
  }
  step(start: Vector3, end: Vector3, dt: number, collide?: (point: Vector3) => void) {
    if (!this.initialized) this.reset(start, end)
    this.length = Math.max(this.length, start.distanceTo(end) + .04)
    const step = Math.min(.05, Math.max(0, dt)) / 4
    const segment = this.length / (this.points.length - 1)
    for (let sub = 0; sub < 4; sub++) {
      for (let i = 1; i < this.points.length - 1; i++) {
        const p = this.points[i], old = this.previous[i], x = p.x, y = p.y, z = p.z
        p.set(p.x + (p.x - old.x) * .96, p.y + (p.y - old.y) * .96 - 9.81 * step * step, p.z + (p.z - old.z) * .96)
        old.set(x, y, z)
      }
      for (let iteration = 0; iteration < 16; iteration++) {
        this.points[0].copy(start); this.points.at(-1)!.copy(end)
        for (let i = 0; i < this.points.length - 1; i++) {
          const a = this.points[i], b = this.points[i + 1]
          const distance = a.distanceTo(b)
          if (distance < 1e-8) continue
          const correction = (distance - segment) / distance
          const dx = (b.x - a.x) * correction, dy = (b.y - a.y) * correction, dz = (b.z - a.z) * correction
          const left = i === 0 ? 0 : i === this.points.length - 2 ? 1 : .5
          const right = i === this.points.length - 2 ? 0 : i === 0 ? 1 : .5
          a.x += dx * left; a.y += dy * left; a.z += dz * left
          b.x -= dx * right; b.y -= dy * right; b.z -= dz * right
        }
        for (let i = 1; i < this.points.length - 1; i++) {
          this.points[i].y = Math.max(.035, this.points[i].y)
          collide?.(this.points[i])
        }
      }
    }
    this.points[0].copy(start); this.points.at(-1)!.copy(end)
  }
}
