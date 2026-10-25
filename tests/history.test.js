import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EditHistory } from '../src/history.js';
import { RGBAScene } from '../src/rgba.js';
import { LoopClock, DEFAULT_LOOP_MS } from '../src/loop.js';
import { visitShape } from '../src/drawing.js';
import { renderSignature } from '../src/geometry.js';
import { normalizeProject, serializeProject, parseProject } from '../src/project.js';
import { editLayer, resolveLayer } from '../src/layers.js';
const fixture = (extra = {}) => ({ version: 1, duration: 10000, settings: {}, clips: [{ id: 'one', mode: 'place', shape: 'circle', color: '#0000ff', ringWidth: 6, enabled: true, targets: [0, 1], start: 0, duration: 0, fadeInMs: 0, holdMs: 1000, fadeOutMs: 1000, fadeMs: 2000, samples: [{ x: 100, y: 100, size: 100, t: 0 }], ...extra }] });
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
  for (let width = 7; width <= 12; width++) h.record(fixture({ ringWidth: width }), control);
  assert.equal(h.past.length, 1); assert.equal(h.undo().clips[0].ringWidth, 6); assert.equal(h.redo().clips[0].ringWidth, 12);
  h.endGroup(); h.record(fixture({ ringWidth: 16 }), control); assert.equal(h.undo().clips[0].ringWidth, 12);
  assert.equal(h.redo().clips[0].ringWidth, 16);
});

test('history limits prevent unbounded source-data accumulation', () => {
  const h = new EditHistory({ limit: 3, maxBytes: 2048 }); h.reset({ text: 'a'.repeat(80) });
  for (let i = 0; i < 20; i++) h.record({ text: String(i).repeat(80) });
  assert.ok(h.past.length <= 3); assert.ok(h.past.length > 0);
  const cost = entry => (entry.data.length + entry.signature.length) * 2;
  assert.ok([...h.past, h.current, ...h.future].reduce((sum, item) => sum + cost(item), 0) <= 2048);
});

test('old independent edge colors are removed when importing both common and scoped layers', () => {
  const source = fixture({ edgeColor: '#ff0000', edgeWidth: 8, eyeOverrides: { 1: { edgeColor: '#00ff00', edgeWidth: 10 } } });
  const restored = parseProject(serializeProject(source, { playing: false, phase: 0 })).project;
  for (const side of [0, 1]) {
    const layer = resolveLayer(restored.clips[0], side);
    assert.equal(layer.edgeColor, undefined); assert.equal(layer.edgeWidth, undefined);
    assert.equal(layer.blendMode, 'analog');
    assert.deepEqual(pixel(new RGBAScene({ ...restored, clips: [layer] }).draw(side, 0), 148, 100), [0, 0, 255, 255]);
  }
});

test('application timelines are always sixteen seconds, including legacy imports', () => {
  assert.equal(DEFAULT_LOOP_MS, 16000); assert.equal(new LoopClock().duration, 16000);
  assert.equal(normalizeProject({ version: 1, clips: [] }).duration, 16000);
  assert.equal(normalizeProject({ version: 1, duration: 6000, clips: [] }).duration, 16000);
  assert.equal(normalizeProject({ version: 1, clips: [], settings: { followDirection: true } }).settings.followDirection, false);
});
