import { CPULayerEffects } from './render/cpu-effects.js';
import { paintingStyle } from './effects.js';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './canvas.js';
import { visitPaint } from './drawing.js';
import { layerVariants } from './layers.js';
import { CachedGesture, gestureTime, gestureVisible, gestureOpacity } from './loop.js';
import { compositePixel, PigmentMixer } from './blend.js';
import { colorAtTime } from './color.js';

export class RGBAScene {
  constructor(project) {
    this.pixels = new Uint8ClampedArray(CANVAS_WIDTH * CANVAS_HEIGHT * 4);
    this.mixer = new PigmentMixer(); this.setProject(project);
  }
  setProject(project, items) {
    this.duration = project.duration;
    this.items = items ?? project.clips.flatMap(layerVariants).filter(clip => clip.enabled).map(clip => ({ clip, gesture: new CachedGesture(clip) }));
  }
  draw(side, phase, { placementPreview = false, effects = false } = {}) {
    const pixels = this.pixels; pixels.fill(0);
    for (const { clip: original, gesture } of this.items) {
      const clip = effects ? paintingStyle(original) : original;
      if (!clip.enabled || !clip.targets.includes(side) || !gestureVisible(clip, phase, this.duration)) { gesture.releaseRaster(); continue; }
      if (effects) gesture.clip = { ...clip, samples: gesture.clip.samples };
      const time = gestureTime(clip, phase, this.duration), visual = gesture.render(time);
      const opacity = (placementPreview && clip.mode === 'place' && time < 1 ? 1 : gestureOpacity(clip, time)) * (visual.opacity ?? 1) * (clip.opacity ?? 1);
      if (visual.active === false) continue;
      let layer = null;
      if (effects) { this.layer ??= new Uint8ClampedArray(pixels.length); this.layer.fill(0); layer = this.layer; }
      const destination = layer ?? pixels;
      if (clip.mode === 'move' || clip.mode === 'place') {
        visitPaint({ ...visual, x: Math.round(visual.x), y: Math.round(visual.y), size: Math.round(visual.size) }, colorAtTime(clip, time, visual), clip, (start, end, paint) => {
          const color = Number.parseInt(paint.slice(1), 16);
          for (let pixel = start; pixel < end; pixel++) compositePixel(destination, pixel * 4, color >> 16, (color >> 8) & 255, color & 255, layer ? 1 : opacity, clip, this.mixer);
        });
      } else {
        for (let offset = 0; offset < visual.length; offset += 4) {
          if (visual[offset + 3]) compositePixel(destination, offset, visual[offset], visual[offset + 1], visual[offset + 2], visual[offset + 3] / 255 * (layer ? 1 : opacity), clip, this.mixer);
        }
      }
      if (layer) this.compositeLayer(layer, clip, time, opacity);
    }
    return pixels;
  }
  compositeLayer(source, clip, time, opacity = clip.opacity ?? 1) {
    this.effects ??= new CPULayerEffects();
    const image = this.effects.apply(source, CANVAS_WIDTH, CANVAS_HEIGHT, clip, time);
    const style = { ...clip, blendMode: 'analog' };
    for (let p = 0; p < image.length; p += 4) if (image[p + 3]) compositePixel(this.pixels, p, image[p], image[p + 1], image[p + 2], image[p + 3] / 255 * opacity, style, this.mixer);
  }
}
