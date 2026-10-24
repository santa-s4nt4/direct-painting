import { MAX_BRUSH_SIZE } from './canvas.js';
import { hasColorGradient } from './color.js';

export function dimensionRange(clip, axis) {
  return clip.samples.reduce((range, sample) => ({ min: Math.min(range.min, sample[axis] ?? sample.size), max: Math.max(range.max, sample[axis] ?? sample.size) }), { min: MAX_BRUSH_SIZE, max: 1 });
}
export function resizeDimension(clip, axis, bound, value) {
  const original = dimensionRange(clip, axis), range = { ...original }, key = `${axis}Position`;
  const positions = clip.samples.map(sample => sample[key] ?? (original.max > original.min ? ((sample[axis] ?? sample.size) - original.min) / (original.max - original.min) : 1));
  const varying = positions.some(position => position !== positions[0]), size = Math.max(1, Math.min(MAX_BRUSH_SIZE, Math.round(value)));
  if (!varying) range.min = range.max = size;
  else { range[bound] = size; if (range.min > range.max) range[bound === 'min' ? 'max' : 'min'] = size; }
  return { ...clip, [`${axis}Range`]: range, samples: clip.samples.map((sample, index) => ({ ...sample, [key]: positions[index], [axis]: Math.round(range.min + (range.max - range.min) * positions[index]) })) };
}
export function prepareShapeClip(clip) {
  if (!clip.shape) return clip;
  return { ...clip, samples: clip.samples.map(sample => ({ ...sample, shape: clip.shape, ...(clip.shape === 'rect' ? { width: sample.width ?? sample.size, height: sample.height ?? sample.size, angle: clip.angle ?? 0 } : clip.shape === 'ring' ? { ringWidth: clip.ringWidth ?? 5 } : {}) })) };
}
export function renderSignature(clip) {
  return JSON.stringify([clip.mode, clip.procedural?.kind, clip.shape, clip.ringWidth, clip.color, hasColorGradient(clip), clip.duration, clip.angle, clip.samples]);
}
