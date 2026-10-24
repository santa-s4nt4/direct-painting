import test from 'node:test';
import assert from 'node:assert/strict';
import { blurOpaqueRGB, sampleLED } from '../src/visuals.js';

function image(width, height, color = [0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...color, 255], i);
  return data;
}

test('blur softens edges without mutating the original pixels used for LED sampling', () => {
  const input = image(15, 15);
  for (let y = 5; y < 10; y++) for (let x = 5; x < 10; x++) input.set([255, 255, 255, 255], (y * 15 + x) * 4);
  const original = input.slice();
  const result = blurOpaqueRGB(input, 15, 15, new Uint8ClampedArray(input.length), new Uint8ClampedArray(input.length), 1);
  const outside = result[(7 * 15 + 4) * 4];
  assert.ok(outside > 0 && outside < 255);
  assert.ok(result[(7 * 15 + 5) * 4] > outside);
  assert.deepEqual(input, original);
  assert.ok(Array.from(result).filter((_, i) => i % 4 === 3).every(alpha => alpha === 255));
});

test('blur preserves a uniform color including the image boundaries', () => {
  const input = image(9, 9, [115, 196, 186]);
  assert.deepEqual(blurOpaqueRGB(input, 9, 9, new Uint8ClampedArray(input.length), new Uint8ClampedArray(input.length)), input);
});

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

test('blur amount can be disabled or increased without affecting raw LED pixels', () => {
  const width = 32, height = 32, source = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < source.length; i += 4) source[i] = 255;
  const center = (16 * width + 16) * 4; source[center] = source[center + 1] = source[center + 2] = 255;
  const scratch = source.slice(), output = source.slice();
  blurOpaqueRGB(source, width, height, scratch, output, 0); assert.deepEqual(output, source);
  blurOpaqueRGB(source, width, height, scratch, output, 4);
  assert.ok(output[center] < 255); assert.ok(output[center + 4] > 0); assert.equal(source[center + 4], 0);
});
