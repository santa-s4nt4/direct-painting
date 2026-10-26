import { MAX_BRUSH_SIZE } from './canvas.js';
export const DEFAULT_EFFECTS = Object.freeze({ blur: false, blurRadius: 16, motionBlur: true, motionBlurAmount: 100 });
export const EFFECT_LIMITS = Object.freeze({ blurRadius: [0, 192], motionBlurAmount: [0, 200] });
export const DEFAULT_RING_WIDTH = 20;
export const MAX_RING_WIDTH = MAX_BRUSH_SIZE / 2;

// Effects are appearance, separate from the cached stroke geometry.
export function layerEffects(clip) { return Object.fromEntries(Object.entries(DEFAULT_EFFECTS).map(([key, value]) => [key, clip.effects?.[key] ?? value])); }
export function validateEffects(value) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !Object.hasOwn(DEFAULT_EFFECTS, key) && !['glitch', 'glitchAmount', 'chromatic', 'chromaticAmount'].includes(key))) throw new Error('Invalid layer effects');
  for (const key of ['blur', 'motionBlur']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error(`Invalid ${key} effect`);
  for (const [key, [min, max]] of Object.entries(EFFECT_LIMITS)) if (value[key] !== undefined && (!Number.isInteger(value[key]) || value[key] < min || value[key] > max)) throw new Error(`Invalid ${key}`);
}
export function validateRingWidth(value) {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > MAX_RING_WIDTH)) throw new Error('Invalid ring width');
}
// Older saves always wrote Blur ON as the default. Apply the new defaults once;
// explicit motionBlur (including false) marks a save using the new effect model.
export function upgradedEffects(value) {
  const effects = layerEffects({ effects: value });
  return value?.motionBlur === undefined ? { ...effects, blur: false } : effects;
}
export function paintingStyle(clip) {
  const { edgeColor, edgeWidth, ...style } = clip;
  return { ...style, blendMode: 'analog', effects: upgradedEffects(clip.effects), ...(clip.lineMarkers ? { lineMarkers: clip.lineMarkers.map(paintingStyle) } : {}) };
}
