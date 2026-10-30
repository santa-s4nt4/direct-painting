import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { setupMidiIndicators, MIDI_FLASH_MS } from '../src/midi-indicators.js';
import { setupMidiPanel } from '../src/midi-panel.js';

function dom() {
  const window = new Window(), old = new Map();
  for (const [key, value] of Object.entries({ window, document: window.document, Option: function(text, value) { const option = window.document.createElement('option'); option.textContent = text; option.value = value; return option; } })) {
    old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  return { window, async restore() { await window.happyDOM.abort(); for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } } };
}
const note = (number, extra = {}) => ({ type: 'on', note: number, channel: 1, velocity: 100, ...extra });

test('MIDI rows flash immediately, repeat in place and snap back after the last receipt', async t => {
  const env = dom(); t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const indicators = setupMidiIndicators(document.body), rows = () => [...document.querySelectorAll('.midi-indicators li')];
    indicators.receive(note(60, { epoch: 'a', revision: 1 })); const first = rows()[0];
    assert.ok(first.classList.contains('is-active')); assert.equal(first.textContent, '60');
    t.mock.timers.tick(60); indicators.receive(note(60, { channel: 2, epoch: 'a', revision: 2 }));
    assert.equal(rows().length, 1); assert.equal(rows()[0], first, 'Same note on another channel flashes the existing row');
    t.mock.timers.tick(60); assert.ok(first.classList.contains('is-active'));
    t.mock.timers.tick(MIDI_FLASH_MS - 60); assert.equal(first.classList.contains('is-active'), false);
    indicators.receive(note(60, { epoch: 'a', revision: 1 })); assert.equal(first.classList.contains('is-active'), false, 'An old event cannot reflash');
    for (const message of [note(61, { type: 'off' }), note(61, { velocity: 0 }), note(-1), note(128)]) indicators.receive(message);
    assert.equal(rows().length, 1);
    indicators.receive(note(60, { epoch: 'b', revision: 1 })); assert.ok(first.classList.contains('is-active'), 'A restarted server has its own event epoch');
    indicators.dispose(); assert.equal(document.querySelector('.midi-indicators'), null);
  } finally { t.mock.timers.reset(); await env.restore(); }
});

test('MIDI indicators keep ten rows in discovery order and replace the oldest new-note slot', async t => {
  const env = dom(); t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const indicators = setupMidiIndicators(document.body), values = () => [...document.querySelectorAll('.midi-indicators li')].map(row => Number(row.dataset.note));
    for (const n of [60, 24, 72, 48, 36, 61, 62, 63, 64, 65]) indicators.receive(note(n));
    assert.deepEqual(values(), [60, 24, 72, 48, 36, 61, 62, 63, 64, 65]);
    indicators.receive(note(24)); assert.equal(values()[1], 24);
    indicators.receive(note(66)); assert.deepEqual(values(), [24, 72, 48, 36, 61, 62, 63, 64, 65, 66]);
    t.mock.timers.tick(MIDI_FLASH_MS); assert.equal(document.querySelectorAll('.midi-indicators .is-active').length, 0);
    window.dispatchEvent(new env.window.Event('pagehide')); assert.equal(document.querySelector('.midi-indicators'), null);
  } finally { t.mock.timers.reset(); await env.restore(); }
});

test('MIDI panel forwards streamed note receipts immediately without waiting for polling', async () => {
  const env = dom(), oldFetch = globalThis.fetch, oldStream = globalThis.EventSource, streams = [], received = [];
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ available: true, selected: '', devices: [] }) });
    globalThis.EventSource = class { events = new Map(); constructor() { streams.push(this); } addEventListener(type, fn) { this.events.set(type, fn); } close() { this.closed = true; } };
    setupMidiPanel(document.body, () => {}, { onNote: message => received.push(message) });
    const receipt = note(42, { epoch: 'a', revision: 1 }); streams[0].events.get('midi')({ data: JSON.stringify(receipt) });
    assert.deepEqual(received, [receipt]);
    await new Promise(setImmediate); window.dispatchEvent(new env.window.Event('pagehide')); assert.equal(streams[0].closed, true);
  } finally { globalThis.fetch = oldFetch; globalThis.EventSource = oldStream; await env.restore(); }
});
