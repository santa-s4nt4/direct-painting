export const LED_SIZE = 32;
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
