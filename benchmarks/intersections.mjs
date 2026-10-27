// CPU geometry benchmark; does not alter the project or require a GPU context.
// node benchmarks/intersections.mjs [--project .direct-painting/loop.json]
import { readFile } from 'node:fs/promises';
import { IntersectionDetector } from '../src/intersections.js';
import { CachedGesture, gestureVisible, gestureTime, gestureOpacity } from '../src/loop.js';
import { lineGeometry } from '../src/space.js';
import { DEFAULT_VIEW } from '../src/view.js';

const summarize = times => {
  const sorted = [...times].sort((a, b) => a - b);
  return { frames: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0, p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0, maxMs: sorted.at(-1) ?? 0 };
};
const trace = (id, x, shape, size) => ({
  clip: { id, mode: 'move', shape, trace: { pending: false, sourceShape: shape, drawMs: 500, strokeWidth: 20, peak: { x, y: 1080, size, width: size, height: size * 2 / 3, t: 0 } } },
  visual: null, time: 500, alpha: 1,
});
const report = [];
for (const [shape, size, count] of [['circle', 300, 2], ['rect', 300, 2], ['circle', 800, 6]]) {
  const detector = new IntersectionDetector(), entries = Array.from({ length: count }, (_, i) => trace(String(i), 1920 + i * 100, shape, size));
  const changing = [], cameraOnly = [];
  let markers;
  for (let frame = 0; frame < 30; frame++) {
    for (const entry of entries) entry.time = frame * 500 / 29;
    const start = performance.now(); markers = detector.find(entries, DEFAULT_VIEW); changing.push(performance.now() - start);
  }
  const completedStats = { ...detector.stats };
  for (let frame = 0; frame < 120; frame++) {
    const start = performance.now(); detector.find(entries, { ...DEFAULT_VIEW, yaw: frame / 2 }); cameraOnly.push(performance.now() - start);
  }
  report.push({ name: `${count} ${size}px ${shape} traces`, markers: markers.length, drawing: summarize(changing), cameraOnly: summarize(cameraOnly), completedStats, cachedStats: detector.stats });
}

const projectIndex = process.argv.indexOf('--project');
if (projectIndex !== -1) {
  const saved = JSON.parse(await readFile(process.argv[projectIndex + 1], 'utf8')), project = saved.project ?? saved.state?.project ?? saved;
  const detector = new IntersectionDetector(), view = project.settings?.view ?? DEFAULT_VIEW;
  const items = project.clips.map(clip => ({ clip, gesture: (clip.mode === 'move' || clip.mode === 'place') && !(clip.trace && !clip.trace.pending) ? new CachedGesture(clip) : null }));
  const times = [], activeTimes = [];
  let slowestPhase = 0, maxMs = 0;
  for (let frame = 0; frame < Math.ceil(project.duration * 60 / 1000); frame++) {
    const phase = frame * 1000 / 60;
    const entries = items.flatMap(({ clip, gesture }) => {
      if (!clip.enabled || !gestureVisible(clip, phase, project.duration)) return [];
      const time = gestureTime(clip, phase, project.duration), alpha = gestureOpacity(clip, time) * (clip.opacity ?? 1);
      if (clip.mode === 'line' && clip.points3D) {
        const geometry = lineGeometry(clip, view);
        return [{ clip: { ...clip, plane: geometry.plane, origin: geometry.origin }, visual: geometry.visual, time, alpha }];
      }
      const visual = gesture?.render(time) ?? null;
      return visual?.active === false ? [] : [{ clip, visual, time, alpha: alpha * (visual?.opacity ?? 1) }];
    });
    const start = performance.now(); detector.find(entries, view); const ms = performance.now() - start;
    times.push(ms); if (entries.filter(entry => entry.alpha >= 0.5).length >= 2) activeTimes.push(ms);
    if (ms > maxMs) { maxMs = ms; slowestPhase = phase; }
  }
  report.push({ name: 'Saved project', layers: project.clips.length, loop: summarize(times), intersectingFrames: summarize(activeTimes), slowestPhase });
}
console.log(JSON.stringify(report, null, 2));
