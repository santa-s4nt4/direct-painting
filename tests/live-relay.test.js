import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLoopRelay } from '../server/loop-relay.js';
const project = { version: 1, duration: 6000, clips: [], settings: {} };
const live = { session: 'editor', revision: 1, id: 'first', mode: 'return', color: '#ff0000', targets: [0, 1], from: 0, elapsed: 100, samples: [{ x: 40, y: 80, size: 20, t: 0 }], head: { x: 40, y: 80, size: 20, t: 100 } };
test('SSE pushes the first live point, syncs late readers, and atomically commits without ghost frames', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'imagraph-live-')), file = join(folder, 'loop.json'), handler = await createLoopRelay(file);
  const server = createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, value) => { const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); assert.equal(response.status, 200); return response.json(); };
  let reader;
  try {
    await post('/api/loop', { project, playback: { playing: true, phase: 1000 }, liveState: { session: 'editor', revision: 1, id: 'first' } });
    const response = await fetch(base + '/api/stream'); assert.match(response.headers.get('content-type'), /event-stream/); reader = response.body.getReader(); const decoder = new TextDecoder(); let text = '';
    const event = async type => { while (!text.includes(`event: ${type}\n`) || !text.slice(text.indexOf(`event: ${type}\n`)).includes('\n\n')) { const part = await reader.read(); text += decoder.decode(part.value); } const start = text.indexOf(`event: ${type}\n`), end = text.indexOf('\n\n', start), block = text.slice(start, end); text = text.slice(end + 2); return JSON.parse(block.split('\ndata: ')[1]); };
    await event('state'); assert.deepEqual(await post('/api/live', live), { next: 1 });
    const first = await event('live'); assert.equal(first.live.samples[0].x, 40);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).live, undefined);
    const delta = { ...live, from: 1, elapsed: 200, samples: [{ x: 140, y: 80, size: 30, t: 200 }], head: { x: 140, y: 80, size: 30, t: 200 } };
    assert.deepEqual(await post('/api/live', delta), { next: 2 }); await event('live');
    const late = await (await fetch(base + '/api/loop')).json(); assert.equal(late.live.samples.length, 2); assert.equal(late.live.from, 0);
    const clip = { id: 'first', mode: 'return', color: '#ff0000', enabled: true, targets: [0, 1], start: 1000, duration: 200, samples: late.live.samples };
    await post('/api/loop', { project: { ...project, clips: [clip] }, playback: { playing: true, phase: 1200 }, liveState: { session: 'editor', revision: 2, id: null } });
    const committed = await event('state'); assert.equal(committed.live, null); assert.equal(committed.state.project.clips[0].id, 'first');
    await post('/api/live', { ...delta, from: 2, elapsed: 300, samples: [] }); // A late request must not resurrect the live stroke.
    assert.equal((await (await fetch(base + '/api/loop')).json()).live, null);
    await post('/api/live', { ...live, revision: 3, id: 'next' });
    // An older idle snapshot arriving after a new gesture must not clear it.
    await post('/api/loop', { project, playback: { playing: true, phase: 1500 }, liveState: { session: 'editor', revision: 2, id: null } });
    assert.equal((await (await fetch(base + '/api/loop')).json()).live.id, 'next');
  } finally { await reader?.cancel(); handler.dispose(); await new Promise(resolve => server.close(resolve)); await rm(folder, { recursive: true }); }
});
