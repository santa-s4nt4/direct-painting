import { hasColorGradient } from './color.js';

export function dimensionRange(clip, axis) {
  return clip.samples.reduce((range, sample) => ({ min: Math.min(range.min, sample[axis] ?? sample.size), max: Math.max(range.max, sample[axis] ?? sample.size) }), { min: 320, max: 1 });
}
export function resizeDimension(clip, axis, bound, value) {
  const original = dimensionRange(clip, axis), range = { ...original }, key = `${axis}Position`;
  const positions = clip.samples.map(sample => sample[key] ?? (original.max > original.min ? ((sample[axis] ?? sample.size) - original.min) / (original.max - original.min) : 1));
  const varying = positions.some(position => position !== positions[0]), size = Math.max(1, Math.min(320, Math.round(value)));
  if (!varying) range.min = range.max = size;
  else { range[bound] = size; if (range.min > range.max) range[bound === 'min' ? 'max' : 'min'] = size; }
  return { ...clip, [`${axis}Range`]: range, samples: clip.samples.map((sample, index) => ({ ...sample, [key]: positions[index], [axis]: Math.round(range.min + (range.max - range.min) * positions[index]) })) };
}
export function prepareShapeClip(clip) {
  if (clip.shape !== 'rect' && !clip.samples.some(sample => sample.shape === 'rect')) return clip;
  return { ...clip, samples: clip.samples.map(sample => clip.shape === 'rect' ? { ...sample, shape: 'rect', width: sample.width ?? sample.size, height: sample.height ?? sample.size, angle: clip.angle ?? 0 } : { ...sample, shape: 'circle' }) };
}
export function renderSignature(clip) {
  return JSON.stringify([clip.mode, clip.procedural?.kind, clip.shape, clip.color, clip.edgeColor, clip.edgeWidth, hasColorGradient(clip), clip.duration, clip.angle, clip.samples]);
}
