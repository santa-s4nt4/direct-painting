import { CANVAS_WIDTH as W, CANVAS_HEIGHT as H, VIEWPORT_WIDTH as VW, VIEWPORT_HEIGHT as VH } from './canvas.js';

export const DEFAULT_VIEW = Object.freeze({ scale: 1, x: (VW - W) / 2, y: (VH - H) / 2 });
export const MIN_ZOOM = .1, MAX_ZOOM = W / VW;
// Below "fit", center the painting in the viewport. Above it, pan only inside
// the painting. Drawing coordinates always remain in the same 4K world.
export function viewBounds(scale) {
  const x = VW - W * scale, y = VH - H * scale;
  return { minX: x > 0 ? x / 2 : x, minY: y > 0 ? y / 2 : y, maxX: x > 0 ? x / 2 : 0, maxY: y > 0 ? y / 2 : 0 };
}
export function validateView(view) {
  if (view === undefined) return;
  if (!view || typeof view !== 'object' || Array.isArray(view) || !['scale', 'x', 'y'].every(key => Number.isFinite(view[key])) || view.scale < MIN_ZOOM || view.scale > MAX_ZOOM) throw new Error('Invalid canvas view');
  const b = viewBounds(view.scale), epsilon = 1e-6;
  if (view.x < b.minX - epsilon || view.x > b.maxX + epsilon || view.y < b.minY - epsilon || view.y > b.maxY + epsilon) throw new Error('View exceeds 4K canvas');
}
export function canvasView(value) {
  const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value?.scale ?? 1)), b = viewBounds(scale);
  return { scale, x: Math.max(b.minX, Math.min(b.maxX, value?.x ?? (b.minX + b.maxX) / 2)), y: Math.max(b.minY, Math.min(b.maxY, value?.y ?? (b.minY + b.maxY) / 2)) };
}
// Older projects allowed 10–800% and unbounded margins. Preserve the recorded
// stroke coordinates while fitting that old camera into the new UHD bounds.
export function importedView(view, canvas, version) {
  if (view === undefined) return { ...DEFAULT_VIEW };
  if (canvas?.width === W && canvas?.height === H) {
    validateView(view);
    // Upgrade the former top-left default once. Versioned projects retain any
    // deliberate pan, including a later move back to the top-left corner.
    if (version === undefined && view.scale === 1 && view.x === 0 && view.y === 0) return { ...DEFAULT_VIEW };
    return canvasView(view);
  }
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
