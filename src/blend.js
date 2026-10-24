import spectral from 'spectral.js';

// Pigment calculations are reused across pixels and frames. Keep both caches
// bounded so color edits and long-running loops cannot grow memory indefinitely.
export class PigmentMixer {
  constructor({ colorLimit = 1024, mixLimit = 16384 } = {}) {
    this.colors = new Map(); this.mixes = new Map();
    this.colorLimit = colorLimit; this.mixLimit = mixLimit;
  }
  color(rgb) {
    let color = this.colors.get(rgb);
    if (!color) {
      color = new spectral.Color([rgb >> 16, (rgb >> 8) & 255, rgb & 255]);
      if (this.colors.size >= this.colorLimit) this.colors.delete(this.colors.keys().next().value);
      this.colors.set(rgb, color);
    }
    return color;
  }
  mix(below, above, amount = 50) {
    if (below === above || amount <= 0) return below;
    if (amount >= 100) return above;
    if (below === this.lastBelow && above === this.lastAbove && amount === this.lastAmount) return this.lastMix;
    const key = `${below}:${above}:${amount}`;
    let mixed = this.mixes.get(key);
    if (mixed === undefined) {
      const rgb = spectral.mix([this.color(below), 1 - amount / 100], [this.color(above), amount / 100]).sRGB;
      mixed = (Math.max(0, Math.min(255, Math.round(rgb[0]))) << 16) | (Math.max(0, Math.min(255, Math.round(rgb[1]))) << 8) | Math.max(0, Math.min(255, Math.round(rgb[2])));
      if (this.mixes.size >= this.mixLimit) this.mixes.delete(this.mixes.keys().next().value);
      this.mixes.set(key, mixed);
    }
    this.lastBelow = below; this.lastAbove = above; this.lastAmount = amount; this.lastMix = mixed;
    return mixed;
  }
}

// Straight-alpha compositing. Pigment mixing affects only actual overlap;
// neither a transparent pixel nor the viewer's black backdrop acts as paint.
export function compositePixel(target, offset, red, green, blue, alpha, style, mixer) {
  if (alpha <= 0) return;
  const belowAlpha = target[offset + 3] / 255;
  if (style.blendMode === 'analog' && belowAlpha > 0) {
    const below = (target[offset] << 16) | (target[offset + 1] << 8) | target[offset + 2];
    const mixed = mixer.mix(below, (red << 16) | (green << 8) | blue, style.mixAmount ?? 50);
    red += ((mixed >> 16) - red) * belowAlpha;
    green += (((mixed >> 8) & 255) - green) * belowAlpha;
    blue += ((mixed & 255) - blue) * belowAlpha;
  }
  const remaining = belowAlpha * (1 - alpha), combined = alpha + remaining;
  target[offset] = (red * alpha + target[offset] * remaining) / combined;
  target[offset + 1] = (green * alpha + target[offset + 1] * remaining) / combined;
  target[offset + 2] = (blue * alpha + target[offset + 2] * remaining) / combined;
  target[offset + 3] = combined * 255;
}
