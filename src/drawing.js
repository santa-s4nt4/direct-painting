import { CANVAS_WIDTH, CANVAS_HEIGHT, MAX_BRUSH_SIZE } from './canvas.js';
export const DEFAULT_EDGE_WIDTH = 5;
// Old projects used zero to disable the edge. Treat it as the default now.
export const edgeWidth = value => value === undefined || value === 0 ? DEFAULT_EDGE_WIDTH : value;

export function brushSize(min, max, pressure, pointerType, enabled) {
  if (!enabled || pointerType !== 'pen') return max;
  const p = Number.isFinite(pressure) ? Math.min(1, Math.max(0, pressure)) : 0.5;
  return Math.round(min + (max - min) * p);
}

export function canvasPoint(event, rect) {
  return { x: (event.clientX - rect.left) * CANVAS_WIDTH / rect.width, y: (event.clientY - rect.top) * CANVAS_HEIGHT / rect.height };
}

// Sample at one pixel or less, including pressure changes at a stationary point.
export function strokePoints(from, to) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const rect = to.shape === 'rect';
  const rotation = rect ? angleDelta(from.angle ?? 0, to.angle ?? 0) : 0;
  const steps = Math.ceil(Math.max(distance, Math.abs(to.size - from.size), rect ? Math.abs((to.width ?? to.size) - (from.width ?? from.size)) : 0, rect ? Math.abs((to.height ?? to.size) - (from.height ?? from.size)) : 0, rect ? Math.abs(rotation) * Math.max(to.width ?? to.size, to.height ?? to.size) * Math.PI / 180 : 0));
  if (!steps) return [];
  return Array.from({ length: steps }, (_, i) => {
    const t = (i + 1) / steps;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, size: Math.round(from.size + (to.size - from.size) * t), ...(rect ? { shape: 'rect', width: (from.width ?? from.size) + ((to.width ?? to.size) - (from.width ?? from.size)) * t, height: (from.height ?? from.size) + ((to.height ?? to.size) - (from.height ?? from.size)) * t, angle: (from.angle ?? 0) + rotation * t } : {}) };
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
  if (point.shape !== 'rect') return visitDisk(point, writeRow);
  const w = Math.max(1, Math.min(MAX_BRUSH_SIZE, point.width ?? point.size)) / 2, h = Math.max(1, Math.min(MAX_BRUSH_SIZE, point.height ?? point.size)) / 2;
  const angle = (point.angle ?? 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle), cx = Math.floor(point.x), cy = Math.floor(point.y);
  const corners = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }));
  const first = Math.max(0, Math.floor(Math.min(...corners.map(p => p.y)))), end = Math.min(CANVAS_HEIGHT, Math.ceil(Math.max(...corners.map(p => p.y))));
  for (let y = first; y < end; y++) {
    const scan = y + .5, intersections = [];
    for (let edge = 0; edge < 4; edge++) {
      const a = corners[edge], b = corners[(edge + 1) % 4];
      if ((a.y <= scan && scan < b.y) || (b.y <= scan && scan < a.y)) intersections.push(a.x + (scan - a.y) / (b.y - a.y) * (b.x - a.x));
    }
    if (intersections.length < 2) continue;
    const left = Math.max(0, Math.ceil(Math.min(...intersections) - .5)), right = Math.min(CANVAS_WIDTH, Math.ceil(Math.max(...intersections) - .5));
    if (right > left) writeRow(y * CANVAS_WIDTH + left, y * CANVAS_WIDTH + right);
  }
}
// Split the existing shape into disjoint fill/edge spans. Keeping the edge
// inside its bounds preserves the recorded diameter and avoids double alpha.
export function visitPaint(point, color, style, writeRow, separateEdge = false) {
  const width = Math.round(edgeWidth(style?.edgeWidth)), edge = style?.edgeColor ?? color;
  if (edge === color && !separateEdge) return visitShape(point, (start, end) => writeRow(start, end, color, false));
  const inner = point.shape === 'rect' ? { ...point, width: (point.width ?? point.size) - width * 2, height: (point.height ?? point.size) - width * 2 } : { ...point, size: Math.round(point.size) - width * 2 };
  const hasFill = point.shape === 'rect' ? inner.width > 0 && inner.height > 0 : inner.size > 0;
  const rows = [];
  if (hasFill) visitShape(inner, (start, end) => rows.push([start, end]));
  let next = 0;
  visitShape(point, (start, end) => {
    while (next < rows.length && rows[next][1] <= start) next++;
    const fill = rows[next];
    if (!fill || fill[0] >= end) { writeRow(start, end, edge, true); return; }
    const left = Math.max(start, fill[0]), right = Math.min(end, fill[1]);
    if (left > start) writeRow(start, left, edge, true);
    if (right > left) writeRow(left, right, color, false);
    if (right < end) writeRow(right, end, edge, true);
  });
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

export function recordingMime(Recorder) {
  const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return types.find(type => Recorder.isTypeSupported(type)) || '';
}
