import { MAX_BRUSH_SIZE } from './canvas.js';
export const DEFAULT_EFFECTS = Object.freeze({ blur: true, blurRadius: 16 });
export const EFFECT_LIMITS = Object.freeze({ blurRadius: [0, 192] });
export const DEFAULT_RING_WIDTH = 5;
export const MAX_RING_WIDTH = MAX_BRUSH_SIZE / 2;

// Effects are appearance, separate from the cached stroke geometry.
export function layerEffects(clip) { return { blur: clip.effects?.blur ?? DEFAULT_EFFECTS.blur, blurRadius: clip.effects?.blurRadius ?? DEFAULT_EFFECTS.blurRadius }; }
export function validateEffects(value) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !Object.hasOwn(DEFAULT_EFFECTS, key) && !['glitch', 'glitchAmount', 'chromatic', 'chromaticAmount'].includes(key))) throw new Error('Invalid layer effects');
  for (const key of ['blur']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error(`Invalid ${key} effect`);
  for (const [key, [min, max]] of Object.entries(EFFECT_LIMITS)) if (value[key] !== undefined && (!Number.isInteger(value[key]) || value[key] < min || value[key] > max)) throw new Error(`Invalid ${key}`);
}
export function validateRingWidth(value) {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > MAX_RING_WIDTH)) throw new Error('Invalid ring width');
}
export function paintingStyle(clip) {
  const { edgeColor, edgeWidth, ...style } = clip;
  return { ...style, blendMode: 'analog', effects: layerEffects(clip) };
}
