import { CANVAS_WIDTH, CANVAS_HEIGHT } from './canvas.js';
import { stamp } from './drawing.js';
import { CachedGesture, gestureTime, gestureVisible, gestureOpacity } from './loop.js';
import { layerVariants } from './layers.js';
import { renderSignature } from './geometry.js';
import { RGBAScene } from './rgba.js';
import { hasColorGradient, hasFireworkColor, hasSampleColor, colorAtTime } from './color.js';

export class LoopScene {
  items = [];
  duration = 10000;
  setProject(project) {
    this.duration = project.duration;
    const previous = new Map(this.items.map(item => [item.clip.id, item]));
    this.items = project.clips.flatMap(layerVariants).map(clip => {
      let item = previous.get(clip.id);
      const signature = renderSignature(clip);
      if (!item || item.signature !== signature) {
        item = { signature, gesture: new CachedGesture(clip), canvas: null, ctx: null, image: null, paintedTime: -1 };
      }
      item.clip = clip; item.gesture.clip = { ...clip, samples: item.gesture.clip.samples };
      return item;
    });
    if (this.items.some(({ clip }) => clip.enabled && (clip.blendMode === 'analog' || hasColorGradient(clip) || hasFireworkColor(clip) || hasSampleColor(clip) || clip.samples.some(sample => sample.opacity !== undefined)))) {
      this.composite ??= new RGBAScene({ clips: [], duration: this.duration });
      // Share the already-prepared gestures instead of duplicating trail fields.
      this.composite.setProject(project, this.items);
    } else this.composite = null;
  }
  draw(ctx, index, phase, { placementPreview = false } = {}) {
    ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    // UHD rasters are large. Keep only layers active at the current phase,
    // and rebuild from their source samples when seeking or looping back.
    for (const item of this.items) {
      if (!item.clip.enabled || !gestureVisible(item.clip, phase, this.duration)) {
        item.gesture.releaseRaster(); item.canvas = item.ctx = item.image = null; item.paintedTime = -1;
      }
    }
    if (this.composite) {
      const pixels = this.composite.draw(index, phase, { placementPreview });
      this.opaqueImage ??= new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
      const output = this.opaqueImage.data;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const alpha = pixels[offset + 3] / 255;
        output[offset] = pixels[offset] * alpha; output[offset + 1] = pixels[offset + 1] * alpha; output[offset + 2] = pixels[offset + 2] * alpha; output[offset + 3] = 255;
      }
      ctx.putImageData(this.opaqueImage, 0, 0); return;
    }
    for (const item of this.items) {
      const clip = item.clip;
      if (!clip.enabled || !clip.targets.includes(index) || !gestureVisible(clip, phase, this.duration)) continue;
      const time = gestureTime(clip, phase, this.duration);
      const visual = item.gesture.render(time);
      const opacity = (placementPreview && clip.mode === 'place' && time < 1 ? 1 : gestureOpacity(clip, time)) * (visual.opacity ?? 1);
      if (visual.active === false) continue;
      if (clip.mode === 'move' || clip.mode === 'place') stamp(ctx, { ...visual, x: Math.round(visual.x), y: Math.round(visual.y), size: Math.round(visual.size) }, colorAtTime(clip, time, visual), opacity, clip);
      else {
        if (!item.canvas) {
          item.canvas = document.createElement('canvas'); item.canvas.width = CANVAS_WIDTH; item.canvas.height = CANVAS_HEIGHT;
          item.ctx = item.canvas.getContext('2d'); item.image = new ImageData(item.gesture.field.data, CANVAS_WIDTH, CANVAS_HEIGHT);
        }
        if (item.paintedTime !== time) { item.ctx.putImageData(item.image, 0, 0); item.paintedTime = time; }
        ctx.globalAlpha = opacity; ctx.drawImage(item.canvas, 0, 0); ctx.globalAlpha = 1;
      }
    }
  }
}
