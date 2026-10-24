import test from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import { canvasPoint, visitShape } from '../src/drawing.js';
import { RGBAScene } from '../src/rgba.js';
import { singleCanvasProject, normalizeProject, serializeProject, parseProject } from '../src/project.js';
import { editLayer } from '../src/layers.js';

const clip = (id, targets = [0]) => ({ id, targets, mode: 'place', color: '#0d99ff', duration: 0, start: 0, enabled: true, fadeInMs: 0, holdMs: 1000, fadeOutMs: 0, samples: [{ x: 1850, y: 1000, size: 40, t: 0 }] });
const project = clips => ({ version: 1, clips, duration: 10000 });
const pixel = (data, x, y) => [...data.slice((y * CANVAS_WIDTH + x) * 4, (y * CANVAS_WIDTH + x) * 4 + 4)];

test('responsive 16:9 input maps the center and every canvas corner to Full HD', () => {
  const rect = { left: 100, top: 50, width: 960, height: 540 };
  assert.deepEqual(canvasPoint({ clientX: 580, clientY: 320 }, rect), { x: 960, y: 540 });
  assert.deepEqual(canvasPoint({ clientX: 100, clientY: 50 }, rect), { x: 0, y: 0 });
  assert.deepEqual(canvasPoint({ clientX: 1060, clientY: 590 }, rect), { x: 1920, y: 1080 });
});

test('4K rasterization paints the lower right area and clips at the rectangular bounds', () => {
  const pixels = new RGBAScene(project([clip('native')])).draw(0, 100);
  assert.equal(pixels.length, CANVAS_WIDTH * CANVAS_HEIGHT * 4);
  assert.deepEqual(pixel(pixels, 1850, 1000), [13, 153, 255, 255]);
  assert.deepEqual(pixel(pixels, 1000, 1000), [0, 0, 0, 0]);
  const spans = [];
  visitShape({ x: 3839, y: 2159, size: 40 }, (start, end) => spans.push([start, end]));
  assert.ok(spans.length > 0);
  assert.ok(spans.every(([start, end]) => start >= 0 && end <= CANVAS_WIDTH * CANVAS_HEIGHT && Math.floor(start / CANVAS_WIDTH) === Math.floor((end - 1) / CANVAS_WIDTH)));
});

test('legacy left, right and shared layers all reach the single output without duplicating shared paint', () => {
  const legacy = singleCanvasProject({ ...project([clip('left', [0]), clip('right', [1]), clip('both', [0, 1])]), settings: { active: 1, sync: true, p5Target: 'both' } });
  assert.equal(legacy.clips.length, 3);
  assert.ok(legacy.clips.every(item => item.targets.length === 1 && item.targets[0] === 0));
  assert.equal(legacy.settings.active, 0); assert.equal(legacy.settings.sync, false); assert.equal(legacy.settings.p5Target, 'left');
  assert.deepEqual(legacy.canvas, { width: 3840, height: 2160 });
  assert.deepEqual(singleCanvasProject(legacy), legacy);
});

test('imported side-specific colors become independent editable layers and use the new project identity', () => {
  const original = editLayer(clip('both', [0, 1]), '1', item => ({ ...item, color: '#ff0000' }));
  const legacyText = JSON.stringify({ format: 'imagraph-project', version: 1, project: project([original]) });
  const converted = singleCanvasProject(parseProject(legacyText).project);
  assert.equal(converted.clips.length, 2);
  assert.deepEqual(converted.clips.map(item => item.color), ['#0d99ff', '#ff0000']);
  const saved = serializeProject(converted, { playing: false, phase: 0 });
  assert.equal(JSON.parse(saved).format, 'direct-painting-project');
  assert.deepEqual(parseProject(saved).project, normalizeProject(converted));
});

test('inactive UHD gesture rasters are released and rebuild identically when seeking back', () => {
  const moving = { ...clip('trail'), mode: 'trail', duration: 100, samples: [{ x: 1850, y: 1000, size: 40, t: 0 }, { x: 1860, y: 1000, size: 40, t: 100 }] };
  const scene = new RGBAScene(project([moving])), gesture = scene.items[0].gesture;
  assert.equal(gesture.field, undefined);
  const before = pixel(scene.draw(0, 200), 1850, 1000);
  assert.ok(gesture.field);
  scene.draw(0, 8000); assert.equal(gesture.field, null);
  assert.deepEqual(pixel(scene.draw(0, 200), 1850, 1000), before);
});


test('paint and JSON retain marks near the far 4K edge', () => {
  const far = { ...clip('far'), samples: [{ x: 3780, y: 2100, size: 80, t: 0 }] };
  const saved = parseProject(serializeProject({ ...project([far]), settings: { view: { scale: .5, x: 0, y: 0 } } }, { playing: false, phase: 100 })).project;
  assert.deepEqual(saved.canvas, { width: 3840, height: 2160 });
  const data = new RGBAScene(saved).draw(0, 100);
  assert.deepEqual(pixel(data, 3780, 2100), [13, 153, 255, 255]);
  assert.deepEqual(pixel(data, 1850, 1000), [0, 0, 0, 0]);
});
