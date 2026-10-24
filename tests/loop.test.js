import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CachedGesture, LoopClock, minimumLoop, gestureTime, gestureVisible, sampleAt, validateProject, layerSizeRange, resizeGesture } from '../src/loop.js';

const samples = [{ x: 40, y: 80, size: 10, t: 0 }, { x: 140, y: 80, size: 30, t: 1000 }, { x: 140, y: 80, size: 30, t: 1200 }];
const clip = mode => ({ id: 'test', samples, duration: 1200, color: '#73c4ba', mode, enabled: true, targets: [0, 1], start: 0 });
const rgba = (data, x, y) => Array.from(data.slice((y * CANVAS_WIDTH + x) * 4, (y * CANVAS_WIDTH + x) * 4 + 4));

test('layer diameter edits preserve relative circle sizes, timing and motion through collapsed ranges', () => {
  for (const mode of ['trail', 'return', 'move']) {
    const source = { ...clip(mode), sizeRange: { min: 10, max: 30 }, samples: samples.map((sample, i) => ({ ...sample, size: 10 + i * 10, pressure: i / 2 })) };
    const snapshot = structuredClone(source);
    const larger = resizeGesture(source, 'max', 110);
    assert.deepEqual(larger.samples.map(sample => sample.size), [10, 60, 110]);
    const collapsed = resizeGesture(larger, 'min', 110);
    assert.deepEqual(collapsed.samples.map(sample => sample.size), [110, 110, 110]);
    const restored = resizeGesture(resizeGesture(collapsed, 'min', 10), 'max', 30);
    assert.deepEqual(restored.samples.map(sample => sample.size), source.samples.map(sample => sample.size));
    assert.deepEqual(restored.samples.map(sample => sample.pressure), source.samples.map(sample => sample.pressure));
    assert.deepEqual(layerSizeRange(restored), { min: 10, max: 30 });
    assert.deepEqual(source, snapshot);
    assert.deepEqual(validateProject({ version: 1, clips: [larger], duration: 6000 }).clips[0], larger);
    if (mode !== 'move') assert.ok(rgba(new CachedGesture(larger).render(1200), 140, 120)[3] > 0);
    else assert.ok(new CachedGesture(larger).render(3000).size > 109);
  }
});

test('old size-only caches preserve relative diameters and fixed circles change their whole diameter', () => {
  const source = { ...clip('return'), samples: samples.map((sample, i) => ({ ...sample, size: 10 + i * 10 })) };
  assert.deepEqual(layerSizeRange(source), { min: 10, max: 30 });
  const changed = resizeGesture(source, 'max', 90);
  assert.deepEqual(changed.samples.map(sample => sample.size), [10, 50, 90]);
  assert.deepEqual(changed.samples.map(sample => sample.diameterPosition), [0, .5, 1]);
  const fixed = { ...source, samples: source.samples.map(sample => ({ ...sample, size: 30 })) };
  assert.ok(resizeGesture(fixed, 'max', 90).samples.every(sample => sample.size === 90));
  assert.deepEqual(layerSizeRange(resizeGesture(fixed, 'max', 90)), { min: 90, max: 90 });
  assert.deepEqual(layerSizeRange(resizeGesture(fixed, 'min', 15)), { min: 15, max: 15 });
  assert.deepEqual(resizeGesture(changed, 'min', 9999).diameterRange, { min: 3000, max: 3000 });
  assert.deepEqual(resizeGesture(changed, 'max', -10).diameterRange, { min: 1, max: 1 });
});

test('actual recorded circle extrema are independent of brush bounds and partial pencil pressure', () => {
  const source = { ...clip('return'), sizeRange: { min: 20, max: 100 }, samples: samples.map((sample, i) => ({ ...sample, size: 40 + i * 20, pressure: .25 + i * .25 })) };
  assert.deepEqual(layerSizeRange(source), { min: 40, max: 80 });
  const changed = resizeGesture(resizeGesture(source, 'max', 120), 'min', 20);
  assert.deepEqual(changed.samples.map(sample => sample.size), [20, 70, 120]);
  assert.deepEqual(layerSizeRange(changed), { min: 20, max: 120 });
  assert.deepEqual(changed.sizeRange, { min: 20, max: 100 });
  assert.deepEqual(changed.samples.map(sample => sample.pressure), [.25, .5, .75]);
  const collapsed = resizeGesture(changed, 'min', 120);
  const reopened = resizeGesture(collapsed, 'min', 20);
  assert.deepEqual(reopened.samples.map(sample => sample.size), [20, 70, 120]);
});

