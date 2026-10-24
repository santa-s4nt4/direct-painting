import { validateP5Source } from './p5-motion.js';

export function runP5Motion(source, signal) {
  validateP5Source(source);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Generation cancelled')); return; }
    const worker = new Worker(new URL('./p5-worker.js', import.meta.url), { type: 'module' });
    const finish = (error, samples) => {
      clearTimeout(timer); worker.terminate(); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(samples);
    };
    const abort = () => finish(new Error('Generation cancelled'));
    const timer = setTimeout(() => finish(new Error('Snippet timed out after 3 seconds. Check for an infinite loop.')), 3000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.tracks ? { tracks: data.tracks } : data.samples);
    worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || 'Could not run snippet')); };
    worker.postMessage(source);
  });
}
