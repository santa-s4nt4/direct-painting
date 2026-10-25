import { CANVAS_WIDTH, CANVAS_HEIGHT } from './canvas.js';
import { visitPaint, angleDelta } from './drawing.js';

export const TRAIL_LIFETIME = 1800;
const PIXELS = CANVAS_WIDTH * CANVAS_HEIGHT;
const colorValue = color => Number.parseInt(color.slice(1), 16);

// Store the most recent visit per pixel. Overlapping circles form one continuous
// surface instead of accumulating bright spots at every input sample.
export class TrailField {
  times = new Float64Array(PIXELS);
  colors = new Uint32Array(PIXELS);
  data = new Uint8ClampedArray(PIXELS * 4);
  active = false;

  constructor(trackPaint = false) { if (trackPaint) this.paintMask = new Uint8Array(PIXELS); }

  add(point, color, now, style = {}) {
    const fill = colorValue(color);
    visitPaint(point, color, style, (start, end) => {
      this.times.fill(now + 1, start, end); this.colors.fill(fill, start, end);
      this.paintMask?.fill(1, start, end);
    });
    this.active = true;
  }

  render(now) {
    this.active = false;
    for (let i = 0; i < PIXELS; i++) {
      const age = this.times[i] ? Math.max(0, now - (this.times[i] - 1)) : TRAIL_LIFETIME;
      const offset = i * 4;
      if (age >= TRAIL_LIFETIME) {
        this.times[i] = 0;
        this.data[offset] = this.data[offset + 1] = this.data[offset + 2] = this.data[offset + 3] = 0;
      } else {
        this.active = true;
        const color = this.colors[i];
        this.data[offset] = color >> 16;
        this.data[offset + 1] = (color >> 8) & 255;
        this.data[offset + 2] = color & 255;
        this.data[offset + 3] = Math.round(255 * (1 - age / TRAIL_LIFETIME) ** 2);
      }
    }
    return this.data;
  }

  clear() { this.times.fill(0); this.paintMask?.fill(0); this.render(0); }
}

// One persistent surface per canvas keeps strokes indefinitely without storing
// or replaying an ever-growing list of paths.
export class PersistentField {
  data = new Uint8ClampedArray(PIXELS * 4);
  active = false;
  dirty = false;

  constructor(trackPaint = false) { if (trackPaint) this.paintMask = new Uint8Array(PIXELS); }

  add(point, color, _now, style = {}) {
    const fill = colorValue(color);
    visitPaint(point, color, style, (start, end) => {
      this.paintMask?.fill(1, start, end);
      const value = fill;
      for (let i = start; i < end; i++) {
        const offset = i * 4;
        this.data[offset] = value >> 16;
        this.data[offset + 1] = (value >> 8) & 255;
        this.data[offset + 2] = value & 255;
        this.data[offset + 3] = 255;
      }
    });
    this.active = this.dirty = true;
  }

  clear() { this.data.fill(0); this.paintMask?.fill(0); this.active = false; this.dirty = true; }
}

export const MOVE_EASING_MS = 65;

// Filter raw targets on animation frames, independently of pointer-event rates.
// Exponential easing cannot overshoot and keeps the same feel at 60Hz and 120Hz.
export class SmoothedCircle {
  moving = false;

  constructor(point, color, now) {
    this.point = { ...point };
    this.target = { ...point };
    this.color = color;
    this.updatedAt = now;
  }

  setTarget(point) {
    // Ignore subpixel positional noise, while still accepting pressure changes.
    if (Math.hypot(point.x - this.target.x, point.y - this.target.y) > 0.5) {
      this.target.x = point.x;
      this.target.y = point.y;
    }
    this.target.size = point.size;
    for (const key of ['width', 'height', 'angle']) if (Number.isFinite(point[key])) this.target[key] = point[key];
    this.moving = true;
  }

  update(now) {
    const dt = Math.max(0, now - this.updatedAt);
    this.updatedAt = Math.max(this.updatedAt, now);
    if (!this.moving || !dt) return;
    const alpha = 1 - Math.exp(-dt / MOVE_EASING_MS);
    const keys = ['x', 'y', 'size', 'width', 'height'].filter(key => Number.isFinite(this.target[key]));
    for (const key of keys) this.point[key] += (this.target[key] - this.point[key]) * alpha;
    if (Number.isFinite(this.target.angle)) this.point.angle += angleDelta(this.point.angle, this.target.angle) * alpha;
    if (keys.every(key => Math.abs(this.target[key] - this.point[key]) < .02) && (!Number.isFinite(this.target.angle) || Math.abs(angleDelta(this.point.angle, this.target.angle)) < .02)) {
      this.point = { ...this.target };
      this.moving = false;
    }
  }

  displayPoint() {
    // Round instead of flooring so tiny filtered changes near integer positions
    // do not toggle the rasterized circle between neighboring pixels.
    return { ...this.point, x: Math.round(this.point.x), y: Math.round(this.point.y), size: Math.max(1, Math.round(this.point.size)), ...(['rect', 'rect-ring'].includes(this.point.shape) ? { width: Math.max(1, Math.round(this.point.width)), height: Math.max(1, Math.round(this.point.height)) } : {}) };
  }
}
