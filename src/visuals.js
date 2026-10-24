export const LED_SIZE = 32;
export const BLUR_RADIUS = 64;
export const MAX_BLUR_RADIUS = 160;

// A sliding-window blur avoids relying on CanvasRenderingContext2D.filter.
// Three box passes approximate a soft Gaussian edge at a fixed per-pixel cost.
function boxPass(input, output, width, height, radius, horizontal) {
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const step = horizontal ? 4 : width * 4;
  const kernel = radius * 2 + 1;
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * width * 4 : line * 4;
    let red = input[base] * (radius + 1);
    let green = input[base + 1] * (radius + 1);
    let blue = input[base + 2] * (radius + 1);
    for (let i = 1; i <= radius; i++) {
      const offset = base + Math.min(length - 1, i) * step;
      red += input[offset]; green += input[offset + 1]; blue += input[offset + 2];
    }
    for (let i = 0; i < length; i++) {
      const offset = base + i * step;
      output[offset] = red / kernel;
      output[offset + 1] = green / kernel;
      output[offset + 2] = blue / kernel;
      output[offset + 3] = 255;
      const leaving = base + Math.max(0, i - radius) * step;
      const entering = base + Math.min(length - 1, i + radius + 1) * step;
      red += input[entering] - input[leaving];
      green += input[entering + 1] - input[leaving + 1];
      blue += input[entering + 2] - input[leaving + 2];
    }
  }
}

export function blurOpaqueRGB(input, width, height, scratch, output, radius = BLUR_RADIUS) {
  let source = input;
  for (let pass = 0; pass < 3; pass++) {
    boxPass(source, scratch, width, height, radius, true);
    boxPass(scratch, output, width, height, radius, false);
    source = output;
  }
  return output;
}

// Average the original pixels in each LED cell, before any blur is applied.
// Area averaging preserves the contribution of marks smaller than one cell.
export function sampleLED(input, width, height, grid = LED_SIZE, output = new Uint8ClampedArray(grid * grid * 4)) {
  if (width % grid || height % grid) throw new RangeError('LED cells must divide the source dimensions.');
  const cellWidth = width / grid, cellHeight = height / grid;
  const area = cellWidth * cellHeight;
  for (let row = 0; row < grid; row++) {
    for (let column = 0; column < grid; column++) {
      let red = 0, green = 0, blue = 0;
      for (let y = row * cellHeight; y < (row + 1) * cellHeight; y++) {
        for (let x = column * cellWidth; x < (column + 1) * cellWidth; x++) {
          const offset = (y * width + x) * 4;
          red += input[offset]; green += input[offset + 1]; blue += input[offset + 2];
        }
      }
      const offset = (row * grid + column) * 4;
      output[offset] = red / area;
      output[offset + 1] = green / area;
      output[offset + 2] = blue / area;
      output[offset + 3] = 255;
    }
  }
  return output;
}
