import { CANVAS_WIDTH } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EFFECTS, DEFAULT_RING_WIDTH, paintingStyle } from '../src/effects.js';
import { CPULayerEffects } from '../src/render/cpu-effects.js';
import { normalizeProject, serializeProject, parseProject } from '../src/project.js';
import { validateLive, validateSnapshot } from '../server/loop-relay.js';
import { sameGeometry, LiveStroke, StampCursor } from '../src/render/stroke.js';
import { CachedGesture } from '../src/loop.js';
import { visitShape } from '../src/drawing.js';
import { EditHistory } from '../src/history.js';

const clip = { id: 'ring', mode: 'return', shape: 'ring', ringWidth: 5, color: '#ffffff', enabled: true, targets: [0], start: 0, duration: 100, fadeMs: 2000, samples: [{ x: 100, y: 100, size: 80, shape: 'ring', ringWidth: 5, t: 0 }, { x: 100, y: 100, size: 80, shape: 'ring', ringWidth: 5, t: 100 }] };
const project = (value = clip) => ({ version: 1, duration: 10000, clips: [value] });
const off = { ...DEFAULT_EFFECTS, blur: false };

test('Ring brushes default to 20px and old brush defaults migrate without changing saved artwork or explicit new choices',()=>{
 assert.equal(DEFAULT_RING_WIDTH,20);assert.equal(normalizeProject(project()).settings.ringWidth,20);
 const migrated=normalizeProject({...project(),settings:{ringWidth:5}});assert.equal(migrated.settings.ringWidth,20);assert.equal(migrated.clips[0].ringWidth,5);
 assert.equal(normalizeProject({...project(),settings:{ringWidth:8}}).settings.ringWidth,8);
 const explicit=normalizeProject({...project(),settings:{ringWidth:5,ringDefaultsVersion:1}});assert.equal(parseProject(serializeProject(explicit,{playing:false,phase:0})).project.settings.ringWidth,5);
});

test('layer effects, ring geometry and Analog-only mixing migrate and round-trip without retired settings', () => {
  const p = normalizeProject({ ...project({ ...clip, edgeColor: '#ff0000', edgeWidth: 6, blendMode: 'normal' }), settings: { blurRadius: 99, showBlurPreview: true, exportFormat: 'rgb', shape: 'ring', ringWidth: 8 } });
  assert.deepEqual(p.clips[0].effects, DEFAULT_EFFECTS); assert.equal(p.clips[0].blendMode, 'analog');
  assert.equal(p.clips[0].edgeColor, undefined); assert.equal(p.clips[0].edgeWidth, undefined);
  for (const key of ['blurRadius', 'showBlurPreview', 'exportFormat']) assert.equal(p.settings[key], undefined);
  const edited = { ...p, clips: [{ ...p.clips[0], effects: { ...off, blurRadius: 93 } }] };
  assert.deepEqual(parseProject(serializeProject(edited, { playing: false, phase: 500 })).project, edited);
  const history = new EditHistory(); history.reset(p); history.record(edited);
  assert.deepEqual(history.undo(), p); assert.deepEqual(history.redo(), edited);
  assert.ok(sameGeometry(p.clips[0], edited.clips[0]));
});

test('invalid imported and relayed effects fail before changing a project', () => {
  for (const effects of [null, [], { blur: 1 }, { blurRadius: -1 }, { blurRadius: 193 }, { unknown: true }]) {
    assert.throws(() => normalizeProject(project({ ...clip, effects })));
    assert.throws(() => validateSnapshot({ project: project({ ...clip, effects }), playback: { playing: false, phase: 0 } }, 1000));
  }
  for (const ringWidth of [0, 1501, 2.5, '5']) assert.throws(() => normalizeProject(project({ ...clip, ringWidth })));
  assert.deepEqual(paintingStyle({ effects: { blur: false } }).effects, off);
});

test('live streams retain ring and effect settings for both local and remote input', () => {
  const frame = validateLive({ session: 'test', revision: 1, id: 'live-ring', from: 0, mode: 'move', color: '#ffffff', targets: [0], samples: [clip.samples[0]], head: { ...clip.samples[0], t: 50 }, elapsed: 50, effects: off, ringWidth: 5 });
  const live = new LiveStroke(); live.update(frame, 1000);
  assert.deepEqual(live.effects, off); assert.equal(live.head.shape, 'ring'); assert.equal(live.samples[0].ringWidth, 5);
  live.setLocal({ ...clip, id: 'local', started: 0, last: clip.samples[0], effects: off }, 100);
  assert.equal(live.ringWidth, 5); assert.deepEqual(live.effects, off);
  assert.throws(() => validateLive({ ...frame, effects: { blur: 'yes' } }));
  assert.throws(() => validateLive({ ...frame, head: { ...frame.head, ringWidth: -2 } }));
});

test('rings leave the center untouched through all motion modes, interpolation and width edits', () => {
  const center = (100 * CANVAS_WIDTH + 100) * 4, edge = (100 * CANVAS_WIDTH + 137) * 4;
  for (const mode of ['trail', 'return', 'move', 'place']) {
    const c = { ...clip, mode, ...(mode === 'place' ? { duration: 0, samples: [clip.samples[0]], fadeInMs: 0, holdMs: 1000, fadeOutMs: 0 } : {}) };
    const visual = new CachedGesture(c).render(50);
    if (mode === 'trail' || mode === 'return') { assert.equal(visual[center + 3], 0); assert.ok(visual[edge + 3] > 0); }
    else {
      const spans = []; visitShape(visual, (a, b) => spans.push([a, b]));
      assert.ok(!spans.some(([a, b]) => a <= center / 4 && center / 4 < b));
      assert.ok(spans.some(([a, b]) => a <= edge / 4 && edge / 4 < b));
    }
  }
  const cursor = new StampCursor([{ ...clip.samples[0] }, { ...clip.samples[1], x: 110 }]);
  const stamps = []; cursor.advance(50, p => stamps.push(p));
  assert.ok(stamps.length > 1); assert.ok(stamps.every(p => p.shape === 'ring' && p.ringWidth === 5));
});

test('CPU effects blur alpha and preserve paint color without modifying the source', () => {
  const width = 160, height = 96, input = new Uint8ClampedArray(width * height * 4);
  for (let y = 24; y < 72; y++) for (let x = 50; x < 110; x++) input.set([255, 255, 255, 255], (y * width + x) * 4);
  const fx = new CPULayerEffects(), pixel = (data, x, y = 48) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
  assert.equal(fx.apply(input, width, height, { effects: off }, 0), input);
  const blurred = fx.apply(input, width, height, { effects: { ...off, blur: true, blurRadius: 16 } }, 0).slice();
  assert.ok(pixel(blurred, 45)[3] > 0); assert.deepEqual(pixel(blurred, 45).slice(0, 3), [255, 255, 255]);
  assert.deepEqual(pixel(input, 80), [255, 255, 255, 255], 'Effects never alter source pixels');
});

test('retired effects are ignored when loading old projects', () => {
  const p = normalizeProject(project({ ...clip, effects: { blur: false, blurRadius: 64, glitch: true, glitchAmount: 90, chromatic: true, chromaticAmount: 30 } }));
  assert.deepEqual(p.clips[0].effects, { ...DEFAULT_EFFECTS, blurRadius: 64 });
  assert.deepEqual(p.settings.effects, DEFAULT_EFFECTS);
});
