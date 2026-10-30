import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_VIEW } from '../src/view.js';
import { DEFAULT_CAMERA } from '../src/camera-motion.js';
import { RENDER_FRAME_MS } from '../src/timing.js';

for (const refreshRate of [60, 120, 144]) test(`output stays at 30fps on ${refreshRate}Hz despite live, view and MIDI invalidations`, async () => {
  const window = new Window({ url: 'http://localhost/output' }), previous = new Map(), streams = [], calls = [];
  const folder = await mkdtemp(join(tmpdir(), 'direct-output-timing-')); let raf;
  window.document.body.innerHTML = '<div id="app"></div>';
  const serverNow = Date.now(), state = { project: { version: 1, duration: 16000, clips: [], settings: { view: DEFAULT_VIEW, camera: DEFAULT_CAMERA } }, playback: { playing: true, anchor: serverNow, phase: 0 } };
  class Events {
    constructor() { this.listeners = new Map(); streams.push(this); }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    emit(name, data) { this.listeners.get(name)?.({ data: JSON.stringify(data) }); }
    close() { this.listeners.clear(); }
  }
  const mock = canvas => ({ canvas, outputWidth: canvas.width, outputHeight: canvas.height, setProject() {}, setView() {}, receiveLive() {},
    setOutputSize(width, height) { this.outputWidth = width; this.outputHeight = height; },
    draw(_side, phase, options) { if (options) calls.push({ now: options.now, phase }); },
  });
  const globals = { window, document: window.document, EventSource: Events, requestAnimationFrame: fn => { raf = fn; return 1; },
    fetch: async () => new Response(JSON.stringify({ state, version: 1, serverNow, live: null, liveVersion: 0 }), { headers: { 'Content-Type': 'application/json' } }),
    __outputTestMocks: { createPaintingRenderer: mock },
  };
  for (const [key, value] of Object.entries(globals)) { previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); }
  try {
    let source = await readFile(resolve('src/output.js'), 'utf8');
    source = source.replace(/^import '\.\/output\.css';\n/m, '')
      .replace(/^import \{ createPaintingRenderer \} from '\.\/render\/index\.js';$/m, 'const { createPaintingRenderer } = globalThis.__outputTestMocks;')
      .replace(/from '(\.\/[^']+)'/g, (_all, file) => `from '${pathToFileURL(resolve('src', file))}'`);
    const entry = join(folder, 'output.mjs'); await writeFile(entry, 'const setTimeout=window.setTimeout.bind(window),clearTimeout=window.clearTimeout.bind(window);\n' + source);
    await import(pathToFileURL(entry).href); await new Promise(setImmediate);
    const start = (Math.ceil(performance.now() / RENDER_FRAME_MS) + 1) * RENDER_FRAME_MS;
    for (let i = 0; i < refreshRate; i++) {
      for (const stream of streams) {
        stream.emit('camera', { epoch: 'timing', revision: i + 1, config: DEFAULT_CAMERA });
        stream.emit('view', { version: i + 2, view: DEFAULT_VIEW });
        stream.emit('live', { live: null, liveVersion: i + 1 });
      }
      const callback = raf; raf = null; assert.ok(callback); callback(start + i * 1000 / refreshRate);
    }
    assert.equal(calls.length, 30, 'Frequent messages cannot bypass the presentation cap');
    const elapsed = calls.at(-1).phase - calls[0].phase;
    assert.ok(elapsed > 940 && elapsed < 1000, 'Playback still advances by one real second, not half speed');
  } finally {
    window.dispatchEvent(new window.Event('pagehide')); await window.happyDOM.abort();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    await rm(folder, { recursive: true, force: true });
  }
});
