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
  draw(side, phase, { placementPreview = false } = {}) {
    const pixels = this.pixels; pixels.fill(0);
    for (const { clip, gesture } of this.items) {
      if (!clip.enabled || !clip.targets.includes(side) || !gestureVisible(clip, phase, this.duration)) { gesture.releaseRaster(); continue; }
      const time = gestureTime(clip, phase, this.duration), visual = gesture.render(time);
      const opacity = (placementPreview && clip.mode === 'place' && time < 1 ? 1 : gestureOpacity(clip, time)) * (visual.opacity ?? 1);
      if (visual.active === false) continue;
      if (clip.mode === 'move' || clip.mode === 'place') {
        visitPaint({ ...visual, x: Math.round(visual.x), y: Math.round(visual.y), size: Math.round(visual.size) }, colorAtTime(clip, time, visual), clip, (start, end, paint) => {
          const color = Number.parseInt(paint.slice(1), 16);
          for (let pixel = start; pixel < end; pixel++) compositePixel(pixels, pixel * 4, color >> 16, (color >> 8) & 255, color & 255, opacity, clip, this.mixer);
        });
      } else {
        for (let offset = 0; offset < visual.length; offset += 4) {
          if (visual[offset + 3]) compositePixel(pixels, offset, visual[offset], visual[offset + 1], visual[offset + 2], visual[offset + 3] / 255 * opacity, clip, this.mixer);
        }
      }
    }
    return pixels;
  }
}
