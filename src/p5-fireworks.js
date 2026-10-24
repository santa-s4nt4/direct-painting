import { LED_TRACK_HELPERS } from './p5-led.js';

export const LED_FIREWORKS_CODE = `function sequence(p, duration, options = {}) {
  const slots = 3; // Simultaneous fireworks per eye during the climax.
  const sparks = 8; // LED grains in each burst. slots * sparks * 2 must be <= 64.
${LED_TRACK_HELPERS}
  for (const [eyeIndex, eye] of ['left', 'right'].entries()) {
    const events = Array.from({ length: slots }, () => []);
    function launch(slot, start, length) {
      const x = column(10 + (slot * 7 + eyeIndex * 5) % 12);
      const centerX = Math.max(7, Math.min(24, x));
      const centerY = Math.round(vary(11, 7, 15));
      const radius = vary(9, 6, 12), rotation = vary(0, -0.3, 0.3);
      events[slot].push({ start, length, x, centerX, centerY, radius, rotation });
    }
    if (split > 0) {
      // The next eye launches exactly when the preceding burst has disappeared.
      for (let i = 0; i < 3; i++) launch(0, (i * 2 + eyeIndex) * split / 6, split / 6);
    }
    if (split < 1) {
      const finale = 1 - split, stop = 1 - Math.min(0.01, finale * 0.05);
      for (let slot = 0; slot < slots; slot++) {
        const offset = slot * 0.12 + vary(eyeIndex * 0.035, 0, 0.07);
        const cycle = finale * vary(0.25, 0.23, 0.29);
        const length = cycle * 0.92;
        for (let start = split + finale * offset; start < stop; start += cycle) {
          launch(slot, start, Math.min(length, stop - start));
        }
      }
    }
    for (let slot = 0; slot < slots; slot++) for (let spark = 0; spark < sparks; spark++) {
      const frames = [frame(0, 0, 0, false)];
      for (const event of events[slot]) {
        const { start, length, x, centerX, centerY, radius, rotation } = event;
        const ascent = 0.3, angle = spark / sparks * Math.PI * 2 + rotation;
        // The rocket is one LED, then breaks into eight independently moving LEDs.
        for (let step = 0; step < 20; step++) {
          const u = step / 20;
          frames.push(frame(start + length * ascent * u, Math.round(x + (centerX - x) * u), Math.round(31 + (centerY - 31) * u), spark === 0, { opacity: 1, colorProgress: 0 }));
        }
        const life = spark === 0 ? 1 : vary(1, 0.8, 1);
        for (let step = 0; step < 33; step++) {
          const u = step / 33, distance = radius * (1 - (1 - u) ** 2);
          const px = Math.round(centerX + Math.cos(angle) * distance);
          const py = Math.round(centerY + Math.sin(angle) * distance + 4 * u * u);
          const progress = Math.min(1, u / life);
          frames.push(frame(start + length * (ascent + (1 - ascent) * u), Math.max(0, Math.min(31, px)), Math.max(0, Math.min(31, py)), progress < 1, { opacity: 1 - progress, colorProgress: progress }));
        }
        frames.push(frame(start + length, 0, 0, false, { opacity: 0, colorProgress: 1 }));
      }
      addTrack(eye, 'FIREWORK ' + (eyeIndex === 0 ? 'L' : 'R') + ' ' + (slot + 1) + '·' + (spark + 1), frames);
    }
  }
  return tracks;
}`;
