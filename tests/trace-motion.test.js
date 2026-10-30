import test from 'node:test';
import assert from 'node:assert/strict';
import { activeMotionDuration, largestShapePose, traceHead, traceHeadMarkers, traceHeadFrameWindow, MAX_TRACE_HEAD_MARKERS, tracePlaybackClip, traceSamplesAt, traceVisual, traceFillPolygons } from '../src/trace-motion.js';
import { DEFAULT_VIEW, canvasView } from '../src/view.js';
import { projectSpace, pointInSpace } from '../src/space.js';
import { RENDER_FRAME_MS } from '../src/timing.js';
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

const area = polygons => polygons.reduce((sum, polygon) => sum + Math.abs(polygon.reduce((a, p, i) => {
  const q = polygon[(i + 1) % polygon.length]; return a + p.x * q.y - p.y * q.x;
}, 0)) / 2, 0);

test('filled circle Trace sweeps from its center and completes a filled disk without changing the first cycle', () => {
  const source = base({ trace: { pending: true, drawMs: 500, strokeWidth: 70, peak: { x: 1920, y: 1080, size: 200, t: 100 } } });
  assert.equal(tracePlaybackClip(source), source); assert.equal(traceVisual(source, 250), null);
  const clip = tracePlaybackClip(finishFirstCycle(source));
  assert.equal(traceVisual(clip, 250).traceFill, true); assert.equal(traceVisual(clip, 250).strokeWidth, 0);
  assert.deepEqual(traceFillPolygons(clip, 0), []);
  const half = traceFillPolygons(clip, 250);
  assert.equal(half.length, 1); assert.ok(half.flat().every(p => p.x >= 1920 - 1e-6));
  assert.ok(Math.abs(area(half) / (Math.PI * 100 ** 2 / 2) - 1) < .001);
  const full = traceFillPolygons(clip, 500);
  assert.equal(full.length, 1); assert.ok(Math.abs(area(full) / (Math.PI * 100 ** 2) - 1) < .001);
  assert.equal(traceHead(clip, 500), null);
  const restored = parseProject(serializeProject({ version: 1, duration: 16000, clips: [finishFirstCycle(source)] }, { playing: true, phase: 0 })).project.clips[0];
  assert.equal(traceVisual(restored, 250).traceFill, true);
});

test('filled rectangle Trace follows perimeter distance, preserves its rotation and leaves Ring Trace outlined', () => {
  const source = base({ shape: 'rect', trace: { pending: false, drawMs: 500, strokeWidth: 20, peak: { x: 1920, y: 1080, size: 400, width: 400, height: 200, angle: 0, t: 100 } } });
  const head = traceHead(source, 125);
  assert.deepEqual(head, { x: 1907.5, y: 980, t: 125 });
  assert.equal(area(traceFillPolygons(source, 125)), 9375);
  assert.equal(area(traceFillPolygons(source, 500)), 80000);
  const rotated = { ...source, trace: { ...source.trace, peak: { ...source.trace.peak, angle: 90 } } };
  assert.ok(Math.abs(area(traceFillPolygons(rotated, 375)) - area(traceFillPolygons(source, 375))) < 1e-6);
  const rotatedHead = traceHead(rotated, 125); assert.ok(Math.abs(rotatedHead.x - 2020) < 1e-6); assert.ok(Math.abs(rotatedHead.y - 1067.5) < 1e-6);
  for (const shape of ['ring', 'rect-ring']) {
    const ring = tracePlaybackClip({ ...source, shape });
    assert.equal(traceVisual(ring, 250).traceFill, false); assert.equal(traceVisual(ring, 250).strokeWidth, 20);
    assert.deepEqual(traceFillPolygons(ring, 250), []);
  }
});

test('Trace heads cover the travel between 30fps positions with a bounded fading sweep on the contour',()=>{
 const clip=base({shape:'ring',trace:{pending:false,drawMs:500,strokeWidth:20,peak:{x:1920,y:1080,size:800,t:100}}});
 const markers=traceHeadMarkers(clip,250,DEFAULT_VIEW),head=projectSpace(pointInSpace(traceHead(clip,250)),DEFAULT_VIEW);
 assert.ok(markers.length>10&&markers.length<=MAX_TRACE_HEAD_MARKERS);assert.deepEqual(markers[0],{...head,alpha:1,traceHead:true});
 assert.ok(markers.slice(1).every(p=>p.alpha>0&&p.alpha<=.550001));
 for(const p of markers)assert.ok(Math.abs(Math.hypot(p.x-960,p.y-540)-400)<.5,'Interpolated circles stay on the curve');
 for(let i=1;i<=30;i++){
  const t=250-RENDER_FRAME_MS*(1-i/30),point=projectSpace(pointInSpace(traceHead(clip,t)),DEFAULT_VIEW);
  assert.ok(Math.min(...markers.map(p=>Math.hypot(p.x-point.x,p.y-point.y)))<7.5,'No detached white dots between frames');
 }
});

test('Trace head sweeps turn at rectangle corners without cutting diagonally across the fill',()=>{
 const clip=base({shape:'rect-ring',trace:{pending:false,drawMs:500,strokeWidth:20,peak:{x:1920,y:1080,size:400,width:400,height:200,t:100}}});
 const markers=traceHeadMarkers(clip,225,DEFAULT_VIEW);
 assert.ok(markers.length>2);assert.ok(markers.some(p=>Math.abs(p.x-1160)<1e-6&&Math.abs(p.y-440)<1e-6));
 assert.ok(markers.every(p=>Math.abs(p.x-1160)<1e-6||Math.abs(p.y-440)<1e-6));
 assert.deepEqual(traceHeadMarkers(clip,225,DEFAULT_VIEW),markers,'Seeking has no prior-frame image history');
 for(const time of[-1,500,750])assert.deepEqual(traceHeadMarkers(clip,time,DEFAULT_VIEW),[]);
 assert.deepEqual(traceHeadMarkers({...clip,trace:{...clip.trace,pending:true}},225,DEFAULT_VIEW),[]);
});

test('Trace head interpolation stays bounded through zoom and excludes hidden camera depths',()=>{
 const clip=base({shape:'ring',trace:{pending:false,drawMs:500,strokeWidth:20,peak:{x:1920,y:-420,size:3000,t:100}}});
 const markers=traceHeadMarkers(clip,250,canvasView({scale:5}),100);
 assert.ok(markers.length>0&&markers.length<=MAX_TRACE_HEAD_MARKERS);
 assert.ok(markers.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1920&&p.y>=0&&p.y<=1080));
 assert.deepEqual(traceHeadMarkers({...clip,origin:[0,0,6000]},250,DEFAULT_VIEW),[]);
});

test('head interpolation spans a missed frame but resets its short window on seeks and loop restarts',()=>{
 const before={phase:250,now:1000};
 assert.equal(traceHeadFrameWindow(undefined,250,1000),RENDER_FRAME_MS);
 assert.ok(Math.abs(traceHeadFrameWindow(before,250+2000/30,1000+2000/30)-2000/30)<1e-9);
 for(const [phase,now]of[[250,2000],[0,1033],[9000,1033],[260,900]])assert.equal(traceHeadFrameWindow(before,phase,now),RENDER_FRAME_MS);
});
