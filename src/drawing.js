import { DEFAULT_RING_WIDTH } from './effects.js';
import { CANVAS_WIDTH, CANVAS_HEIGHT, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, MAX_BRUSH_SIZE } from './canvas.js';
export function brushSize(min, max, pressure, pointerType, enabled) {
  if (!enabled || pointerType !== 'pen') return max;
  const p = Number.isFinite(pressure) ? Math.min(1, Math.max(0, pressure)) : 0.5;
  return Math.round(min + (max - min) * p);
}

export function canvasPoint(event, rect) {
  return { x: (event.clientX - rect.left) * VIEWPORT_WIDTH / rect.width, y: (event.clientY - rect.top) * VIEWPORT_HEIGHT / rect.height };
}

// Keep small strokes dense; large footprints need fewer overlapping stamps.
export function strokePoints(from, to) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const rect = ['rect', 'rect-ring'].includes(to.shape);
  const rotation = rect ? angleDelta(from.angle ?? 0, to.angle ?? 0) : 0;
  const diameter = Math.min(from.size, to.size, ...(rect ? [from.width ?? from.size, from.height ?? from.size, to.width ?? to.size, to.height ?? to.size] : []));
  const spacing = Math.max(1, Math.min(diameter > 320 ? diameter / 100 : 1, ['ring', 'rect-ring'].includes(to.shape) ? (to.ringWidth ?? DEFAULT_RING_WIDTH) / 2 : Infinity));
  const steps = Math.ceil(Math.max(distance, Math.abs(to.size - from.size), rect ? Math.abs((to.width ?? to.size) - (from.width ?? from.size)) : 0, rect ? Math.abs((to.height ?? to.size) - (from.height ?? from.size)) : 0, rect ? Math.abs(rotation) * Math.max(to.width ?? to.size, to.height ?? to.size) * Math.PI / 180 : 0) / spacing);
  if (!steps) return [];
  return Array.from({ length: steps }, (_, i) => {
    const t = (i + 1) / steps;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, size: Math.round(from.size + (to.size - from.size) * t), ...(['ring', 'rect-ring'].includes(to.shape) ? { shape: to.shape, ringWidth: to.ringWidth ?? DEFAULT_RING_WIDTH } : {}), ...(rect ? { shape: to.shape, width: (from.width ?? from.size) + ((to.width ?? to.size) - (from.width ?? from.size)) * t, height: (from.height ?? from.size) + ((to.height ?? to.size) - (from.height ?? from.size)) * t, angle: (from.angle ?? 0) + rotation * t } : {}) };
  });
}
export const angleDelta = (from, to) => ((to - from) % 360 + 540) % 360 - 180;

const diskCache = new Map();
export function visitDisk(point, writeRow) {
  const size = Math.min(MAX_BRUSH_SIZE, Math.max(1, Math.round(point.size)));
  let rows = diskCache.get(size);
  if (!rows) {
    const radius = size / 2;
    rows = Array.from({ length: size }, (_, row) => {
      const dy = row + 0.5 - radius;
      const halfWidth = Math.sqrt(radius * radius - dy * dy);
      return [Math.max(0, Math.ceil(radius - halfWidth - 0.5)), Math.min(size, Math.floor(radius + halfWidth - 0.5) + 1)];
    });
    if (diskCache.size >= 64) diskCache.delete(diskCache.keys().next().value);
    diskCache.set(size, rows);
  }
  const left = Math.floor(point.x) - Math.floor(size / 2);
  const top = Math.floor(point.y) - Math.floor(size / 2);
  for (let row = 0; row < size; row++) {
    const y = top + row;
    if (y < 0 || y >= CANVAS_HEIGHT) continue;
    const x = Math.max(0, left + rows[row][0]);
    const end = Math.min(CANVAS_WIDTH, left + rows[row][1]);
    if (end > x) writeRow(y * CANVAS_WIDTH + x, y * CANVAS_WIDTH + end);
  }
}

