import test from 'node:test';
import assert from 'node:assert/strict';
import { findIntersections, IntersectionDetector, IntersectionPulseTracker } from '../src/intersections.js';
import { DEFAULT_VIEW } from '../src/view.js';
import { projectSpace } from '../src/space.js';

const clip = (id, shape = 'circle', extra = {}) => ({ id, mode: 'move', shape, plane: [1,0,0,0,1,0,0,0,1], origin: [0,0,0], trace: undefined, ...extra });
const entry = (id, visual, shape = visual.shape, extra = {}) => ({ clip: clip(id, shape, extra.clip), visual, time: extra.time ?? 0, alpha: extra.alpha ?? 1 });

test('coplanar filled faces produce one point inside their overlapping area', () => {
  const markers = findIntersections([
    entry('circle', { x: 1920, y: 1080, size: 400, shape: 'circle' }),
    entry('rect', { x: 2155, y: 1080, width: 80, height: 500, size: 500, shape: 'rect' }, 'rect'),
  ], DEFAULT_VIEW);
  assert.equal(markers.length, 1);
  const { world, alpha } = markers[0];
  assert.ok(Math.hypot(world[0], world[1]) <= 200.05);
  assert.ok(Math.abs(world[0] - 235) <= 40.05 && Math.abs(world[1]) <= 250.05);
  assert.equal(alpha, 1);
});

test('projection-only overlap on separate planes produces no physical intersection', () => {
  const visual = { x: 1920, y: 1080, size: 400, shape: 'circle' };
  assert.deepEqual(findIntersections([entry('a', visual), entry('b', visual, 'circle', { clip: { origin: [0, 0, 100] } })], DEFAULT_VIEW), []);
});

test('noncoplanar face intersections use the real 3D overlap segment', () => {
  const visual = { x: 1920, y: 1080, width: 300, height: 300, size: 300, shape: 'rect' };
  const markers = findIntersections([
    entry('xy', visual),
    entry('yz', visual, 'rect', { clip: { plane: [0,0,1, 0,1,0, -1,0,0] } }),
  ], DEFAULT_VIEW);
  assert.equal(markers.length, 1); assert.ok(markers[0].world.every(value => Math.abs(value) < 1e-6));
});

test('coplanar face intersections exclude the empty hole of an outline shape', () => {
  const ring = entry('ring', { x: 1920, y: 1080, size: 400, shape: 'ring' }, 'ring', { clip: { ringWidth: 20 } });
  const insideHole = entry('disk', { x: 1920, y: 1080, size: 100, shape: 'circle' });
  assert.deepEqual(findIntersections([ring, insideHole], DEFAULT_VIEW), []);
  insideHole.visual.x = 2110;
  const markers = findIntersections([ring, insideHole], DEFAULT_VIEW);
  assert.equal(markers.length, 1);
  assert.ok(Math.hypot(...markers[0].world.slice(0, 2)) >= 180 - 0.05);
});

const traceEntry = (id, x, shape = 'rect-ring') => ({ clip: clip(id, shape, { trace: { pending: false, sourceShape: shape, drawMs: 500, strokeWidth: 20, peak: { x, y: 1080, size: 300, width: 300, height: 200, t: 0 } } }), visual: null, time: 500, alpha: 1 });

test('Trace face queries cull distant capsules and reuse world intersections when only the camera changes', () => {
  const entries = [traceEntry('a', 1920), traceEntry('b', 2020)], detector = new IntersectionDetector();
  const first = detector.find(entries, DEFAULT_VIEW);
  assert.equal(first.length, 1);
  assert.ok(detector.stats.polygonClips < 800, `Only nearby capsules should be clipped: ${detector.stats.polygonClips}`);
  assert.ok(detector.stats.patchPairs < 2000);
  const rotatedView = { ...DEFAULT_VIEW, yaw: 25, pitch: 10 }, rotated = detector.find(entries, rotatedView);
  assert.equal(detector.stats.facesBuilt, 0); assert.equal(detector.stats.pairsSolved, 0); assert.equal(detector.stats.pairCacheHits, 1);
  assert.deepEqual(rotated[0].world, first[0].world);
  assert.deepEqual({ x: rotated[0].x, y: rotated[0].y }, projectSpace(first[0].world, rotatedView));
});

