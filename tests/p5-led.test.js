import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MotionP5 } from '../src/p5-math.js';
import { P5_PRESETS, sequenceTracks, p5Clips, motionSamples, validateP5Source, freshP5Seed } from '../src/p5-motion.js';
import { sampleAt } from '../src/loop.js';
import { DEFAULT_SETTINGS, MAX_PROJECT_BYTES, normalizeProject, serializeProject, parseProject } from '../src/project.js';
import { RGBAScene } from '../src/rgba.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function generate(preset, { durationMs = 12000, seed = 7, single = 3, climax = 2, variation = 75, trackIndex } = {}) {
  const source = { kind: 'p5', code: P5_PRESETS[preset], preset, options: { single, climax, variation }, durationMs, seed, ...(trackIndex !== undefined ? { trackIndex } : {}) };
  const sequence = new Function(`${source.code}; return sequence;`)();
  const tracks = sequenceTracks(sequence, new MotionP5(seed), source);
  const clips = p5Clips({ tracks }, { source, settings: DEFAULT_SETTINGS, id: preset, targets: [0, 1], mode: 'move', start: 0 });
  return { source, tracks, clips };
}
const visible = (tracks, side, time) => tracks.filter(track => track.eye === (side ? 'right' : 'left')).map(track => sampleAt(track.samples, time)).filter(point => point.active);

test('LED sequences stretch every LED keyframe from 0.1s to 10min within the JSON and sample limits', () => {
  for (const preset of ['rain', 'fireworks']) {
    const base = generate(preset);
    for (const durationMs of [100, 37100, 600000]) {
      const { tracks, clips } = generate(preset, { durationMs });
      assert.ok(tracks.reduce((count, track) => count + track.samples.length, 0) < 40000);
      assert.equal(tracks.length, preset === 'rain' ? 32 : 48);
      for (const [index, track] of tracks.entries()) {
        assert.equal(track.samples.length, base.tracks[index].samples.length);
        assert.equal(track.samples.at(-1).t, durationMs);
        for (let i = 0; i < track.samples.length; i++) {
          const a = track.samples[i], b = base.tracks[index].samples[i];
          assert.ok(Math.abs(a.t / durationMs - b.t / base.source.durationMs) < 1e-10);
          assert.equal(a.x, b.x); assert.equal(a.y, b.y); assert.equal(a.active, b.active);
        }
      }
      assert.ok(Buffer.byteLength(serializeProject({ version: 1, duration: durationMs, clips }, { playing: false, phase: 0 })) < MAX_PROJECT_BYTES);
    }
  }
});

test('single:climax ratios change the phase boundary and support either phase by itself', () => {
  for (const preset of ['rain', 'fireworks']) {
    const { tracks } = generate(preset, { single: 1, climax: 3 });
    for (let time = 0; time < 3000; time += 17) {
      const left = visible(tracks, 0, time).length, right = visible(tracks, 1, time).length;
      assert.equal(left && right ? 1 : 0, 0, 'Single phase must never overlap the eyes');
      if (preset === 'rain') assert.ok(left + right <= 1);
    }
    assert.ok([0, 1].every(side => visible(tracks, side, 10000).length >= 8));
    const onlySingle = generate(preset, { single: 1, climax: 0 }).tracks;
    for (let time = 0; time < 12000; time += 31) assert.equal(Boolean(visible(onlySingle, 0, time).length && visible(onlySingle, 1, time).length), false);
    const onlyClimax = generate(preset, { single: 0, climax: 1 }).tracks;
    assert.ok([0, 1].every(side => visible(onlyClimax, side, 10000).length >= 8));
  }
});

test('fireworks launch in alternating eyes, burst into LED grains and immediately hand off when finished', () => {
  const { tracks } = generate('fireworks');
  const length = 1200;
  for (let event = 0; event < 6; event++) {
    const eye = event % 2, start = event * length;
    const low = visible(tracks, eye, start + 1), high = visible(tracks, eye, start + length * .2);
    assert.equal(low.length, 1); assert.equal(high.length, 1); assert.ok(high[0].y < low[0].y);
    assert.ok(visible(tracks, eye, start + length * .55).length >= 6);
    for (const fraction of [.01, .4, .9, .9999]) {
      assert.ok(visible(tracks, eye, start + length * fraction).length > 0);
      assert.equal(visible(tracks, 1 - eye, start + length * fraction).length, 0);
    }
    if (event < 5) {
      assert.equal(visible(tracks, eye, start + length + .001).length, 0);
      assert.equal(visible(tracks, 1 - eye, start + length + .001).length, 1);
    }
  }
  let peak = 0;
  for (let time = 9000; time < 11800; time += 19) peak = Math.max(peak, Math.min(visible(tracks, 0, time).length, visible(tracks, 1, time).length));
  assert.ok(peak >= 16, `Climax must show overlapping bursts in both eyes: ${peak}`);
  assert.equal(visible(tracks, 0, 11990).length + visible(tracks, 1, 11990).length, 0);
});

