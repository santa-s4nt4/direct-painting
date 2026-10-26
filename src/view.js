import { CANVAS_WIDTH as W, CANVAS_HEIGHT as H, VIEWPORT_WIDTH as VW, VIEWPORT_HEIGHT as VH, BOX_SPEC } from './canvas.js';

export const DEFAULT_VIEW = Object.freeze({ scale: 1, x: (VW - W) / 2, y: (VH - H) / 2 });
export const MIN_ZOOM = .5, MAX_ZOOM = 5;
export const CAMERA_DISTANCE = 5000, MAX_TILT = 180;
export const MIN_CAMERA_DISTANCE = 3500, MAX_CAMERA_DISTANCE = 12000;
const radians = angle => angle * Math.PI / 180;
export const wrapAngle = angle => ((angle + 180) % 360 + 360) % 360 - 180;
export function viewBounds(scale) {
  const x = VW - W * scale;
  return { minX: x, minY: VH - (BOX_SPEC.height + H) * scale / 2, maxX: 0, maxY: (BOX_SPEC.height - H) * scale / 2 };
}
export function validateView(view) {
  if (view === undefined) return;
  if (!view || typeof view !== 'object' || Array.isArray(view) || !['scale', 'x', 'y'].every(key => Number.isFinite(view[key])) || view.scale < MIN_ZOOM || view.scale > MAX_ZOOM) throw new Error('Invalid canvas view');
  for (const [key, limit] of [['rotation', 180], ['pitch', MAX_TILT], ['yaw', MAX_TILT]]) if (view[key] !== undefined && (!Number.isFinite(view[key]) || Math.abs(view[key]) > limit)) throw new Error('Invalid view rotation');
  if(view.distance!==undefined&&(!Number.isFinite(view.distance)||view.distance<MIN_CAMERA_DISTANCE||view.distance>MAX_CAMERA_DISTANCE))throw new Error('Invalid camera distance');
  const b = viewBounds(view.scale), epsilon = 1e-6;
  if (view.x < b.minX - epsilon || view.x > epsilon || view.y < b.minY - epsilon || view.y > b.maxY + epsilon) throw new Error('View exceeds canvas bounds');
}
export function canvasView(value) {
  const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value?.scale ?? 1)), b = viewBounds(scale);
  const view = { scale, x: Math.max(b.minX, Math.min(0, value?.x ?? b.minX / 2)), y: Math.max(b.minY, Math.min(b.maxY, value?.y ?? (b.minY + b.maxY) / 2)) };
  for (const key of ['rotation', 'pitch', 'yaw']) {
    const angle = wrapAngle(value?.[key] ?? 0);
    if (angle) view[key] = angle;
  }
  if(value?.distance!==undefined)view.distance=Math.max(MIN_CAMERA_DISTANCE,Math.min(MAX_CAMERA_DISTANCE,value.distance));
  return view;
}
export function importedView(view, canvas, version) {
  if (view === undefined) return { ...DEFAULT_VIEW };
  if (version === 3 || version === 4) { validateView(view); return canvasView(view); }
  // Older files used 10–800%. Migrate their camera without moving the artwork.
  if (!view || typeof view !== 'object' || Array.isArray(view) || !['scale', 'x', 'y'].every(key => Number.isFinite(view[key])) || view.scale < .1 || view.scale > 8 || Math.abs(view.x) > VW * 8 || Math.abs(view.y) > VH * 8) throw new Error('Invalid legacy canvas view');
  if (version === undefined && canvas?.width === W && canvas?.height === H && view.scale === 1 && view.x === 0 && view.y === 0) return { ...DEFAULT_VIEW };
  const migrated = canvasView(view); validateView(migrated); return migrated;
}
// Rz(roll) Rx(pitch) Ry(yaw), in painting coordinates (+Y points down).
// The renderer uses the same matrix on a real Three.js plane in a perspective camera.
export function viewRotation(view) {
  const z = radians(view.rotation ?? 0), x = radians(view.pitch ?? 0), y = radians(view.yaw ?? 0);
  const c = Math.cos(z), s = Math.sin(z), cp = Math.cos(x), sp = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y);
  return [c * cy - s * sp * sy, -s * cp, c * sy + s * sp * cy, s * cy + c * sp * sy, c * cp, s * sy - c * sp * cy, -cp * sy, sp, cp * cy];
}
export function viewHomography(view) {
  const r = viewRotation(view), cx = view.x + W * view.scale / 2, cy = view.y + H * view.scale / 2;
  const distance=view.distance??CAMERA_DISTANCE,f=view.scale*CAMERA_DISTANCE/distance;
  const a=f*r[0]-cx*r[6]/distance,b=f*r[1]-cx*r[7]/distance,d=f*r[3]-cy*r[6]/distance,e=f*r[4]-cy*r[7]/distance,g=-r[6]/distance,h=-r[7]/distance;
  return [a, b, cx - a * W / 2 - b * H / 2, d, e, cy - d * W / 2 - e * H / 2, g, h, 1 - g * W / 2 - h * H / 2];
}
export function invertHomography(m) {
  const [a,b,c,d,e,f,g,h,i] = m;
  const q = [e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
  const determinant = a*q[0]+b*q[3]+c*q[6];
  return q.map(value => value / determinant);
}
const transforms = new WeakMap();
function matrices(view) {
  let pair = transforms.get(view);
  if (!pair) { const forward = viewHomography(view); pair = { forward, inverse: invertHomography(forward) }; transforms.set(view, pair); }
  return pair;
}
function transform(p, m) {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w };
}
export const screenToWorld = (p, view) => transform(p, matrices(view).inverse);
export const worldToScreen = (p, view) => transform(p, matrices(view).forward);
export function transformAt(view, updates, anchor, destination = anchor) {
  const r=viewRotation(view),local=[(anchor.x-view.x-W*view.scale/2)*(view.distance??CAMERA_DISTANCE)/view.scale/CAMERA_DISTANCE,(anchor.y-view.y-H*view.scale/2)*(view.distance??CAMERA_DISTANCE)/view.scale/CAMERA_DISTANCE,0];
  const world=[r[0]*local[0]+r[3]*local[1],r[1]*local[0]+r[4]*local[1],r[2]*local[0]+r[5]*local[1]];
  const next=canvasView({...view,...updates}),n=viewRotation(next);
  const projected=[n[0]*world[0]+n[1]*world[1]+n[2]*world[2],n[3]*world[0]+n[4]*world[1]+n[5]*world[2],n[6]*world[0]+n[7]*world[1]+n[8]*world[2]],k=next.scale*CAMERA_DISTANCE/((next.distance??CAMERA_DISTANCE)-projected[2]);
  return canvasView({...next,x:destination.x-W*next.scale/2-projected[0]*k,y:destination.y-H*next.scale/2-projected[1]*k});
}
export const zoomAt = (view, scale, anchor, destination = anchor) => transformAt(view, { scale }, anchor, destination);

// After navigation, the remaining finger stays reserved until every finger lifts.
export class PinchGesture {
  points = new Map(); blocked = false; initial = null;
  down(id, point, view) {
    this.points.set(id, point);
    if (this.points.size === 2) {
      this.blocked = true;
      const [a, b] = this.points.values();
      this.initial = { view: { ...view }, angle: Math.atan2(b.y - a.y, b.x - a.x), distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return true;
    }
    return false;
  }
  move(id, point) {
    if (!this.points.has(id)) return null;
    this.points.set(id, point);
    if (this.points.size !== 2 || !this.initial) return null;
    const [a, b] = this.points.values(), { view, distance, center, angle } = this.initial;
    const rotation = wrapAngle((view.rotation ?? 0) + (Math.atan2(b.y - a.y, b.x - a.x) - angle) * 180 / Math.PI);
    return transformAt(view, { scale: view.scale * Math.hypot(b.x - a.x, b.y - a.y) / distance, rotation }, center, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  up(id) {
    const navigation = this.blocked;
    this.points.delete(id); this.initial = null;
    if (!this.points.size) this.blocked = false;
    return navigation;
  }
}
