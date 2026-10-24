import { MotionP5 } from './p5-math.js';
import { motionSamples, sequenceTracks, validateP5Source } from './p5-motion.js';

self.onmessage = ({ data }) => {
  try {
    const source = validateP5Source(data);
    const program = new Function('p5', `"use strict";\n${source.code}\nreturn { motion: typeof motion === 'function' ? motion : null, sequence: typeof sequence === 'function' ? sequence : null };`)(MotionP5);
    const p = new MotionP5(source.seed);
    if (program.sequence) self.postMessage({ tracks: sequenceTracks(program.sequence, p, source) });
    else if (program.motion) self.postMessage({ samples: motionSamples(program.motion, p, source.durationMs) });
    else throw new Error('Define motion(p, t, seconds) or sequence(p, duration)');
  } catch (error) { self.postMessage({ error: error.message || String(error) }); }
};
