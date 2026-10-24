import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VIEW, PinchGesture, zoomAt, screenToWorld, worldToScreen, validateView } from '../src/view.js';
import { hsvToHex, hexToHSV, wheelColor } from '../src/color-panel.js';
import { MAX_BRUSH_SIZE } from '../src/canvas.js';
import { strokePoints, visitShape } from '../src/drawing.js';
import { normalizeProject, serializeProject, parseProject } from '../src/project.js';
import { validateLive } from '../server/loop-relay.js';

test('two-finger pinch keeps its anchor, pans with the midpoint and reserves the remaining finger', () => {
  const pinch = new PinchGesture();
  assert.equal(pinch.down(1, { x: 400, y: 300 }, DEFAULT_VIEW), false);
  assert.equal(pinch.down(2, { x: 600, y: 300 }, DEFAULT_VIEW), true);
  const zoomed = pinch.move(2, { x: 800, y: 300 });
  assert.deepEqual(zoomed, { scale: 2, x: -400, y: -300 });
  assert.deepEqual(worldToScreen({ x: 500, y: 300 }, zoomed), { x: 600, y: 300 });
  assert.deepEqual(screenToWorld({ x: 600, y: 300 }, zoomed), { x: 500, y: 300 });
  assert.equal(pinch.up(1), true); assert.equal(pinch.blocked, true);
  assert.equal(pinch.move(2, { x: 900, y: 300 }), null);
  assert.equal(pinch.up(2), true); assert.equal(pinch.blocked, false);
  pinch.down(1, { x: 400, y: 300 }, DEFAULT_VIEW); pinch.down(2, { x: 600, y: 300 }, DEFAULT_VIEW);
  assert.deepEqual(pinch.move(2, { x: 500, y: 300 }), { scale: .5, x: 200, y: 150 });
});

test('zoom limits and reset remain valid and preserve drawing coordinates', () => {
  assert.equal(zoomAt(DEFAULT_VIEW, 100, { x: 960, y: 540 }).scale, 8);
  assert.equal(zoomAt(DEFAULT_VIEW, .001, { x: 960, y: 540 }).scale, .1);
  for (const view of [null, {}, { scale: 0, x: 0, y: 0 }, { scale: 1, x: Infinity, y: 0 }, { scale: 2, x: 999999, y: 0 }]) assert.throws(() => validateView(view));
  assert.deepEqual(screenToWorld({ x: 200, y: 300 }, DEFAULT_VIEW), { x: 200, y: 300 });
});

test('color wheel, brightness and HSV conversions reproduce primary colors and hex round trips', () => {
  assert.equal(hsvToHex(0, 1, 1), '#ff0000'); assert.equal(hsvToHex(120, 1, 1), '#00ff00'); assert.equal(hsvToHex(240, 1, 1), '#0000ff');
  assert.equal(hsvToHex(360, 1, 1), '#ff0000'); assert.equal(hsvToHex(180, 0, 1), '#ffffff'); assert.equal(hsvToHex(120, 1, 0), '#000000');
  for (const hex of ['#e731a0', '#111111', '#ff8800', '#2222ff']) { const { h, s, v } = hexToHSV(hex); assert.equal(hsvToHex(h, s, v), hex); }
  assert.deepEqual(wheelColor(0, 0, 1), { h: 0, s: 0 }); assert.equal(wheelColor(10, 0, 1).s, 1);
});

test('3000px sizes, brush Blur, opacity and output view survive files and live relay validation', () => {
  assert.equal(MAX_BRUSH_SIZE, 3000);
  const sample = { x: 960, y: 540, size: 3000, shape: 'rect', width: 3000, height: 3000, angle: 45, t: 0 };
  const clip = { id: 'large', color: '#ff0000', opacity: .4, mode: 'move', shape: 'rect', enabled: true, targets: [0], duration: 100, samples: [sample, { ...sample, t: 100 }] };
  const project = normalizeProject({ version: 1, duration: 10000, clips: [clip], settings: { maxSize: 3000, widthMax: 3000, heightMax: 3000, opacity: .25, effects: { blur: false, blurRadius: 16 }, view: { scale: 2, x: -400, y: -300 }, colorPanelVisible: false } });
  assert.deepEqual(parseProject(serializeProject(project, { playing: false, phase: 0 })).project, project);
  const packet = { session: 'test', revision: 1, id: 'large', mode: 'move', color: '#ffffff', opacity: .25, from: 0, targets: [0], elapsed: 100, samples: [sample], head: { ...sample, t: 100 } };
  assert.equal(validateLive(packet).samples[0].size, 3000); assert.equal(validateLive(packet).opacity, .25);
  assert.throws(() => validateLive({ ...packet, opacity: 2 })); assert.throws(() => validateLive({ ...packet, samples: [{ ...sample, size: 3001 }] }));
  assert.throws(() => normalizeProject({ ...project, settings: { maxSize: 3001 } }));
  let pixels = 0; visitShape({ x: 960, y: 540, size: 3000 }, (a, b) => pixels += b - a); assert.equal(pixels, 1920 * 1080);
  const points = strokePoints({ x: 100, y: 100, size: 3000 }, { x: 1000, y: 100, size: 3000 });
  assert.ok(points.length < 100, 'Large brushes avoid thousands of overlapping stamps'); assert.equal(points.at(-1).x, 1000);
});