test('layer size metadata and normalized pressure reject malformed stored values', () => {
  const project = changed => ({ version: 1, duration: 6000, clips: [{ ...clip('return'), ...changed }] });
  for (const range of [{ min: 0, max: 30 }, { min: 30, max: 10 }, { min: 10, max: 3001 }, { min: 1.5, max: 30 }]) {
    for (const key of ['sizeRange', 'diameterRange']) assert.throws(() => validateProject(project({ [key]: range })));
  }
  for (const value of [-.1, 1.1, NaN]) {
    for (const key of ['pressure', 'diameterPosition']) assert.throws(() => validateProject(project({ samples: samples.map(sample => ({ ...sample, [key]: value })) })));
  }
});

test('loop clock pauses, resumes, wraps and restarts without losing its position', () => {
  const clock = new LoopClock(100, 6000);
  assert.equal(clock.phase(6600), 500);
  clock.pause(6700); assert.equal(clock.phase(9000), 600);
  clock.play(10000); assert.equal(clock.phase(10100), 700);
  clock.resize(2000, 10200); assert.equal(clock.phase(10200), 800);
  clock.restart(10300); assert.equal(clock.phase(10300), 0);
});
test('cached motion interpolates timing and pressure-derived diameter', () => {
  assert.deepEqual(sampleAt(samples, 500), { x: 90, y: 80, size: 20, t: 500 });
  assert.equal(sampleAt(samples, 1150).x, 140);
  assert.equal(minimumLoop([clip('trail')]), 3000);
});
test('TRAIL replays a continuous fading path, holds its head, then starts a fresh loop', () => {
  const gesture = new CachedGesture(clip('trail'));
  let data = gesture.render(500);
  assert.ok(rgba(data, 75, 80)[3] > 0);
  assert.equal(rgba(data, 120, 80)[3], 0);
  assert.deepEqual(rgba(data, 90, 80), [115, 196, 186, 255]);
  data = gesture.render(1150); assert.deepEqual(rgba(data, 140, 80), [115, 196, 186, 255]);
  data = gesture.render(2100); assert.ok(rgba(data, 140, 80)[3] > 0 && rgba(data, 140, 80)[3] < 255);
  data = gesture.render(3000); assert.equal(rgba(data, 140, 80)[3], 0);
  data = gesture.render(0); assert.deepEqual(rgba(data, 40, 80), [115, 196, 186, 255]);
  assert.equal(rgba(data, 140, 80)[3], 0);
});
test('TRAIL seeking and incremental playback produce the same frame', () => {
  const incremental = new CachedGesture(clip('trail'));
  for (let time = 0; time < 900; time += 50) incremental.render(time);
  const frame = incremental.render(900).slice();
  const direct = new CachedGesture(clip('trail')).render(900);
  // Stamp rounding can move the last visit by one interpolation step (up to 10ms).
  for (let i = 3; i < frame.length; i += 4) assert.ok(Math.abs(frame[i] - direct[i]) <= 4);
});
test('RETURN draws in recorded order, holds opaque pixels, and replays on a new cycle', () => {
  const gesture = new CachedGesture(clip('return'));
  assert.equal(rgba(gesture.render(500), 120, 80)[3], 0);
  assert.deepEqual(rgba(gesture.render(1200), 100, 80), [115, 196, 186, 255]);
  assert.deepEqual(rgba(gesture.render(3000), 100, 80), [115, 196, 186, 255]);
  assert.equal(rgba(gesture.render(0), 100, 80)[3], 0);
});
test('MOVE cache has deterministic easing, no path, and settles at the final point', () => {
  const gesture = new CachedGesture(clip('move'));
  assert.equal(gesture.render(0).x, 40);
  const middle = gesture.render(1050);
  assert.ok(middle.x > 40 && middle.x < 140);
  const end = gesture.render(3000); assert.ok(Math.abs(end.x - 140) < .05);
  gesture.render(0); assert.deepEqual(gesture.render(1050), middle);
});
test('local projects round-trip source gestures and reject corrupt samples', () => {
  const project = { version: 1, clips: [clip('trail')], duration: 6000, settings: { color: '#ffffff' } };
  assert.deepEqual(validateProject(structuredClone(project)), project);
  assert.equal(validateProject({ ...project, duration: 1000 }).duration, 3000);
  assert.throws(() => validateProject({ ...project, clips: [{ ...clip('trail'), color: '<svg>' }] }));
  assert.throws(() => validateProject({ ...project, clips: [{ ...clip('trail'), samples: [{ x: 10, y: 10, size: 3001, t: 0 }] }] }));
});

