import { CANVAS_WIDTH, CANVAS_HEIGHT } from './canvas.js';
import { stamp, strokePoints } from './drawing.js';
import { TrailField, PersistentField } from './motion.js';

// A live gesture is independent of loop phase: even a long first stroke is shown
// immediately, then replaced atomically by its committed cached layer.
export class LiveDrawing {
  clear() { this.id = null; this.field = null; this.surface = null; }
  update(frame, now) {
    if (!frame) { this.clear(); return; }
    if (frame.id !== this.id && frame.from !== 0) return;
    if (frame.id === this.id && frame.elapsed < this.elapsed) return;
    if (frame.id !== this.id || frame.from === 0) {
      this.clear(); this.id = frame.id; this.count = 0; this.previous = null;
      this.field = ['move', 'place'].includes(frame.mode) ? null : frame.mode === 'trail' ? new TrailField() : new PersistentField();
    }
    if (frame.from !== this.count) return;
    this.mode = frame.mode; this.color = frame.color; this.targets = frame.targets; this.style = frame;
    this.elapsed = frame.elapsed; this.received = now; this.head = frame.head; this.move = frame.move;
    for (const sample of frame.samples) {
      if (this.field) {
        if (!this.previous) this.field.add(sample, frame.color, sample.t, frame);
        else {
          const points = strokePoints(this.previous, sample);
          points.forEach((point, index) => this.field.add(point, frame.color, this.previous.t + (sample.t - this.previous.t) * (index + 1) / points.length, frame));
          if (!points.length) this.field.add(sample, frame.color, sample.t, frame);
        }
      }
      this.previous = sample; this.count++;
    }
  }
  draw(ctx, side, now) {
    if (!this.id || !this.targets?.includes(side)) return;
    if (this.mode === 'move' || this.mode === 'place') { stamp(ctx, this.mode === 'place' ? this.head : this.move ?? this.head, this.color, 1, this.style); return; }
    const elapsed = this.elapsed + Math.max(0, now - this.received);
    if (this.mode === 'trail') { this.field.add(this.head, this.color, elapsed, this.style); this.field.render(elapsed); }
    if (!this.surface) {
      const canvas = document.createElement('canvas'); canvas.width = CANVAS_WIDTH; canvas.height = CANVAS_HEIGHT;
      this.surface = { canvas, ctx: canvas.getContext('2d'), image: new ImageData(this.field.data, CANVAS_WIDTH, CANVAS_HEIGHT) };
    }
    this.surface.ctx.putImageData(this.surface.image, 0, 0); ctx.drawImage(this.surface.canvas, 0, 0);
    if (this.mode === 'trail') stamp(ctx, this.head, this.color, 1, this.style);
  }
}
