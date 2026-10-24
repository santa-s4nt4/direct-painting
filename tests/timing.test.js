import test from 'node:test';
import assert from 'node:assert/strict';
import { FPS, FRAME_MS, frameNumber } from '../src/timing.js';
import { createLivePublisher } from '../src/relay.js';
import { singleCanvasProject } from '../src/project.js';

test('60Hz frame grid retains 60 updates on 60Hz, 120Hz and 144Hz displays', () => {
  assert.equal(FPS, 60); assert.equal(FRAME_MS, 1000 / 60);
  for (const refreshRate of [60, 120, 144]) {
    const frames = new Set(Array.from({ length: refreshRate }, (_, i) => frameNumber(i * 1000 / refreshRate)));
    assert.equal(frames.size, 60, `${refreshRate}Hz display`);
  }
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
  assert.equal(restored.settings.mode, 'trail'); assert.equal(restored.settings.motionSource, 'pen');
  const move = singleCanvasProject({ version: 1, clips: [], duration: 10000, settings: { mode: 'move' } });
  assert.equal(move.settings.mode, 'move');
});
