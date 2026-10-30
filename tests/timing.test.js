import test from 'node:test';
import assert from 'node:assert/strict';
import { FPS, FRAME_MS, frameNumber, RENDER_FPS, RENDER_FRAME_MS, renderFrameNumber, FrameRateMeter } from '../src/timing.js';
import { createLivePublisher } from '../src/relay.js';
import { singleCanvasProject } from '../src/project.js';

test('60Hz frame grid retains 60 updates on 60Hz, 120Hz and 144Hz displays', () => {
  assert.equal(FPS, 60); assert.equal(FRAME_MS, 1000 / 60);
  for (const refreshRate of [60, 120, 144]) {
    const frames = new Set(Array.from({ length: refreshRate }, (_, i) => frameNumber(i * 1000 / refreshRate)));
    assert.equal(frames.size, 60, `${refreshRate}Hz display`);
  }
});

test('presentation is capped at 30fps across display refresh rates while input and shutter stay at 60Hz', () => {
  assert.equal(RENDER_FPS, 30); assert.equal(RENDER_FRAME_MS, 1000 / 30);
  assert.equal(FRAME_MS, 1000 / 60);
  for (const refreshRate of [30, 60, 90, 120, 144]) {
    const frames = new Set(Array.from({ length: refreshRate }, (_, i) => renderFrameNumber(i * 1000 / refreshRate)));
    assert.equal(frames.size, 30, `${refreshRate}Hz display`);
  }
});

test('measured FPS reflects delivered 30fps frames and CPU submission time', () => {
  const meter = new FrameRateMeter();
  for (let i = 0; i <= 15; i++) meter.record(i * 1000 / 30, 4);
  assert.deepEqual(meter.sample(500), { fps: 30, drawMs: 4 });
  assert.deepEqual(meter.sample(1000), { fps: 0, drawMs: 0 }, 'Idle painting does not claim 60fps');
});

test('forced redraws in one frame do not inflate measured FPS; hidden-tab time can reset', () => {
  const meter = new FrameRateMeter();
  for (let i = 0; i <= 15; i++) {
    meter.record(i * RENDER_FRAME_MS, 2); meter.record(i * RENDER_FRAME_MS + 1, 4);
  }
  assert.deepEqual(meter.sample(501), { fps: 15 * 1000 / 501, drawMs: 3 });
  meter.reset(10000); assert.equal(meter.sample(10100), null);
  for (let i = 0; i <= 15; i++) meter.record(10100 + i * 1000 / 30, 1);
  assert.equal(meter.sample(10600).fps, 30);
});

test('live Pencil updates use the same 60fps grid without duplicate sends inside a frame', async () => {
  const original = globalThis.fetch, sent = [];
  globalThis.fetch = async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ next: 1 }) }; };
  try {
    const live = createLivePublisher(() => ({ id: 'stroke', samples: [] }), () => {});
    for (const time of [0, 8, FRAME_MS, FRAME_MS + 2, FRAME_MS * 2]) {
      live.publish(time);
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(sent.length, 3);
  } finally { globalThis.fetch = original; }
});

test('saved Place or p5 tool selections restore to an available Pencil drawing mode', () => {
  const restored = singleCanvasProject({ version: 1, clips: [], duration: 10000, settings: { mode: 'place', motionSource: 'p5' } });
  assert.equal(restored.settings.mode, 'move'); assert.equal(restored.settings.motionSource, 'pen');
  const move = singleCanvasProject({ version: 1, clips: [], duration: 10000, settings: { mode: 'move' } });
  assert.equal(move.settings.mode, 'move');
});
