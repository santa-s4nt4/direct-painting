// HSL lightness leaves hue/saturation intact and keeps the base color recoverable
// even after the user drags all the way to black or white.
export function colorHSL(color) {
  const rgb = [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16) / 255);
  const max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min, lightness = (max + min) / 2;
  if (!delta) return { hue: 0, saturation: 0, lightness: lightness * 100 };
  let hue = max === rgb[0] ? ((rgb[1] - rgb[2]) / delta) % 6 : max === rgb[1] ? (rgb[2] - rgb[0]) / delta + 2 : (rgb[0] - rgb[1]) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return { hue, saturation: delta / (1 - Math.abs(2 * lightness - 1)), lightness: lightness * 100 };
}
export function colorAtLightness(base, percent) {
  const { hue, saturation } = colorHSL(base), lightness = Math.max(0, Math.min(100, percent)) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation, x = chroma * (1 - Math.abs((hue / 60) % 2 - 1)), m = lightness - chroma / 2;
  const rgb = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${rgb.map(channel => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}
export function editLayerLightness(clip, value) {
  const colorBase = clip.colorBase ?? clip.color, colorLightness = Math.max(0, Math.min(100, value));
  return { ...clip, colorBase, colorLightness, color: colorAtLightness(colorBase, colorLightness) };
}
export function pickLayerColor(clip, color) {
  return { ...clip, color, colorBase: color, colorLightness: colorHSL(color).lightness };
}

export const hasColorGradient = clip => clip.colorEditMode === 'gradient' && Boolean(clip.colorGradient);
export const hasFireworkColor = clip => clip.colorEditMode === 'firework' && Boolean(clip.fireworkColorTo);
export const hasSampleColor = clip => clip.colorEditMode === 'sample';

export function interpolateColor(from, to, amount) {
  if (amount <= 0) return from;
  if (amount >= 1) return to;
  return `#${[1, 3, 5].map(index => {
    const a = Number.parseInt(from.slice(index, index + 2), 16), b = Number.parseInt(to.slice(index, index + 2), 16);
    return Math.round(a + (b - a) * amount).toString(16).padStart(2, '0');
  }).join('')}`;
}

// Times are relative to the original gesture, so trimming/placing a layer does
// not move its color transition to a different frame of the source animation.
export function colorAtTime(clip, time, visual) {
  if (hasSampleColor(clip)) return visual?.color ?? clip.color;
  if (hasFireworkColor(clip)) return interpolateColor(clip.color, clip.fireworkColorTo, visual?.colorProgress ?? 0);
  if (!hasColorGradient(clip)) return clip.color;
  const { to, startMs, endMs } = clip.colorGradient;
  if (time <= startMs) return clip.color;
  if (time >= endMs) return to;
  return interpolateColor(clip.color, to, (time - startMs) / (endMs - startMs));
}
