import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { visitShape, strokePoints, angleDelta } from '../src/drawing.js';
import { dimensionRange, resizeDimension, prepareShapeClip } from '../src/geometry.js';
import { editLayer, resolveLayer, layerVariants, moveLayer, removeLayerSides } from '../src/layers.js';
import { CachedGesture, gestureLength, gestureOpacity, minimumLoop, validateProject } from '../src/loop.js';
import { RGBAScene } from '../src/rgba.js';
import { serializeProject, parseProject } from '../src/project.js';
import { validateLive } from '../server/loop-relay.js';
import { LiveDrawing } from '../src/live.js';

const clip = (extra = {}) => ({ id: 'one', mode: 'return', color: '#ff0000', targets: [0, 1], enabled: true, duration: 100, start: 0, samples: [{ x: 100, y: 100, size: 20, t: 0 }, { x: 120, y: 100, size: 60, t: 100 }], ...extra });
const project = clips => ({ version: 1, duration: 6000, clips });
const pixel = (data, x = 100, y = 100) => Array.from(data.slice((y * CANVAS_WIDTH + x) * 4, (y * CANVAS_WIDTH + x) * 4 + 4));
const covered = point => { const pixels = new Set(); visitShape(point, (start, end) => { for (let i = start; i < end; i++) pixels.add(i); }); return pixels; };

test('rectangle rasterization respects width, height, rotation and clipped canvas edges', () => {
  const point = { shape: 'rect', x: 100, y: 100, size: 20, width: 40, height: 10, angle: 0 };
  const horizontal = covered(point), vertical = covered({ ...point, angle: 90 });
  assert.equal(horizontal.size, 400); assert.equal(vertical.size, 400);
  assert.ok(horizontal.has(100 * CANVAS_WIDTH + 117)); assert.ok(!vertical.has(100 * CANVAS_WIDTH + 117));
  assert.ok(vertical.has(117 * CANVAS_WIDTH + 100)); assert.ok(!horizontal.has(117 * CANVAS_WIDTH + 100));
  const diagonal = covered({ ...point, angle: 45 });
  for (const index of diagonal) { const dx = index % CANVAS_WIDTH + .5 - 100, dy = Math.floor(index / CANVAS_WIDTH) + .5 - 100; assert.ok(Math.abs((dx + dy) / Math.SQRT2) <= 20 + 1e-8 && Math.abs((dy - dx) / Math.SQRT2) <= 5 + 1e-8); }
  assert.ok(Math.abs(diagonal.size - 400) < 40);
  const clipped = covered({ ...point, x: 0, y: 0 }); assert.equal(clipped.size, 100);
  assert.ok([...clipped].every(index => index >= 0 && index < CANVAS_WIDTH * CANVAS_HEIGHT));
});

test('rectangle interpolation takes the shortest angle and covers pressure and rotation changes', () => {
  const from = { shape: 'rect', x: 80, y: 80, size: 10, width: 20, height: 10, angle: 179 };
  const to = { ...from, width: 60, height: 30, angle: -179 };
  const points = strokePoints(from, to);
  assert.ok(points.length >= 40); assert.equal(points.at(-1).width, 60); assert.equal(points.at(-1).height, 30);
  assert.equal(angleDelta(from.angle, points.at(-1).angle), 2); assert.ok(points.every(point => point.x === 80 && point.y === 80));
});

test('recorded rectangle width and height can be independently remapped and expanded after collapsing', () => {
  const source = clip({ shape: 'rect', samples: [{ x: 100, y: 100, t: 0, size: 20, width: 30, height: 10 }, { x: 120, y: 100, t: 100, size: 60, width: 70, height: 30 }] });
  let edited = resizeDimension(source, 'width', 'min', 10); edited = resizeDimension(edited, 'width', 'max', 110);
  assert.deepEqual(dimensionRange(edited, 'width'), { min: 10, max: 110 }); assert.deepEqual(dimensionRange(edited, 'height'), { min: 10, max: 30 });
  edited = resizeDimension(edited, 'width', 'max', 10); edited = resizeDimension(edited, 'width', 'max', 90);
  assert.deepEqual(edited.samples.map(sample => sample.width), [10, 90]);
  assert.deepEqual(edited.samples.map(sample => [sample.x, sample.y, sample.t]), source.samples.map(sample => [sample.x, sample.y, sample.t]));
  const fixed = resizeDimension(clip({ samples: [{ x: 10, y: 10, t: 0, size: 20 }], duration: 0 }), 'height', 'min', 80);
  assert.deepEqual(dimensionRange(fixed, 'height'), { min: 80, max: 80 });
});

