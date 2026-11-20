import test from 'node:test'
import assert from 'node:assert/strict'
import { subtractOpening, windowLayout, WINDOW_WIDTH, WINDOW_HEIGHT } from '../src/windowGeometry.ts'
import { actions, emergencyCases } from '../src/scenario.ts'
import { createAttempt, requiredActions } from '../src/simulation.ts'

const area = r => (r.right - r.left) * (r.top - r.bottom)
test('wall pieces leave an actual empty window opening', () => {
  const band = { left: -4, right: 4, bottom: 0, top: 4 }, hole = { left: -1, right: 1, bottom: 1, top: 3 }
  const pieces = subtractOpening(band, hole)
  assert.equal(pieces.reduce((total, r) => total + area(r), 0), area(band) - area(hole))
  for (const r of pieces) assert.ok(r.right <= hole.left || r.left >= hole.right || r.top <= hole.bottom || r.bottom >= hole.top)
  assert.deepEqual(subtractOpening(band, { ...hole, left: 8, right: 10 }), [band])
})
test('window and hole track saved size and wall position without floating off the wall', () => {
  const wall = { position: [-3, 2.5, 0.5], scale: 2 }, window = { position: [99, 3, 1], scale: 0.75 }
  const layout = windowLayout([-4, 2, 0], [0.2, 4, 8], wall, window)
  assert.deepEqual(layout.position, [-3, 3, 1], 'Legacy normal-axis offsets must not detach the frame')
  assert.equal((layout.opening.right - layout.opening.left) * wall.scale, WINDOW_WIDTH * window.scale)
  assert.equal((layout.opening.top - layout.opening.bottom) * wall.scale, WINDOW_HEIGHT * window.scale)
  assert.equal(layout.depth * window.scale, 0.2 * wall.scale)
})
test('permanently closed window is absent from actions and every scenario requirement', () => {
  assert.ok(!actions.some(a => a.id === 'air' || a.target.object === 'window'))
  for (const scenario of emergencyCases) {
    const required = requiredActions(createAttempt(scenario.id))
    assert.ok(!required.includes('air'))
    assert.ok(required.every(id => actions.some(a => a.id === id)))
  }
})
