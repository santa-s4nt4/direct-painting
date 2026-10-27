import { validatePlane, insideBox, pointInSpace, BOX_SPEC } from './space.js';
import { MAX_BRUSH_SIZE } from './canvas.js';
import { validateEffects, validateRingWidth, DEFAULT_RING_WIDTH, MAX_RING_WIDTH } from './effects.js';
import { strokePoints, angleDelta } from './drawing.js';
import { TrailField, PersistentField, SmoothedCircle, TRAIL_LIFETIME } from './motion.js';
import { prepareShapeClip } from './geometry.js';
import { layerVariants, EYE_FIELDS } from './layers.js';
import { validateP5Source } from './p5-motion.js';
import { hasColorGradient, colorAtTime } from './color.js';
import { activeMotionDuration } from './trace-motion.js';

export { LOOP_MS as DEFAULT_LOOP_MS } from './transport.js';
import { LOOP_MS as DEFAULT_LOOP_MS } from './transport.js';

export class LoopClock {
  constructor(now = 0, duration = DEFAULT_LOOP_MS) { this.duration = duration; this.origin = now; this.held = 0; this.playing = true; }
  phase(now) { return ((this.playing ? now - this.origin : this.held) % this.duration + this.duration) % this.duration; }
  pause(now) { this.held = this.phase(now); this.playing = false; }
  play(now) { if (!this.playing) { this.origin = now - this.held; this.playing = true; } }
  restart(now) { this.seek(0, now); }
  seek(phase, now) { this.held = ((phase % this.duration) + this.duration) % this.duration; this.origin = now - this.held; }
  resize(duration, now) { const phase = this.phase(now); this.duration = duration; this.held = phase % duration; this.origin = now - this.held; }
}

// The application clock cannot grow when layers or fades exceed the loop.
export class FixedLoopClock extends LoopClock {
  constructor(now = 0) { super(now, DEFAULT_LOOP_MS); }
  resize(_duration, now) { super.resize(DEFAULT_LOOP_MS, now); }
}

export const DEFAULT_FADE_MS = 2000;
export function layerSizeRange(clip) {
  return clip.samples.reduce((range, sample) => ({ min: Math.min(range.min, sample.size), max: Math.max(range.max, sample.size) }), { min: MAX_BRUSH_SIZE, max: 1 });
}

