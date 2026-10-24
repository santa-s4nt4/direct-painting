import test from 'node:test';
import assert from 'node:assert/strict';
import { brushSize, canvasPoint, strokePoints, stamp, timestamp } from '../src/drawing.js';

test('Pencil pressure scales the brush while mouse and disabled pressure use the selected size', () => {
  assert.equal(brushSize(15, 100, 0, 'pen', true), 15);
  assert.equal(brushSize(15, 100, 1, 'pen', true), 100);
  assert.equal(brushSize(15, 100, 0.5, 'pen', true), 58);
  assert.equal(brushSize(15, 100, 0.1, 'mouse', true), 100);
  assert.equal(brushSize(15, 100, 0.1, 'pen', false), 100);
  assert.equal(brushSize(15, 100, 5, 'pen', true), 100);
  assert.equal(brushSize(15, 100, -1, 'pen', true), 15);
  assert.equal(brushSize(15, 100, NaN, 'pen', true), 58);
});
test('responsive canvas coordinates map to native 1920 × 1080 resolution', () => {
  assert.deepEqual(canvasPoint({ clientX: 260, clientY: 370 }, { left: 100, top: 50, width: 640, height: 640 }), { x: 480, y: 540 });
});
test('dense samples form a continuous trail and interpolate stationary pressure changes', () => {
  const from = { x: 10, y: 10, size: 20 }, to = { x: 250, y: 180, size: 20 };
  const points = [from, ...strokePoints(from, to)];
  assert.deepEqual(points.at(-1), to);
  for (let i = 1; i < points.length; i++) assert.ok(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) <= 1.001);
  assert.deepEqual(strokePoints(from, { x: 11, y: 10, size: 20 }), [{ x: 11, y: 10, size: 20 }]);
  const pressurePoints = strokePoints(from, { x: 10, y: 10, size: 40 });
  assert.equal(pressurePoints.length, 20);
  assert.equal(pressurePoints[0].size, 21);
  assert.equal(pressurePoints.at(-1).size, 40);
  assert.deepEqual(strokePoints(from, from), []);
});
test('circle stamps keep crisp pixels, omit square corners, and restore opacity', () => {
  const calls = []; const ctx = { globalAlpha: 1, fillRect: (...args) => calls.push(args) };
  stamp(ctx, { x: 10.9, y: 20.6, size: 10 }, '#123456', 0.3);
  assert.equal(ctx.fillStyle, '#123456');
  assert.equal(ctx.globalAlpha, 1);
  assert.equal(calls.length, 10);
  assert.ok(calls[0][2] < calls[4][2]);
  assert.equal(calls[4][2], 10);
  assert.ok(calls.every(args => args.every(Number.isInteger) && args[3] === 1));
});
test('filenames include a local timestamp', () => {
  assert.equal(timestamp(new Date(2026, 9, 8, 9, 5, 3)), '20261008-090503');
});
