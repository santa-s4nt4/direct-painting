import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MotionP5 } from '../src/p5-math.js';
import { P5_PRESETS, sequenceTracks, p5Clips, motionSamples, p5Clip, validateP5Source, upgradeP5Code } from '../src/p5-motion.js';
import { LEGACY_COLOR_RAIN_CODE } from '../src/p5-color-rain-legacy.js';
import { DEFAULT_SETTINGS, MAX_PROJECT_BYTES, normalizeProject, serializeProject, parseProject } from '../src/project.js';
import { sampleAt, trimGesture } from '../src/loop.js';
import { RGBAScene } from '../src/rgba.js';
import { sampleLED } from '../src/visuals.js';
import { colorAtTime } from '../src/color.js';
import { EditHistory } from '../src/history.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function generate({ seed = 2026, durationMs = 10000, variation = 75, single = 3, climax = 2, initialColor = '#ef7331', initialColorHoldMs = 2000, trackIndex } = {}) {
  const source = { kind: 'p5', preset: 'colorRain', code: P5_PRESETS.colorRain, seed, durationMs, options: { single, climax, variation, initialColor, initialColorHoldMs }, ...(trackIndex !== undefined ? { trackIndex } : {}) };
  const sequence = new Function(`${source.code}; return sequence;`)();
  const tracks = sequenceTracks(sequence, new MotionP5(seed), source);
  const clips = p5Clips({ tracks }, { source, settings: DEFAULT_SETTINGS, id: 'color-rain', targets: [0, 1], mode: 'move' });
  return { source, tracks, clips };
}
const base = generate();
const visible = (tracks, eye, time) => tracks.filter(track => track.eye === eye).map(track => sampleAt(track.samples, time)).filter(point => point.active);
const pixel = (data, x, y, width = CANVAS_WIDTH) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
const rgb = hex => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));