// Normalize the circles actually recorded, independently of the input brush range.
// Keep their relative diameters so a collapsed range can later be expanded again.
export function resizeGesture(clip, bound, value) {
  const original = layerSizeRange(clip), diameterRange = { ...original };
  const positions = clip.samples.map(sample => sample.diameterPosition ?? (original.max > original.min ? (sample.size - original.min) / (original.max - original.min) : 1));
  const positionRange = positions.reduce((range, position) => ({ min: Math.min(range.min, position), max: Math.max(range.max, position) }), { min: 1, max: 0 });
  const diameter = Math.max(1, Math.min(MAX_BRUSH_SIZE, Math.round(value)));
  if (positionRange.min === positionRange.max) diameterRange.min = diameterRange.max = diameter;
  else {
    diameterRange[bound] = diameter;
    if (diameterRange.min > diameterRange.max) diameterRange[bound === 'min' ? 'max' : 'min'] = diameter;
  }
  const samples = clip.samples.map((sample, index) => {
    const diameterPosition = positions[index];
    return { ...sample, diameterPosition, size: Math.round(diameterRange.min + (diameterRange.max - diameterRange.min) * diameterPosition) };
  });
  return { ...clip, diameterRange, samples };
}
export function fadeDuration(clip) { return clip.mode === 'trail' ? TRAIL_LIFETIME : clip.fadeMs ?? DEFAULT_FADE_MS; }
export function gestureLength(clip) { return clip.mode === 'place' ? (clip.fadeInMs ?? 300) + (clip.holdMs ?? 1000) + (clip.fadeOutMs ?? 1000) : activeMotionDuration(clip) + fadeDuration(clip); }
export const MIN_TRIM_MS = 50;
export function trimRange(clip) { return { in: clip.trimIn ?? 0, out: clip.trimOut ?? gestureLength(clip) }; }
export function playbackLength(clip) { const range = trimRange(clip); return range.out - range.in; }
const wrap = (time, duration) => ((time % duration) + duration) % duration;
// Moving the IN handle keeps the retained frames at their existing loop times.
// The source samples remain untouched so either handle can restore cut frames.
export function trimGesture(clip, bound, value, loopDuration = DEFAULT_LOOP_MS) {
  const range = trimRange(clip), length = gestureLength(clip), minimum = Math.min(MIN_TRIM_MS, length);
  if (bound === 'in') {
    const next = Math.max(0, Math.min(range.out - minimum, Math.round(value)));
    return { ...clip, trimIn: next, start: wrap((clip.start ?? 0) + next - range.in, loopDuration) };
  }
  return { ...clip, trimOut: Math.max(range.in + minimum, Math.min(length, Math.round(value))) };
}
export function resetGestureTrim(clip, loopDuration = DEFAULT_LOOP_MS) {
  return { ...clip, start: wrap((clip.start ?? 0) - (clip.trimIn ?? 0), loopDuration), trimIn: 0, trimOut: null };
}
// Shortening a fade/hold can shorten the available source range as well.
export function fitGestureTrim(clip, loopDuration = DEFAULT_LOOP_MS) {
  if (clip.trimIn === undefined && clip.trimOut === undefined) return clip;
  const length = gestureLength(clip), range = trimRange(clip);
  const out = Math.min(range.out, length), start = Math.max(0, Math.min(range.in, out - 1));
  return { ...clip, start: wrap((clip.start ?? 0) + start - range.in, loopDuration), trimIn: start, ...(clip.trimOut != null ? { trimOut: out } : {}) };
}
export function gestureOpacity(clip, time) {
  if (clip.mode === 'line' && clip.linePending) return 1;
  if (clip.mode === 'place') {
    const fadeIn = clip.fadeInMs ?? 300, hold = clip.holdMs ?? 1000, fadeOut = clip.fadeOutMs ?? 1000;
    if (time < fadeIn) return (Math.max(0, time) / fadeIn) ** 2;
    if (time < fadeIn + hold) return 1;
    return fadeOut ? Math.max(0, 1 - (time - fadeIn - hold) / fadeOut) ** 2 : 0;
  }
  const duration = activeMotionDuration(clip);
  if (clip.mode === 'trail' || time <= duration) return 1;
  return Math.max(0, 1 - (time - duration) / fadeDuration(clip)) ** 2;
}
export function minimumLoop(clips) { return Math.max(1000, ...clips.flatMap(layerVariants).flatMap(clip=>[playbackLength(clip),...(clip.lineMarkers??[]).map(playbackLength)])); }

// Keep source timing relative to its gesture, and place that gesture on the loop.
// Taking modulo here lets a late-starting trail continue across the loop seam.
export function gestureTime(clip, phase, loopDuration) {
  const start = (clip.start ?? 0) % loopDuration;
  return (clip.trimIn ?? 0) + wrap(phase - start, loopDuration);
}

export function gestureVisible(clip, phase, loopDuration) {
  if (clip.mode === 'line' && clip.linePending) return true;
  return gestureTime(clip, phase, loopDuration) < trimRange(clip).out;
}

// Interpolate sparse input samples, preserving timing and pressure-derived size.
export function sampleAt(samples, time) {
  if (time <= samples[0].t) return samples[0];
  let low = 0, high = samples.length - 1;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (samples[middle].t <= time) low = middle; else high = middle - 1; }
  const a = samples[low], b = samples[low + 1];
  if (!b) return { ...a, t: time };
  const fraction = (time - a.t) / (b.t - a.t);
  const appearance = a.color !== undefined ? { color: a.color } : {};
  // Sample colors stay stepped; firework color progress and alpha can be smooth.
  // Never interpolate into the next firework's reset or reveal hidden gaps.
  const interpolate = a.active !== false && !(b.colorProgress < a.colorProgress);
  for (const [key, fallback] of [['opacity', 1], ['colorProgress', 0]]) {
    if (a[key] !== undefined || b[key] !== undefined) {
      const from = a[key] ?? fallback;
      appearance[key] = interpolate ? from + ((b[key] ?? from) - from) * fraction : from;
    }
  }
  if (a.step || a.active === false || b.active === false) return { ...a, ...appearance, t: time };
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, size: a.size + (b.size - a.size) * fraction, t: time, ...appearance, ...(a.active !== undefined ? { active: a.active } : {}), ...(a.shape === 'ring' ? { shape: 'ring', ringWidth: a.ringWidth } : {}), ...(['rect', 'rect-ring'].includes(a.shape) ? { shape: a.shape, width: a.width + (b.width - a.width) * fraction, height: a.height + (b.height - a.height) * fraction, angle: a.angle + angleDelta(a.angle, b.angle) * fraction } : {}) };
}

