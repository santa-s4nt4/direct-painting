import { CANVAS_WIDTH as W, CANVAS_HEIGHT as H } from '../canvas.js';
import { LoopScene } from '../scene.js';
import { LiveDrawing } from '../live.js';
import { blurOpaqueRGB } from '../visuals.js';

// Compatibility backend for unavailable WebGL2. Server-side RGBA export keeps
// its deterministic CPU rasterizer as well; no GPU readback is needed there.
export class CPUPaintingRenderer {
  backend = 'cpu'; scene = new LoopScene(); live = new LiveDrawing();
  constructor(canvas, { onBackendChange = () => {} } = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.dataset.renderer = 'cpu'; onBackendChange('cpu');
  }
  get items() { return this.scene.items; }
  setProject(project) { this.scene.setProject(project); }
  setLiveStroke(stroke, now, move) {
    if (!stroke) { this.live.update(null, now); return; }
    const from = this.live.id === stroke.id ? this.live.count : 0;
    this.live.update({ id: stroke.id, mode: stroke.mode, color: stroke.color, targets: stroke.targets, samples: stroke.samples.slice(from), from, elapsed: Math.max(now - stroke.started, stroke.samples.at(-1).t), head: stroke.last, move }, now);
  }
  receiveLive(packet, now) { this.live.update(packet, now); }
  draw(side, phase, { now = performance.now(), placementPreview = false, blurRadius = 0 } = {}) {
    this.scene.draw(this.ctx, side, phase, { placementPreview }); this.live.draw(this.ctx, side, now);
    if (blurRadius > 0) {
      this.scratch ??= new Uint8ClampedArray(W * H * 4); this.blurred ??= new Uint8ClampedArray(W * H * 4); this.image ??= new ImageData(this.blurred, W, H);
      blurOpaqueRGB(this.ctx.getImageData(0, 0, W, H).data, W, H, this.scratch, this.blurred, blurRadius); this.ctx.putImageData(this.image, 0, 0);
    }
  }
  dispose() { this.scene.items = []; this.live.clear(); }
}
