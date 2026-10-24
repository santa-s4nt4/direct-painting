export const DEFAULT_EFFECTS = Object.freeze({ blur: true, blurRadius: 64, glitch: false, glitchAmount: 24, chromatic: false, chromaticAmount: 6 });
export const EFFECT_LIMITS = Object.freeze({ blurRadius: [0, 192], glitchAmount: [0, 96], chromaticAmount: [0, 32] });
export const DEFAULT_RING_WIDTH = 5;

// Effects are appearance, separate from the cached stroke geometry.
export function layerEffects(clip) { return { ...DEFAULT_EFFECTS, ...clip.effects }; }
export function validateEffects(value) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !Object.hasOwn(DEFAULT_EFFECTS, key))) throw new Error('Invalid layer effects');
  for (const key of ['blur', 'glitch', 'chromatic']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error(`Invalid ${key} effect`);
  for (const [key, [min, max]] of Object.entries(EFFECT_LIMITS)) if (value[key] !== undefined && (!Number.isInteger(value[key]) || value[key] < min || value[key] > max)) throw new Error(`Invalid ${key}`);
}
export function validateRingWidth(value) {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 160)) throw new Error('Invalid ring width');
}
export function paintingStyle(clip) {
  const { edgeColor, edgeWidth, ...style } = clip;
  return { ...style, blendMode: 'analog', effects: layerEffects(clip) };
}
// Integer hash shared by CPU/GLSL: deterministic on pause, seek and output.
export function glitchShift(y, time, amount) {
  const tick = Math.floor(Math.max(0, time) / 90), band = Math.floor(y / 24);
  const hash = (Math.imul(band + 1, 37) + Math.imul(tick + 1, 17)) % 101;
  return hash < 27 ? Math.round((hash / 13 - 1) * amount) : 0;
}
