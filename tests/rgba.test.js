import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RGBAScene } from '../src/rgba.js';
const clip = (color, extra = {}) => ({ id: color, mode: 'return', color, enabled: true, targets: [0], start: 0, duration: 200, fadeMs: 1000, samples: [{ x: 100, y: 100, size: 40, t: 0 }, { x: 100, y: 100, size: 40, t: 200 }], ...extra });
const pixel = (data, x = 100, y = 100) => Array.from(data.slice((y * CANVAS_WIDTH + x) * 4, (y * CANVAS_WIDTH + x) * 4 + 4));
test('RGBA retains opaque black artwork and fades alpha rather than RGB brightness', () => {
  const black = new RGBAScene({ duration: 2000, clips: [clip('#000000')] });
  assert.deepEqual(pixel(black.draw(0, 0)), [0, 0, 0, 255]);
  assert.deepEqual(pixel(black.draw(0, 0), 0, 0), [0, 0, 0, 0]);
  const red = new RGBAScene({ duration: 2000, clips: [clip('#ff0000')] });
  assert.deepEqual(pixel(red.draw(0, 700)), [255, 0, 0, 64]);
  assert.deepEqual(pixel(red.draw(0, 1200)), [0, 0, 0, 0]);
});
test('RGBA composes selected layers with source-over, respects L/R and replays all modes', () => {
  for (const mode of ['return', 'trail', 'move']) {
    const scene = new RGBAScene({ duration: 3000, clips: [clip('#ff0000', { mode }), clip('#0000ff', { id: 'top', mode }), clip('#ffffff', { enabled: false })] });
    assert.deepEqual(pixel(scene.draw(0, 0)), [0, 0, 255, 255]);
    assert.deepEqual(pixel(scene.draw(1, 0)), [0, 0, 0, 0]);
    const fading = pixel(scene.draw(0, 700));
    assert.ok(fading[0] > 0 && fading[2] > 0 && fading[3] > 64 && fading[3] < 255);
    assert.deepEqual(pixel(scene.draw(0, 0)), [0, 0, 255, 255]);
  }
});