function addSegment(field, a, b, color, style) {
  const points = strokePoints(a, b);
  points.forEach((point, i) => field.add(point, color, a.t + (b.t - a.t) * (i + 1) / points.length, style));
  // Held circles must retain their brightness until the pencil is lifted.
  if (!points.length) field.add(b, color, b.t, style);
}

// Each gesture owns a reusable surface. Seeking backwards resets its path;
// ordinary playback only rasterizes the new segment, rather than the whole path.
export class CachedGesture {
  constructor(clip) {
    clip = prepareShapeClip(clip);
    this.clip = clip; this.lastTime = -1; this.lastFrame = -1;
    if (clip.mode === 'place' || clip.mode === 'move' && clip.procedural?.kind === 'p5') { this.positions = clip.samples; return; }
    if (clip.mode === 'return' || clip.mode === 'trail' || clip.mode === 'line') return;
    else {
      const circle = new SmoothedCircle(clip.samples[0], clip.color, 0);
      this.positions = [{ ...circle.point, t: 0 }];
      // Bake the same easing on a fixed clock so scrubbing is deterministic.
      let next = 1;
      for (let time = 1000 / 60; time < clip.duration + 750; time += 1000 / 60) {
        while (next < clip.samples.length && clip.samples[next].t <= time) {
          const sample = clip.samples[next++]; circle.update(sample.t); circle.setTarget(sample);
        }
        circle.update(time); this.positions.push({ ...circle.point, t: time });
      }
    }
  }

  releaseRaster() {
    if (this.field) { this.field = null; this.lastTime = this.lastFrame = -1; }
  }

  render(time) {
    if (this.clip.mode === 'move' || this.clip.mode === 'place') return sampleAt(this.positions, time);
    this.field ??= ['return', 'line'].includes(this.clip.mode) ? new PersistentField(hasColorGradient(this.clip)) : new TrailField(hasColorGradient(this.clip));
    if (time === this.lastFrame) return this.colorizedField(time);
    const { samples, color } = this.clip;
    if (this.clip.mode === 'line' && this.clip.linePending) {
      if (this.lastTime < 0) for (const point of samples) this.field.add(point, color, 0, { ...this.clip, ringWidth: Math.min(this.clip.ringWidth ?? DEFAULT_RING_WIDTH, 12, Math.floor(point.size / 4)) });
      this.lastTime = time; this.lastFrame = time; return this.colorizedField(time);
    }
    const duration = this.clip.mode === 'line' ? 1 : this.clip.duration;
    if (time < this.lastTime || this.lastTime < 0) { this.field.clear(); this.lastTime = -1; }
    const until = this.clip.mode === 'line' ? 1 : Math.min(time, duration);
    if (this.lastTime < duration) {
      if (this.lastTime < 0) this.field.add(samples[0], color, 0, this.clip);
      let previous = sampleAt(samples, Math.max(0, this.lastTime));
      for (const sample of samples) {
        if (sample.t > Math.max(0, this.lastTime) && sample.t < until) { addSegment(this.field, previous, sample, color, this.clip); previous = sample; }
      }
      if (until >= previous.t) addSegment(this.field, previous, sampleAt(samples, until), color, this.clip);
    }
    this.lastTime = time; this.lastFrame = time;
    if (this.clip.mode === 'trail') this.field.render(time);
    return this.colorizedField(time);
  }

  colorizedField(time) {
    const { data, paintMask } = this.field;
    if (!paintMask) return data;
    const fill = colorAtTime(this.clip, time), colors = [0, Number.parseInt(fill.slice(1), 16), Number.parseInt(fill.slice(1), 16)];
    // Keep geometry and alpha cached. Recolor the visible surface without
    // replaying its path, including when a color is edited on a paused frame.
    for (let pixel = 0; pixel < paintMask.length; pixel++) {
      const offset = pixel * 4;
      if (!data[offset + 3]) continue;
      const color = colors[paintMask[pixel]];
      data[offset] = color >> 16; data[offset + 1] = (color >> 8) & 255; data[offset + 2] = color & 255;
    }
    return data;
  }
}

