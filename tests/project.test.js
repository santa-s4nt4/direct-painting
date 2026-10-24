import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeProject, parseProject, normalizeProject } from '../src/project.js';
import { resizeGesture } from '../src/loop.js';
const clip = { id: 'layer', mode: 'move', color: '#001122', enabled: false, targets: [0, 1], start: 500, duration: 100, fadeMs: 800, samples: [{ x: 10, y: 20, size: 20, pressure: .25, t: 0 }, { x: 30, y: 40, size: 40, pressure: .75, t: 100 }] };
test('JSON round-trip preserves edited diameters, color, motion, hidden layers and playback', () => {
  const project = normalizeProject({ version: 1, duration: 4000, clips: [resizeGesture(clip, 'max', 90)], settings: { blurRadius: 123, minSize: 12, maxSize: 200, sync: true, exportFormat: 'rgba' } });
  const playback = { playing: false, phase: 1500 };
  assert.deepEqual(parseProject(serializeProject(project, playback)), { project, playback });
  assert.deepEqual(parseProject(JSON.stringify(project)).project, project);
  assert.equal(parseProject(serializeProject(project, playback)).project.clips[0].enabled, false);
});
test('JSON validation rejects malformed files and settings before a project can be replaced', () => {
  assert.throws(() => parseProject('{'));
  assert.throws(() => parseProject(JSON.stringify({ format: 'unrelated', project: {} })));
  for (const settings of [{ blurRadius: 999 }, { color: 'bad' }, { pressure: 'yes' }, { minSize: 200, maxSize: 10 }, { mode: 'invalid' }, { exportFormat: 'exe' }]) assert.throws(() => normalizeProject({ version: 1, duration: 4000, clips: [clip], settings }));
  assert.throws(() => normalizeProject({ version: 1, duration: Infinity, clips: [] }));
  assert.throws(() => parseProject(JSON.stringify({ project: { version: 1, duration: 4000, clips: [clip] }, playback: { playing: true, phase: -1 } })));
});