test('rectangles keep the UI angle in every mode, including old direction-following data', () => {
  for (const mode of ['trail', 'return', 'move', 'place']) {
    const samples = [{ x: 100, y: 100, size: 20, width: 50, height: 10, heading: 90, angle: 120, shape: 'rect', t: 0 }];
    const shape = clip({ mode, shape: 'rect', angle: 0, followDirection: true, duration: 0, samples, fadeInMs: 0 });
    const scene = new RGBAScene(project([shape]));
    assert.equal(pixel(scene.draw(0, 0), 100, 120)[3], 0); assert.equal(pixel(scene.draw(0, 0), 120, 100)[3], 255);
    const rotated = new RGBAScene(project([{ ...shape, angle: 90 }]));
    assert.equal(pixel(rotated.draw(0, 0), 100, 120)[3], 255); assert.equal(pixel(rotated.draw(0, 0), 120, 100)[3], 0);
    const converted = new RGBAScene(project([{ ...shape, shape: 'circle' }]));
    assert.equal(pixel(converted.draw(0, 0), 120, 100)[3], 0);
  }
  const prepared = prepareShapeClip(clip({ shape: 'rect', angle: 30, followDirection: true, samples: [{ x: 1, y: 2, size: 20, t: 0, heading: 45 }] }));
  assert.equal(prepared.samples[0].angle, 30);
});

test('dual-eye layers edit independently while BOTH changes preserve unrelated overrides', () => {
  let source = editLayer(clip(), '0', item => ({ ...item, color: '#00ff00' }));
  source = editLayer(source, '1', item => resizeDimension(item, 'width', 'max', 100));
  assert.equal(resolveLayer(source, 0).color, '#00ff00'); assert.equal(resolveLayer(source, 1).color, '#ff0000');
  source = editLayer(source, 'all', item => ({ ...item, color: '#0000ff' }));
  assert.equal(resolveLayer(source, 0).color, '#0000ff'); assert.equal(resolveLayer(source, 1).color, '#0000ff');
  assert.equal(dimensionRange(resolveLayer(source, 1), 'width').max, 100); assert.equal(dimensionRange(resolveLayer(source, 0), 'width').max, 60);
  assert.ok(!source.eyeOverrides[0]); assert.equal(layerVariants(source).length, 2);
  const rightOnly = removeLayerSides(source, [0]); assert.deepEqual(rightOnly.targets, [1]); assert.equal(rightOnly.eyeOverrides, undefined);
  assert.equal(dimensionRange(rightOnly, 'width').max, 100); assert.equal(rightOnly.color, '#0000ff');
  const hidden = editLayer(clip(), 'all', item => ({ ...item, enabled: false }));
  const visibleRight = editLayer(hidden, '1', item => ({ ...item, enabled: true, color: '#ffffff' }));
  const retained = removeLayerSides(visibleRight, [0]); assert.equal(retained.enabled, true); assert.equal(retained.color, '#ffffff');
});

test('visibility, stack order, eye overrides and geometry survive editable JSON and RGBA composition', () => {
  const bottom = clip({ color: '#ff0000' }), top = clip({ id: 'two', color: '#0000ff' });
  let layers = [bottom, editLayer(top, '1', item => ({ ...item, enabled: false }))];
  let renderer = new RGBAScene(project(layers));
  assert.deepEqual(pixel(renderer.draw(0, 0)), [0, 0, 255, 255]); assert.deepEqual(pixel(renderer.draw(1, 0)), [255, 0, 0, 255]);
  layers = moveLayer(layers, 'one', 1); renderer = new RGBAScene(project(layers));
  assert.deepEqual(pixel(renderer.draw(0, 0)), [255, 0, 0, 255]); assert.equal(moveLayer(layers, 'one', 1), layers);
  const restored = parseProject(serializeProject(project(layers), { playing: false, phase: 1234 }));
  assert.deepEqual(restored.project.clips, layers); assert.equal(restored.playback.phase, 1234);
  assert.deepEqual(pixel(new RGBAScene(restored.project).draw(1, 0)), [255, 0, 0, 255]);
});

