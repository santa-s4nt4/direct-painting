import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleLED } from '../src/visuals.js';

function image(width, height, color = [0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...color, 255], i);
  return data;
}

test('LED sampling averages cells of the unblurred image and preserves color', () => {
  const input = image(4, 4);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) input.set([100, 60, 20, 255], (y * 4 + x) * 4);
  input.set([200, 120, 40, 255], (3 * 4 + 3) * 4);
  const leds = sampleLED(input, 4, 4, 2);
  assert.deepEqual(Array.from(leds), [100, 60, 20, 255, 0, 0, 0, 255, 0, 0, 0, 255, 50, 30, 10, 255]);
  assert.throws(() => sampleLED(input, 4, 4, 3), RangeError);
});

test('320px artwork produces exactly 32 by 32 LED pixels with no blur halo', () => {
  const input = image(320, 320);
  for (let y = 100; y < 110; y++) for (let x = 100; x < 110; x++) input.set([255, 0, 0, 255], (y * 320 + x) * 4);
  const leds = sampleLED(input, 320, 320);
  assert.equal(leds.length, 32 * 32 * 4);
  assert.deepEqual(Array.from(leds.slice((10 * 32 + 10) * 4, (10 * 32 + 10) * 4 + 4)), [255, 0, 0, 255]);
  assert.equal(leds[(10 * 32 + 9) * 4], 0);
});
