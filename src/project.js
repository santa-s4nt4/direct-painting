import { LOOP_MS } from './transport.js';
import { BOX_SPEC } from './space.js';
import { DEFAULT_VIEW, importedView } from './view.js';
import { resolveLayer } from './layers.js';
import { CANVAS_SPEC, MAX_BRUSH_SIZE } from './canvas.js';
import { validateProject } from './loop.js';
import { DEFAULT_RING_WIDTH, MAX_RING_WIDTH, DEFAULT_EFFECTS, validateEffects, layerEffects, paintingStyle } from './effects.js';
import { DEFAULT_P5_CODE, MAX_SNIPPET_LENGTH, MAX_P5_DURATION_MS, P5_PRESETS, upgradeP5Code } from './p5-motion.js';
import { validateLEDOptions } from './p5-led.js';

export const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
export const DEFAULT_SETTINGS = Object.freeze({ mode: 'move', lineWidth: 5, shape: 'circle', color: '#ffffff', opacity: 1, colorPanelVisible: true, effects: DEFAULT_EFFECTS, view: DEFAULT_VIEW, viewVersion: 4, rectangleDefaultsVersion: 1, minSize: 15, maxSize: 100, widthMin: 20, widthMax: 1600, heightMin: 20, heightMax: 1600, angle: 0, followDirection: false, pressure: true, touch: false, sync: false, active: 0, ringWidth: DEFAULT_RING_WIDTH, fadeMs: 2000, fadeInMs: 300, holdMs: 1000, fadeOutMs: 1000, motionSource: 'pen', p5Code: DEFAULT_P5_CODE, p5Seed: 1, p5DurationMs: 10000, p5Mode: 'move', p5Target: 'left', p5Preset: 'orbit', p5SingleRatio: 3, p5ClimaxRatio: 2, p5Variation: 75, p5AutoSeed: true, p5RainColorHoldMs: 2000, p5FireworkColorA: null, p5FireworkColorB: null });

export function normalizeProject(value) {
  if (value?.duration !== undefined && (!Number.isFinite(value.duration) || value.duration <= 0)) throw new Error('Invalid loop length');
  const project = validateProject(value), supplied = project.settings ?? {};
  if (typeof supplied !== 'object' || Array.isArray(supplied)) throw new Error('Invalid drawing settings');
  const settings = { ...DEFAULT_SETTINGS };
  const choices = { mode: ['trail', 'return', 'move', 'place', 'line'], shape: ['circle', 'rect', 'ring', 'rect-ring'], active: [0, 1], motionSource: ['pen', 'p5'], p5Mode: ['move', 'trail', 'return'], p5Target: ['left', 'right', 'both'], p5Preset: ['custom', ...Object.keys(P5_PRESETS)] };
  for (const [key, allowed] of Object.entries(choices)) {
    if (supplied[key] !== undefined) { if (!allowed.includes(supplied[key])) throw new Error(`Invalid ${key}`); settings[key] = supplied[key]; }
  }
  for (const key of ['pressure', 'touch', 'sync', 'followDirection', 'p5AutoSeed', 'colorPanelVisible']) {
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
  for (const [key, min, max] of [['p5Seed', 0, 4294967295], ['p5DurationMs', 100, MAX_P5_DURATION_MS], ['p5SingleRatio', 0, 1000], ['p5ClimaxRatio', 0, 1000], ['p5Variation', 0, 100], ['p5RainColorHoldMs', 0, 600000], ['minSize', 1, MAX_BRUSH_SIZE], ['maxSize', 1, MAX_BRUSH_SIZE], ['widthMin', 1, MAX_BRUSH_SIZE], ['widthMax', 1, MAX_BRUSH_SIZE], ['heightMin', 1, MAX_BRUSH_SIZE], ['heightMax', 1, MAX_BRUSH_SIZE], ['angle', -180, 180], ['ringWidth', 1, MAX_RING_WIDTH], ['lineWidth', 1, MAX_RING_WIDTH], ['fadeMs', 100, 10000], ['fadeInMs', 0, 10000], ['holdMs', 100, 600000], ['fadeOutMs', 0, 10000]]) {
    if (supplied[key] !== undefined) { if (!Number.isInteger(supplied[key]) || supplied[key] < min || supplied[key] > max) throw new Error(`Invalid ${key}`); settings[key] = supplied[key]; }
  }
  if(supplied.rectangleDefaultsVersion!==undefined&&supplied.rectangleDefaultsVersion!==1)throw new Error('Invalid rectangle defaults version');
  if(supplied.rectangleDefaultsVersion===undefined&&supplied.widthMax===100&&supplied.heightMax===100&&supplied.widthMin===20&&supplied.heightMin===20){settings.widthMax=1600;settings.heightMax=1600;}
  validateEffects(supplied.effects); settings.effects = layerEffects({ effects: supplied.effects });
  if (supplied.viewVersion !== undefined && supplied.viewVersion !== 2 && supplied.viewVersion !== 3 && supplied.viewVersion !== 4) throw new Error('Invalid canvas view version');
  settings.view = importedView(supplied.view, project.canvas, supplied.viewVersion);
  settings.viewVersion = 4;
  if (supplied.opacity !== undefined) { if (!Number.isFinite(supplied.opacity) || supplied.opacity < 0 || supplied.opacity > 1) throw new Error('Invalid opacity'); settings.opacity = supplied.opacity; }
  validateLEDOptions({ single: settings.p5SingleRatio, climax: settings.p5ClimaxRatio, variation: settings.p5Variation });
  settings.followDirection = false; // Accept legacy JSON but always use the UI angle.
  if (settings.minSize > settings.maxSize) throw new Error('Minimum diameter exceeds maximum');
  if (settings.widthMin > settings.widthMax || settings.heightMin > settings.heightMax) throw new Error('Minimum rectangle dimension exceeds maximum');
  const clips = project.clips.map(clip => {
    const normalized = paintingStyle(clip);
    if (clip.eyeOverrides) normalized.eyeOverrides = Object.fromEntries(Object.entries(clip.eyeOverrides).map(([side, patch]) => {
      const { edgeColor, edgeWidth, ...fields } = patch;
      return [side, { ...fields, blendMode: 'analog', ...(patch.effects ? { effects: paintingStyle({ effects: { ...normalized.effects, ...patch.effects } }).effects } : {}) }];
    }));
    return normalized;
  });
  return { ...project, duration: LOOP_MS, clips, canvas: { ...CANVAS_SPEC }, space: { ...BOX_SPEC }, settings };
}

export function singleCanvasProject(value) {
  const project = normalizeProject(value), settings = project.settings;
  const clips = project.clips.flatMap(clip => {
    if (clip.eyeOverrides && Object.keys(clip.eyeOverrides).length) return clip.targets.map(side => ({ ...resolveLayer(clip, side), id: `${clip.id}-side-${side}`, targets: [0], editScope: 'all' }));
    const { eyeOverrides, ...single } = clip;
    return [{ ...single, targets: [0], editScope: 'all' }];
  });
  return { ...project, duration: LOOP_MS, clips, canvas: { ...CANVAS_SPEC }, space: { ...BOX_SPEC }, settings: { ...settings, active: 0, sync: false, p5Target: 'left', motionSource: 'pen', mode: ['move', 'line'].includes(settings.mode) ? settings.mode : 'move' } };
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
