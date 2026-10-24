import { resolveLayer } from './layers.js';
import { CANVAS_SPEC } from './canvas.js';
import { validateProject } from './loop.js';
import { BLUR_RADIUS, MAX_BLUR_RADIUS } from './visuals.js';
import { DEFAULT_P5_CODE, MAX_SNIPPET_LENGTH, MAX_P5_DURATION_MS, P5_PRESETS, upgradeP5Code } from './p5-motion.js';
import { validateLEDOptions } from './p5-led.js';

export const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
export const DEFAULT_SETTINGS = Object.freeze({ mode: 'trail', shape: 'circle', color: '#ffffff', minSize: 15, maxSize: 100, widthMin: 20, widthMax: 100, heightMin: 20, heightMax: 100, angle: 0, followDirection: false, pressure: true, touch: false, sync: false, active: 0, blurRadius: BLUR_RADIUS, showBlurPreview: false, fadeMs: 2000, fadeInMs: 300, holdMs: 1000, fadeOutMs: 1000, exportFormat: 'rgba', motionSource: 'pen', p5Code: DEFAULT_P5_CODE, p5Seed: 1, p5DurationMs: 10000, p5Mode: 'move', p5Target: 'left', p5Preset: 'orbit', p5SingleRatio: 3, p5ClimaxRatio: 2, p5Variation: 75, p5AutoSeed: true, p5RainColorHoldMs: 2000, p5FireworkColorA: null, p5FireworkColorB: null });

export function normalizeProject(value) {
  if (value?.duration !== undefined && (!Number.isFinite(value.duration) || value.duration <= 0)) throw new Error('Invalid loop length');
  const project = validateProject(value), supplied = project.settings ?? {};
  if (typeof supplied !== 'object' || Array.isArray(supplied)) throw new Error('Invalid drawing settings');
  const settings = { ...DEFAULT_SETTINGS };
  const choices = { mode: ['trail', 'return', 'move', 'place'], shape: ['circle', 'rect'], active: [0, 1], exportFormat: ['rgba', 'rgb'], motionSource: ['pen', 'p5'], p5Mode: ['move', 'trail', 'return'], p5Target: ['left', 'right', 'both'], p5Preset: ['custom', ...Object.keys(P5_PRESETS)] };
  for (const [key, allowed] of Object.entries(choices)) {
    if (supplied[key] !== undefined) { if (!allowed.includes(supplied[key])) throw new Error(`Invalid ${key}`); settings[key] = supplied[key]; }
  }
  for (const key of ['pressure', 'touch', 'sync', 'followDirection', 'showBlurPreview', 'p5AutoSeed']) {
    if (supplied[key] !== undefined) { if (typeof supplied[key] !== 'boolean') throw new Error(`Invalid ${key}`); settings[key] = supplied[key]; }
  }
  if (supplied.color !== undefined) { if (!/^#[0-9a-f]{6}$/i.test(supplied.color)) throw new Error('Invalid color'); settings.color = supplied.color; }
  for (const key of ['p5FireworkColorA', 'p5FireworkColorB']) if (supplied[key] !== undefined) {
    if (supplied[key] !== null && !/^#[0-9a-f]{6}$/i.test(supplied[key])) throw new Error('Invalid firework color');
    settings[key] = supplied[key];
  }
  if (supplied.p5Code !== undefined) {
    if (typeof supplied.p5Code !== 'string' || supplied.p5Code.length > MAX_SNIPPET_LENGTH) throw new Error('Invalid p5 snippet');
    settings.p5Code = upgradeP5Code(supplied.p5Code);
  }
  if (supplied.p5Preset === undefined) settings.p5Preset = Object.keys(P5_PRESETS).find(key => P5_PRESETS[key] === settings.p5Code) ?? 'custom';
  for (const [key, min, max] of [['p5Seed', 0, 4294967295], ['p5DurationMs', 100, MAX_P5_DURATION_MS], ['p5SingleRatio', 0, 1000], ['p5ClimaxRatio', 0, 1000], ['p5Variation', 0, 100], ['p5RainColorHoldMs', 0, 600000], ['minSize', 1, 320], ['maxSize', 1, 320], ['widthMin', 1, 320], ['widthMax', 1, 320], ['heightMin', 1, 320], ['heightMax', 1, 320], ['angle', -180, 180], ['blurRadius', 0, MAX_BLUR_RADIUS], ['fadeMs', 100, 10000], ['fadeInMs', 0, 10000], ['holdMs', 100, 600000], ['fadeOutMs', 0, 10000]]) {
    if (supplied[key] !== undefined) { if (!Number.isInteger(supplied[key]) || supplied[key] < min || supplied[key] > max) throw new Error(`Invalid ${key}`); settings[key] = supplied[key]; }
  }
  validateLEDOptions({ single: settings.p5SingleRatio, climax: settings.p5ClimaxRatio, variation: settings.p5Variation });
  settings.followDirection = false; // Accept legacy JSON but always use the UI angle.
  if (settings.minSize > settings.maxSize) throw new Error('Minimum diameter exceeds maximum');
  if (settings.widthMin > settings.widthMax || settings.heightMin > settings.heightMax) throw new Error('Minimum rectangle dimension exceeds maximum');
  return { ...project, canvas: { ...CANVAS_SPEC }, settings };
}

export function singleCanvasProject(value) {
  const project = normalizeProject(value), settings = project.settings;
  const clips = project.clips.flatMap(clip => {
    if (clip.eyeOverrides && Object.keys(clip.eyeOverrides).length) return clip.targets.map(side => ({ ...resolveLayer(clip, side), id: `${clip.id}-side-${side}`, targets: [0], editScope: 'all' }));
    const { eyeOverrides, ...single } = clip;
    return [{ ...single, targets: [0], editScope: 'all' }];
  });
  return { ...project, clips, canvas: { ...CANVAS_SPEC }, settings: { ...settings, active: 0, sync: false, p5Target: 'left', motionSource: 'pen', mode: ['trail', 'return', 'move'].includes(settings.mode) ? settings.mode : 'trail' } };
}

export function serializeProject(project, playback) {
  return JSON.stringify({ format: 'direct-painting-project', version: 1, savedAt: new Date().toISOString(), project: normalizeProject(project), playback }, null, 2);
}

export function parseProject(text) {
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES) throw new Error('Project exceeds 16MB');
  const file = JSON.parse(text);
  if (file?.format !== undefined && (!['direct-painting-project', 'imagraph-project'].includes(file.format) || file.version !== 1)) throw new Error('Unsupported project format');
  const project = normalizeProject(file?.project ?? file);
  const playback = file.playback ?? { playing: false, phase: 0 };
  if (typeof playback.playing !== 'boolean' || !Number.isFinite(playback.phase) || playback.phase < 0) throw new Error('Invalid playback position');
  return { project, playback: { playing: playback.playing, phase: playback.phase % project.duration } };
}
