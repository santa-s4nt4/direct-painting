import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionP5 } from '../src/p5-math.js';
import { P5_PRESETS, motionSamples, p5Clip, validateP5Source } from '../src/p5-motion.js';
import { DEFAULT_SETTINGS, normalizeProject, parseProject, serializeProject } from '../src/project.js';
import { CachedGesture, trimGesture, playbackLength } from '../src/loop.js';
import { editLayer, resolveLayer } from '../src/layers.js';
import { RGBAScene } from '../src/rgba.js';
const source = (code = P5_PRESETS.orbit) => ({ kind: 'p5', code, seed: 14, durationMs: 1000 });
const sample = value => motionSamples(new Function('p5', `${value.code};return motion;`)(MotionP5), new MotionP5(value.seed), value.durationMs);
const make = (value = source(), settings = DEFAULT_SETTINGS) => p5Clip(sample(value), { source: value, settings, id: 'script', targets: [0, 1], start: 200, mode: 'move' });
const pixel = (data, x, y) => [...data.slice((y * CANVAS_WIDTH + x) * 4, (y * CANVAS_WIDTH + x) * 4 + 4)];

test('official p5 math supports angles, seeded noise/random and vector motion without a DOM', () => {
  const p = new MotionP5(14); assert.equal(p.sin(p.HALF_PI), 1); assert.equal(p.createVector(3, 4).mag(), 5);
  p.angleMode(p.DEGREES); assert.equal(p.sin(90), 1); p.angleMode(p.RADIANS);
  const code = 'function motion(p,t) { return {x:p.random(320), y:p.noise(t*3)*320, pressure:p.map(p.sin(t*p.TWO_PI),-1,1,0,1)}; }';
  assert.deepEqual(sample(source(code)), sample(source(code)));
  for (const code of [P5_PRESETS.orbit, P5_PRESETS.figure8, P5_PRESETS.noise]) {
    const samples = sample(source(code)); assert.equal(samples.length, 61); assert.equal(samples[0].t, 0); assert.equal(samples.at(-1).t, 1000);
    assert.ok(Math.hypot(samples[0].x-samples.at(-1).x, samples[0].y-samples.at(-1).y) < 0.00001);
  }
});
test('motion output is bounded before rasterization and invalid frames fail without producing a clip', () => {
  const samples = motionSamples(() => ({x:1e9,y:-1e9,pressure:10,size:900,width:0,height:200}), new MotionP5(1), 100);
  assert.deepEqual(samples[0], {x:1920,y:0,pressure:1,size:320,width:1,height:200,t:0});
  for (const result of [null, {}, {x:Infinity,y:1}, {x:1,y:2,size:NaN}, {x:1,y:2,pressure:'1'}]) assert.throws(() => motionSamples(() => result, new MotionP5(1), 100));
  for (const patch of [{code:''},{code:'a'.repeat(32769)},{seed:-1},{durationMs:0},{kind:'other'}]) assert.throws(() => validateP5Source({...source(), ...patch}));
});
test('p5 motion preserves exact timing and pressure geometry across trim, RGBA, L/R and editable JSON', () => {
  const clip = make(); const position = new CachedGesture(clip).render(250);
  assert.ok(Math.abs(position.x-CANVAS_WIDTH/2)<0.00001); assert.ok(Math.abs(position.y-(CANVAS_HEIGHT/2 + CANVAS_HEIGHT*.32))<0.00001); assert.equal(position.size,58);
  const right = editLayer(clip, '1', item => ({...item,color:'#ff0000',edgeColor:'#0000ff'}));
  const project = normalizeProject({version:1,duration:2000,clips:[right],settings:{motionSource:'p5',p5Code:source().code,p5Seed:14,p5DurationMs:1000}});
  const file = serializeProject(project,{playing:false,phase:450}); const restored = parseProject(file).project;
  assert.deepEqual(restored,project); assert.equal(resolveLayer(restored.clips[0],1).procedural.code,source().code);
  const scene = new RGBAScene(restored);
  assert.deepEqual(pixel(scene.draw(0,450),CANVAS_WIDTH/2,Math.round(CANVAS_HEIGHT/2 + CANVAS_HEIGHT*.32)),[255,255,255,255]); assert.deepEqual(pixel(scene.draw(1,450),CANVAS_WIDTH/2,Math.round(CANVAS_HEIGHT/2 + CANVAS_HEIGHT*.32)),[255,0,0,255]);
  const trimmed = trimGesture(trimGesture(right,'in',200,2000),'out',800,2000);
  assert.equal(playbackLength(trimmed),600); assert.equal(trimmed.samples,right.samples);
  assert.throws(() => normalizeProject({...project,clips:[{...clip,procedural:{...source(),code:''}}]}));
});
test('rectangle motion samples map pressure and explicit dimensions to editable geometry', () => {
  const s=source('function motion(p,t){return {x:160,y:160,pressure:t,width:22};}');
  const clip=make(s,{...DEFAULT_SETTINGS,shape:'rect',angle:45,widthMin:20,widthMax:80,heightMin:10,heightMax:60});
  assert.equal(clip.samples[0].width,22); assert.equal(clip.samples[0].height,10); assert.equal(clip.samples.at(-1).height,60); assert.equal(clip.samples.at(-1).angle,45);
  assert.doesNotThrow(()=>normalizeProject({version:1,duration:2000,clips:[clip]}));
});