test('color rain starts empty, every drop enters from the top, and both eyes build into a downpour', () => {
  const { tracks } = base;
  assert.equal(tracks.length, 48);
  for (const eye of ['left', 'right']) assert.equal(visible(tracks, eye, 0).length, 0);
  for (let time = 1500; time < 10000; time += 137) for (const eye of ['left', 'right']) {
    const drops = visible(tracks, eye, time);
    assert.ok(drops.length >= 12, `${eye} at ${time} must be a downpour`);
    if (time > 4000) assert.ok(new Set(drops.map(drop => drop.color)).size >= 10);
  }
  for (const track of tracks) {
    assert.equal(track.samples[0].active, false);
    assert.equal(track.samples.at(-1).active, false);
    let previous;
    for (const point of track.samples) {
      assert.equal(point.x % 10, 5); assert.equal(point.y % 10, 5);
      assert.equal(point.width, 10); assert.equal(point.height, 10); assert.equal(point.step, true);
      if (point.active) {
        assert.match(point.color, /^#[0-9a-f]{6}$/);
        if (previous?.active) { assert.ok(point.y > previous.y); assert.equal(point.x, previous.x); assert.equal(point.color, previous.color); }
        else { assert.equal(point.y, 5); assert.ok(point.t > 0); }
      }
      previous = point;
    }
  }
  assert.equal(hash(generate({ single: 1, climax: 0 }).tracks), hash(tracks), 'This preset ignores the single/climax ratio');
});

test('seeds reproduce drop colors and falls, individual tracks regenerate exactly, and the eyes differ', () => {
  assert.equal(hash(generate().tracks), hash(base.tracks));
  assert.notEqual(hash(generate({ seed: 2027 }).tracks), hash(base.tracks));
  assert.equal(hash(generate({ trackIndex: 27 }).tracks[0]), hash(base.tracks[27]));
  assert.notEqual(hash(base.tracks.slice(0, 24).map(track => track.samples)), hash(base.tracks.slice(24).map(track => track.samples)));
  assert.notEqual(hash(generate({ variation: 0 }).tracks), hash(generate({ variation: 100 }).tracks));
  const fixedA = generate({ variation: 0 }), fixedB = generate({ variation: 0, seed: 9 });
  const geometry = tracks => tracks.map(track => track.samples.map(({ color, ...point }) => point));
  assert.equal(hash(geometry(fixedA.tracks)), hash(geometry(fixedB.tracks)), '0% fixes the fall pattern');
  assert.notEqual(hash(fixedA.tracks), hash(fixedB.tracks), 'Drop colors remain seeded at 0% variation');
});

test('arbitrary lengths scale the same colored rain keyframes without exceeding project or sample limits', () => {
  const reference = generate({ initialColorHoldMs: 0 });
  for (const durationMs of [100, 37100, 600000]) {
    const { tracks, clips, source } = generate({ durationMs, initialColorHoldMs: 0 });
    assert.ok(tracks.reduce((total, track) => total + track.samples.length, 0) < 40000);
    for (const [index, track] of tracks.entries()) {
      assert.equal(track.samples.at(-1).t, durationMs);
      assert.equal(track.samples.length, reference.tracks[index].samples.length);
      for (const [i, point] of track.samples.entries()) {
        const original = reference.tracks[index].samples[i];
        assert.ok(Math.abs(point.t / durationMs - original.t / 10000) < 1e-10);
        assert.equal(point.color, original.color); assert.equal(point.x, original.x); assert.equal(point.y, original.y);
      }
    }
    const project = normalizeProject({ version: 1, duration: durationMs, clips, settings: { p5Preset: 'colorRain', p5Code: source.code, p5DurationMs: durationMs } });
    const file = serializeProject(project, { playing: false, phase: 0 });
    assert.ok(Buffer.byteLength(file) < MAX_PROJECT_BYTES);
    assert.equal(hash(parseProject(file).project), hash(project));
  }
});

test('per-drop colors render as exact LED cells, survive trim and permit fixed fill overrides', () => {
  const clip = base.clips.find(clip => sampleAt(clip.samples, 400).active), project = value => ({ version: 1, duration: 10000, clips: [value] });
  assert.equal(clip.colorEditMode, 'sample');
  const scene = new RGBAScene(project(clip));
  for (const time of [0, 487, 5200, 237]) {
    const point = sampleAt(clip.samples, time);
    if (!point.active) continue;
    const pixels = scene.draw(0, time), expected = [...rgb(point.color), 255];
    assert.deepEqual(pixel(pixels, point.x, point.y), expected);
    assert.deepEqual(pixel(pixels, point.x - 5, point.y - 5), expected, 'Unset edges follow the drop color');
    assert.deepEqual(pixel(sampleLED(Uint8ClampedArray.from({ length: 320 * 320 * 4 }, (_, i) => pixels[(Math.floor(i / (320 * 4)) * CANVAS_WIDTH * 4) + i % (320 * 4)]), 320, 320), (point.x - 5) / 10, (point.y - 5) / 10, 32), expected);
    assert.equal(scene.draw(1, time).some(value => value > 0), false);
  }
  const point = sampleAt(clip.samples, 400);
  const edge = new RGBAScene(project({ ...clip, edgeColor: '#ffffff', edgeWidth: 2 })).draw(0, 400);
  assert.deepEqual(pixel(edge, point.x - 5, point.y), [...rgb(point.color), 255]);
  assert.deepEqual(pixel(edge, point.x, point.y), [...rgb(point.color), 255]);
  assert.equal(colorAtTime({ ...clip, colorEditMode: 'color', color: '#123456' }, 0, point), '#123456');
  const trimmed = new RGBAScene(project(trimGesture(clip, 'in', 200, 10000)));
  assert.equal(hash(trimmed.draw(0, 400)), hash(scene.draw(0, 400)));
  const history = new EditHistory(); history.reset(project(clip)); history.record(project({ ...clip, colorEditMode: 'color' }));
  assert.equal(history.undo().clips[0].colorEditMode, 'sample'); assert.equal(history.redo().clips[0].colorEditMode, 'color');
});

test('initial color holds for an absolute number of seconds and new drops then become random without changing the falls', () => {
  const geometry = tracks => tracks.map(track => track.samples.map(({ color, ...point }) => point));
  const random = generate({ initialColorHoldMs: 0 }), held = generate({ initialColorHoldMs: 600000, initialColor: '#000000' });
  assert.equal(hash(geometry(base.tracks)), hash(geometry(random.tracks)));
  assert.equal(hash(geometry(held.tracks)), hash(geometry(random.tracks)));
  assert.ok(held.tracks.every(track => track.samples.filter(p => p.active).every(p => p.color === '#000000')));
  for (const durationMs of [1000, 10000, 600000]) {
    const { tracks } = generate({ durationMs, initialColorHoldMs: 2000 });
    for (const track of tracks) {
      let color;
      for (let i = 0; i < track.samples.length; i++) {
        const point = track.samples[i];
        if (!point.active) continue;
        if (!track.samples[i - 1]?.active) {
          color = point.color;
          if (point.t < 2000) assert.equal(color, '#ef7331');
          else assert.notEqual(color, '#ef7331');
        }
        assert.equal(point.color, color, 'A falling drop must never change color mid-flight');
      }
    }
    for (const eye of ['left', 'right']) for (const time of [100, 500, 1500, 1999].filter(time => time < durationMs)) {
      assert.ok(visible(tracks, eye, time).every(point => point.color === '#ef7331'));
    }
  }
});

test('rain hold and initial color round-trip through JSON and history and reject malformed values', () => {
  const { source, clips } = generate({ initialColorHoldMs: 3500, initialColor: '#22cc88' });
  const project = normalizeProject({ version: 1, duration: 10000, clips, settings: { color: '#22cc88', p5Preset: 'colorRain', p5Code: source.code, p5RainColorHoldMs: 3500 } });
  const restored = parseProject(serializeProject(project, { playing: false, phase: 3000 })).project;
  assert.equal(hash(restored), hash(project));
  assert.deepEqual(restored.clips[27].procedural.options, source.options);
  const history = new EditHistory(); history.reset(project); history.record({ ...project, settings: { ...project.settings, p5RainColorHoldMs: 0 } });
  assert.equal(history.undo().settings.p5RainColorHoldMs, 3500); assert.equal(history.redo().settings.p5RainColorHoldMs, 0);
  assert.equal(DEFAULT_SETTINGS.p5RainColorHoldMs, 2000);
  for (const value of [-1, 0.5, 600001, '2', null, NaN]) {
    assert.throws(() => validateP5Source({ ...source, options: { ...source.options, initialColorHoldMs: value } }));
    assert.throws(() => normalizeProject({ version: 1, clips: [], settings: { p5RainColorHoldMs: value } }));
  }
  for (const initialColor of ['red', '#fff', 123, null, ['#123456']]) assert.throws(() => validateP5Source({ ...source, options: { ...source.options, initialColor } }));
});

test('the untouched previous color-rain snippet upgrades without replacing its cached motion or custom code', () => {
  const source = { ...base.source, code: LEGACY_COLOR_RAIN_CODE };
  const tracks = sequenceTracks(new Function(`${source.code}; return sequence;`)(), new MotionP5(source.seed), source);
  const clips = p5Clips({ tracks }, { source, settings: DEFAULT_SETTINGS, id: 'legacy-rain', targets: [0, 1], mode: 'move' });
  const restored = normalizeProject({ version: 1, duration: 10000, clips, settings: { p5Preset: 'colorRain', p5Code: source.code } });
  assert.equal(restored.settings.p5Code, P5_PRESETS.colorRain);
  assert.equal(hash(restored.clips.map(({ blendMode, effects, ...clip }) => clip)), hash(clips));
  const custom = LEGACY_COLOR_RAIN_CODE + '\n// custom';
  assert.equal(upgradeP5Code(custom), custom);
});

test('sample colors hold between keys and invalid snippets or imported color data fail before rendering', () => {
  const { source } = base;
  const points = motionSamples((p, t) => ({ x: 10 + t * 100, y: 20, color: t === 0 ? '#FF0000' : '#0000ff' }), new MotionP5(1), 100, [0, 1]);
  assert.equal(sampleAt(points, 50).color, '#ff0000'); assert.equal(sampleAt(points, 100).color, '#0000ff');
  for (const color of ['red', '#fff', '#12345678', 12, ['#ffffff'], null]) {
    assert.throws(() => motionSamples(() => ({ x: 5, y: 5, color }), new MotionP5(1), 100), /color/);
    const clip = { ...base.clips[0], samples: base.clips[0].samples.map((sample, i) => i ? sample : { ...sample, color }) };
    assert.throws(() => normalizeProject({ version: 1, duration: 10000, clips: [clip] }), /color/);
  }
  assert.throws(() => p5Clip(points, { source, settings: DEFAULT_SETTINGS, id: 'bad', targets: [0], mode: 'trail' }), /MOVE/);
  const noColors = { ...base.clips[0], samples: base.clips[0].samples.map(({ color, ...point }) => point) };
  assert.throws(() => normalizeProject({ version: 1, duration: 10000, clips: [noColors] }), /snippet color/);
});
