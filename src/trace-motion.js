import { CANVAS_WIDTH as W, CANVAS_HEIGHT as H, VIEWPORT_WIDTH as VW, VIEWPORT_HEIGHT as VH, MARKER_DIAMETER } from './canvas.js';
import { SmoothedCircle } from './motion.js';
import { planeHomography } from './space.js';
import { CAMERA_DISTANCE, CAMERA_NEAR, CAMERA_FAR } from './view.js';
import { RENDER_FRAME_MS } from './timing.js';

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

export function traceIsFilled(clip) {
  return ['circle', 'rect'].includes(clip.trace?.sourceShape ?? clip.shape ?? 'circle');
}

// The leading point follows the perimeter exactly, including rectangle corners.
function contourPoint(visual, progress) {
  if (visual.shape === 'trace-circle') {
    const angle = -Math.PI / 2 + progress * Math.PI * 2;
    return [Math.cos(angle) * visual.size / 2, Math.sin(angle) * visual.size / 2];
  }
  const w = visual.width, h = visual.height, distance = progress * 2 * (w + h);
  if (distance <= w) return [-w / 2 + distance, -h / 2];
  if (distance <= w + h) return [w / 2, -h / 2 + distance - w];
  if (distance <= 2 * w + h) return [w / 2 - (distance - w - h), h / 2];
  return [-w / 2, h / 2 - (distance - 2 * w - h)];
}

function visualPoint(visual, [x, y]) {
  const angle = visual.angle * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return { x: visual.x + x * c - y * s, y: visual.y + x * s + y * c };
}

// Convex pieces of the swept face, shared by CPU drawing and 3D intersections.
// At most two circle sectors or four rectangle triangles, with no stroke width.
export function traceFillPolygons(clip, time = Infinity) {
  const visual = traceVisual(clip, time);
  if (!visual?.traceFill || visual.traceProgress <= 0) return [];
  const progress = visual.traceProgress, pieces = [];
  if (visual.shape === 'trace-circle') {
    if (progress >= 1) pieces.push(Array.from({ length: 96 }, (_, i) => contourPoint(visual, i / 96)));
    else for (let start = 0; start < progress; start += .5) {
      const end = Math.min(progress, start + .5), steps = Math.max(1, Math.ceil((end - start) * 96));
      pieces.push([[0, 0], ...Array.from({ length: steps + 1 }, (_, i) => contourPoint(visual, start + (end - start) * i / steps))]);
    }
  } else {
    const w = visual.width, h = visual.height, corners = [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]], lengths = [w,h,w,h];
    if (progress >= 1) pieces.push(corners);
    else {
      let remaining = progress * 2 * (w + h);
      for (let i = 0; i < 4 && remaining > 0; i++) {
        const a = corners[i], b = corners[(i + 1) % 4], fraction = Math.min(1, remaining / lengths[i]);
        pieces.push([[0, 0], a, [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]]);
        remaining -= lengths[i];
      }
    }
  }
  return pieces.map(polygon => polygon.map(point => visualPoint(visual, point)));
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
    x: peak.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: peak.y + x * Math.sin(angle) + y * Math.cos(angle),
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
  if (points.length) Object.assign(points.at(-1), { x: points[0].x, y: points[0].y });
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
  const visual = traceVisual(clip, time);
  return visual ? { ...visualPoint(visual, contourPoint(visual, visual.traceProgress)), t: Math.max(0, time) } : null;
}

