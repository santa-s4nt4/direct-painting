import { upgradedEffects } from '../effects.js';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../canvas.js';
import { strokePoints } from '../drawing.js';
import { sampleAt } from '../loop.js';

// Geometry has no Canvas/WebGL dependency. The saved x/y/pressure/t data remains
// the source of truth; a future 3D renderer can consume it without UI changes.
const GEOMETRY_KEYS = ['mode', 'shape', 'angle', 'duration', 'ringWidth', 'linePending', 'lineIncomplete'];
const POINT_KEYS = ['x', 'y', 'size', 't', 'shape', 'width', 'height', 'ringWidth', 'angle', 'step', 'active', 'opacity', 'color', 'colorProgress'];
export function sameGeometry(a, b) {
  if (!a || !b || GEOMETRY_KEYS.some(key => a[key] !== b[key]) || a.procedural?.kind !== b.procedural?.kind) return false;
  if (a.samples === b.samples) return true;
  return a.samples.length === b.samples.length && a.samples.every((point, i) => POINT_KEYS.every(key => point[key] === b.samples[i][key]));
}
export function strokeBounds(clip) {
  let left = CANVAS_WIDTH, top = CANVAS_HEIGHT, right = 0, bottom = 0;
  for (const point of clip.samples) {
    const rect = ['rect', 'rect-ring'].includes(clip.shape) || ['rect', 'rect-ring'].includes(point.shape);
    const radius = rect ? Math.hypot(point.width ?? point.size, point.height ?? point.size) / 2 + 2 : point.size / 2 + 2;
    left = Math.min(left, point.x - radius); top = Math.min(top, point.y - radius);
    right = Math.max(right, point.x + radius); bottom = Math.max(bottom, point.y + radius);
  }
  left = Math.max(0, Math.min(CANVAS_WIDTH - 1, Math.floor(left))); top = Math.max(0, Math.min(CANVAS_HEIGHT - 1, Math.floor(top)));
  return { x: left, y: top, width: Math.max(1, Math.min(CANVAS_WIDTH, Math.ceil(right)) - left), height: Math.max(1, Math.min(CANVAS_HEIGHT, Math.ceil(bottom)) - top) };
}

// Advance only through newly recorded samples. Nothing here scans image pixels.
export class StampCursor {
  constructor(samples) { this.samples = samples; this.reset(); }
  reset(from = 0) {
    this.time = -1; this.next = 1;
    // For a Trail rebuild, fully expired stamps cannot contribute any pixels.
    // Start at the last original sample before that window so subsequent
    // segment interpolation keeps the same source boundaries.
    if (from > 0) {
      let low = 0, high = this.samples.length - 1;
      while (low < high) { const mid = Math.ceil((low + high) / 2); if (this.samples[mid].t <= from) low = mid; else high = mid - 1; }
      this.time = this.samples[low].t; this.next = low + 1;
    }
  }
  advance(until, add) {
    if (until === this.time) return false;
    const reset = until < this.time;
    if (reset) this.reset();
    const samples = this.samples;
    if (this.time < 0) add(samples[0], 0);
    let previous = sampleAt(samples, Math.max(0, this.time));
    const segment = next => {
      const points = strokePoints(previous, next);
      if (!points.length) add(next, next.t);
      else for (let i = 0; i < points.length; i++) add(points[i], previous.t + (next.t - previous.t) * (i + 1) / points.length);
      previous = next;
    };
    while (this.next < samples.length && samples[this.next].t < until) segment(samples[this.next++]);
    if (until >= previous.t) segment(sampleAt(samples, until));
    this.time = until;
    return reset;
  }
}

// Receive live samples without allocating UHD CPU images. Local input uses
// a shared source array; network input appends only its incremental packet.
export class LiveStroke {
  clear() { this.id = null; this.samples = []; this.count = 0; this.motionPositions = []; }
  constructor() { this.clear(); }
  setLocal(stroke, now, move) {
    if (!stroke) { this.clear(); return; }
    if (this.id !== stroke.id) this.motionPositions = [];
    Object.assign(this, { id: stroke.id, mode: stroke.mode, color: stroke.color, opacity: stroke.opacity, effects: upgradedEffects(stroke.effects), ringWidth: stroke.ringWidth, plane: stroke.plane, targets: stroke.targets, samples: stroke.samples, count: stroke.samples.length, head: stroke.last, move, elapsed: Math.max(now - stroke.started, stroke.samples.at(-1).t), received: now });
    this.recordMotion();
  }
  update(frame, now) {
    if (!frame) { this.clear(); return; }
    if (frame.id !== this.id && frame.from !== 0 || frame.id === this.id && frame.elapsed < this.elapsed) return;
    if (frame.id !== this.id || frame.from === 0) { this.clear(); this.id = frame.id; }
    if (frame.from !== this.count) return;
    for (const sample of frame.samples) this.samples.push(sample);
    this.count += frame.samples.length;
    Object.assign(this, { mode: frame.mode, color: frame.color, opacity: frame.opacity, targets: frame.targets, head: frame.head, move: frame.move, elapsed: frame.elapsed, received: now, effects: upgradedEffects(frame.effects), ringWidth: frame.ringWidth, plane: frame.plane });
    this.recordMotion();
  }
  recordMotion() {
    const point = this.move ?? this.head;
    if (!point) return;
    const sample = { ...point, t:this.elapsed }, last = this.motionPositions.at(-1);
    if (last?.t === sample.t) this.motionPositions[this.motionPositions.length-1] = sample;
    else this.motionPositions.push(sample);
    while (this.motionPositions.length > 2 && this.motionPositions[1].t < sample.t - 100) this.motionPositions.shift();
    if (this.motionPositions.length > 32) this.motionPositions.splice(0,this.motionPositions.length-32);
  }
  motionAt(time) { return sampleAt(this.motionPositions,time); }
  time(now) { return this.elapsed + Math.max(0, now - this.received); }
}
