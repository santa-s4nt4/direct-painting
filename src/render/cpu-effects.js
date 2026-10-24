import { layerEffects, glitchShift } from '../effects.js';

// Compatibility path without Canvas2D.filter (also works on older iPads).
// Blur premultiplied RGBA, including alpha; transparent pixels never turn black.
export class CPULayerEffects {
  apply(input, width, height, clip, time) {
    const fx = layerEffects(clip), blur = fx.blur && fx.blurRadius > 0;
    if (!blur && !fx.glitch && !fx.chromatic) return input;
    const scale = blur ? 4 : 1, w = Math.ceil(width / scale), h = Math.ceil(height / scale);
    const length = w * h * 4;
    if (this.source?.length !== length) { this.source = new Float32Array(length); this.scratch = new Float32Array(length); this.filtered = new Float32Array(length); }
    const source = this.source; source.fill(0);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4, q = (Math.floor(y / scale) * w + Math.floor(x / scale)) * 4, alpha = input[p + 3] / 255 / (scale * scale);
      source[q] += input[p] * alpha; source[q + 1] += input[p + 1] * alpha; source[q + 2] += input[p + 2] * alpha; source[q + 3] += alpha * 255;
    }
    let image = source;
    if (blur) {
      const radius = Math.max(1, Math.round(fx.blurRadius / scale / 2));
      for (let i = 0; i < 3; i++) { box(image, this.scratch, w, h, radius, true); box(this.scratch, this.filtered, w, h, radius, false); image = this.filtered; }
    }
    if (this.output?.length !== input.length) this.output = new Uint8ClampedArray(input.length);
    const output = this.output, chromatic = fx.chromatic ? fx.chromaticAmount : 0;
    const read = (x, y, channel) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return 0;
      const px = Math.max(0, Math.min(w - 1, (x + .5) / scale - .5)), py = Math.max(0, Math.min(h - 1, (y + .5) / scale - .5));
      const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), tx = px - x0, ty = py - y0;
      const a = image[(y0 * w + x0) * 4 + channel] * (1 - tx) + image[(y0 * w + x1) * 4 + channel] * tx;
      const b = image[(y1 * w + x0) * 4 + channel] * (1 - tx) + image[(y1 * w + x1) * 4 + channel] * tx;
      return a * (1 - ty) + b * ty;
    };
    for (let y = 0; y < height; y++) {
      const shift = fx.glitch ? glitchShift(y + .5, time, fx.glitchAmount) : 0;
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4, sx = x - shift;
        const alpha = Math.max(read(sx, y, 3), read(sx - chromatic, y, 3), read(sx + chromatic, y, 3));
        output[p] = alpha ? read(sx - chromatic, y, 0) * 255 / alpha : 0;
        output[p + 1] = alpha ? read(sx, y, 1) * 255 / alpha : 0;
        output[p + 2] = alpha ? read(sx + chromatic, y, 2) * 255 / alpha : 0; output[p + 3] = alpha;
      }
    }
    return output;
  }
}

function box(input, output, width, height, radius, horizontal) {
  const lines = horizontal ? height : width, length = horizontal ? width : height, step = horizontal ? 4 : width * 4, divisor = radius * 2 + 1;
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * width * 4 : line * 4;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let i = 0; i <= radius && i < length; i++) sum += input[base + i * step + c];
      for (let i = 0; i < length; i++) {
        output[base + i * step + c] = sum / divisor;
        if (i - radius >= 0) sum -= input[base + (i - radius) * step + c];
        if (i + radius + 1 < length) sum += input[base + (i + radius + 1) * step + c];
      }
    }
  }
}
