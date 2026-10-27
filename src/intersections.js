import { BOX_SPEC, pointInSpace, projectSpace, insideBox, clipPolygonToBox } from './space.js';
import { VIEWPORT_WIDTH as VW, VIEWPORT_HEIGHT as VH } from './canvas.js';
import { traceSamplesAt } from './trace-motion.js';

const GEOMETRY_EPSILON = 1e-5;
const PLANE_EPSILON = 0.05;

const add3 = (a, b) => a.map((v, i) => v + b[i]);
const sub3 = (a, b) => a.map((v, i) => v - b[i]);
const mul3 = (a, k) => a.map(v => v * k);
const dot3 = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length3 = a => Math.hypot(...a);
const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];

function polygonArea(polygon) {
  return polygon.reduce((sum, point, i) => sum + cross2(point, polygon[(i + 1) % polygon.length]), 0) / 2;
}

function polygonCentroid(polygon) {
  const area = polygonArea(polygon);
  if (Math.abs(area) < GEOMETRY_EPSILON) return polygon.reduce((sum, point) => [sum[0] + point[0] / polygon.length, sum[1] + point[1] / polygon.length], [0, 0]);
  let x = 0, y = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], weight = cross2(a, b);
    x += (a[0] + b[0]) * weight; y += (a[1] + b[1]) * weight;
  }
  return [x / (6 * area), y / (6 * area)];
}

function circlePolygon(radius, steps = 64) {
  return Array.from({ length: steps }, (_, i) => {
    const angle = i * Math.PI * 2 / steps;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}

function capsulePolygon(a, b, radius, steps = 8) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
  if (length < GEOMETRY_EPSILON) return circlePolygon(radius, steps * 2);
  const angle = Math.atan2(dy, dx), points = [];
  for (let i = 0; i <= steps; i++) {
    const theta = angle - Math.PI / 2 + Math.PI * i / steps;
    points.push([b[0] + Math.cos(theta) * radius, b[1] + Math.sin(theta) * radius]);
  }
  for (let i = 0; i <= steps; i++) {
    const theta = angle + Math.PI / 2 + Math.PI * i / steps;
    points.push([a[0] + Math.cos(theta) * radius, a[1] + Math.sin(theta) * radius]);
  }
  return points;
}

function rectPolygon(width, height) {
  return [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]];
}

function straightPath(points) {
  const result = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < GEOMETRY_EPSILON) continue;
    while (result.length > 1) {
      const a = result.at(-2), b = result.at(-1), ab = [b[0] - a[0], b[1] - a[1]], bc = [point[0] - b[0], point[1] - b[1]];
      if (Math.abs(cross2(ab, bc)) > GEOMETRY_EPSILON || dot2(ab, bc) < 0) break;
      result.pop();
    }
    result.push(point);
  }
  return result;
}

function bounds2(polygon) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY };
}

function overlaps2(a, b) {
  return a.minX <= b.maxX + PLANE_EPSILON && b.minX <= a.maxX + PLANE_EPSILON && a.minY <= b.maxY + PLANE_EPSILON && b.minY <= a.maxY + PLANE_EPSILON;
}

