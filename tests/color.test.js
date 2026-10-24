import test from 'node:test';
import assert from 'node:assert/strict';
import { colorHSL, colorAtLightness, editLayerLightness, pickLayerColor } from '../src/color.js';
import { serializeProject, parseProject } from '../src/project.js';

test('lightness preserves hue/saturation and can return from black or white', () => {
  const clip = { color: '#4080c0' }, base = colorHSL(clip.color);
  for (const value of [20, 80]) {
    const color = colorHSL(colorAtLightness(clip.color, value));
    assert.ok(Math.abs(color.hue - base.hue) < 1);
    assert.ok(Math.abs(color.saturation - base.saturation) < .02);
    assert.ok(Math.abs(color.lightness - value) < .3);
  }
  const black = editLayerLightness(clip, 0); assert.equal(black.color, '#000000');
  const white = editLayerLightness(black, 100); assert.equal(white.color, '#ffffff');
  assert.equal(editLayerLightness(white, base.lightness).color, clip.color);
  const changed = pickLayerColor(white, '#ff0000');
  assert.equal(editLayerLightness(changed, 25).color, '#800000');
});

test('lightness editing changes color without changing geometry or alpha and survives JSON', () => {
  const clip = { id: 'test', mode: 'return', enabled: true, targets: [0], duration: 100, fadeMs: 1000, color: '#ff0000', start: 0, samples: [{ x: 100, y: 100, size: 30, t: 0 }, { x: 100, y: 100, size: 30, t: 100 }] };
  const edited = { ...editLayerLightness(clip, 25), colorEditMode: 'lightness' };
  assert.equal(edited.color, '#800000'); assert.deepEqual(edited.samples, clip.samples); assert.equal(edited.fadeMs, clip.fadeMs);
  const saved = serializeProject({ version: 1, duration: 3000, clips: [edited] }, { playing: false, phase: 100 });
  assert.deepEqual(parseProject(saved).project.clips[0], edited);
  assert.throws(() => parseProject(saved.replace('"colorLightness": 25', '"colorLightness": 200')));
});
