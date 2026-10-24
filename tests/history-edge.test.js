import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EditHistory } from '../src/history.js';
import { RGBAScene } from '../src/rgba.js';
import { LoopClock, DEFAULT_LOOP_MS } from '../src/loop.js';
import { DEFAULT_EDGE_WIDTH, edgeWidth, visitPaint, visitShape } from '../src/drawing.js';
import { renderSignature } from '../src/geometry.js';
import { normalizeProject, serializeProject, parseProject } from '../src/project.js';
import { editLayer, resolveLayer } from '../src/layers.js';
const fixture = (extra = {}) => ({ version: 1, duration: 10000, settings: {}, clips: [{ id: 'one', mode: 'place', shape: 'circle', color: '#0000ff', edgeColor: '#ff0000', edgeWidth: 6, enabled: true, targets: [0, 1], start: 0, duration: 0, fadeInMs: 0, holdMs: 1000, fadeOutMs: 1000, fadeMs: 2000, samples: [{ x: 100, y: 100, size: 100, t: 0 }], ...extra }] });
const pixel = (data, x = 100, y = 100) => Array.from(data.slice((y * CANVAS_WIDTH + x) * 4, (y * CANVAS_WIDTH + x) * 4 + 4));

test('history restores immutable drawing, settings, deleted layers and imports with redo branching', () => {
  const h = new EditHistory(), initial = fixture(); h.reset(initial);
  const edited = structuredClone(initial); edited.clips[0].color = '#00ff00'; h.record(edited);
  edited.clips = []; h.record(edited);
  assert.equal(h.undo().clips.length, 1); assert.equal(h.undo().clips[0].color, '#0000ff'); assert.equal(h.canUndo, false);
  assert.equal(h.redo().clips[0].color, '#00ff00');
  h.record({ ...fixture(), settings: { shape: 'rect' }, duration: 12000 }); assert.equal(h.canRedo, false);
  assert.equal(h.undo().clips[0].color, '#00ff00'); assert.equal(h.redo().duration, 12000);
});

test('one continuous input produces one undo step; selections do not consume history', () => {
  const h = new EditHistory(), source = fixture(); h.reset(source);
  assert.equal(h.record({ ...source, settings: { active: 1 }, clips: source.clips.map(c => ({ ...c, editScope: '0' })) }), false);
  const control = {};
  for (let width = 7; width <= 12; width++) h.record(fixture({ edgeWidth: width }), control);
  assert.equal(h.past.length, 1); assert.equal(h.undo().clips[0].edgeWidth, 6); assert.equal(h.redo().clips[0].edgeWidth, 12);
  h.endGroup(); h.record(fixture({ edgeWidth: 16 }), control); assert.equal(h.undo().clips[0].edgeWidth, 12);
  assert.equal(h.redo().clips[0].edgeWidth, 16);
});

test('history limits prevent unbounded source-data accumulation', () => {
  const h = new EditHistory({ limit: 3, maxBytes: 2048 }); h.reset({ text: 'a'.repeat(80) });
  for (let i = 0; i < 20; i++) h.record({ text: String(i).repeat(80) });
  assert.ok(h.past.length <= 3); assert.ok(h.past.length > 0);
  const cost = entry => (entry.data.length + entry.signature.length) * 2;
  assert.ok([...h.past, h.current, ...h.future].reduce((sum, item) => sum + cost(item), 0) <= 2048);
});

test('edge paint partitions circles and rotated rectangles without changing their footprint or alpha', () => {
  for (const point of [{ x: 100, y: 100, size: 100 }, { x: 2, y: 3, size: 45 }, { shape: 'rect', x: 100, y: 100, size: 40, width: 100, height: 50, angle: 35 }]) {
    const expected = new Set(), visits = new Map();
    visitShape(point, (start, end) => { for (let i = start; i < end; i++) expected.add(i); });
    visitPaint(point, '#0000ff', { edgeColor: '#ff0000', edgeWidth: 6 }, (start, end, color) => { for (let i = start; i < end; i++) { assert.equal(visits.has(i), false, 'An edge must not blend over the same fill pixel'); visits.set(i, color); } });
    assert.equal(visits.size, expected.size); assert.ok([...visits.keys()].every(i => expected.has(i))); assert.ok([...visits.values()].includes('#ff0000'));
  }
});

