import test from 'node:test';
import assert from 'node:assert/strict';
import { sameGeometry, strokeBounds, StampCursor, LiveStroke } from '../src/render/stroke.js';
import { strokePoints } from '../src/drawing.js';

const samples = [{ x: 100, y: 100, size: 30, t: 0 }, { x: 200, y: 150, size: 50, t: 100 }, { x: 300, y: 100, size: 30, t: 200 }];
const clip = { mode: 'trail', shape: 'circle', duration: 200, samples };

test('GPU geometry cache survives color, fade, timing and visibility edits, but detects actual shape changes', () => {
  assert.ok(sameGeometry(clip, { ...clip, color: '#ff0000', fadeMs: 800, start: 100, enabled: false }));
  assert.ok(sameGeometry(clip, structuredClone(clip)), 'A new relay JSON object can reuse unchanged GPU geometry');
  assert.equal(sameGeometry(clip, { ...clip, edgeWidth: 10 }), false);
  assert.equal(sameGeometry(clip, { ...clip, shape: 'rect' }), false);
  assert.equal(sameGeometry(clip, { ...clip, samples: samples.map((p, i) => i === 1 ? { ...p, x: 190 } : p) }), false);
});

test('cropped GPU masks contain all source samples and remain inside the Full HD canvas', () => {
  const bounds = strokeBounds(clip);
  assert.ok(bounds.width < 300 && bounds.height < 150);
  for (const p of samples) { assert.ok(bounds.x <= p.x - p.size / 2); assert.ok(bounds.y <= p.y - p.size / 2); assert.ok(bounds.x + bounds.width >= p.x + p.size / 2); }
  assert.deepEqual(strokeBounds({ samples: [{ x: -100, y: 1200, size: 80 }] }), { x: 0, y: 1079, width: 1, height: 1 });
  const rotated = strokeBounds({ shape: 'rect', samples: [{ x: 960, y: 540, size: 20, width: 300, height: 200 }] });
  assert.ok(rotated.width >= Math.hypot(300, 200));
});

test('incremental GPU stamp scheduling follows dense source segments and rebuilds correctly on rewind', () => {
  const stamps = [], cursor = new StampCursor(samples);
  cursor.advance(200, (p, t) => stamps.push({ ...p, t }));
  const expected = [samples[0]];
  for (let i = 1; i < samples.length; i++) {
    const points = strokePoints(samples[i - 1], samples[i]);
    points.forEach((p, n) => expected.push({ ...p, t: samples[i - 1].t + (samples[i].t - samples[i - 1].t) * (n + 1) / points.length }));
  }
  assert.deepEqual(stamps, expected);
  let newStamps = 0; cursor.advance(200, () => newStamps++); assert.equal(newStamps, 0);
  assert.equal(cursor.advance(50, () => newStamps++), true); assert.ok(newStamps > 0);
});

test('live GPU input appends incremental packets, ignores stale data, and clears without raster buffers', () => {
  const live = new LiveStroke(), frame = { id: 'stroke', from: 0, mode: 'trail', color: '#0d99ff', targets: [0], samples: [samples[0]], head: samples[0], elapsed: 10 };
  live.update(frame, 100); live.update({ ...frame, from: 1, samples: [samples[1]], elapsed: 100 }, 200);
  assert.equal(live.count, 2); assert.equal(live.samples.length, 2); assert.equal(live.time(220), 120);
  live.update({ ...frame, elapsed: 5 }, 230); assert.equal(live.count, 2);
  assert.equal(live.field, undefined); live.update(null, 240); assert.equal(live.id, null);
});