function prepareFace(face) {
  let points;
  if (face.kind === 'line') points = [face.start, face.end];
  else {
    face.patchBounds = face.patches.map(bounds2);
    const local = face.patchBounds.reduce((bounds, patch) => ({ minX: Math.min(bounds.minX, patch.minX), minY: Math.min(bounds.minY, patch.minY), maxX: Math.max(bounds.maxX, patch.maxX), maxY: Math.max(bounds.maxY, patch.maxY) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    // Conservative world bounds need four corners, not a transform of every
    // vertex in every Trace capsule.
    points = [[local.minX, local.minY], [local.maxX, local.minY], [local.maxX, local.maxY], [local.minX, local.maxY]].map(face.toWorld);
  }
  face.bounds = [0, 1, 2].map(axis => {
    let min = Infinity, max = -Infinity;
    for (const point of points) { min = Math.min(min, point[axis]); max = Math.max(max, point[axis]); }
    return [min, max];
  });
  face.withinBox = face.bounds.every(([min, max], axis) => min >= -[BOX_SPEC.width, BOX_SPEC.height, BOX_SPEC.depth][axis] / 2 && max <= [BOX_SPEC.width, BOX_SPEC.height, BOX_SPEC.depth][axis] / 2);
  return face;
}

function patchCandidates(face, bounds) {
  if (face.patches.length < 16) return face.patchBounds.map((_, index) => index);
  if (!face.patchGrid) {
    const sizes = face.patchBounds.map(b => Math.max(b.maxX - b.minX, b.maxY - b.minY)).sort((a, b) => a - b);
    face.patchCell = Math.max(4, sizes[Math.floor(sizes.length / 2)]);
    face.patchGrid = new Map();
    face.patchBounds.forEach((b, index) => {
      for (let x = Math.floor(b.minX / face.patchCell); x <= Math.floor(b.maxX / face.patchCell); x++) for (let y = Math.floor(b.minY / face.patchCell); y <= Math.floor(b.maxY / face.patchCell); y++) {
        const key = `${x}:${y}`, cell = face.patchGrid.get(key) ?? [];
        cell.push(index); face.patchGrid.set(key, cell);
      }
    });
  }
  const left = Math.floor((bounds.minX - PLANE_EPSILON) / face.patchCell), right = Math.floor((bounds.maxX + PLANE_EPSILON) / face.patchCell);
  const top = Math.floor((bounds.minY - PLANE_EPSILON) / face.patchCell), bottom = Math.floor((bounds.maxY + PLANE_EPSILON) / face.patchCell);
  // A large filled face can cover many tiny Trace cells. Scanning the bounded
  // patch list is cheaper than enumerating empty cells in that case.
  if ((right - left + 1) * (bottom - top + 1) > face.patches.length * 4) return face.patchBounds.map((_, index) => index);
  const candidates = new Set();
  for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) for (const index of face.patchGrid.get(`${x}:${y}`) ?? []) candidates.add(index);
  return candidates;
}

function geometryKey({ clip, visual, time }) {
  if (clip.mode === 'line' && clip.points3D) return clip.points3D.flat().join(',');
  const placement = [...(clip.plane ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]), ...(clip.origin ?? [0, 0, 0])];
  if (clip.trace && !clip.trace.pending) {
    const trace = clip.trace, peak = trace.peak;
    return ['trace', Math.max(0, Math.min(trace.drawMs, time ?? trace.drawMs)), trace.drawMs, trace.strokeWidth, trace.sourceShape ?? clip.shape, peak?.x, peak?.y, peak?.size, peak?.width, peak?.height, peak?.angle, clip.angle, ...placement].join(',');
  }
  return [visual?.shape, visual?.x, visual?.y, visual?.size, visual?.width, visual?.height, visual?.angle, clip.ringWidth, ...placement].join(',');
}

function makeFace(entry) {
  const { clip, visual, time } = entry, plane = clip.plane ?? [1, 0, 0, 0, 1, 0, 0, 0, 1], origin = clip.origin ?? [0, 0, 0];
  if (clip.mode === 'line' && Array.isArray(clip.points3D) && clip.points3D.length >= 2) {
    return { kind: 'line', owner: entry.owner ?? clip.id, alpha: entry.alpha, start: clip.points3D[0], end: clip.points3D[1] };
  }
  if (clip.trace && !clip.trace.pending) {
    const samples = traceSamplesAt(clip, time);
    if (!samples.length) return null;
    const u = [plane[0], plane[3], plane[6]], v = [plane[1], plane[4], plane[7]], center = pointInSpace(samples[0], plane, origin);
    const points = straightPath(samples.map(point => [point.x - samples[0].x, point.y - samples[0].y])), radius = (clip.trace.strokeWidth ?? 20) / 2;
    const patches = points.length === 1 ? [circlePolygon(radius)] : points.slice(1).map((point, i) => capsulePolygon(points[i], point, radius));
    const normal = cross3(u, v), pathSegments = points.slice(1).map((point, i) => [points[i], point]);
    const toLocal = world => { const delta = sub3(world, center); return [dot3(delta, u), dot3(delta, v)]; };
    const distanceToPath = local => pathSegments.reduce((nearest, [a, b]) => {
      const delta = [b[0] - a[0], b[1] - a[1]], denominator = dot2(delta, delta);
      const t = denominator ? Math.max(0, Math.min(1, dot2([local[0] - a[0], local[1] - a[1]], delta) / denominator)) : 0;
      return Math.min(nearest, Math.hypot(local[0] - a[0] - delta[0] * t, local[1] - a[1] - delta[1] * t));
    }, points.length === 1 ? Math.hypot(local[0], local[1]) : Infinity);
    return {
      owner: entry.owner ?? clip.id, alpha: entry.alpha, center, u, v, normal, patches, holes: [],
      toWorld: local => add3(center, add3(mul3(u, local[0]), mul3(v, local[1]))), toLocal,
      contains: world => distanceToPath(toLocal(world)) <= radius + PLANE_EPSILON,
      clearance: world => radius - distanceToPath(toLocal(world)),
    };
  }
  if (!visual || !['circle', 'ring', 'rect', 'rect-ring', 'capsule'].includes(visual.shape)) return null;

  const angle = (visual.angle ?? 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const planeU = [plane[0], plane[3], plane[6]], planeV = [plane[1], plane[4], plane[7]];
  const u = add3(mul3(planeU, c), mul3(planeV, s)), v = add3(mul3(planeU, -s), mul3(planeV, c));
  const center = pointInSpace({ x: visual.x, y: visual.y }, plane, origin), normal = cross3(u, v);
  const width = visual.width ?? visual.size, height = visual.height ?? visual.size, edge = clip.ringWidth ?? 20;
  let outer, holes = [], containsLocal, clearanceLocal;
  if (visual.shape === 'circle' || visual.shape === 'ring') {
    const radius = visual.size / 2, inner = visual.shape === 'ring' ? Math.max(0, radius - edge) : 0;
    outer = circlePolygon(radius);
    if (inner > 0) holes = [circlePolygon(inner)];
    containsLocal = ([x, y]) => { const d = Math.hypot(x, y); return d <= radius + PLANE_EPSILON && (inner === 0 || d >= inner - PLANE_EPSILON); };
    clearanceLocal = ([x, y]) => { const d = Math.hypot(x, y); return inner > 0 ? Math.min(radius - d, d - inner) : radius - d; };
  } else if (visual.shape === 'rect' || visual.shape === 'rect-ring') {
    const innerWidth = Math.max(0, width - edge * 2), innerHeight = Math.max(0, height - edge * 2);
    outer = rectPolygon(width, height);
    if (visual.shape === 'rect-ring' && innerWidth > 0 && innerHeight > 0) holes = [rectPolygon(innerWidth, innerHeight)];
    containsLocal = ([x, y]) => Math.abs(x) <= width / 2 + PLANE_EPSILON && Math.abs(y) <= height / 2 + PLANE_EPSILON && (visual.shape !== 'rect-ring' || innerWidth === 0 || innerHeight === 0 || Math.abs(x) >= innerWidth / 2 - PLANE_EPSILON || Math.abs(y) >= innerHeight / 2 - PLANE_EPSILON);
    clearanceLocal = ([x, y]) => {
      const outerMargin = Math.min(width / 2 - Math.abs(x), height / 2 - Math.abs(y));
      return visual.shape === 'rect-ring' && innerWidth > 0 && innerHeight > 0 ? Math.min(outerMargin, Math.max(Math.abs(x) - innerWidth / 2, Math.abs(y) - innerHeight / 2)) : outerMargin;
    };
  } else {
    const radius = height / 2, halfSegment = width / 2;
    outer = capsulePolygon([-halfSegment, 0], [halfSegment, 0], radius);
    containsLocal = ([x, y]) => Math.hypot(Math.max(0, Math.abs(x) - halfSegment), y) <= radius + PLANE_EPSILON;
    clearanceLocal = ([x, y]) => radius - Math.hypot(Math.max(0, Math.abs(x) - halfSegment), y);
  }
  const toWorld = local => add3(center, add3(mul3(u, local[0]), mul3(v, local[1])));
  const toLocal = world => { const delta = sub3(world, center); return [dot3(delta, u), dot3(delta, v)]; };
  return {
    owner: entry.owner ?? clip.id, alpha: entry.alpha, center, u, v, normal, patches: [outer], holes, toWorld, toLocal,
    contains: world => containsLocal(toLocal(world)), clearance: world => clearanceLocal(toLocal(world)),
  };
}

function lineFaceIntersection(line, face) {
  const direction = sub3(line.end, line.start), denominator = dot3(face.normal, direction), offset = dot3(face.normal, sub3(face.center, line.start));
  if (Math.abs(denominator) > GEOMETRY_EPSILON) {
    const t = offset / denominator;
    if (t < -GEOMETRY_EPSILON || t > 1 + GEOMETRY_EPSILON) return [];
    const point = add3(line.start, mul3(direction, Math.max(0, Math.min(1, t))));
    return face.contains(point) ? [point] : [];
  }
  if (Math.abs(offset) > PLANE_EPSILON) return [];
  const length = length3(direction);
  if (length < GEOMETRY_EPSILON) return face.contains(line.start) ? [line.start] : [];
  const unit = mul3(direction, 1 / length), intervals = faceIntervals(face, line.start, unit);
  return intervals.flatMap(([a, b]) => {
    const low = Math.max(0, a), high = Math.min(length, b);
    return high >= low - PLANE_EPSILON ? [add3(line.start, mul3(unit, (low + high) / 2))] : [];
  });
}

function lineLineIntersection(a, b) {
  const u = sub3(a.end, a.start), v = sub3(b.end, b.start), w = sub3(a.start, b.start);
  const aa = dot3(u, u), bb = dot3(u, v), cc = dot3(v, v), dd = dot3(u, w), ee = dot3(v, w), denominator = aa * cc - bb * bb;
  if (aa < GEOMETRY_EPSILON) {
    const t = cc ? Math.max(0, Math.min(1, dot3(sub3(a.start, b.start), v) / cc)) : 0, q = add3(b.start, mul3(v, t));
    return length3(sub3(a.start, q)) <= PLANE_EPSILON ? [mul3(add3(a.start, q), 0.5)] : [];
  }
  if (cc < GEOMETRY_EPSILON) {
    const s = Math.max(0, Math.min(1, dot3(sub3(b.start, a.start), u) / aa)), p = add3(a.start, mul3(u, s));
    return length3(sub3(p, b.start)) <= PLANE_EPSILON ? [mul3(add3(p, b.start), 0.5)] : [];
  }
  let s = denominator < GEOMETRY_EPSILON ? 0 : Math.max(0, Math.min(1, (bb * ee - cc * dd) / denominator));
  let t = Math.max(0, Math.min(1, (bb * s + ee) / cc));
  s = Math.max(0, Math.min(1, (bb * t - dd) / aa));
  const p = add3(a.start, mul3(u, s)), q = add3(b.start, mul3(v, t));
  return length3(sub3(p, q)) <= PLANE_EPSILON ? [mul3(add3(p, q), 0.5)] : [];
}

function linePolygonInterval(point, direction, polygon) {
  const hits = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], edge = [b[0] - a[0], b[1] - a[1]], offset = [a[0] - point[0], a[1] - point[1]], denominator = cross2(direction, edge);
    if (Math.abs(denominator) <= GEOMETRY_EPSILON) {
      if (Math.abs(cross2(offset, direction)) <= PLANE_EPSILON) {
        const scale = dot2(direction, direction);
        if (scale > GEOMETRY_EPSILON) hits.push(dot2(offset, direction) / scale, dot2([b[0] - point[0], b[1] - point[1]], direction) / scale);
      }
      continue;
    }
    const t = cross2(offset, edge) / denominator, edgeT = cross2(offset, direction) / denominator;
    if (edgeT >= -GEOMETRY_EPSILON && edgeT <= 1 + GEOMETRY_EPSILON) hits.push(t);
  }
  if (!hits.length) return [];
  return [[Math.min(...hits), Math.max(...hits)]];
}

