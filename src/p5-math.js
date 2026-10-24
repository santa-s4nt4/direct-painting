import { CANVAS_WIDTH, CANVAS_HEIGHT } from './canvas.js';
import math from 'p5/math';

// Register p5's official math addons without starting its DOM/canvas lifecycle.
// This keeps snippet execution in a terminable worker, including on iPad.
export class MotionP5 {
  static registerAddon(addon) { addon(this, this.prototype, {}); }
  static registerDecorator(path, decorate) {
    const parts = path.split('.').slice(1), key = parts.pop();
    const target = parts.reduce((value, part) => value[part], this);
    target[key] = decorate(target[key]);
  }
  static _friendlyError(message) { throw new Error(message); }
  constructor(seed) {
    this._angleMode = this.RADIANS;
    this.width = CANVAS_WIDTH; this.height = CANVAS_HEIGHT;
    this.randomSeed(seed); this.noiseSeed(seed);
  }
}
math(MotionP5);
Object.assign(MotionP5.prototype, { PI: Math.PI, TWO_PI: 2 * Math.PI, TAU: 2 * Math.PI, HALF_PI: Math.PI / 2, QUARTER_PI: Math.PI / 4 });