test('geometry changes invalidate intersections without caching layer fade opacity', () => {
  const entries = [entry('a', { x: 1920, y: 1080, size: 300, shape: 'circle' }), entry('b', { x: 2020, y: 1080, size: 300, shape: 'circle' })], detector = new IntersectionDetector();
  assert.equal(detector.find(entries, DEFAULT_VIEW).length, 1);
  entries[0].alpha = 0.6;
  assert.equal(detector.find(entries, DEFAULT_VIEW)[0].alpha, 0.6); assert.equal(detector.stats.pairCacheHits, 1);
  entries[1].visual.x = 3000;
  assert.deepEqual(detector.find(entries, DEFAULT_VIEW), []); assert.equal(detector.stats.facesBuilt, 1);
  entries[0].alpha = 0.49;
  assert.deepEqual(detector.find(entries, DEFAULT_VIEW), []); assert.equal(detector.stats.pairsSolved, 0);
});

test('intersection pulses stop immediately below 50% source opacity and reproject held world positions', () => {
  const entries = [entry('a', { x: 1920, y: 1080, size: 300, shape: 'circle' }), entry('b', { x: 2020, y: 1080, size: 300, shape: 'circle' })];
  const tracker = new IntersectionPulseTracker(), detector = new IntersectionDetector(), markers = detector.find(entries, DEFAULT_VIEW);
  assert.equal(tracker.update(0, markers, 0, {}, DEFAULT_VIEW, entries).length, 1);
  const movedView = { ...DEFAULT_VIEW, yaw: 30 };
  const held = tracker.update(0, [], 50, {}, movedView, entries)[0];
  assert.deepEqual({ x: held.x, y: held.y }, projectSpace(markers[0].world, movedView));
  entries[0].alpha = 0.49;
  assert.deepEqual(tracker.update(0, detector.find(entries, movedView), 100, {}, movedView, entries), []);
});

test('intersection search skips same-layer shapes and invisible layers', () => {
  const circle = { x: 1920, y: 1080, size: 400, shape: 'circle' };
  const rect = { x: 2155, y: 1080, width: 80, height: 500, size: 500, shape: 'rect' };
  assert.deepEqual(findIntersections([entry('same', circle), entry('same', rect, 'rect')], DEFAULT_VIEW), []);
  assert.deepEqual(findIntersections([entry('visible', circle), entry('hidden', rect, 'rect', { alpha: 0 })], DEFAULT_VIEW), []);
});

test('Trace intersections only consider the portion drawn by the current source time', () => {
  const trace = clip('trace', 'circle', { trace: { pending: false, sourceShape: 'circle', drawMs: 1000, strokeWidth: 12, peak: { x: 1920, y: 1080, size: 300, t: 0 } } });
  const crossing = entry('crossing', { x: 2060, y: 1080, width: 20, height: 400, size: 400, shape: 'rect' }, 'rect');
  const traceEntry = time => ({ clip: trace, visual: null, time, alpha: 1 });
  assert.deepEqual(findIntersections([traceEntry(100), crossing], DEFAULT_VIEW), []);
  assert.ok(findIntersections([traceEntry(500), crossing], DEFAULT_VIEW).length > 0);
});

test('filled Trace intersections include the swept interior, exclude unpainted sectors and ignore stroke width', () => {
  for (const shape of ['circle', 'rect']) {
    const filled = traceEntry('filled', 1920, shape), detector = new IntersectionDetector();
    const disk = entry('inside', { x: 1970, y: 1040, size: 20, shape: 'circle' });
    filled.time = 0; assert.deepEqual(detector.find([filled, disk], DEFAULT_VIEW), []);
    filled.time = 250; assert.equal(detector.find([filled, disk], DEFAULT_VIEW).length, 1);
    disk.visual.x = 1870; disk.visual.y = 1120; assert.deepEqual(detector.find([filled, disk], DEFAULT_VIEW), []);
    filled.time = 500; assert.equal(detector.find([filled, disk], DEFAULT_VIEW).length, 1);
    filled.clip.trace.strokeWidth = 1000; disk.visual.x = 2400;
    assert.deepEqual(detector.find([filled, disk], DEFAULT_VIEW), [], 'A wide stroke cannot grow the filled face');
    disk.visual.x = 1970; disk.clip.origin = [0, 0, 50];
    assert.deepEqual(detector.find([filled, disk], DEFAULT_VIEW), [], 'Projection-only overlap is still excluded');
  }
});