export function visitShape(point, writeRow) {
  if (point.shape === 'ring') {
    const size = Math.max(1, Math.min(MAX_BRUSH_SIZE, Math.round(point.size))), radius = size / 2;
    const inner = Math.max(0, radius - (point.ringWidth ?? DEFAULT_RING_WIDTH));
    const cx = Math.floor(point.x) + size % 2 * .5, cy = Math.floor(point.y) + size % 2 * .5;
    return visitDisk(point, (start, end) => {
      const y = Math.floor(start / CANVAS_WIDTH), dy = y + .5 - cy;
      if (inner <= 0 || Math.abs(dy) >= inner) return writeRow(start, end);
      const half = Math.sqrt(inner * inner - dy * dy), left = y * CANVAS_WIDTH + Math.ceil(cx - half - .5), right = y * CANVAS_WIDTH + Math.floor(cx + half - .5) + 1;
      if (left > start) writeRow(start, Math.min(end, left));
      if (right < end) writeRow(Math.max(start, right), end);
    });
  }
  if (!['rect', 'rect-ring'].includes(point.shape)) return visitDisk(point, writeRow);
  const w = Math.max(1, Math.min(MAX_BRUSH_SIZE, point.width ?? point.size)) / 2, h = Math.max(1, Math.min(MAX_BRUSH_SIZE, point.height ?? point.size)) / 2;
  const angle = (point.angle ?? 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle), cx = Math.floor(point.x), cy = Math.floor(point.y);
  const corners = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }));
  const outline = point.shape === 'rect-ring', inner = new Map();
  const edge = point.ringWidth ?? DEFAULT_RING_WIDTH;
  if (outline && w > edge && h > edge) visitShape({ ...point, shape: 'rect', width: (w - edge) * 2, height: (h - edge) * 2 }, (a,b) => inner.set(Math.floor(a / CANVAS_WIDTH), [a,b]));
  const first = Math.max(0, Math.floor(Math.min(...corners.map(p => p.y)))), end = Math.min(CANVAS_HEIGHT, Math.ceil(Math.max(...corners.map(p => p.y))));
  for (let y = first; y < end; y++) {
    const scan = y + .5, intersections = [];
    for (let edge = 0; edge < 4; edge++) {
      const a = corners[edge], b = corners[(edge + 1) % 4];
      if ((a.y <= scan && scan < b.y) || (b.y <= scan && scan < a.y)) intersections.push(a.x + (scan - a.y) / (b.y - a.y) * (b.x - a.x));
    }
    if (intersections.length < 2) continue;
    const left = Math.max(0, Math.ceil(Math.min(...intersections) - .5)), right = Math.min(CANVAS_WIDTH, Math.ceil(Math.max(...intersections) - .5));
    if (right > left) {
      const a = y * CANVAS_WIDTH + left, b = y * CANVAS_WIDTH + right, hole = inner.get(y);
      if (!hole) writeRow(a,b);
      else { if (hole[0] > a) writeRow(a, Math.min(b, hole[0])); if (hole[1] < b) writeRow(Math.max(a, hole[1]), b); }
    }
  }
}
// The main fill color paints the entire footprint. Ring is an annulus and
// always leaves its center transparent, even where stamps overlap.
export function visitPaint(point, color, style, writeRow) {
  visitShape(['ring', 'rect-ring'].includes(point.shape) ? { ...point, ringWidth: style?.ringWidth ?? point.ringWidth } : point, (start, end) => writeRow(start, end, color, false));
}

export function stamp(ctx, point, color, opacity = 1, style = {}) {
  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = opacity;
  let previousPaint;
  visitPaint(point, color, style, (start, end, paint) => { if (paint !== previousPaint) { ctx.fillStyle = paint; previousPaint = paint; } ctx.fillRect(start % CANVAS_WIDTH, Math.floor(start / CANVAS_WIDTH), end - start, 1); });
  ctx.globalAlpha = previousAlpha;
}

export function timestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
