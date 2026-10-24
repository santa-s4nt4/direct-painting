import { LED_TRACK_HELPERS } from './p5-led.js';

// Keep the snippet as source text so builds preserve its name and comments.
export const LED_RAIN_CODE = `function sequence(p, duration, options = {}) {
  const streams = 16; // Per eye. Increase for heavier rain (up to 32).
${LED_TRACK_HELPERS}
  for (const [eyeIndex, eye] of ['left', 'right'].entries()) {
    for (let stream = 0; stream < streams; stream++) {
      const frames = [frame(0, 0, 0, false)];
      function drop(start, fall, x, stop = 1) {
        if (start >= stop) return;
        for (let row = 0; row < 32; row++) {
          const time = start + fall * row / 32;
          if (time < stop) frames.push(frame(time, x, row, true));
        }
        frames.push(frame(Math.min(start + fall, stop), x, 31, false));
      }
      if (stream === 0 && split > 0) {
        // Left single drops, then right single drops. One grain at a time.
        const begin = eyeIndex * split / 2, cycle = split / 6;
        for (let i = 0; i < 3; i++) {
          const fall = cycle * vary(0.8, 0.65, 0.88);
          drop(begin + i * cycle, fall, column((i * 11 + eyeIndex * 13 + 3) % 32), begin + split / 2);
        }
      }
      if (split < 1) {
        const storm = 1 - split, stop = 1 - Math.min(0.01, storm * 0.05);
        const join = split + storm * (stream / streams * 0.45 + vary(0, 0, 0.02));
        const fall = storm * vary(0.14, 0.105, 0.175), cycle = fall + storm * 0.015;
        for (let start = join, i = 0; start < stop; start += cycle, i++) {
          drop(start, fall, column((stream * 7 + i * 11 + eyeIndex * 13) % 32), stop);
        }
      }
      addTrack(eye, 'RAIN ' + (eyeIndex === 0 ? 'L' : 'R') + ' ' + String(stream + 1).padStart(2, '0'), frames);
    }
  }
  return tracks;
}`;
