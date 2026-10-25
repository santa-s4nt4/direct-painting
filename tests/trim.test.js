import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CachedGesture, gestureTime, gestureVisible, gestureLength, playbackLength, minimumLoop, trimRange, trimGesture, resetGestureTrim, fitGestureTrim, validateProject } from '../src/loop.js';
import { RGBAScene } from '../src/rgba.js';
import { editLayer, resolveLayer } from '../src/layers.js';
import { serializeProject, parseProject } from '../src/project.js';
const source = (extra = {}) => ({ id: 'moving', mode: 'return', color: '#ff0000', enabled: true, targets: [0, 1], start: 2000, duration: 1000, fadeMs: 1000, samples: [{ x: 40, y: 100, size: 20, pressure: .2, t: 0 }, { x: 140, y: 100, size: 40, pressure: .8, t: 1000 }], ...extra });
const project = clips => ({ version: 1, duration: 10000, clips });
const pixel = (data, x, y = 100) => Array.from(data.slice((y * CANVAS_WIDTH + x) * 4, (y * CANVAS_WIDTH + x) * 4 + 4));

test('IN and OUT trim non-destructively while keeping retained frames at their loop times', () => {
  const original = source(), samples = structuredClone(original.samples);
  let edited = trimGesture(original, 'in', 400); edited = trimGesture(edited, 'out', 1300);
  assert.deepEqual(trimRange(edited), { in: 400, out: 1300 }); assert.equal(edited.start, 2400); assert.equal(playbackLength(edited), 900); assert.equal(gestureLength(edited), 2000);
  assert.equal(edited.samples, original.samples); assert.deepEqual(original.samples, samples);
  assert.equal(gestureVisible(edited, 2399, 10000), false); assert.equal(gestureTime(edited, 2400, 10000), 400); assert.equal(gestureVisible(edited, 3299, 10000), true); assert.equal(gestureVisible(edited, 3300, 10000), false);
  assert.equal(gestureTime(edited, 2800, 10000), gestureTime(original, 2800, 10000));
  const restored = resetGestureTrim(edited); assert.equal(restored.start, 2000); assert.deepEqual(trimRange(restored), { in: 0, out: 2000 }); assert.equal(restored.samples, original.samples);
});

test('trim playback remains aligned across the loop seam and when shortening the global loop', () => {
  const edited = trimGesture(trimGesture(source({ start: 9700 }), 'in', 500, 10000), 'out', 1400, 10000);
  assert.equal(edited.start, 200); assert.equal(gestureTime(edited, 400, 10000), 700); assert.equal(gestureVisible(edited, 150, 10000), false); assert.equal(gestureVisible(edited, 1099, 10000), true); assert.equal(gestureVisible(edited, 1100, 10000), false);
  assert.equal(minimumLoop([edited]), 1000);
  assert.equal(gestureTime(edited, 400, 1000), 700); assert.equal(gestureVisible(edited, 150, 1000), false);
  const relocated = { ...edited, start: 0 }; assert.equal(resetGestureTrim(relocated, 1000).start, 500);
});

test('trimmed TRAIL/RETURN retain prior source frames and MOVE keeps its recorded easing', () => {
  for (const mode of ['trail', 'return', 'move']) {
    const original = source({ mode }), trimmed = trimGesture(trimGesture(original, 'in', 500), 'out', 1200);
    const scene = new RGBAScene(project([trimmed]));
    assert.deepEqual(pixel(scene.draw(0, 2499), 90), [0, 0, 0, 0]);
    const actual = scene.draw(0, 2800).slice(), expected = new RGBAScene(project([original])).draw(0, 2800);
    let differences = 0; for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) differences++; assert.equal(differences, 0);
    assert.deepEqual(pixel(scene.draw(0, 3200), 120), [0, 0, 0, 0]);
    const cached = new CachedGesture(trimmed); assert.ok(cached.render(500));
  }
});

test('PLACE trims its fade-in, hold and fade-out as one source without changing its size', () => {
  const placed = source({ mode: 'place', duration: 0, fadeInMs: 400, holdMs: 600, fadeOutMs: 1000, samples: [{ x: 100, y: 100, size: 40, t: 0 }] });
  const edited = trimGesture(trimGesture(placed, 'in', 200), 'out', 1500), scene = new RGBAScene(project([edited]));
  assert.deepEqual(pixel(scene.draw(0, 2200), 100), [255, 0, 0, 64]); assert.deepEqual(pixel(scene.draw(0, 3000), 100), [255, 0, 0, 255]); assert.deepEqual(pixel(scene.draw(0, 3500), 100), [0, 0, 0, 0]);
});

test('bounds clamp to recorded source and fade edits keep the trim range valid', () => {
  let trimmed = trimGesture(source(), 'in', 9999); assert.equal(trimmed.trimIn, 1950);
  trimmed = trimGesture(trimmed, 'out', -100); assert.equal(trimRange(trimmed).out, 2000);
  assert.equal(trimGesture(source(), 'out', 99999).trimOut, 2000);
  const shorter = fitGestureTrim({ ...trimmed, fadeMs: 100 }); assert.ok(shorter.trimIn < shorter.trimOut); assert.equal(shorter.trimOut, 1100); assert.doesNotThrow(() => validateProject(project([shorter])));
  const reset = resetGestureTrim(trimmed); assert.equal(trimRange({ ...reset, fadeMs: 3000 }).out, 4000);
});

test('L/R trim edits and resets survive JSON without deleting shared source samples', () => {
  const original = source(); let shared = editLayer(original, '1', clip => trimGesture(clip, 'in', 500)); shared = editLayer(shared, '1', clip => trimGesture(clip, 'out', 1500));
  const restored = parseProject(serializeProject(project([shared]), { playing: false, phase: 2500 })).project.clips[0];
  assert.equal(resolveLayer(restored, 0).start, 2000); assert.equal(resolveLayer(restored, 1).start, 2500); assert.equal(playbackLength(resolveLayer(restored, 1)), 1000);
  const renderer = new RGBAScene(project([restored])); assert.ok(pixel(renderer.draw(0, 2200), 60)[3]); assert.deepEqual(pixel(renderer.draw(1, 2200), 60), [0, 0, 0, 0]);
  const resetRight = editLayer(restored, '1', clip => resetGestureTrim(clip)); assert.deepEqual(trimRange(resolveLayer(resetRight, 1)), { in: 0, out: 2000 });
  assert.equal(resolveLayer(resetRight, 1).start, 2000); assert.deepEqual(resolveLayer(resetRight, 1).samples, original.samples);
  const trimmedBoth = trimGesture(original, 'in', 300); const resetOverride = editLayer(trimmedBoth, '1', clip => resetGestureTrim(clip)); assert.equal(resolveLayer(resetOverride, 0).trimIn, 300); assert.equal(resolveLayer(resetOverride, 1).trimIn, 0); assert.equal(resolveLayer(resetOverride, 1).trimOut, null);
});

test('imports reject corrupt trim metadata before replacing an editable project', () => {
  for (const patch of [{ trimIn: -1 }, { trimIn: NaN }, { trimOut: Infinity }, { trimIn: 500, trimOut: 500 }, { trimOut: 2001 }, { trimIn: 2000 }, { eyeOverrides: { 1: { trimOut: -1 } } }]) assert.throws(() => validateProject(project([source(patch)])));
  assert.doesNotThrow(() => validateProject(project([source({ trimIn: 0, trimOut: null })])));
});