test('edge colors replay and fade in all four modes and support rotated rectangles', () => {
  for (const mode of ['trail', 'return', 'move', 'place']) {
    const project = fixture({ mode }), renderer = new RGBAScene(project);
    assert.deepEqual(pixel(renderer.draw(0, 0)), [0, 0, 255, 255]); assert.deepEqual(pixel(renderer.draw(0, 0), 148, 100), [255, 0, 0, 255]);
    const phase = mode === 'trail' ? 900 : mode === 'place' ? 1500 : 1000;
    assert.deepEqual(pixel(renderer.draw(0, phase)), [0, 0, 255, 64]); assert.deepEqual(pixel(renderer.draw(0, phase), 148, 100), [255, 0, 0, 64]);
  }
  const renderer = new RGBAScene(fixture({ shape: 'rect', angle: 90, samples: [{ shape: 'rect', x: 100, y: 100, size: 100, width: 100, height: 50, t: 0 }] }));
  assert.deepEqual(pixel(renderer.draw(0, 0), 100, 148), [255, 0, 0, 255]); assert.deepEqual(pixel(renderer.draw(0, 0), 100, 130), [0, 0, 255, 255]);
  assert.deepEqual(pixel(new RGBAScene(fixture({ edgeWidth: 0 })).draw(0, 0), 148, 100), [255, 0, 0, 255]);
  assert.deepEqual(pixel(new RGBAScene(fixture({ edgeWidth: 32, samples: [{ x: 100, y: 100, size: 10, t: 0 }] })).draw(0, 0)), [255, 0, 0, 255]);
});

test('edges stay enabled at five pixels for new and legacy unset/off layers', () => {
  assert.equal(DEFAULT_EDGE_WIDTH, 5);
  for (const width of [undefined, 0, 5]) {
    assert.equal(edgeWidth(width), 5);
    const renderer = new RGBAScene(fixture({ edgeWidth: width }));
    assert.deepEqual(pixel(renderer.draw(0, 0), 148, 100), [255, 0, 0, 255]);
    assert.deepEqual(pixel(renderer.draw(0, 0), 144, 100), [0, 0, 255, 255]);
  }
  assert.equal(edgeWidth(12), 12);
});

test('scoped edge color changes survive JSON, invalidate cached geometry and reach L/R independently', () => {
  const source = fixture(); source.clips[0] = editLayer(source.clips[0], '1', clip => ({ ...clip, edgeColor: '#00ff00', edgeWidth: 10 }));
  const restored = parseProject(serializeProject(source, { playing: false, phase: 0 })).project;
  const scene = new RGBAScene(restored);
  assert.deepEqual(pixel(scene.draw(0, 0), 148, 100), [255, 0, 0, 255]); assert.deepEqual(pixel(scene.draw(1, 0), 148, 100), [0, 255, 0, 255]);
  const left = resolveLayer(restored.clips[0], 0), right = resolveLayer(restored.clips[0], 1);
  assert.notEqual(renderSignature(left), renderSignature(right));
  for (const patch of [{ edgeColor: 'bad' }, { edgeWidth: -1 }, { edgeWidth: 33 }, { edgeWidth: .5 }, { eyeOverrides: { 1: { edgeColor: 'bad' } } }]) assert.throws(() => normalizeProject(fixture(patch)));
});

test('new timelines default to ten seconds and explicit project lengths remain editable', () => {
  assert.equal(DEFAULT_LOOP_MS, 10000); assert.equal(new LoopClock().duration, 10000);
  assert.equal(normalizeProject({ version: 1, clips: [] }).duration, 10000);
  assert.equal(normalizeProject({ version: 1, duration: 6000, clips: [] }).duration, 6000);
  assert.equal(normalizeProject({ version: 1, clips: [], settings: { followDirection: true } }).settings.followDirection, false);
});