function mergeIntervals(intervals) {
  const sorted = intervals.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).sort((a, b) => a[0] - b[0]), merged = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1] + PLANE_EPSILON) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}

function faceIntervals(face, point, direction) {
  const localPoint = face.toLocal(point), localDirection = [dot3(direction, face.u), dot3(direction, face.v)];
  let intervals = mergeIntervals(face.patches.flatMap(polygon => linePolygonInterval(localPoint, localDirection, polygon)));
  const holes = mergeIntervals(face.holes.flatMap(polygon => linePolygonInterval(localPoint, localDirection, polygon)));
  for (const [holeStart, holeEnd] of holes) {
    intervals = intervals.flatMap(([start, end]) => {
      if (holeEnd <= start || holeStart >= end) return [[start, end]];
      return [[start, Math.min(end, holeStart)], [Math.max(start, holeEnd), end]].filter(([a, b]) => b - a > GEOMETRY_EPSILON);
    });
  }
  return mergeIntervals(intervals);
}

function intersectIntervals(a, b) {
  const intersections = [];
  for (const [a0, a1] of a) for (const [b0, b1] of b) {
    const start = Math.max(a0, b0), end = Math.min(a1, b1);
    if (end >= start - PLANE_EPSILON) intersections.push([start, Math.max(start, end)]);
  }
  return mergeIntervals(intersections);
}