test('all LED sparks occupy exactly one 32x32 grid cell and raw RGBA preserves silent eyes', () => {
  const { tracks, clips } = generate('fireworks'), scene = new RGBAScene({ duration: 12000, clips });
  for (const track of tracks) for (const point of track.samples) {
    assert.equal(point.x % 10, 5); assert.equal(point.y % 10, 5);
    assert.equal(point.width, 10); assert.equal(point.height, 10); assert.equal(point.step, true);
    assert.ok(point.x >= 5 && point.x <= 315 && point.y >= 5 && point.y <= 315);
  }
  for (const [side, phase] of [[0, 600], [1, 1800], [0, 10800], [1, 10800]]) {
    const pixels = scene.draw(side, phase); let lit = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const alpha = pixels[((y * 10) * CANVAS_WIDTH + x * 10) * 4 + 3];
      if (alpha) lit++;
      for (let dy = 0; dy < 10; dy++) for (let dx = 0; dx < 10; dx++) assert.equal(pixels[(((y * 10 + dy) * CANVAS_WIDTH + x * 10 + dx) * 4) + 3], alpha);
    }
    assert.ok(lit > 0);
  }
  assert.equal(scene.draw(1, 600).some((value, index) => index % 4 === 3 && value > 0), false);
});

test('variation controls randomness while a saved seed reproduces the full sequence and individual track', () => {
  for (const preset of ['rain', 'fireworks']) {
    const a = generate(preset), b = generate(preset, { seed: 8 });
    assert.notEqual(hash(a.tracks), hash(b.tracks));
    assert.equal(hash(a.tracks), hash(generate(preset).tracks));
    assert.equal(hash(generate(preset, { seed: 7, variation: 0 }).tracks), hash(generate(preset, { seed: 8, variation: 0 }).tracks));
    assert.notEqual(hash(generate(preset, { variation: 25 }).tracks), hash(generate(preset, { variation: 100 }).tracks));
    assert.equal(hash(generate(preset, { trackIndex: 9 }).tracks[0]), hash(a.tracks[9]));
  }
  assert.equal(freshP5Seed(7, 8), 8);
  assert.notEqual(freshP5Seed(7, 7), 7);
  assert.notEqual(freshP5Seed(4294967295, 4294967295), 4294967295);
});

test('keyframe sampling retains exact event timing and rejects invalid schedules before rendering', () => {
  const seen = [];
  const points = motionSamples((p, t) => { seen.push(p.deltaTime); return { x: 5, y: t * 300 + 5, active: t < .3, step: true }; }, new MotionP5(1), 1000, [0, .1, .3, 1]);
  assert.deepEqual(points.map(point => point.t), [0, 100, 300, 1000]); assert.deepEqual(seen, [0, 100, 200, 700]);
  assert.equal(sampleAt(points, 299).active, true); assert.equal(sampleAt(points, 300).active, false);
  for (const times of [[], [0], [.1, 1], [0, .9], [0, .5, .5, 1], [0, NaN, 1], [0, 1.1, 1], [0, -.1, 1], 'bad']) assert.throws(() => motionSamples(() => ({ x: 1, y: 1 }), new MotionP5(1), 1000, times));
  assert.throws(() => sequenceTracks(() => Array.from({ length: 64 }, () => ({ motion: () => ({ x: 1, y: 1 }) })), new MotionP5(1), { seed: 1, durationMs: 600000 }), /Too many/);
});

test('LED settings, parameters and per-track source round-trip through editable JSON with validation', () => {
  const { source, clips } = generate('fireworks', { durationMs: 13700, single: 1, climax: 4, variation: 50 });
  const state = normalizeProject({ version: 1, duration: 13700, clips, settings: { motionSource: 'p5', p5Code: source.code, p5Preset: 'fireworks', p5DurationMs: 13700, p5SingleRatio: 1, p5ClimaxRatio: 4, p5Variation: 50, p5AutoSeed: false } });
  const restored = parseProject(serializeProject(state, { playing: false, phase: 800 })).project;
  assert.deepEqual(restored, state); assert.deepEqual(restored.clips[17].procedural.options, source.options);
  for (const options of [{ single: 0, climax: 0, variation: 50 }, { single: -1, climax: 1, variation: 50 }, { single: 1.5, climax: 1, variation: 50 }, { single: 1, climax: 1, variation: 101 }, null]) assert.throws(() => validateP5Source({ ...source, options }));
  for (const patch of [{ durationMs: 600001 }, { preset: 'unknown' }]) assert.throws(() => validateP5Source({ ...source, ...patch }));
  for (const settings of [{ p5SingleRatio: 0, p5ClimaxRatio: 0 }, { p5Variation: -1 }, { p5AutoSeed: 'yes' }, { p5DurationMs: 600001 }]) assert.throws(() => normalizeProject({ version: 1, clips: [], settings }));
  assert.equal(normalizeProject({ version: 1, clips: [] }).settings.p5AutoSeed, true);
});
