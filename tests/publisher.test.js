import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublisher } from '../src/relay.js';

const settle = () => new Promise(setImmediate);
test('continuous completed taps publish bounded batches before tapping stops', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = globalThis.fetch, sent = []; let contacts = 0;
  globalThis.fetch = async (_url, options) => { sent.push(JSON.parse(options.body).contacts); return { ok: true }; };
  try {
    const publisher = createPublisher(() => ({ contacts }), () => {});
    for (let i = 0; i < 15; i++) { contacts++; publisher.publish(); t.mock.timers.tick(20); await settle(); }
    assert.deepEqual(sent, [5, 10, 15], 'Continuous updates do not postpone the entire project until the final tap');
  } finally { globalThis.fetch = original; t.mock.timers.reset(); }
});

test('project publishing stays single-flight and sends the newest pending contact state', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = globalThis.fetch, sent = [], responses = []; let contacts = 1;
  globalThis.fetch = (_url, options) => { sent.push(JSON.parse(options.body).contacts); return new Promise(resolve => responses.push(resolve)); };
  try {
    const publisher = createPublisher(() => ({ contacts }), () => {});
    publisher.publish(true); contacts = 2; publisher.publish(); t.mock.timers.tick(100);
    contacts = 3; publisher.publish(); assert.deepEqual(sent, [1]);
    responses.shift()({ ok: true }); await settle(); assert.deepEqual(sent, [1, 3]);
    responses.shift()({ ok: true }); await settle(); t.mock.timers.tick(100); await settle();
    assert.deepEqual(sent, [1, 3], 'A pending timer cannot resend the already flushed state');
  } finally { globalThis.fetch = original; t.mock.timers.reset(); }
});
