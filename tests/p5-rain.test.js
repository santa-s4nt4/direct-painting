import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MotionP5 } from '../src/p5-math.js';
import { P5_PRESETS, sequenceTracks, p5Clips, motionSamples } from '../src/p5-motion.js';
import { sampleAt, resizeGesture } from '../src/loop.js';
import { DEFAULT_SETTINGS, MAX_PROJECT_BYTES, normalizeProject, serializeProject, parseProject } from '../src/project.js';
import { RGBAScene } from '../src/rgba.js';
import { resizeDimension } from '../src/geometry.js';
import { EditHistory } from '../src/history.js';
const sequence = new Function(`${P5_PRESETS.rain}; return sequence;`)();
const source = { kind:'p5',code:P5_PRESETS.rain,seed:7,durationMs:10000 };
const tracks = sequenceTracks(sequence,new MotionP5(7),source);
const clips = p5Clips({tracks},{source,settings:DEFAULT_SETTINGS,id:'rain',targets:[0,1],mode:'move',start:0});
const active = (side,time) => clips.filter(c=>c.targets.includes(side)).map(c=>sampleAt(c.samples,time)).filter(p=>p.active);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const lit = pixels => {let n=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])n++;return n};

test('rain starts one drop at a time on the left, then right, and finishes with a downpour in both eyes', () => {
 assert.equal(tracks.length,32);assert.equal(clips.filter(c=>c.targets[0]===0).length,16);assert.equal(clips.filter(c=>c.targets[0]===1).length,16);
 for(const time of[100,400,1100,1400,2100,2400]){assert.equal(active(0,time).length,1);assert.equal(active(1,time).length,0)}
 for(const time of[3100,3400,4100,4400,5100,5400]){assert.equal(active(1,time).length,1);assert.equal(active(0,time).length,0)}
 for(const time of[8500,9000,9700])for(const side of[0,1])assert.ok(active(side,time).length>=10,`${side}/${time}: ${active(side,time).length}`);
 for(const time of[850,950,1850,2950,5850,9950])for(const side of[0,1])assert.equal(active(side,time).length,0,`${side}/${time}`);
 const a=active(0,100)[0],b=active(0,400)[0];assert.equal(a.x,b.x);assert.ok(b.y>a.y);
 assert.ok(new Set([100,1100,2100,3100,4100,5100].map(time=>active(time<3000?0:1,time)[0].x)).size>2);
});

test('each rain grain fills exactly one LED cell and hidden gaps never paint or interpolate across cells', () => {
 const scene=new RGBAScene({duration:10000,clips});assert.equal(lit(scene.draw(0,400)),100);assert.equal(lit(scene.draw(1,400)),0);assert.equal(lit(scene.draw(0,950)),0);assert.equal(lit(scene.draw(0,9950)),0);
 for(const side of[0,1]){
  const pixels=scene.draw(side,8500);for(let y=0;y<32;y++)for(let x=0;x<32;x++){
   const alpha=pixels[((y*10)*CANVAS_WIDTH+x*10)*4+3];for(let dy=0;dy<10;dy++)for(let dx=0;dx<10;dx++)assert.equal(pixels[(((y*10+dy)*CANVAS_WIDTH+x*10+dx)*4)+3],alpha);
  }
 }
 const samples=[{x:5,y:5,size:10,t:0,step:true,active:true},{x:5,y:15,size:10,t:16.667,step:true,active:false}];
 assert.deepEqual(sampleAt(samples,8),{...samples[0],t:8});assert.equal(sampleAt(samples,17).active,false);
});

test('sequence regeneration is seeded and individual tracks reproduce the full sequence result', () => {
 assert.equal(hash(sequenceTracks(sequence,new MotionP5(7),source)),hash(tracks));
 assert.notEqual(hash(sequenceTracks(sequence,new MotionP5(8),{...source,seed:8})),hash(tracks));
 const selected=sequenceTracks(sequence,new MotionP5(7),{...source,trackIndex:17});assert.equal(selected.length,1);assert.equal(hash(selected[0]),hash(tracks[17]));
 const left=p5Clips({tracks},{source,settings:DEFAULT_SETTINGS,id:'left',targets:[0],mode:'move'});assert.equal(left.length,16);assert.ok(left.every(c=>c.targets.length===1&&c.targets[0]===0));
});

test('rain stays editable through JSON, diameter/dimension edits and silent loop boundaries', () => {
 const p=normalizeProject({version:1,duration:10000,clips,settings:{motionSource:'p5',p5Code:source.code}});
 const file=serializeProject(p,{playing:false,phase:8500});assert.ok(Buffer.byteLength(file)<MAX_PROJECT_BYTES);const restored=parseProject(file).project;
 assert.equal(hash(restored.clips),hash(clips));assert.equal(restored.clips[17].procedural.trackIndex,17);assert.equal(restored.clips[17].procedural.label,'RAIN R 02');
 const resized=resizeDimension(resizeGesture(clips[0],'max',12),'width','max',12);assert.equal(resized.samples[0].width,12);assert.equal(resized.samples[0].size,12);assert.equal(resized.samples[0].step,true);
 assert.throws(()=>normalizeProject({...p,clips:[{...clips[0],samples:clips[0].samples.map(s=>({...s,active:'yes'}))}]}));
 assert.throws(()=>sequenceTracks(sequence,new MotionP5(7),{...source,trackIndex:63}));
 const long=sequenceTracks(sequence,new MotionP5(7),{...source,durationMs:600000});assert.equal(long.length,tracks.length);assert.equal(long[0].samples.at(-1).t,600000);assert.equal(long.reduce((n,t)=>n+t.samples.length,0),tracks.reduce((n,t)=>n+t.samples.length,0));
 assert.throws(()=>p5Clips({tracks},{source,settings:DEFAULT_SETTINGS,id:'bad',targets:[0,1],mode:'trail'}),/MOVE/);
 assert.throws(()=>motionSamples(()=>({x:1,y:1,step:1}),new MotionP5(1),100));
});

test('history keeps rain visibility edits while ignoring the selected canvas', () => {
 const original={settings:{active:0},clips:[{...clips[0],samples:[clips[0].samples[0]]}]},history=new EditHistory();history.reset(original);
 assert.equal(history.record({...original,settings:{active:1}}),false);
 const changed={...original,clips:[{...original.clips[0],samples:[{...original.clips[0].samples[0],active:false}]}]};
 assert.equal(history.record(changed),true);assert.equal(history.undo().clips[0].samples[0].active,true);assert.equal(history.redo().clips[0].samples[0].active,false);
});
