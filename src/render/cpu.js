import { canvasView } from '../view.js';
import { CANVAS_WIDTH as W, CANVAS_HEIGHT as H } from '../canvas.js';
import { RGBAScene } from '../rgba.js';
import { LiveDrawing } from '../live.js';
import { paintingStyle } from '../effects.js';

// Compatibility backend. Effects use premultiplied RGBA without requiring
// Canvas2D.filter, and pigment mixing matches the GPU's Spectral compositor.
export class CPUPaintingRenderer {
  backend = 'cpu'; view = canvasView(); scene = new RGBAScene({ clips: [], duration: 10000 }); live = new LiveDrawing();
  constructor(canvas, { onBackendChange = () => {} } = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.opaque = new Uint8ClampedArray(W * H * 4); this.image = new ImageData(this.opaque, W, H);
    canvas.dataset.renderer = 'cpu'; onBackendChange('cpu');
  }
  get items() { return this.scene.items; }
  setView(view) { this.view = canvasView(view); }
  setProject(project) { if (project.settings?.view) this.setView(project.settings.view); this.scene.setProject({ ...project, clips: project.clips.map(paintingStyle) }); }
  setLiveStroke(stroke, now, move) {
    if (!stroke) { this.live.update(null, now); return; }
    const from = this.live.id === stroke.id ? this.live.count : 0;
    this.live.update({ id: stroke.id, mode: stroke.mode, color: stroke.color, opacity: stroke.opacity, effects: stroke.effects, ringWidth: stroke.ringWidth, targets: stroke.targets, samples: stroke.samples.slice(from), from, elapsed: Math.max(now - stroke.started, stroke.samples.at(-1).t), head: stroke.last, move }, now);
  }
  receiveLive(packet, now) { this.live.update(packet, now); }
  draw(side, phase, { now = performance.now(), placementPreview = false } = {}) {
    const pixels = this.scene.draw(side, phase, { placementPreview, effects: true });
    if (this.live.id && this.live.targets.includes(side)) {
      if (!this.liveCanvas) { this.liveCanvas = document.createElement('canvas'); this.liveCanvas.width = W; this.liveCanvas.height = H; this.liveContext = this.liveCanvas.getContext('2d', { willReadFrequently: true }); }
      this.liveContext.clearRect(0, 0, W, H); this.live.draw(this.liveContext, side, now);
      this.scene.compositeLayer(this.liveContext.getImageData(0, 0, W, H).data, paintingStyle(this.live.style), this.live.elapsed + Math.max(0, now - this.live.received));
    }
    for (let p = 0; p < pixels.length; p += 4) { const a = pixels[p + 3] / 255; this.opaque[p] = pixels[p] * a; this.opaque[p + 1] = pixels[p + 1] * a; this.opaque[p + 2] = pixels[p + 2] * a; this.opaque[p + 3] = 255; }
    const { scale, x, y } = this.view;
    if (scale === 1 && x === 0 && y === 0) this.ctx.putImageData(this.image, 0, 0);
    else {
      if (!this.viewCanvas) { this.viewCanvas = document.createElement('canvas'); this.viewCanvas.width = W; this.viewCanvas.height = H; this.viewContext = this.viewCanvas.getContext('2d'); }
      this.viewContext.putImageData(this.image, 0, 0);
      this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, W, H); this.ctx.save(); this.ctx.setTransform(scale, 0, 0, scale, x, y); this.ctx.drawImage(this.viewCanvas, 0, 0); this.ctx.restore();
    }
  }
  dispose() { this.scene.items = []; this.live.clear(); }
}
