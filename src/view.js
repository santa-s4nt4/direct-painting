import { CANVAS_WIDTH as W, CANVAS_HEIGHT as H, VIEWPORT_WIDTH as VW, VIEWPORT_HEIGHT as VH } from './canvas.js';

export const DEFAULT_VIEW = Object.freeze({ scale: 1, x: 0, y: 0 });
export const MIN_ZOOM = VW / W, MAX_ZOOM = W / VW;
export const viewBounds = scale => ({ minX: VW - W * scale, minY: VH - H * scale, maxX: 0, maxY: 0 });
export function validateView(view) {
  if (view === undefined) return;
  if (!view || typeof view !== 'object' || Array.isArray(view) || !['scale', 'x', 'y'].every(key => Number.isFinite(view[key])) || view.scale < MIN_ZOOM || view.scale > MAX_ZOOM) throw new Error('Invalid canvas view');
  const b = viewBounds(view.scale), epsilon = 1e-6;
  if (view.x < b.minX - epsilon || view.x > epsilon || view.y < b.minY - epsilon || view.y > epsilon) throw new Error('View exceeds 4K canvas');
}
export function canvasView(value) {
  const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value?.scale ?? 1)), b = viewBounds(scale);
  return { scale, x: Math.max(b.minX, Math.min(0, value?.x ?? 0)), y: Math.max(b.minY, Math.min(0, value?.y ?? 0)) };
}
// Older projects allowed 10–800% and unbounded margins. Preserve the recorded
// stroke coordinates while fitting that old camera into the new UHD bounds.
export function importedView(view, canvas) {
  if (view === undefined) return { ...DEFAULT_VIEW };
  if (canvas?.width === W && canvas?.height === H) { validateView(view); return canvasView(view); }
  if (!view || typeof view !== 'object' || Array.isArray(view) || !['scale', 'x', 'y'].every(key => Number.isFinite(view[key])) || view.scale < .1 || view.scale > 8 || Math.abs(view.x) > VW * 8 || Math.abs(view.y) > VH * 8) throw new Error('Invalid legacy canvas view');
  return canvasView(view);
}
export const screenToWorld = (p, view) => ({ x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale });
export const worldToScreen = (p, view) => ({ x: p.x * view.scale + view.x, y: p.y * view.scale + view.y });
export function zoomAt(view, scale, anchor, destination = anchor) {
  const world = screenToWorld(anchor, view), next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
  return canvasView({ scale: next, x: destination.x - world.x * next, y: destination.y - world.y * next });
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