function boxLineInterval(point, direction) {
  let low = -Infinity, high = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const half = [BOX_SPEC.width, BOX_SPEC.height, BOX_SPEC.depth][axis] / 2;
    if (Math.abs(direction[axis]) < GEOMETRY_EPSILON) { if (Math.abs(point[axis]) > half) return null; continue; }
    let a = (-half - point[axis]) / direction[axis], b = (half - point[axis]) / direction[axis];
    if (a > b) [a, b] = [b, a];
    low = Math.max(low, a); high = Math.min(high, b);
    if (low > high) return null;
  }
  return [low, high];
}

function clipHalfPlane(polygon, a, b, orientation) {
  const result = [], ex = b[0] - a[0], ey = b[1] - a[1];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    const dp = orientation * (ex * (p[1] - a[1]) - ey * (p[0] - a[0]));
    const dq = orientation * (ex * (q[1] - a[1]) - ey * (q[0] - a[0]));
    const pInside = dp >= -GEOMETRY_EPSILON, qInside = dq >= -GEOMETRY_EPSILON;
    if (pInside) result.push(p);
    if (pInside !== qInside) {
      const t = dp / (dp - dq);
      result.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return result;
}

function convexIntersection(subject, clipper) {
  let output = subject;
  const orientation = Math.sign(polygonArea(clipper)) || 1;
  for (let i = 0; i < clipper.length && output.length; i++) output = clipHalfPlane(output, clipper[i], clipper[(i + 1) % clipper.length], orientation);
  return output;
}

function subtractHole(polygon, hole) {
  if (!overlaps2(bounds2(polygon), hole.bounds)) return [polygon];
  const result = [], orientation = Math.sign(polygonArea(hole.polygon)) || 1;
  let remaining = polygon;
  for (let i = 0; i < hole.polygon.length && remaining.length; i++) {
    const a = hole.polygon[i], b = hole.polygon[(i + 1) % hole.polygon.length];
    const outside = clipHalfPlane(remaining, a, b, -orientation);
    if (outside.length && Math.abs(polygonArea(outside)) > GEOMETRY_EPSILON) result.push(outside);
    remaining = clipHalfPlane(remaining, a, b, orientation);
  }
  return result;
}

function coplanarOverlapPoint(a, b, stats) {
  // Transform each B patch once, query nearby A patches, then intersect their
  // faces. A Trace may have hundreds of capsules: never compare every pair or
  // scan the entire Trace path for every overlap candidate.
  const offset = a.toLocal(b.center), xx = dot3(a.u, b.u), xy = dot3(a.u, b.v), yx = dot3(a.v, b.u), yy = dot3(a.v, b.v);
  const toA = ([x, y]) => [offset[0] + x * xx + y * xy, offset[1] + x * yx + y * yy];
  const holes = [...a.holes, ...b.holes.map(polygon => polygon.map(toA))].map(polygon => ({ polygon, bounds: bounds2(polygon) }));
  let best = null, bestArea = -1;
  for (const patchB of b.patches) {
    const patchBInA = patchB.map(toA), boundsB = bounds2(patchBInA);
    for (const index of patchCandidates(a, boundsB)) {
      stats.patchPairs++;
      if (!overlaps2(a.patchBounds[index], boundsB)) continue;
      stats.polygonClips++;
      const overlap = convexIntersection(a.patches[index], patchBInA);
      if (!overlap.length) continue;
      let pieces = [overlap];
      for (const hole of holes) pieces = pieces.flatMap(polygon => subtractHole(polygon, hole));
      for (let polygon of pieces) {
        if (!a.withinBox || !b.withinBox) polygon = clipPolygonToBox(polygon.map(a.toWorld)).map(a.toLocal);
        if (!polygon.length) continue;
        const area = Math.abs(polygonArea(polygon));
        if (area <= bestArea) continue;
        const candidates = [polygonCentroid(polygon)];
        // Curved holes are polygon approximations. Validate against the actual
        // hole, and retain boundary fallbacks for very thin face overlaps.
        if (holes.length) candidates.push(...polygon);
        for (const candidate of candidates) {
          const world = a.toWorld(candidate);
          if (!insideBox(world) || a.holes.length && !a.contains(world) || b.holes.length && !b.contains(world)) continue;
          best = world; bestArea = area; break;
        }
      }
    }
  }
  return best;
}

function planeIntersection(a, b) {
  const direction = cross3(a.normal, b.normal), magnitude = length3(direction);
  if (magnitude < GEOMETRY_EPSILON) return { parallel: true, coplanar: Math.abs(dot3(a.normal, sub3(b.center, a.center))) <= PLANE_EPSILON };
  const unitDirection = mul3(direction, 1 / magnitude), d1 = dot3(a.normal, a.center), d2 = dot3(b.normal, b.center), divisor = magnitude * magnitude;
  const point = mul3(add3(mul3(cross3(b.normal, direction), d1), mul3(cross3(direction, a.normal), d2)), 1 / divisor);
  return { parallel: false, point, direction: unitDirection };
}

function makeMarker(world, alpha, pair, view) {
  if (!insideBox(world)) return null;
  const point = projectSpace(world, view);
  if (![point.x, point.y].every(Number.isFinite) || point.x < 0 || point.x > VW || point.y < 0 || point.y > VH) return null;
  return { x: point.x, y: point.y, world, alpha, pair };
}

function worldIntersections(a, b, stats) {
  if (a.bounds.some(([min, max], axis) => min > b.bounds[axis][1] + PLANE_EPSILON || b.bounds[axis][0] > max + PLANE_EPSILON)) return [];
  if (a.kind === 'line' && b.kind === 'line') return lineLineIntersection(a, b);
  if (a.kind === 'line') return lineFaceIntersection(a, b);
  if (b.kind === 'line') return lineFaceIntersection(b, a);
  const relation = planeIntersection(a, b);
  if (relation.parallel) {
    if (!relation.coplanar) return [];
    const world = coplanarOverlapPoint(a, b, stats);
    return world ? [world] : [];
  }
  const box = boxLineInterval(relation.point, relation.direction);
  if (!box) return [];
  const intervals = intersectIntervals(faceIntervals(a, relation.point, relation.direction), faceIntervals(b, relation.point, relation.direction));
  const points = [];
  for (const [start, end] of intervals) {
    const low = Math.max(start, box[0]), high = Math.min(end, box[1]);
    if (high >= low - PLANE_EPSILON) points.push(add3(relation.point, mul3(relation.direction, (low + high) / 2)));
  }
  return points;
}

export class IntersectionDetector {
  faces = new WeakMap();
  pairs = new WeakMap();
  stats = {};

  find(entries, view) {
    const stats = this.stats = { facesBuilt: 0, pairsSolved: 0, pairCacheHits: 0, patchPairs: 0, polygonClips: 0 };
    const faces = [];
    entries.forEach((entry, index) => {
      // Below this opacity no marker is visible, so do not construct geometry.
      if (!(entry.alpha >= 0.5)) return;
      const cacheKey = entry.clip.mode === 'line' && entry.clip.points3D || entry.clip;
      const key = geometryKey(entry);
      let cached = this.faces.get(cacheKey);
      if (!cached || cached.key !== key) {
        const face = makeFace(entry);
        cached = { key, face: face && prepareFace(face) };
        this.faces.set(cacheKey, cached); stats.facesBuilt++;
      }
      if (cached.face) faces.push({ face: cached.face, owner: entry.owner ?? entry.clip.id ?? index, alpha: entry.alpha });
    });
    const markers = [];
    for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
      const a = faces[i], b = faces[j];
      if (a.owner === b.owner) continue;
      let pairs = this.pairs.get(a.face);
      if (!pairs) { pairs = new WeakMap(); this.pairs.set(a.face, pairs); }
      let points = pairs.get(b.face);
      if (points === undefined) { points = worldIntersections(a.face, b.face, stats); pairs.set(b.face, points); stats.pairsSolved++; }
      else stats.pairCacheHits++;
      const pair = JSON.stringify([String(a.owner), String(b.owner)].sort()), alpha = Math.min(a.alpha, b.alpha);
      for (const world of points) { const marker = makeMarker(world, alpha, pair, view); if (marker) markers.push(marker); }
    }
    return markers;
  }
}

