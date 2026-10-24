export const DEFAULT_LED_OPTIONS = Object.freeze({ single: 3, climax: 2, variation: 75 });
export const isLEDPreset = value => value === 'rain' || value === 'colorRain' || value === 'fireworks';

export function validateLEDOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Invalid LED sequence options');
  for (const key of ['single', 'climax']) if (!Number.isInteger(options[key]) || options[key] < 0 || options[key] > 1000) throw new Error('Invalid LED phase ratio');
  if (!options.single && !options.climax) throw new Error('At least one LED phase ratio must be greater than zero');
  if (!Number.isInteger(options.variation) || options.variation < 0 || options.variation > 100) throw new Error('Invalid LED variation');
  if (options.initialColor !== undefined && (typeof options.initialColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(options.initialColor))) throw new Error('Invalid rain initial color');
  if (options.initialColorHoldMs !== undefined && (!Number.isInteger(options.initialColorHoldMs) || options.initialColorHoldMs < 0 || options.initialColorHoldMs > 600000)) throw new Error('Invalid rain initial color hold');
  return options;
}

// Shared source text is embedded into each editable snippet. Keyframe times are
// normalized; stretching LENGTH preserves every LED change without dense frames.
export const LED_TRACK_HELPERS = `
  const single = options.single ?? 3, climax = options.climax ?? 2;
  const split = single / (single + climax);
  const variation = (options.variation ?? 75) / 100;
  const tracks = [];
  const vary = (base, low, high) => base + (p.random(low, high) - base) * variation;
  const column = base => Math.max(0, Math.min(31, Math.round(vary(base, 0, 31))));
  function frame(t, x, y, active, appearance = {}) {
    return { t: Math.round(t * 1e12) / 1e12, x: x * 10 + 5, y: y * 10 + 5, size: 10, width: 10, height: 10, active, step: true, ...appearance };
  }
  function addTrack(eye, label, frames) {
    frames.push(frame(1, 0, 0, false));
    frames.sort((a, b) => a.t - b.t);
    const points = [];
    for (const point of frames) {
      if (point.t < 0 || point.t > 1) continue;
      if (points.length && Math.abs(point.t - points[points.length - 1].t) < 1e-12) points[points.length - 1] = point;
      else points.push(point);
    }
    const keys = points.filter((point, index) => index === 0 || index === points.length - 1 || point.active !== points[index - 1].active || point.active && (point.x !== points[index - 1].x || point.y !== points[index - 1].y || point.opacity !== points[index - 1].opacity || point.colorProgress !== points[index - 1].colorProgress));
    tracks.push({
      eye, label, shape: 'rect', angle: 0,
      times: keys.map(point => point.t),
      motion(p, t) {
        let low = 0, high = keys.length - 1;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (keys[middle].t <= t) low = middle; else high = middle - 1;
        }
        return keys[low];
      }
    });
  }
`;
