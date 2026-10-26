import { FRAME_MS } from '../timing.js';
import { layerEffects } from '../effects.js';
import { gestureOpacity } from '../loop.js';
export const MOTION_SAMPLES = 32;
const geometry = ['x','y','size','width','height','angle','shape'];

// Integrate a fixed shutter ending at source time. No framebuffer history:
// pause, reverse seek, loop boundaries and MIDI restarts cannot leave ghosts.
export function motionExposure(clip, time, current, sample, { live = false } = {}) {
  const fx = layerEffects(clip);
  if (!current || clip.mode !== 'move' || !fx.motionBlur || fx.motionBlurAmount === 0) return null;
  const shutter = FRAME_MS * fx.motionBlurAmount / 100, start = clip.trimIn ?? 0;
  const old = sample(Math.max(start,time-shutter)), middle = sample(Math.max(start,time-shutter/2));
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const radius = Math.hypot(current.width??current.size,current.height??current.size)/2;
  const angle = Math.abs(((current.angle??0)-(old.angle??0)+540)%360-180)*Math.PI/180;
  const change = distance(old,middle)+distance(middle,current)+Math.abs(current.size-old.size)+radius*angle;
  const count = Math.min(MOTION_SAMPLES,2**Math.ceil(Math.log2(Math.max(8,Math.ceil(change/2)+1))));
  const exposure = Array.from({ length: count }, (_, i) => {
    const t = Math.max(start, time - shutter * (count - 1 - i) / (count - 1));
    const visual = i === count - 1 ? current : sample(t);
    const opacity = visual?.active === false ? 0 : (live ? 1 : gestureOpacity(clip,t)) * (visual?.opacity ?? 1);
    return { time:t, visual, opacity };
  });
  // Stationary shapes stay exactly as sharp as the ordinary analytic path.
  return exposure.some(s=>s.opacity>0) && exposure.some(({visual}) => geometry.some(key => visual?.[key] !== current[key])) ? exposure : null;
}
export function visualBounds(visual) {
  const rect = ['rect','rect-ring','capsule'].includes(visual.shape);
  const width = visual.width ?? visual.size, height = visual.height ?? visual.size;
  const radius = (rect ? Math.hypot(width + (visual.shape === 'capsule' ? height : 0),height) : visual.size) / 2 + 3;
  return { x:Math.floor(visual.x-radius), y:Math.floor(visual.y-radius), width:Math.ceil(radius*2+2), height:Math.ceil(radius*2+2) };
}
export function exposureBounds(exposure) {
  const boxes=exposure.filter(s=>s.visual&&s.opacity>0).map(s=>visualBounds(s.visual));
  const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
  return {x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};
}
