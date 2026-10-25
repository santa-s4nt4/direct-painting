import { VolumePaintingRenderer } from './volume.js';
import { CPUVolumeRenderer } from './volume-cpu.js';

export function createPaintingRenderer(canvas, options = {}) {
  try { return new VolumePaintingRenderer(canvas, options); }
  catch (error) {
    console.warn('WebGL2 unavailable; using the CPU renderer.', error);
    // A canvas that already obtained a WebGL context cannot obtain a 2D one.
    // Replace it before input handlers are attached; all attributes are kept.
    canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    const replacement = canvas.cloneNode(false); canvas.replaceWith(replacement);
    return new CPUVolumeRenderer(replacement, options);
  }
}
