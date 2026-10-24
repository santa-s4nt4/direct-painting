import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveDrawing } from '../src/live.js';
import { validateLive } from '../server/loop-relay.js';
const frame = (mode = 'return') => ({ session: 'editor', revision: 1, id: 'stroke', mode, color: '#ff0000', targets: [0], from: 0, elapsed: 100, samples: [{ x: 40, y: 80, size: 20, t: 0 }], head: { x: 40, y: 80, size: 20, t: 100 } });
const pixel = (data, x, y) => Array.from(data.slice((y * CANVAS_WIDTH + x) * 4, (y * CANVAS_WIDTH + x) * 4 + 4));
test('live first point and incremental segments render before the gesture is committed', () => {
  const live = new LiveDrawing(); live.update(frame(), 1000);
  assert.deepEqual(pixel(live.field.data, 40, 80), [255, 0, 0, 255]);
  live.update({ ...frame(), from: 1, elapsed: 200, samples: [{ x: 140, y: 80, size: 30, t: 200 }], head: { x: 140, y: 80, size: 30, t: 200 } }, 1100);
  assert.deepEqual(pixel(live.field.data, 90, 80), [255, 0, 0, 255]); assert.equal(live.count, 2);
  live.update(frame(), 1200); assert.equal(live.count, 2); // Stale poll response cannot rewind a live gesture.
  live.update(null, 1300); assert.equal(live.id, null);
});
test('late subscribers replay full history and MOVE uses the editor-smoothed coordinate', () => {
  const live = new LiveDrawing(), packet = frame('trail'); packet.samples.push({ x: 140, y: 80, size: 30, t: 100 });
  live.update(packet, 1000); assert.ok(pixel(live.field.render(100), 90, 80)[3] > 0);
  live.update({ ...frame('move'), id: 'move', move: { x: 65, y: 80, size: 23 } }, 1100);
  assert.deepEqual(live.move, { x: 65, y: 80, size: 23 });
  live.update({ ...frame(), id: 'missing-start', from: 3 }, 1200); assert.equal(live.id, 'move');
});
test('live packets reject malformed geometry, timing and session revisions', () => {
  assert.equal(validateLive(frame()).id, 'stroke');
  for (const patch of [{ revision: -1 }, { mode: 'other' }, { targets: [2] }, { from: -1 }, { color: 'bad' }, { elapsed: NaN }, { samples: [{ x: 1, y: 1, size: 0, t: 0 }] }, { samples: [] }]) assert.throws(() => validateLive({ ...frame(), ...patch }));
});
