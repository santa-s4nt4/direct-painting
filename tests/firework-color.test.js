import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionP5 } from '../src/p5-math.js';
import { P5_PRESETS, sequenceTracks, p5Clips, upgradeP5Code } from '../src/p5-motion.js';
import { LEGACY_FIREWORKS_CODE } from '../src/p5-fireworks-legacy.js';
import { DEFAULT_SETTINGS, normalizeProject, serializeProject, parseProject } from '../src/project.js';
import { sampleAt } from '../src/loop.js';
import { RGBAScene } from '../src/rgba.js';
import { colorAtTime, interpolateColor } from '../src/color.js';
import { editLayer } from '../src/layers.js';
import { EditHistory } from '../src/history.js';

const source = { kind: 'p5', preset: 'fireworks', code: P5_PRESETS.fireworks, seed: 7, durationMs: 12000, options: { single: 3, climax: 2, variation: 75 } };
const sequence = new Function(`${source.code}; return sequence;`)();
const tracks = sequenceTracks(sequence, new MotionP5(source.seed), source);
const make = (settings = {}, value = source, result = tracks) => p5Clips({ tracks: result }, { source: value, settings: { ...DEFAULT_SETTINGS, color: '#ff0000', ...settings }, id: 'firework', targets: [0, 1], mode: 'move' });
const project = clips => ({ version: 1, duration: 12000, clips });
const pixel = (data, point) => [...data.slice((Math.floor(point.y) * CANVAS_WIDTH + Math.floor(point.x)) * 4, (Math.floor(point.y) * CANVAS_WIDTH + Math.floor(point.x)) * 4 + 4)];
function near(actual, expected, tolerance = 1) { for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) <= tolerance, `${actual} versus ${expected}`); }

test('firework endpoints default to the selected draw color and accept independent launch/fade colors', () => {
  for (const color of ['#ff0000', '#32bca0']) for (const clip of make({ color })) {
    assert.equal(clip.color, color); assert.equal(clip.fireworkColorTo, color); assert.equal(clip.colorEditMode, 'firework');
  }
  const clips = make({ p5FireworkColorA: '#00ff00', p5FireworkColorB: '#0000ff' });
  assert.ok(clips.every(clip => clip.color === '#00ff00' && clip.fireworkColorTo === '#0000ff'));
  const rainSource = { ...source, preset: 'rain', code: P5_PRESETS.rain };
  const rainSequence = new Function(`${rainSource.code}; return sequence;`)();
  const rain = make({ p5FireworkColorA: '#00ff00', p5FireworkColorB: '#0000ff' }, rainSource, sequenceTracks(rainSequence, new MotionP5(7), rainSource));
  assert.ok(rain.every(clip => clip.color === '#ff0000' && clip.fireworkColorTo === undefined));
});

test('every burst resets its color and smoothly fades alpha while its position stays on the LED grid', () => {
  const [clip] = make({ p5FireworkColorB: '#0000ff' }), scene = new RGBAScene(project([clip]));
  const rocket = sampleAt(clip.samples, 200), middle = sampleAt(clip.samples, 780), late = sampleAt(clip.samples, 1140);
  assert.equal(rocket.colorProgress, 0); assert.equal(rocket.opacity, 1);
  assert.ok(Math.abs(middle.colorProgress - .5) < 1e-8); assert.ok(Math.abs(middle.opacity - .5) < 1e-8);
  assert.ok(late.colorProgress > .9 && late.opacity < .1);
  near(pixel(scene.draw(0, 200), rocket), [255, 0, 0, 255]);
  near(pixel(scene.draw(0, 780), middle), [128, 0, 128, 128]);
  near(pixel(scene.draw(0, 1140), late), [18, 0, 237, 18], 2);
  const next = sampleAt(clip.samples, 2400);
  assert.equal(next.colorProgress, 0); assert.equal(next.opacity, 1); near(pixel(scene.draw(0, 2400), next), [255, 0, 0, 255]);
  for (const time of [781, 785, 789]) { const point = sampleAt(clip.samples, time); assert.equal(point.x % 10, 5); assert.equal(point.y % 10, 5); }
  const a = sampleAt(clip.samples, 781), b = sampleAt(clip.samples, 782);
  assert.notEqual(a.colorProgress, b.colorProgress); assert.notEqual(a.opacity, b.opacity);
  assert.equal(interpolateColor('#ff0000', '#0000ff', .5), '#800080');
  assert.equal(colorAtTime(clip, 780, { colorProgress: 1 }), '#0000ff');
});