const defaultDetector = new IntersectionDetector();
export function findIntersections(entries, view) { return defaultDetector.find(entries, view); }

export class IntersectionPulseTracker {
  tracks = new Map();

  reset() { this.tracks.clear(); this.lastPhase = undefined; }

  update(side, markers, phase, { fadeInMs = 0, holdMs = 200, fadeOutMs = 0 } = {}, view, entries) {
    if (this.lastSide !== side) { this.lastSide = side; this.reset(); }
    if (this.lastPhase !== undefined && phase + 2 < this.lastPhase) this.reset();
    this.lastPhase = phase;
    const total = fadeInMs + holdMs + fadeOutMs;
    const ownerAlpha = entries && new Map();
    entries?.forEach((entry, index) => {
      const owner = String(entry.owner ?? entry.clip.id ?? index);
      ownerAlpha.set(owner, Math.max(ownerAlpha.get(owner) ?? 0, entry.alpha));
    });
    const visible = track => !ownerAlpha || JSON.parse(track.pair).every(owner => (ownerAlpha.get(owner) ?? 0) >= 0.5);
    const tracks = [...this.tracks.values()], used = new Set(), current = [];
    for (const marker of markers) {
      let match = null, nearest = Infinity;
      for (const track of tracks) {
        if (used.has(track) || track.pair !== marker.pair || phase - track.lastSeen > Math.max(100, total)) continue;
        const distance = marker.world && track.world ? length3(sub3(track.world, marker.world)) : Math.hypot(track.x - marker.x, track.y - marker.y);
        if (distance < nearest) { nearest = distance; match = track; }
      }
      if (!match) match = { pair: marker.pair, started: phase };
      used.add(match); Object.assign(match, { x: marker.x, y: marker.y, world: marker.world, alpha: marker.alpha, lastSeen: phase });
      current.push(match);
    }
    const result = [];
    for (const track of tracks) if (!used.has(track) && visible(track) && phase - track.lastSeen <= Math.max(100, total)) current.push(track);
    this.tracks = new Map(current.map((track, index) => [`${track.pair}:${index}`, track]));
    for (const track of current) {
      const age = Math.max(0, phase - track.started);
      if (!total || age >= total) continue;
      const alpha = age < fadeInMs ? age / Math.max(1, fadeInMs) : age < fadeInMs + holdMs ? 1 : (total - age) / Math.max(1, fadeOutMs);
      const point = track.world && view ? projectSpace(track.world, view) : track;
      const visibleAlpha = track.alpha * alpha;
      if (visibleAlpha >= 0.5 && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= VW && point.y >= 0 && point.y <= VH) result.push({ x: point.x, y: point.y, alpha: visibleAlpha, pair: track.pair });
    }
    return result;
  }
}
