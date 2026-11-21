import test from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { OxygenHose } from '../src/oxygenHose.ts'

test('hose has fixed endpoints, sags under gravity and rests on the floor', () => {
  const rope = new OxygenHose(), start = new Vector3(0, 1, 0), end = new Vector3(2, 1.5, 0)
  for (let i = 0; i < 240; i++) rope.step(start, end, 1 / 60)
  assert.deepEqual(rope.points[0], start)
  assert.deepEqual(rope.points.at(-1), end)
  assert.ok(Math.min(...rope.points.map(p => p.y)) < .7)
  assert.ok(rope.points.every(p => p.y >= .035))
  const length = rope.points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(rope.points[i]), 0)
  assert.ok(Math.abs(length - 3.6) < .15, `rope length ${length}`)
})

test('moving the mask keeps the outlet fixed and the rope responds without invalid points', () => {
  const rope = new OxygenHose(), start = new Vector3(0, 1, 0), end = new Vector3(1, 1, 0)
  for (let i = 0; i < 100; i++) {
    end.set(1 + i / 100, 1.5, Math.sin(i / 10) * .3)
    rope.step(start, end, i === 20 ? 8 : 1 / 60, p => { if (p.x > .8 && p.x < 1.2) p.y = Math.max(.5, p.y) })
    assert.deepEqual(rope.points[0], start)
    assert.deepEqual(rope.points.at(-1), end)
    assert.ok(rope.points.every(p => p.toArray().every(Number.isFinite)))
  }
  assert.ok(rope.points.slice(1, -1).filter(p => p.x > .8 && p.x < 1.2).every(p => p.y >= .5))
})