export const MAX_TRACE_HEAD_MARKERS = 256;
export function traceHeadFrameWindow(previous, phase, now) {
  if (!previous) return RENDER_FRAME_MS;
  const delta = phase - previous.phase, elapsed = now - previous.now;
  return delta > 0 && delta <= 100 && Math.abs(delta - elapsed) < RENDER_FRAME_MS / 2 ? Math.max(RENDER_FRAME_MS, delta) : RENDER_FRAME_MS;
}
// A short, fading sweep joins successive 30fps head positions. Reproject every
// point through the current camera; no framebuffer history or camera blur.
export function traceHeadMarkers(clip, time, view, windowMs = RENDER_FRAME_MS) {
  if (!clip.trace || time < 0 || time >= clip.trace.drawMs || clip.trace.pending) return [];
  const visual = traceVisual(clip, time);
  if (!visual) return [];
  const end = visual.traceProgress, start = easeInOut(Math.max(0, time - Math.min(100, Math.max(0, windowMs))) / clip.trace.drawMs);
  const matrix = planeHomography(clip.plane, clip.origin, view), distance = view.distance ?? CAMERA_DISTANCE;
  const near = CAMERA_NEAR / distance, far = CAMERA_FAR / distance, angle = visual.angle * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const centerW=matrix[6]*visual.x+matrix[7]*visual.y+matrix[8],u=matrix[6]*c+matrix[7]*s,v=-matrix[6]*s+matrix[7]*c;
  const extentW=visual.shape==='trace-rect'?(Math.abs(u)*visual.width+Math.abs(v)*visual.height)/2:Math.hypot(u,v)*visual.size/2;
  if(centerW+extentW<near||centerW-extentW>far)return [];
  const sample = progress => {
    const [x,y] = contourPoint(visual,progress), px = visual.x + x*c-y*s, py = visual.y + x*s+y*c;
    return {x:matrix[0]*px+matrix[1]*py+matrix[2], y:matrix[3]*px+matrix[4]*py+matrix[5], w:matrix[6]*px+matrix[7]*py+matrix[8], progress};
  };
  const project = p => ({x:p.x/p.w,y:p.y/p.w});
  const head = sample(end), markers = [];
  const visible = p => p.w >= near && p.w <= far && Number.isFinite(p.x) && Number.isFinite(p.y);
  const onScreen = p => p.x >= 0 && p.x <= VW && p.y >= 0 && p.y <= VH;
  if (visible(head)) { const p = project(head); if(onScreen(p))markers.push({...p,alpha:1,traceHead:true}); }
  if (start === end) return markers;
  const mix = (a,b,t) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,w:a.w+(b.w-a.w)*t,progress:a.progress+(b.progress-a.progress)*t});
  const addSegment = (a,b) => {
    for(const [bound,sign] of [[near,1],[far,-1]]){
      const da=sign*(a.w-bound),db=sign*(b.w-bound);
      if(da<0&&db<0)return;
      if(da<0)a=mix(a,b,da/(da-db));else if(db<0)b=mix(a,b,da/(da-db));
    }
    let p=project(a),q=project(b),low=0,high=1;const dx=q.x-p.x,dy=q.y-p.y;
    // Clip offscreen parts before creating stamps, keeping large/zoomed traces cheap.
    for(const [origin,delta,min,max] of [[p.x,dx,0,VW],[p.y,dy,0,VH]]){
      if(Math.abs(delta)<1e-8){if(origin<min||origin>max)return;continue;}
      const t0=(min-origin)/delta,t1=(max-origin)/delta;low=Math.max(low,Math.min(t0,t1));high=Math.min(high,Math.max(t0,t1));if(low>high)return;
    }
    const length=Math.hypot(dx,dy)*(high-low),steps=Math.max(1,Math.ceil(length/(MARKER_DIAMETER/4)));
    for(let i=0;i<=steps&&markers.length<MAX_TRACE_HEAD_MARKERS;i++){
      const t=low+(high-low)*i/steps,progress=a.progress+(b.progress-a.progress)*t,alpha=.275*((progress-start)/(end-start))**2,x=p.x+dx*t,y=p.y+dy*t,last=markers.at(-1);
      if(alpha>0&&(!last||Math.hypot(x-last.x,y-last.y)>.25))markers.push({x,y,alpha,traceHead:true});
    }
  };
  const walk = (a,b,depth=0) => {
    if(markers.length>=MAX_TRACE_HEAD_MARKERS)return;
    if(visual.shape==='trace-circle'&&depth<7){
      const m=sample((a.progress+b.progress)/2);
      if(!visible(a)||!visible(b)||!visible(m)){walk(a,m,depth+1);walk(m,b,depth+1);return;}
      const p=project(a),q=project(b),r=project(m),dx=q.x-p.x,dy=q.y-p.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((r.x-p.x)*dx+(r.y-p.y)*dy)/l)):0;
      if(Math.hypot(r.x-p.x-dx*t,r.y-p.y-dy*t)>.4){walk(a,m,depth+1);walk(m,b,depth+1);return;}
    }
    addSegment(a,b);
  };
  const knots=[end,start];
  const w=visual.width,h=visual.height,corners=visual.shape==='trace-rect'?[w,w+h,2*w+h].map(d=>d/(2*(w+h))):[.25,.5,.75];
  for(const corner of corners)if(corner>start&&corner<end)knots.push(corner);
  knots.sort((a,b)=>b-a); // Spend the bounded stamp budget nearest the live head first.
  for(let i=1;i<knots.length&&markers.length<MAX_TRACE_HEAD_MARKERS;i++)walk(sample(knots[i-1]),sample(knots[i]));
  return markers;
}

// GPU coverage uses the same eased contour for the outline or swept fill.
// CPU/intersections use sampled outlines or the convex filled pieces above.
export function traceVisual(clip, time) {
  const trace = clip.trace, peak = trace?.peak;
  if (!peak || trace.pending) return null;
  const rect = ['rect', 'rect-ring'].includes(trace.sourceShape ?? clip.shape);
  return { ...peak, shape: rect ? 'trace-rect' : 'trace-circle', angle: peak.angle ?? clip.angle ?? 0,
    width: rect ? peak.width ?? peak.size : peak.size, height: rect ? peak.height ?? peak.size : peak.size,
    traceFill: traceIsFilled(clip), strokeWidth: traceIsFilled(clip) ? 0 : trace.strokeWidth ?? 20,
    traceProgress: easeInOut(Math.max(0, Math.min(1, time / trace.drawMs))) };
}
