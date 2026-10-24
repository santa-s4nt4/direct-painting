import { LED_TRACK_HELPERS } from './p5-led.js';

export const LED_COLOR_RAIN_CODE = `function sequence(p, duration, options = {}) {
  const streams = 24; // Per eye, up to 32. Starts empty, then fills from the top.
${LED_TRACK_HELPERS}
  const initialColor = options.initialColor ?? '#ffffff';
  const initialColorHoldMs = options.initialColorHoldMs ?? 2000;
  function rainColor() {
    const hue = p.random(6), saturation = p.random(0.7, 1), value = p.random(0.8, 1);
    const c = value * saturation, x = c * (1 - Math.abs(hue % 2 - 1)), m = value - c;
    const rgb = [[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][Math.floor(hue)];
    return '#' + rgb.map(channel => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('');
  }
  for (const [eyeIndex, eye] of ['left', 'right'].entries()) {
    for (let stream = 0; stream < streams; stream++) {
      const frames = [frame(0, 0, 0, false)];
      const cycles = Math.round(vary(9, 6, 12)), cycle = 1 / cycles;
      const offset = Math.max(0.000001, vary(cycle * (stream + 0.5) / streams, 0, cycle));
      for (let drop = 0; drop < cycles; drop++) {
        const x = column((stream * 7 + drop * 11 + eyeIndex * 13) % 32);
        const fall = cycle * vary(0.88, 0.7, 0.97), acceleration = vary(1.2, 0.85, 1.7);
        const randomColor = rainColor(); // Always consume RNG so HOLD does not change the falls.
        const start = offset + drop * cycle, end = start + fall;
        // Existing drops keep their color; new drops gradually replace them after HOLD.
        const color = start * duration * 1000 < initialColorHoldMs ? initialColor : randomColor;
        for (let row = 0; row < 32; row++) {
          const time = start + fall * Math.pow(row / 32, 1 / acceleration);
          if (time < 1) frames.push(frame(time, x, row, true, { color }));
        }
        if (end < 1) frames.push(frame(end, x, 31, false));
      }
      addTrack(eye, 'COLOR RAIN ' + (eyeIndex === 0 ? 'L' : 'R') + ' ' + String(stream + 1).padStart(2, '0'), frames);
    }
  }
  return tracks;
}`;
