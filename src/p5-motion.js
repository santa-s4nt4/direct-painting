import { CANVAS_WIDTH, CANVAS_HEIGHT } from './canvas.js';
import { brushSize, DEFAULT_EDGE_WIDTH } from './drawing.js';
import { LED_RAIN_CODE } from './p5-rain.js';
import { LED_COLOR_RAIN_CODE } from './p5-color-rain.js';
import { LEGACY_COLOR_RAIN_CODE } from './p5-color-rain-legacy.js';
import { LED_FIREWORKS_CODE } from './p5-fireworks.js';
import { LEGACY_FIREWORKS_CODE } from './p5-fireworks-legacy.js';
import { isLEDPreset, validateLEDOptions } from './p5-led.js';

export const MAX_SNIPPET_LENGTH = 32768;
export const MAX_P5_DURATION_MS = 600000;
export const P5_PRESETS = {
  rain: LED_RAIN_CODE,
  colorRain: LED_COLOR_RAIN_CODE,
  fireworks: LED_FIREWORKS_CODE,
  orbit: `function motion(p, t, seconds) {
  const a = t * p.TWO_PI;
  return {
    x: p.width / 2 + p.cos(a) * p.height * 0.32,
    y: p.height / 2 + p.sin(a) * p.height * 0.32,
    pressure: 0.5 + p.sin(a * 2) * 0.5
  };
}`,
  figure8: `function motion(p, t, seconds) {
  const a = t * p.TWO_PI;
  return {
    x: p.width / 2 + p.sin(a) * p.width * 0.32,
    y: p.height / 2 + p.sin(a * 2) * p.height * 0.25,
    pressure: 0.5 + p.cos(a) * 0.5
  };
}`,
  noise: `function motion(p, t, seconds) {
  const a = t * p.TWO_PI;
  const u = p.cos(a), v = p.sin(a);
  return {
    x: p.map(p.noise(u + 2, v + 2), 0, 1, 20, p.width - 20),
    y: p.map(p.noise(u + 9, v + 9), 0, 1, 20, p.height - 20),
    pressure: p.noise(u + 16, v + 16)
  };
}`,
};
export const DEFAULT_P5_CODE = P5_PRESETS.orbit;
export const upgradeP5Code = code => code === LEGACY_FIREWORKS_CODE ? P5_PRESETS.fireworks : code === LEGACY_COLOR_RAIN_CODE ? P5_PRESETS.colorRain : code;

export function validateP5Source(source) {
  if (!source || source.kind !== 'p5' || typeof source.code !== 'string' || !source.code.trim() || source.code.length > MAX_SNIPPET_LENGTH || !Number.isInteger(source.seed) || source.seed < 0 || source.seed > 4294967295 || !Number.isInteger(source.durationMs) || source.durationMs < 100 || source.durationMs > MAX_P5_DURATION_MS) throw new Error('Invalid p5 motion source');
  if (source.trackIndex !== undefined && (!Number.isInteger(source.trackIndex) || source.trackIndex < 0 || source.trackIndex >= 64)) throw new Error('Invalid p5 track index');
  if (source.label !== undefined && (typeof source.label !== 'string' || source.label.length > 48)) throw new Error('Invalid p5 track label');
  if (source.preset !== undefined && !isLEDPreset(source.preset)) throw new Error('Invalid LED preset');
  if (source.options !== undefined) validateLEDOptions(source.options);
  return source;
}

export function freshP5Seed(previous, entropy = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]) {
  const seed = entropy >>> 0;
  return seed === previous ? (seed + 0x9e3779b9) >>> 0 : seed;
}

