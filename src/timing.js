// Input transport and motion-blur shutter keep their original 60Hz timebase.
export const FPS = 60;
export const FRAME_MS = 1000 / FPS;
export const frameNumber = milliseconds => Math.floor(milliseconds / FRAME_MS + 1e-7);
// Presentation has its own cap; changing it must not slow the 16s transport or
// lengthen the blur shutter. Bucket boundaries tolerate early RAF timestamps.
export const RENDER_FPS = 30;
export const RENDER_FRAME_MS = 1000 / RENDER_FPS;
export const renderFrameNumber = milliseconds => Math.floor(milliseconds / RENDER_FRAME_MS + 1e-7);

// Count delivered painting frames, not the requested 30Hz target. Forced draws
// in one display frame count once; CPU submission time is reported separately.
export class FrameRateMeter {
  constructor(now = 0, sampleMs = 500) { this.sampleMs = sampleMs; this.reset(now); }
  reset(now) { this.startedAt = now; this.frames = 0; this.lastFrame = null; this.draws = 0; this.drawMs = 0; }
  record(now, drawMs = 0) {
    if (now < this.startedAt) this.reset(now);
    const frame = renderFrameNumber(now);
    if (this.lastFrame === null) this.startedAt = now;
    else if (frame !== this.lastFrame) this.frames++;
    this.lastFrame = frame; this.draws++; this.drawMs += Math.max(0, drawMs);
  }
  sample(now) {
    const elapsed = now - this.startedAt;
    if (elapsed < this.sampleMs) return null;
    const sample = { fps: this.frames * 1000 / elapsed, drawMs: this.draws ? this.drawMs / this.draws : 0 };
    this.startedAt = now; this.frames = 0; this.draws = 0; this.drawMs = 0;
    return sample;
  }
}
