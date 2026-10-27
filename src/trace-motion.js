import { CANVAS_WIDTH as W, CANVAS_HEIGHT as H } from './canvas.js';
import { SmoothedCircle } from './motion.js';

const samplesByClip = new WeakMap();

const easeInOut = progress => progress * progress * (3 - 2 * progress);
function inverseEaseInOut(progress) {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    if (easeInOut(middle) < progress) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export function largestShapePose(clip) {
  const shape = clip.shape ?? 'circle';
  const circle = new SmoothedCircle(clip.samples[0], clip.color, 0);
  let next = 1, best = null, largest = -Infinity;
  const step = 1000 / 60;
  for (let time = 0; time < clip.duration + 750; time += step) {
    while (next < clip.samples.length && clip.samples[next].t <= time) {
      circle.update(clip.samples[next].t);
      circle.setTarget(clip.samples[next++]);
    }
    circle.update(time);
    const pose = circle.displayPoint();
    const size = ['rect', 'rect-ring'].includes(shape) ? (pose.width ?? pose.size) * (pose.height ?? pose.size) : pose.size ** 2;
    if (size > largest) { largest = size; best = { ...pose, t: time }; }
  }
  return best ?? { ...clip.samples[0] };
}

export function activeMotionDuration(clip) {
  return clip.trace && !clip.trace.pending ? clip.trace.drawMs : clip.duration;
}

function traceSamples(clip) {
  if (samplesByClip.has(clip)) return samplesByClip.get(clip);
  const trace = clip.trace, peak = trace?.peak;
  if (!trace || !peak) return [];
  const rect = ['rect', 'rect-ring'].includes(trace.sourceShape ?? clip.shape);
  const width = rect ? peak.width ?? peak.size : peak.size;
  const height = rect ? peak.height ?? peak.size : peak.size;
  const strokeWidth = trace.strokeWidth ?? 20;
  const perimeter = rect ? 2 * (width + height) : Math.PI * peak.size;
  const spacing = Math.max(2, Math.min(12, strokeWidth / 2));
  const count = Math.max(8, Math.ceil(perimeter / spacing));
  const angle = (peak.angle ?? clip.angle ?? 0) * Math.PI / 180;
  const point = (x, y, t) => ({
    x: Math.round(peak.x + x * Math.cos(angle) - y * Math.sin(angle)),
    y: Math.round(peak.y + x * Math.sin(angle) + y * Math.cos(angle)),
    size: strokeWidth,
    shape: 'circle',
    // Samples are spaced evenly along the contour; invert smoothstep so
    // playback eases into and out of the trace while preserving distance.
    t: trace.drawMs * inverseEaseInOut(t),
  });
  const points = [];
  if (rect) {
    const corners = [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2], [-width / 2, -height / 2]];
    const edges = corners.slice(1).map((p, i) => Math.hypot(p[0] - corners[i][0], p[1] - corners[i][1]));
    for (let i = 0; i <= count; i++) {
      let distance = perimeter * i / count, edge = 0;
      while (edge < edges.length - 1 && distance > edges[edge]) distance -= edges[edge++];
      const fraction = edges[edge] ? distance / edges[edge] : 0, a = corners[edge], b = corners[edge + 1];
      points.push(point(a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction, i / count));
    }
  } else {
    const radius = peak.size / 2;
    for (let i = 0; i <= count; i++) {
      const arcAngle = -Math.PI / 2 + i / count * Math.PI * 2;
      points.push(point(Math.cos(arcAngle) * radius, Math.sin(arcAngle) * radius, i / count));
    }
  }
  samplesByClip.set(clip, points);
  return points;
}

function atTime(points, time) {
  if (!points.length) return null;
  if (time <= points[0].t) return points[0];
  let low = 0, high = points.length - 1;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (points[middle].t <= time) low = middle; else high = middle - 1; }
  const a = points[low], b = points[low + 1];
  if (!b) return a;
  const fraction = (time - a.t) / (b.t - a.t);
  return { ...a, x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, t: time };
}

export function traceSamplesAt(clip, time = Infinity) {
  const points = traceSamples(clip);
  if (time >= (clip.trace?.drawMs ?? Infinity)) return points;
  const end = atTime(points, Math.max(0, time));
  return [...points.filter(point => point.t < time), ...(end ? [end] : [])];
}

export function tracePlaybackClip(clip) {
  const trace = clip.trace;
  if (!trace || trace.pending || !trace.peak) return clip;
  return { ...clip, mode: 'return', shape: 'circle', trace: { ...trace, sourceShape: trace.sourceShape ?? clip.shape }, samples: traceSamples(clip), duration: trace.drawMs };
}

export function traceHead(clip, time) {
  const drawMs = clip.trace?.drawMs;
  if (drawMs == null || time >= drawMs) return null;
  return atTime(traceSamples(clip), Math.max(0, time));
}