test('scheduled layers begin at their recorded loop phase instead of time zero', () => {
  const scheduled = { ...clip('trail'), start: 2000 };
  const gesture = new CachedGesture(scheduled);
  assert.equal(rgba(gesture.render(gestureTime(scheduled, 0, 6000)), 40, 80)[3], 0);
  assert.deepEqual(rgba(gesture.render(gestureTime(scheduled, 2000, 6000)), 40, 80), [115, 196, 186, 255]);
  assert.ok(rgba(gesture.render(gestureTime(scheduled, 2500, 6000)), 90, 80)[3] > 0);
  for (const mode of ['move', 'return']) {
    assert.equal(gestureVisible({ ...scheduled, mode }, 1999, 6000), false);
    assert.equal(gestureVisible({ ...scheduled, mode }, 2000, 6000), true);
  }
});
test('late gestures and their fading tails continue across the loop seam', () => {
  const scheduled = { ...clip('trail'), start: 5500 };
  const gesture = new CachedGesture(scheduled);
  const elapsed = gestureTime(scheduled, 400, 6000);
  assert.equal(elapsed, 900);
  assert.ok(rgba(gesture.render(elapsed), 120, 80)[3] > 0);
  assert.equal(gestureTime(scheduled, 2000, 6000), 2500);
  assert.ok(rgba(gesture.render(2500), 140, 80)[3] > 0);
  assert.equal(rgba(gesture.render(gestureTime(scheduled, 3000, 6000)), 140, 80)[3], 0);
  assert.equal(gestureVisible({ ...scheduled, mode: 'move' }, 400, 6000), true);
});
test('seek preserves paused/play state and restores the previous export position', () => {
  const clock = new LoopClock(0, 6000);
  clock.pause(2500); clock.seek(0, 4000); assert.equal(clock.phase(9000), 0);
  clock.seek(2500, 10000); assert.equal(clock.phase(10010), 2500);
  clock.play(10010); assert.equal(clock.phase(10510), 3000);
});
test('old source caches migrate to start zero, while invalid offsets are rejected', () => {
  const old = clip('trail'); delete old.start;
  const project = { version: 1, clips: [old], duration: 6000 };
  assert.equal(validateProject(project).clips[0].start, 0);
  assert.throws(() => validateProject({ ...project, clips: [{ ...old, start: -1 }] }));
  assert.throws(() => validateProject({ ...project, clips: [{ ...old, start: Infinity }] }));
});

test('RETURN and MOVE cache the entire release fade, including complete disappearance', async () => {
  const { gestureOpacity, gestureLength } = await import('../src/loop.js');
  for (const mode of ['return', 'move']) {
    const fading = { ...clip(mode), fadeMs: 2000 };
    assert.equal(gestureOpacity(fading, 1200), 1);
    assert.equal(gestureOpacity(fading, 2200), .25);
    assert.equal(gestureOpacity(fading, 3200), 0);
    assert.equal(gestureLength(fading), 3200); assert.equal(minimumLoop([fading]), 3200);
    const wrapped = { ...fading, start: 5500 };
    assert.equal(gestureVisible(wrapped, 2000, 6000), true);
    assert.equal(gestureVisible(wrapped, 3000, 6000), false);
    assert.ok(Math.abs(gestureOpacity(wrapped, gestureTime(wrapped, 2000, 6000)) - .1225) < 1e-10);
  }
  assert.throws(() => validateProject({ version: 1, duration: 6000, clips: [{ ...clip('move'), fadeMs: -1 }] }));
});
