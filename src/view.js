import { CANVAS_WIDTH as W, CANVAS_HEIGHT as H } from './canvas.js';

export const DEFAULT_VIEW = Object.freeze({ scale: 1, x: 0, y: 0 });
export const MIN_ZOOM = .1, MAX_ZOOM = 8;
export function validateView(view) {
  if (view === undefined) return;
  if (!view || typeof view !== 'object' || Array.isArray(view) || !['scale', 'x', 'y'].every(key => Number.isFinite(view[key])) || view.scale < MIN_ZOOM || view.scale > MAX_ZOOM || Math.abs(view.x) > W * MAX_ZOOM || Math.abs(view.y) > H * MAX_ZOOM) throw new Error('Invalid canvas view');
}
export const canvasView = value => ({ ...DEFAULT_VIEW, ...value });
export const screenToWorld = (p, view) => ({ x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale });
export const worldToScreen = (p, view) => ({ x: p.x * view.scale + view.x, y: p.y * view.scale + view.y });
export function zoomAt(view, scale, anchor, destination = anchor) {
  const world = screenToWorld(anchor, view), next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
  return { scale: next, x: Math.max(-W * MAX_ZOOM, Math.min(W * MAX_ZOOM, destination.x - world.x * next)), y: Math.max(-H * MAX_ZOOM, Math.min(H * MAX_ZOOM, destination.y - world.y * next)) };
}

// Pointer positions use native canvas coordinates. After a pinch, the remaining
// finger stays reserved for navigation until both fingers have lifted.
export class PinchGesture {
  points = new Map(); blocked = false; initial = null;
  down(id, point, view) {
    this.points.set(id, point);
    if (this.points.size === 2) {
      this.blocked = true;
      const [a, b] = this.points.values();
      this.initial = { view: { ...view }, distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return true;
    }
    return false;
  }
  move(id, point) {
    if (!this.points.has(id)) return null;
    this.points.set(id, point);
    if (this.points.size !== 2 || !this.initial) return null;
    const [a, b] = this.points.values(), { view, distance, center } = this.initial;
    return zoomAt(view, view.scale * Math.hypot(b.x - a.x, b.y - a.y) / distance, center, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  up(id) {
    const navigation = this.blocked;
    this.points.delete(id);
    this.initial = null;
    if (!this.points.size) this.blocked = false;
    return navigation;
  }
}
