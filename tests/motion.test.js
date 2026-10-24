import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { TrailField, PersistentField, SmoothedCircle, TRAIL_LIFETIME } from '../src/motion.js';
const offset = (x, y) => (y * CANVAS_WIDTH + x) * 4;
const rgba = (data, x, y) => Array.from(data.slice(offset(x, y), offset(x, y) + 4));

test('trail fades its opacity smoothly while preserving hue and avoiding overlap buildup', () => {
  const field = new TrailField();
  field.add({ x: 60, y: 100, size: 20 }, '#73c4ba', 0);
  const color = [115, 196, 186, 255];
  assert.deepEqual(rgba(field.render(0), 60, 100), color);
  field.add({ x: 65, y: 100, size: 20 }, '#73c4ba', 0);
  assert.deepEqual(rgba(field.render(0), 60, 100), color);
  const half = rgba(field.render(TRAIL_LIFETIME / 2), 60, 100);
  assert.deepEqual(half.slice(0, 3), color.slice(0, 3));
  assert.ok(half[3] > 0 && half[3] < 255);
  assert.deepEqual(rgba(field.render(TRAIL_LIFETIME), 60, 100), [0, 0, 0, 0]);
  assert.equal(field.active, false);
});
test('new trail samples refresh color and timing while clear removes all prior pixels', () => {
  const field = new TrailField();
  field.add({ x: 50, y: 50, size: 10 }, '#ff0000', 100);
  field.add({ x: 50, y: 50, size: 10 }, '#00ff00', 1600);
  const renewed = rgba(field.render(1900), 50, 50);
  assert.deepEqual(renewed.slice(0, 3), [0, 255, 0]);
  assert.ok(renewed[3] > 0 && renewed[3] < 255);
  field.clear(); assert.equal(field.active, false);
  assert.deepEqual(rgba(field.render(1950), 50, 50), [0, 0, 0, 0]);
});
test('persistent strokes retain earlier pixels, use opaque colors, and only disappear when cleared', () => {
  const field = new PersistentField();
  field.add({ x: 60, y: 100, size: 20 }, '#73c4ba');
  field.add({ x: 160, y: 100, size: 20 }, '#ffffff');
  assert.deepEqual(rgba(field.data, 60, 100), [115, 196, 186, 255]);
  field.add({ x: 65, y: 100, size: 20 }, '#73c4ba');
  assert.deepEqual(rgba(field.data, 60, 100), [115, 196, 186, 255]);
  field.add({ x: 60, y: 100, size: 10 }, '#ef6969');
  assert.deepEqual(rgba(field.data, 60, 100), [239, 105, 105, 255]);
  assert.deepEqual(rgba(field.data, 160, 100), [255, 255, 255, 255]);
  field.clear(); assert.equal(field.active, false);
  assert.deepEqual(rgba(field.data, 160, 100), [0, 0, 0, 0]);
});
test('MOVE eases towards its target without overshooting and continues until settled', () => {
  const circle = new SmoothedCircle({ x: 0, y: 0, size: 15 }, '#ffffff', 0);
  circle.setTarget({ x: 100, y: 200, size: 100 }); circle.update(16);
  assert.ok(circle.point.x > 0 && circle.point.x < 100);
  assert.ok(circle.point.size > 15 && circle.point.size < 100);
  let previous = circle.point.x;
  for (let now = 32; now <= 1000; now += 16) {
    circle.update(now); assert.ok(circle.point.x >= previous && circle.point.x <= 100); previous = circle.point.x;
  }
  assert.deepEqual(circle.point, circle.target); assert.equal(circle.moving, false);
});
test('MOVE follows the same easing curve at 60Hz and 120Hz', () => {
  const simulate = frames => {
    const circle = new SmoothedCircle({ x: 0, y: 0, size: 20 }, '#fff', 0);
    circle.setTarget({ x: 100, y: 80, size: 50 });
    for (let i = 1; i <= frames; i++) circle.update(i * 200 / frames);
    return circle.point;
  };
  const slow = simulate(12), fast = simulate(24);
  for (const key of ['x', 'y', 'size']) assert.ok(Math.abs(slow[key] - fast[key]) < 1e-9);
});
test('MOVE suppresses alternating input jitter and ignores subpixel noise', () => {
  const circle = new SmoothedCircle({ x: 160, y: 160, size: 30 }, '#fff', 0);
  const positions = [];
  for (let i = 1; i <= 40; i++) {
    circle.setTarget({ x: 160 + (i % 2 ? 2 : -2), y: 160, size: 30 });
    circle.update(i * 1000 / 60); positions.push(circle.displayPoint().x);
  }
  assert.ok(Math.max(...positions) - Math.min(...positions) < 4);
  const still = new SmoothedCircle({ x: 160, y: 160, size: 30 }, '#fff', 0);
  still.setTarget({ x: 160.3, y: 159.8, size: 30 }); still.update(100);
  assert.deepEqual(still.displayPoint(), { x: 160, y: 160, size: 30 });
});