export function validateProject(project) {
  if (!project || project.version !== 1 || !Array.isArray(project.clips)) throw new Error('Invalid local project');
  if(project.space!==undefined&&(!project.space||Object.keys(BOX_SPEC).some(k=>project.space[k]!==BOX_SPEC[k])))throw new Error('Invalid 3D canvas space');
  const ids = new Set();
  const clips = project.clips.map(clip => {
    if (!clip || typeof clip.id !== 'string' || ids.has(clip.id) || !['trail', 'return', 'move', 'place', 'line'].includes(clip.mode) || !/^#[0-9a-f]{6}$/i.test(clip.color) || !Array.isArray(clip.samples) || !clip.samples.length || !Array.isArray(clip.targets) || !clip.targets.length || clip.targets.length > 2 || clip.targets.some(index => index !== 0 && index !== 1) || !Number.isFinite(clip.duration) || clip.duration < 0) throw new Error('Invalid cached gesture');
    if (clip.mode === 'line' && (clip.duration !== 0 || clip.samples.length !== (clip.lineIncomplete ? 1 : 2) || typeof clip.linePending !== 'boolean' || clip.lineIncomplete && !clip.linePending)) throw new Error('Invalid line');
    for (const key of ['linePending', 'lineIncomplete']) if (clip[key] !== undefined && (clip.mode !== 'line' || typeof clip[key] !== 'boolean')) throw new Error('Invalid line state');
    if (new Set(clip.targets).size !== clip.targets.length) throw new Error('Duplicate drawing targets');
    if (clip.enabled !== undefined && typeof clip.enabled !== 'boolean') throw new Error('Invalid layer visibility');
    if (clip.blendMode !== undefined && !['normal', 'analog'].includes(clip.blendMode)) throw new Error('Invalid blend mode');
    if (clip.mixAmount !== undefined && (!Number.isInteger(clip.mixAmount) || clip.mixAmount < 0 || clip.mixAmount > 100)) throw new Error('Invalid mix ratio');
    if (clip.procedural !== undefined) {
      validateP5Source(clip.procedural);
      if (clip.mode === 'place') throw new Error('p5 motion cannot be a placed shape');
    }
    if (clip.opacity !== undefined && (!Number.isFinite(clip.opacity) || clip.opacity < 0 || clip.opacity > 1)) throw new Error('Invalid layer opacity');
    validateEffects(clip.effects); validateRingWidth(clip.ringWidth); validatePlane(clip.plane);
    if (clip.trace !== undefined) {
      const trace = clip.trace, peak = trace?.peak;
      if (clip.mode !== 'move' || clip.procedural || !trace || typeof trace !== 'object' || Array.isArray(trace) || typeof trace.pending !== 'boolean' || !Number.isInteger(trace.drawMs) || trace.drawMs < 100 || trace.drawMs > 10000 || !Number.isInteger(trace.strokeWidth) || trace.strokeWidth < 1 || trace.strokeWidth > MAX_RING_WIDTH || !peak || !['x', 'y', 'size'].every(key => Number.isFinite(peak[key])) || peak.size < 1 || peak.size > MAX_BRUSH_SIZE || !Number.isFinite(peak.t) || peak.t < 0 || peak.t > clip.duration + 750) throw new Error('Invalid trace motion');
      if (trace.sourceShape !== undefined && !['circle', 'ring', 'rect', 'rect-ring'].includes(trace.sourceShape)) throw new Error('Invalid trace shape');
      if (['rect', 'rect-ring'].includes(trace.sourceShape ?? clip.shape) && ['width', 'height'].some(key => !Number.isFinite(peak[key]) || peak[key] < 1 || peak[key] > MAX_BRUSH_SIZE)) throw new Error('Invalid trace rectangle');
      if (peak.angle !== undefined && (!Number.isFinite(peak.angle) || Math.abs(peak.angle) > 720)) throw new Error('Invalid trace angle');
    }
    if(clip.origin!==undefined&&(!Array.isArray(clip.origin)||clip.origin.length!==3||!insideBox(clip.origin)))throw new Error('Invalid drawing plane origin');
    if(clip.points3D!==undefined&&(clip.mode!=='line'||!Array.isArray(clip.points3D)||clip.points3D.length!==clip.samples.length||clip.points3D.some(p=>!Array.isArray(p)||p.length!==3||!insideBox(p))))throw new Error('Invalid spatial line points');
    if(clip.lineMarkers!==undefined){
      if(clip.mode!=='line'||!Array.isArray(clip.lineMarkers)||clip.lineMarkers.length!==clip.samples.length||clip.lineMarkers.some(m=>m.mode!=='move'||m.shape!=='ring'||m.lineMarkers!==undefined))throw new Error('Invalid line ring markers');
      for(const marker of clip.lineMarkers)validateProject({version:1,duration:project.duration,clips:[marker]});
    }
    const start = clip.start ?? 0;
    if (clip.shape !== undefined && !['circle', 'rect', 'ring', 'rect-ring'].includes(clip.shape)) throw new Error('Invalid shape');
    if (clip.angle !== undefined && (!Number.isFinite(clip.angle) || Math.abs(clip.angle) > 360)) throw new Error('Invalid angle');
    if (clip.followDirection !== undefined && typeof clip.followDirection !== 'boolean') throw new Error('Invalid direction setting');
    if (clip.editScope !== undefined && (!['all', '0', '1'].includes(clip.editScope) || (clip.editScope !== 'all' && !clip.targets.includes(Number(clip.editScope))))) throw new Error('Invalid edit scope');
    for (const [key, min, max] of [['fadeInMs', 0, 10000], ['holdMs', 100, 600000], ['fadeOutMs', 0, 10000]]) if (clip[key] !== undefined && (!Number.isInteger(clip[key]) || clip[key] < min || clip[key] > max)) throw new Error(`Invalid ${key}`);
    if (clip.mode === 'place' && (clip.duration !== 0 || clip.samples.length !== 1)) throw new Error('Invalid placed shape');
    if (clip.edgeColor !== undefined && !/^#[0-9a-f]{6}$/i.test(clip.edgeColor)) throw new Error('Invalid edge color');
    if (clip.edgeWidth !== undefined && (!Number.isInteger(clip.edgeWidth) || clip.edgeWidth < 0 || clip.edgeWidth > 32)) throw new Error('Invalid edge width');
    if (clip.colorBase !== undefined && !/^#[0-9a-f]{6}$/i.test(clip.colorBase)) throw new Error('Invalid base color');
    if (clip.colorLightness !== undefined && (!Number.isFinite(clip.colorLightness) || clip.colorLightness < 0 || clip.colorLightness > 100)) throw new Error('Invalid color lightness');
    if (clip.colorEditMode !== undefined && !['color', 'lightness', 'gradient', 'firework', 'sample'].includes(clip.colorEditMode)) throw new Error('Invalid color selection mode');
    if (clip.colorEditMode === 'sample' && (clip.mode !== 'move' || clip.procedural?.kind !== 'p5' || !clip.samples.some(sample => sample?.color !== undefined))) throw new Error('Invalid snippet color mode');
    if (clip.fireworkColorTo !== undefined && !/^#[0-9a-f]{6}$/i.test(clip.fireworkColorTo)) throw new Error('Invalid firework fade color');
    if (clip.colorEditMode === 'firework' && (!clip.fireworkColorTo || clip.mode !== 'move' || clip.procedural?.kind !== 'p5')) throw new Error('Invalid firework color mode');
    if (clip.colorGradient !== undefined) {
      const gradient = clip.colorGradient;
      if (!gradient || typeof gradient !== 'object' || Array.isArray(gradient) || !/^#[0-9a-f]{6}$/i.test(gradient.to) || !Number.isFinite(gradient.startMs) || !Number.isFinite(gradient.endMs) || gradient.startMs < 0 || gradient.endMs <= gradient.startMs) throw new Error('Invalid color gradient');
    }
    if (clip.colorEditMode === 'gradient' && !clip.colorGradient) throw new Error('Missing color gradient');
    for (const range of [clip.sizeRange, clip.diameterRange, clip.widthRange, clip.heightRange]) {
      if (range !== undefined && (!range || !Number.isInteger(range.min) || !Number.isInteger(range.max) || range.min < 1 || range.max > MAX_BRUSH_SIZE || range.min > range.max)) throw new Error('Invalid layer size range');
    }
    if (!Number.isFinite(start) || start < 0) throw new Error('Invalid gesture start time');
    if (clip.fadeMs !== undefined && (!Number.isFinite(clip.fadeMs) || clip.fadeMs < 100 || clip.fadeMs > 10000)) throw new Error('Invalid fade duration');
    if (clip.trimIn !== undefined && (!Number.isFinite(clip.trimIn) || clip.trimIn < 0)) throw new Error('Invalid trim in');
    if (clip.trimOut !== undefined && clip.trimOut !== null && (!Number.isFinite(clip.trimOut) || clip.trimOut < 0)) throw new Error('Invalid trim out');
    const trim = trimRange(clip);
    if (trim.in >= trim.out || trim.out > gestureLength(clip)) throw new Error('Invalid trim range');
    ids.add(clip.id);
    let previous = -1;
    for (const sample of clip.samples) {
      if (!sample || !['x', 'y', 'size', 't'].every(key => Number.isFinite(sample[key])) || sample.size < 1 || sample.size > MAX_BRUSH_SIZE || sample.t < previous || sample.t < 0 || sample.t > clip.duration) throw new Error('Invalid gesture samples');
      if(clip.plane&&!insideBox(pointInSpace(sample,clip.plane,clip.origin)))throw new Error('Sample exceeds 3D canvas');
      for (const key of ['active', 'step']) if (sample[key] !== undefined && (typeof sample[key] !== 'boolean' || clip.mode !== 'move' || clip.procedural?.kind !== 'p5')) throw new Error(`Invalid sample ${key}`);
      for (const key of ['opacity', 'colorProgress']) if (sample[key] !== undefined && (!Number.isFinite(sample[key]) || sample[key] < 0 || sample[key] > 1 || clip.mode !== 'move' || clip.procedural?.kind !== 'p5')) throw new Error(`Invalid sample ${key}`);
      if (sample.color !== undefined && (typeof sample.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(sample.color) || clip.mode !== 'move' || clip.procedural?.kind !== 'p5')) throw new Error('Invalid sample color');
      if (sample.shape !== undefined && !['circle', 'rect', 'ring', 'rect-ring'].includes(sample.shape)) throw new Error('Invalid sample shape');
      validateRingWidth(sample.ringWidth);
      for (const key of ['width', 'height']) if (sample[key] !== undefined && (!Number.isFinite(sample[key]) || sample[key] < 1 || sample[key] > MAX_BRUSH_SIZE)) throw new Error('Invalid rectangle dimensions');
      for (const key of ['angle', 'heading']) if (sample[key] !== undefined && (!Number.isFinite(sample[key]) || Math.abs(sample[key]) > 720)) throw new Error('Invalid sample angle');
      for (const key of ['pressure', 'diameterPosition', 'widthPosition', 'heightPosition']) {
        if (sample[key] !== undefined && (!Number.isFinite(sample[key]) || sample[key] < 0 || sample[key] > 1)) throw new Error(`Invalid sample ${key}`);
      }
      previous = sample.t;
    }
    if (clip.samples[0].t !== 0) throw new Error('Missing gesture start');
    if (clip.eyeOverrides !== undefined) {
      if (!clip.eyeOverrides || typeof clip.eyeOverrides !== 'object' || Array.isArray(clip.eyeOverrides)) throw new Error('Invalid eye overrides');
      for (const [side, patch] of Object.entries(clip.eyeOverrides)) {
        if (!['0', '1'].includes(side) || !clip.targets.includes(Number(side)) || !patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !EYE_FIELDS.includes(key))) throw new Error('Invalid eye override');
        const variant = { ...clip, ...patch, targets: [Number(side)] }; delete variant.eyeOverrides; delete variant.editScope;
        validateProject({ version: 1, clips: [variant], duration: project.duration });
      }
    }
    return { ...clip, start, enabled: clip.enabled !== false };
  });
  const duration = Math.max(minimumLoop(clips), Number.isFinite(project.duration) ? project.duration : DEFAULT_LOOP_MS);
  return { ...project, clips, duration };
}