function validateSampleTimes(times) {
  if (!Array.isArray(times) || times.length < 2 || times.length > 40000 || times[0] !== 0 || times.at(-1) !== 1 || times.some((time, index) => !Number.isFinite(time) || time < 0 || time > 1 || index > 0 && time <= times[index - 1])) throw new Error('Track times must increase from 0 to 1 (2–40,000 keyframes)');
  return times;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// Convert user results before they reach any rasterizer. No executable code is
// needed by the output pages, saved project, or server-side video renderer.
export function motionSamples(motion, p, durationMs, times) {
  if (times !== undefined) validateSampleTimes(times);
  const frames = times ? times.length - 1 : Math.ceil(durationMs / 1000 * 60), samples = [];
  for (let frame = 0; frame <= frames; frame++) {
    const t = times ? times[frame] : frame / frames, time = t * durationMs;
    p.frameCount = frame + 1; p.deltaTime = times ? time - (samples.at(-1)?.t ?? 0) : durationMs / frames;
    p.millis = () => time;
    const result = motion(p, t, time / 1000);
    if (!result || typeof result !== 'object' || !Number.isFinite(result.x) || !Number.isFinite(result.y)) throw new Error(`Frame ${frame}: return finite x and y coordinates`);
    const sample = { x: clamp(result.x, 0, CANVAS_WIDTH), y: clamp(result.y, 0, CANVAS_HEIGHT), pressure: 0.5, t: time };
    if (result.color !== undefined) {
      if (typeof result.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(result.color)) throw new Error(`Frame ${frame}: color must be a #RRGGBB string`);
      sample.color = result.color.toLowerCase();
    }
    for (const [key, min, max] of [['pressure', 0, 1], ['size', 1, 320], ['width', 1, 320], ['height', 1, 320], ['opacity', 0, 1], ['colorProgress', 0, 1]]) {
      if (result[key] !== undefined) {
        if (!Number.isFinite(result[key])) throw new Error(`Frame ${frame}: ${key} must be a finite number`);
        sample[key] = clamp(result[key], min, max);
      }
    }
    for (const key of ['active', 'step']) {
      if (result[key] !== undefined) {
        if (typeof result[key] !== 'boolean') throw new Error(`Frame ${frame}: ${key} must be true or false`);
        sample[key] = result[key];
      }
    }
    samples.push(sample);
  }
  return samples;
}

export function p5Clip(samples, { source, settings, id, targets, start = 0, mode = 'move' }) {
  validateP5Source(source);
  if (!['trail', 'return', 'move'].includes(mode)) throw new Error('Invalid p5 playback mode');
  if (mode !== 'move' && samples.some(sample => ['active', 'step', 'opacity', 'colorProgress', 'color'].some(key => sample[key] !== undefined))) throw new Error('Snippets with appearance/step flags require MOVE playback');
  const fireworks = source.preset === 'fireworks';
  const sampleColor = samples.find(sample => sample.active !== false && sample.color !== undefined)?.color;
  return {
    id, targets, mode, start, enabled: true, color: fireworks ? settings.p5FireworkColorA ?? settings.color : sampleColor ?? settings.color, shape: settings.shape, angle: settings.angle, followDirection: false,
    ...(fireworks ? { colorEditMode: 'firework', fireworkColorTo: settings.p5FireworkColorB ?? settings.color } : sampleColor ? { colorEditMode: 'sample' } : {}),
    edgeWidth: DEFAULT_EDGE_WIDTH, fadeMs: settings.fadeMs, sizeRange: { min: settings.minSize, max: settings.maxSize },
    duration: source.durationMs, trimIn: 0, trimOut: source.durationMs, procedural: { ...source },
    samples: samples.map(sample => ({ ...sample, size: Math.round(sample.size ?? brushSize(settings.minSize, settings.maxSize, sample.pressure, 'pen', true)), ...(settings.shape === 'rect' ? { shape: 'rect', width: Math.round(sample.width ?? brushSize(settings.widthMin, settings.widthMax, sample.pressure, 'pen', true)), height: Math.round(sample.height ?? brushSize(settings.heightMin, settings.heightMax, sample.pressure, 'pen', true)), angle: settings.angle, heading: 0 } : {}) })),
  };
}

export function sequenceTracks(sequence, p, source) {
  const definitions = sequence(p, source.durationMs / 1000, source.options ?? {});
  if (!Array.isArray(definitions) || !definitions.length || definitions.length > 64) throw new Error('A sequence must return 1–64 motion tracks');
  const selected = definitions.map((definition, index) => ({ definition, index })).filter(({ index }) => source.trackIndex === undefined || index === source.trackIndex);
  if (!selected.length) throw new Error('This track no longer exists in the sequence. Choose NEW LAYER to generate the new sequence.');
  const count = selected.reduce((sum, { definition }) => sum + (definition?.times !== undefined ? validateSampleTimes(definition.times).length : Math.ceil(source.durationMs / 1000 * 60) + 1), 0);
  if (count > 40000) throw new Error('Too many sequence samples. Use track times, reduce tracks or shorten LENGTH.');
  return selected.map(({ definition, index }) => {
    if (!definition || typeof definition.motion !== 'function') throw new Error(`Track ${index + 1}: define motion(p, t, seconds)`);
    if (definition.eye !== undefined && !['left', 'right', 'both'].includes(definition.eye)) throw new Error(`Track ${index + 1}: invalid eye`);
    if (definition.shape !== undefined && !['circle', 'rect'].includes(definition.shape)) throw new Error(`Track ${index + 1}: invalid shape`);
    if (definition.angle !== undefined && (!Number.isFinite(definition.angle) || Math.abs(definition.angle) > 180)) throw new Error(`Track ${index + 1}: invalid angle`);
    if (definition.label !== undefined && (typeof definition.label !== 'string' || definition.label.length > 48)) throw new Error(`Track ${index + 1}: invalid label`);
    return { index, eye: definition.eye, shape: definition.shape, angle: definition.angle, label: definition.label, samples: motionSamples(definition.motion, new p.constructor((source.seed + index * 7919) >>> 0), source.durationMs, definition.times) };
  });
}

export function p5Clips(result, options) {
  if (Array.isArray(result)) return [p5Clip(result, options)];
  if (options.mode !== 'move') throw new Error('Sequences require MOVE playback');
  return result.tracks.flatMap(track => {
    const targets = options.targets.filter(side => !track.eye || track.eye === 'both' || track.eye === (side === 0 ? 'left' : 'right'));
    if (!targets.length) return [];
    const source = { ...options.source, trackIndex: track.index, ...(track.label ? { label: track.label } : {}) };
    const settings = { ...options.settings, ...(track.shape ? { shape: track.shape } : {}), ...(track.angle !== undefined ? { angle: track.angle } : {}) };
    return [p5Clip(track.samples, { ...options, settings, source, targets, id: `${options.id}-${track.index}` })];
  });
}
