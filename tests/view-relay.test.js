import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLoopRelay } from '../server/loop-relay.js';

test('small view updates reach SSE and late outputs, reject stale snapshots, save and reset', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'direct-view-')), file = join(folder, 'loop.json'), handler = await createLoopRelay(file);
  const server = createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, value) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const initial = { scale: 1, x: -960, y: -540 }, zoomed = { scale: 2, x: -960, y: -540 }, viewState = { session: 'editor', revision: 0, view: initial };
  const snapshot = { project: { version: 1, duration: 10000, clips: [], settings: { view: initial } }, playback: { playing: false, phase: 900 }, viewState };
  let reader;
  try {
    assert.equal((await post('/api/loop', snapshot)).status, 200);
    reader = (await fetch(base + '/api/stream')).body.getReader(); const decoder = new TextDecoder(); let text = '';
    const event = async type => { while (!text.includes(`event: ${type}\n`) || !text.slice(text.indexOf(`event: ${type}\n`)).includes('\n\n')) { const part = await reader.read(); text += decoder.decode(part.value); } const start = text.indexOf(`event: ${type}\n`), end = text.indexOf('\n\n', start), block = text.slice(start, end); text = text.slice(end + 2); return JSON.parse(block.split('\ndata: ')[1]); };
    await event('state');
    assert.equal((await post('/api/view', { ...viewState, revision: 2, view: zoomed })).status, 200);
    assert.deepEqual((await event('view')).view, zoomed);
    let state = await (await fetch(base + '/api/loop')).json(); assert.deepEqual(state.state.project.settings.view, zoomed); assert.equal(state.state.playback.phase, 900);
    await post('/api/view', { ...viewState, revision: 1 }); await post('/api/loop', snapshot);
    state = await (await fetch(base + '/api/loop')).json(); assert.deepEqual(state.state.project.settings.view, zoomed);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).project.settings.view, zoomed);
    assert.equal((await post('/api/view', { ...viewState, revision: 3, view: { scale: 99, x: 0, y: 0 } })).status, 400);
    for (const view of [{ scale: .09, x: 0, y: 0 }, { scale: 2.01, x: 0, y: 0 }, { scale: 1, x: 1, y: 0 }, { scale: 1, x: -1921, y: 0 }, { scale: .5, x: -1, y: 0 }]) assert.equal((await post('/api/view', { ...viewState, revision: 3, view })).status, 400);
    const tiny = { scale: .1, x: 768, y: 432 };
    assert.equal((await post('/api/view', { ...viewState, revision: 3, view: tiny })).status, 200);
    assert.deepEqual((await event('view')).view, tiny);
    await post('/api/view', { ...viewState, revision: 4 }); await post('/api/loop', { ...snapshot, viewState: { ...viewState, revision: 4 } });
    state = await (await fetch(base + '/api/loop')).json(); assert.deepEqual(state.state.project.settings.view, initial);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).project.settings.view, initial);
  } finally { await reader?.cancel(); handler.dispose(); await new Promise(resolve => server.close(resolve)); await rm(folder, { recursive: true }); }
});
