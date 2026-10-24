import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLoopRelay, validateSnapshot } from '../server/loop-relay.js';
import { outputPhase, playbackSnapshot } from '../src/relay.js';
import { LoopClock } from '../src/loop.js';

const project = { version: 1, clips: [], duration: 6000, settings: { blurRadius: 64 } };
test('relay clocks use server time rather than the editor device wall clock', () => {
  const clock = new LoopClock(100, 6000);
  const state = validateSnapshot({ project, playback: playbackSnapshot(clock, 2600) }, 100000);
  assert.equal(state.playback.anchor, 97500);
  assert.equal(outputPhase(state, 104000), 500);
  state.playback.playing = false; assert.equal(outputPhase(state, 104000), 2500);
  assert.throws(() => validateSnapshot({ project, playback: { playing: true, phase: NaN } }, 100000));
  assert.throws(() => validateSnapshot({ project: { ...project, settings: { blurRadius: -1 } }, playback: { playing: true, phase: 0 } }, 100000));
  assert.throws(() => validateSnapshot({ project: { ...project, settings: { blurRadius: 161 } }, playback: { playing: true, phase: 0 } }, 100000));
  const maximumBlur = validateSnapshot({ project: { ...project, settings: { blurRadius: 160 } }, playback: { playing: true, phase: 0 } }, 100000);
  assert.equal(maximumBlur.project.settings.blurRadius, 160);
});
test('shared state reaches isolated browsers, persists on disk, and rejects malformed uploads', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'imagraph-relay-')), file = join(folder, 'cache/loop.json');
  const handler = await createLoopRelay(file);
  const server = createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/loop`;
  try {
    const initial = await (await fetch(url)).json(); assert.equal(initial.state, null);
    const snapshot = { project, playback: { playing: false, phase: 1500 } };
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) })).status, 200);
    const received = await (await fetch(url)).json(); assert.equal(received.state.playback.phase, 1500);
    assert.deepEqual(received.state.project, project);
    assert.equal((await (await fetch(`${url}?since=${received.version}`)).json()).state, null);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).playback.phase, 1500);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    const restored = await createLoopRelay(file); const second = createServer((req,res)=>restored(req,res,()=>res.end()));
    await new Promise(resolve=>second.listen(0,'127.0.0.1',resolve));
    try { const state = await (await fetch(`http://127.0.0.1:${second.address().port}/api/loop`)).json(); assert.equal(state.state.playback.phase, 1500); }
    finally { restored.dispose(); await new Promise(resolve=>second.close(resolve)); }
  } finally { handler.dispose(); await new Promise(resolve=>server.close(resolve)); await rm(folder, { recursive: true }); }
});
