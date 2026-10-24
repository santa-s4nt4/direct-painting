import { LED_TRACK_HELPERS } from './p5-led.js';

// Upgrade only the untouched earlier built-in snippet; retain cached frames.
export const LEGACY_COLOR_RAIN_CODE = `function sequence(p, duration, options = {}) {
  const streams = 24; // Per eye, up to 32. Full downpour for the whole LENGTH.
${LED_TRACK_HELPERS}
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
      const offset = vary(cycle * (stream + 0.5) / streams, 0, cycle);
      for (let drop = 0; drop < cycles; drop++) {
        const x = column((stream * 7 + drop * 11 + eyeIndex * 13) % 32);
        const fall = cycle * vary(0.88, 0.7, 0.97), acceleration = vary(1.2, 0.85, 1.7);
        const color = rainColor(); // One seeded color per drop, held while falling.
        // Repeat the last crossing drop at time 0 so the loop has no empty lead-in.
        for (const shift of [-1, 0]) {
          const start = offset + drop * cycle + shift, end = start + fall;
          if (end <= 0 || start >= 1) continue;
          for (let row = 0; row < 32; row++) {
            const time = start + fall * Math.pow(row / 32, 1 / acceleration);
            if (time < 1) frames.push(frame(Math.max(0, time), x, row, true, { color }));
          }
          if (end < 1) frames.push(frame(end, x, 31, false));
        }
      }
      addTrack(eye, 'COLOR RAIN ' + (eyeIndex === 0 ? 'L' : 'R') + ' ' + String(stream + 1).padStart(2, '0'), frames);
    }
  }
  return tracks;
}`;
