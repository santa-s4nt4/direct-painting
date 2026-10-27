import test from 'node:test';
import assert from 'node:assert/strict';
import { activeMotionDuration, largestShapePose, traceHead, tracePlaybackClip, traceSamplesAt } from '../src/trace-motion.js';
import { LineSchedule, finishFirstCycle } from '../src/line-tool.js';
import { validateProject } from '../src/loop.js';
import { DEFAULT_SETTINGS, normalizeProject, parseProject, serializeProject } from '../src/project.js';
import { validateSnapshot } from '../server/loop-relay.js';

const base = (extra = {}) => ({
  id: 'trace', mode: 'move', shape: 'circle', color: '#ff0000', targets: [0], enabled: true,
  duration: 100, start: 3000, fadeMs: 500, ringWidth: 20,
  samples: [{ x: 1920, y: 1080, size: 20, t: 0 }, { x: 2100, y: 1000, size: 200, t: 100 }],
  ...extra,
});

test('largest pose follows eased display geometry through release and keeps one rectangle pose', () => {
  const circle = largestShapePose(base());
  assert.ok(circle.size > 199);
  assert.ok(circle.t > 100 && circle.t <= 850);
  const rectangle = largestShapePose(base({
    shape: 'rect', samples: [
      { x: 1920, y: 1080, size: 80, width: 80, height: 100, angle: 10, t: 0 },
      { x: 2100, y: 1000, size: 80, width: 300, height: 40, angle: 60, t: 100 },
      { x: 2000, y: 1050, size: 80, width: 100, height: 200, angle: 20, t: 200 },
    ], duration: 200,
  }));
  assert.ok(rectangle.width * rectangle.height > 20000);
  assert.ok(rectangle.width > 100 && rectangle.height > 40);
});

test('trace samples form a clockwise eased contour with exact endpoints and an interpolated head', () => {
  const clip = base({ trace: { pending: false, drawMs: 1000, strokeWidth: 12, peak: { x: 1920, y: 1080, size: 200, t: 100 } } });
  const halfway = traceSamplesAt(clip, 500), head = traceHead(clip, 500), complete = traceSamplesAt(clip);
  assert.equal(halfway[0].x, 1920);
  assert.equal(halfway[0].y, 980);
  assert.ok(Math.abs(head.x - 1920) < 2);
  assert.ok(head.y > 1170);
  assert.equal(complete[0].x, complete.at(-1).x);
  assert.equal(complete[0].y, complete.at(-1).y);
  assert.equal(complete.at(-1).t, 1000);
  assert.equal(activeMotionDuration(clip), 1000);
  assert.equal(activeMotionDuration({ ...clip, trace: { ...clip.trace, pending: true } }), clip.duration);
});

test('completed Trace keeps source data, uses its draw time, and participates in the next-loop gate', () => {
  const clip = base({ trace: { pending: true, drawMs: 1200, strokeWidth: 15, peak: { x: 1920, y: 1080, size: 200, t: 100 } } });
  const rendererClip = tracePlaybackClip(finishFirstCycle(clip));
  assert.equal(clip.trace.pending, true);
  assert.equal(rendererClip.mode, 'return');
  assert.equal(rendererClip.duration, 1200);
  assert.equal(rendererClip.samples[0].t, 0);
  assert.equal(activeMotionDuration(rendererClip), 1200);
  const schedule = new LineSchedule();
  schedule.rebase([clip], 15000, 16000, 0);
  assert.deepEqual(schedule.advance([clip], 15900, 16000, 900, true), new Set());
  assert.deepEqual(schedule.advance([clip], 0, 16000, 1000, true), new Set());
  assert.deepEqual(schedule.advance([clip], 3000, 16000, 4000, true), new Set(['trace']));
});

test('trace validation allows eased release peaks and rejects invalid dimensions or duration', () => {
  const rect = base({ shape: 'rect', trace: { pending: true, drawMs: 1000, strokeWidth: 20, peak: { x: 1920, y: 1080, size: 100, width: 300, height: 200, angle: 45, t: 800 } } });
  assert.equal(validateProject({ version: 1, duration: 16000, clips: [rect] }).clips[0].trace.peak.t, 800);
  assert.throws(() => validateProject({ version: 1, duration: 16000, clips: [{ ...rect, trace: { ...rect.trace, drawMs: 10001 } }] }));
  assert.throws(() => validateProject({ version: 1, duration: 16000, clips: [{ ...rect, trace: { ...rect.trace, peak: { ...rect.trace.peak, width: undefined } } }] }));
});

test('new Motion and intersection settings default off and round-trip in saved projects', () => {
  assert.equal(DEFAULT_SETTINGS.traceMotion, false);
  assert.equal(DEFAULT_SETTINGS.intersections, false);
  assert.equal(DEFAULT_SETTINGS.traceDurationMs, 500);
  const source = normalizeProject({ version: 1, duration: 16000, clips: [base({ trace: { pending: true, drawMs: 1400, strokeWidth: 18, peak: { x: 1920, y: 1080, size: 200, t: 100 } } })], settings: { traceMotion: true, traceDurationMs: 1400, intersections: true } });
  const restored = parseProject(serializeProject(source, { playing: false, phase: 0 })).project;
  assert.equal(restored.settings.traceMotion, true);
  assert.equal(restored.settings.traceDurationMs, 1400);
  assert.equal(restored.settings.intersections, true);
  assert.equal(restored.clips[0].trace.pending, true);
  const packet = { project: source, playback: { playing: false, phase: 0 } };
  assert.equal(validateSnapshot(packet, 10).project.settings.intersections, true);
  assert.throws(() => validateSnapshot({ ...packet, project: { ...source, settings: { ...source.settings, traceMotion: 'yes' } } }, 10));
  assert.throws(() => validateSnapshot({ ...packet, project: { ...source, settings: { ...source.settings, traceDurationMs: 10 } } }, 10));
});
