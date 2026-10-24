import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { colorAtTime } from '../src/color.js';
import { CachedGesture, trimGesture } from '../src/loop.js';
import { RGBAScene } from '../src/rgba.js';
import { editLayer, resolveLayer } from '../src/layers.js';
import { renderSignature } from '../src/geometry.js';
import { normalizeProject, serializeProject, parseProject } from '../src/project.js';
import { EditHistory } from '../src/history.js';

const clip = (extra = {}) => ({
  id: 'gradient', mode: 'return', color: '#ff0000', colorEditMode: 'gradient',
  colorGradient: { to: '#0000ff', startMs: 250, endMs: 750 },
  enabled: true, targets: [0, 1], start: 0, duration: 1000, fadeMs: 1000,
  samples: [{ x: 100, y: 100, size: 100, t: 0 }, { x: 100, y: 100, size: 100, t: 1000 }], ...extra,
});
const project = value => ({ version: 1, duration: 4000, clips: [value] });
const pixel = (data, x = 100, y = 100) => Array.from(data.slice((y * CANVAS_WIDTH + x) * 4, (y * CANVAS_WIDTH + x) * 4 + 4));
function equalPixels(a, b) {
  let differences = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differences++;
  assert.equal(differences, 0, 'Geometry, alpha and paint colors must match');
}

test('temporal gradients hold A/B outside the transition and interpolate RGB inside it', () => {
  const value = clip();
  for (const time of [-100, 0, 250]) assert.equal(colorAtTime(value, time), '#ff0000');
  assert.equal(colorAtTime(value, 500), '#800080');
  for (const time of [750, 1000, 4000]) assert.equal(colorAtTime(value, time), '#0000ff');
  assert.equal(colorAtTime({ ...value, colorEditMode: 'color' }, 500), '#ff0000');
  assert.equal(colorAtTime({ ...value, colorEditMode: 'lightness' }, 500), '#ff0000');
  assert.equal(colorAtTime(clip({ color: '#000000', colorGradient: { to: '#ffffff', startMs: 0, endMs: 1000 } }), 500), '#808080');
});

test('all modes and both shapes animate fill without changing geometry or fades', () => {
  for (const mode of ['trail', 'return', 'move', 'place']) for (const shape of ['circle', 'rect']) {
    const source = clip({ mode, shape, edgeColor: '#ff0000', edgeWidth: 5,
      ...(mode === 'place' ? { duration: 0, fadeInMs: 0, holdMs: 1000, fadeOutMs: 1000, samples: [{ x: 100, y: 100, size: 100, width: 100, height: 60, t: 0 }] } : {}),
    });
    const scene = new RGBAScene(project(source));
    for (const phase of [0, 500, 900, 1500, 300]) {
      const actual = scene.draw(0, phase);
      const expected = new RGBAScene(project({ ...source, colorEditMode: 'color', color: colorAtTime(source, phase) })).draw(0, phase);
      equalPixels(actual, expected);
      if (phase === 500) { assert.deepEqual(pixel(actual), [128, 0, 128, 255]); assert.deepEqual(pixel(actual, 148), [128, 0, 128, 255]); }
    }
  }
});

test('the entire footprint follows the animated fill, including black and tiny shapes', () => {
  for (const mode of ['trail', 'return', 'move']) {
    const scene = new RGBAScene(project(clip({ mode, colorGradient: { to: '#000000', startMs: 0, endMs: 1000 } })));
    assert.deepEqual(pixel(scene.draw(0, 500)), [128, 0, 0, 255]);
    assert.deepEqual(pixel(scene.draw(0, 500), 148), [128, 0, 0, 255]);
    assert.deepEqual(pixel(scene.draw(0, 1000)), [0, 0, 0, 255]);
    const tiny = new RGBAScene(project(clip({ mode, samples: [{ x: 100, y: 100, size: 4, t: 0 }, { x: 100, y: 100, size: 4, t: 1000 }] })));
    assert.deepEqual(pixel(tiny.draw(0, 500)), [128, 0, 128, 255]);
  }
});

test('cached paths recolor the entire trail while scrubbing and accept B edits on a paused frame', () => {
  for (const mode of ['trail', 'return']) {
    const value = clip({ mode, edgeColor: '#ff0000', samples: [{ x: 60, y: 100, size: 40, t: 0 }, { x: 180, y: 100, size: 40, t: 1000 }] });
    const gesture = new CachedGesture(value);
    for (const time of [0, 500, 900, 1500, 300, 500]) equalPixels(gesture.render(time), new CachedGesture(value).render(time));
    gesture.clip = { ...value, colorGradient: { ...value.colorGradient, to: '#00ff00' } };
    const recolored = gesture.render(500);
    assert.deepEqual(pixel(recolored, 120).slice(0, 3), [128, 128, 0]);
    assert.deepEqual(pixel(recolored, 120, 118).slice(0, 3), [128, 128, 0]);
    assert.equal(renderSignature(value), renderSignature(gesture.clip), 'B edits reuse the geometry cache');
    assert.notEqual(renderSignature(value), renderSignature({ ...value, colorEditMode: 'color' }));
  }
});

test('eye-specific gradients survive JSON and history and retain source timing across trim/loop seams', () => {
  const original = clip({ start: 3500, colorGradient: { to: '#0000ff', startMs: 0, endMs: 1000 } });
  const right = editLayer(original, '1', value => ({ ...value, colorGradient: { ...value.colorGradient, to: '#00ff00' } }));
  const state = normalizeProject(project(right)), h = new EditHistory(); h.reset(normalizeProject(project(original))); h.record(state);
  assert.equal(resolveLayer(h.undo().clips[0], 1).colorGradient.to, '#0000ff');
  assert.equal(resolveLayer(h.redo().clips[0], 1).colorGradient.to, '#00ff00');
  const restored = parseProject(serializeProject(state, { playing: false, phase: 0 })).project;
  assert.deepEqual(restored, state);
  const scene = new RGBAScene(restored);
  assert.deepEqual(pixel(scene.draw(0, 0)), [128, 0, 128, 255]);
  assert.deepEqual(pixel(scene.draw(1, 0)), [128, 128, 0, 255]);
  const trimmed = new RGBAScene(project(trimGesture(right, 'in', 400, 4000)));
  for (const side of [0, 1]) equalPixels(trimmed.draw(side, 0), scene.draw(side, 0));
});

test('gradients feed pigment mixing and reject malformed imported settings, including eye overrides', () => {
  const below = { ...clip(), id: 'below', color: '#002185', colorEditMode: 'color' };
  const top = clip({ blendMode: 'analog', color: '#fcd200', colorGradient: { to: '#00ffff', startMs: 0, endMs: 1000 } });
  const animated = new RGBAScene({ duration: 4000, clips: [below, top] });
  const expected = new RGBAScene({ duration: 4000, clips: [below, { ...top, colorEditMode: 'color', color: colorAtTime(top, 500) }] });
  equalPixels(animated.draw(0, 500), expected.draw(0, 500));
  const valid = clip().colorGradient;
  for (const colorGradient of [null, [], {}, { ...valid, to: 'bad' }, { ...valid, startMs: -1 }, { ...valid, startMs: NaN }, { ...valid, endMs: Infinity }, { ...valid, endMs: 250 }, { ...valid, endMs: 100 }]) {
    assert.throws(() => normalizeProject(project(clip({ colorGradient }))));
    assert.throws(() => normalizeProject(project(clip({ eyeOverrides: { 1: { colorGradient } } }))));
  }
  assert.throws(() => normalizeProject(project(clip({ colorGradient: undefined }))));
});