test('appearance interpolation preserves hidden gaps and never brightens towards the next burst reset', () => {
  const samples = [
    { x: 5, y: 5, size: 10, t: 0, active: true, step: true, opacity: 1, colorProgress: 0 },
    { x: 15, y: 15, size: 10, t: 1000, active: false, step: true, opacity: 0, colorProgress: 1 },
    { x: 25, y: 25, size: 10, t: 2000, active: true, step: true, opacity: 1, colorProgress: 0 },
  ];
  const middle = sampleAt(samples, 500); assert.equal(middle.x, 5); assert.equal(middle.opacity, .5); assert.equal(middle.colorProgress, .5);
  const gap = sampleAt(samples, 1500); assert.equal(gap.active, false); assert.equal(gap.opacity, 0);
  const reset = sampleAt([{ ...samples[0], opacity: .1, colorProgress: .9 }, samples[2]], 1999);
  assert.equal(reset.opacity, .1); assert.equal(reset.colorProgress, .9);
});

test('layer fade colors edit independently per eye, survive history/JSON and keep geometry unchanged', () => {
  const original = { ...make({ p5FireworkColorB: '#0000ff' })[0], targets: [0, 1] };
  const changed = editLayer(original, '1', clip => ({ ...clip, fireworkColorTo: '#00ff00' }));
  assert.equal(changed.samples, original.samples);
  const history = new EditHistory(); history.reset(project([original])); history.record(project([changed]));
  assert.equal(history.undo().clips[0].eyeOverrides, undefined);
  const restored = parseProject(serializeProject(history.redo(), { playing: false, phase: 780 })).project;
  const scene = new RGBAScene(restored), point = sampleAt(original.samples, 780);
  near(pixel(scene.draw(0, 780), point), [128, 0, 128, 128]); near(pixel(scene.draw(1, 780), point), [128, 128, 0, 128]);
  assert.equal(restored.clips[0].eyeOverrides[1].fireworkColorTo, '#00ff00');
  const picker = { ...original, colorEditMode: 'color' }; near(pixel(new RGBAScene(project([picker])).draw(0, 780), point), [255, 0, 0, 128]);
});

test('imports reject invalid endpoints, palette settings and per-sample appearance data', () => {
  const [clip] = make();
  for (const fireworkColorTo of [undefined, 'bad', '#fff', 5]) assert.throws(() => normalizeProject(project([{ ...clip, fireworkColorTo }])));
  for (const key of ['opacity', 'colorProgress']) for (const value of [-.1, 1.1, NaN, '0.5']) {
    assert.throws(() => normalizeProject(project([{ ...clip, samples: clip.samples.map((sample, index) => index ? sample : { ...sample, [key]: value }) }])));
  }
  for (const key of ['p5FireworkColorA', 'p5FireworkColorB']) for (const value of ['bad', 1]) assert.throws(() => normalizeProject({ ...project([]), settings: { [key]: value } }));
  const state = normalizeProject({ ...project([clip]), settings: { p5FireworkColorA: null, p5FireworkColorB: '#2040ff' } });
  assert.equal(parseProject(serializeProject(state, { playing: false, phase: 0 })).project.settings.p5FireworkColorB, '#2040ff');
});

test('only the untouched previous built-in snippet upgrades; imported cached motion is preserved', () => {
  assert.equal(upgradeP5Code(LEGACY_FIREWORKS_CODE), P5_PRESETS.fireworks);
  const custom = LEGACY_FIREWORKS_CODE.replace('const slots = 3;', 'const slots = 2;'); assert.equal(upgradeP5Code(custom), custom);
  const legacySequence = new Function(`${LEGACY_FIREWORKS_CODE}; return sequence;`)();
  const legacySource = { ...source, code: LEGACY_FIREWORKS_CODE };
  const oldClips = make({}, legacySource, sequenceTracks(legacySequence, new MotionP5(7), legacySource));
  const restored = normalizeProject({ ...project(oldClips), settings: { p5Code: LEGACY_FIREWORKS_CODE, p5Preset: 'fireworks' } });
  assert.equal(restored.settings.p5Code, P5_PRESETS.fireworks);
  assert.equal(restored.clips[0].procedural.code, LEGACY_FIREWORKS_CODE);
  assert.deepEqual(restored.clips[0].samples, oldClips[0].samples);
});