test('PLACE holds one fixed point with independent fade-in, hold and fade-out across a loop seam', () => {
  const placed = clip({ mode: 'place', start: 5500, duration: 0, fadeInMs: 400, holdMs: 800, fadeOutMs: 1000, samples: [{ x: 100, y: 100, size: 60, t: 0 }] });
  assert.equal(gestureLength(placed), 2200); assert.equal(gestureOpacity(placed, 200), .25); assert.equal(gestureOpacity(placed, 900), 1); assert.equal(gestureOpacity(placed, 1700), .25); assert.equal(gestureOpacity(placed, 2200), 0);
  const gesture = new CachedGesture(placed); assert.deepEqual(gesture.render(1900), { x: 100, y: 100, size: 60, t: 1900 });
  const scene = new RGBAScene(project([placed]));
  assert.deepEqual(pixel(scene.draw(0, 5700)), [255, 0, 0, 64]); assert.deepEqual(pixel(scene.draw(0, 400)), [255, 0, 0, 255]); assert.deepEqual(pixel(scene.draw(0, 1700)), [0, 0, 0, 0]);
  const longRight = editLayer(placed, '1', item => ({ ...item, holdMs: 7000 })); assert.equal(minimumLoop([longRight]), 8400);
  const saved = parseProject(serializeProject(project([longRight]), { phase: 5500, playing: false })); assert.equal(resolveLayer(saved.project.clips[0], 1).holdMs, 7000);
});

test('new geometry, placement, settings and scoped edits are validated before import', () => {
  const good = clip({ mode: 'place', duration: 0, shape: 'rect', samples: [{ x: 100, y: 100, size: 20, width: 50, height: 10, t: 0 }] });
  assert.equal(validateProject(project([good])).clips[0].mode, 'place');
  for (const patch of [{ duration: 100 }, { enabled: 'yes' }, { targets: [0, 0] }, { targets: [0], editScope: '1' }, { eyeOverrides: { 1: { enabled: 'no' } } }, { holdMs: -1 }, { fadeInMs: -1 }, { angle: Infinity }, { shape: 'triangle' }, { eyeOverrides: { 2: { color: '#ffffff' } } }, { eyeOverrides: { 0: { samples: [] } } }, { eyeOverrides: { 1: { color: 'invalid' } } }]) assert.throws(() => validateProject(project([{ ...good, ...patch }])));
  for (const settings of [{ widthMin: 120, widthMax: 20 }, { heightMin: 0 }, { followDirection: 'yes' }, { showBlurPreview: 1 }, { shape: 'oval' }, { fadeOutMs: -1 }]) assert.throws(() => parseProject(JSON.stringify({ ...project([good]), settings })));
});

test('live PLACE and rectangle streams keep shape geometry and draw without a moving path', () => {
  const sample = { x: 100, y: 100, size: 20, shape: 'rect', width: 60, height: 10, angle: 90, t: 0 };
  const packet = { session: 'editor', revision: 1, id: 'fixed', mode: 'place', targets: [0, 1], color: '#ffffff', from: 0, elapsed: 100, samples: [sample], head: { ...sample, t: 100 } };
  const valid = validateLive(packet); assert.equal(valid.head.angle, 90); assert.equal(valid.samples[0].width, 60);
  const live = new LiveDrawing(); live.update(valid, 0); assert.equal(live.field, null);
  const rows = [], ctx = { globalAlpha: 1, fillRect: (...row) => rows.push(row) }; live.draw(ctx, 0, 100); assert.equal(rows.length, 60); assert.ok(rows.every(row => row[2] === 10));
  assert.throws(() => validateLive({ ...packet, head: { ...sample, width: 0 } }));
});
