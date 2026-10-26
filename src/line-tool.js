export const FIXED_LINE_WIDTH = 20;

// The endpoint Ring gestures keep their own stroke; only the final line is fixed.
export function fixedLineStyle(clip) {
  if (clip.mode !== 'line') return clip;
  return { ...clip, ringWidth: FIXED_LINE_WIDTH, ...(clip.eyeOverrides ? { eyeOverrides: Object.fromEntries(Object.entries(clip.eyeOverrides).map(([side, patch]) => [side, { ...patch, ringWidth: FIXED_LINE_WIDTH }])) } : {}) };
}

const wrap = (value, duration) => ((value % duration) + duration) % duration;
// The first cycle shows endpoint rings. The editor and relay share this gate;
// the relay keeps output playback running when the iPad tab sleeps or closes.
export class LineSchedule {
  pending = new Map(); previous = null; duration = null;
  rebase(clips, phase, duration, now) {
    this.pending.clear(); this.previous = now; this.duration = duration;
    for (const clip of clips) if (clip.mode === 'line' && clip.linePending && !clip.lineIncomplete) this.pending.set(clip.id, { start: clip.start ?? 0, remaining: duration - wrap(phase - (clip.start ?? 0), duration) });
  }
  advance(clips, phase, duration, now, playing) {
    if (this.duration !== duration) this.rebase(clips, phase, duration, now);
    const elapsed = this.previous === null ? 0 : Math.max(0, now - this.previous); this.previous = now;
    const pendingClips = clips.filter(c => c.mode === 'line' && c.linePending && !c.lineIncomplete), ids = new Set(pendingClips.map(c => c.id));
    for (const id of this.pending.keys()) if (!ids.has(id)) this.pending.delete(id);
    const revealed = new Set();
    for (const clip of pendingClips) {
      const id = clip.id, entry = this.pending.get(id);
      if (!entry || entry.start !== (clip.start ?? 0)) { this.pending.set(id, { start: clip.start ?? 0, remaining: duration - wrap(phase - (clip.start ?? 0), duration) }); continue; }
      const remaining = entry.remaining - (playing ? elapsed : 0);
      if (remaining <= 0) { revealed.add(id); this.pending.delete(id); } else this.pending.set(id, { ...entry, remaining });
    }
    return revealed;
  }
}
