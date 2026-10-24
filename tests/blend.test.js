import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PigmentMixer, compositePixel } from '../src/blend.js';
import { RGBAScene } from '../src/rgba.js';
import { editLayer, resolveLayer, moveLayer } from '../src/layers.js';
import { normalizeProject, parseProject, serializeProject } from '../src/project.js';
import { EditHistory } from '../src/history.js';
const clip = (id, color, extra = {}) => ({ id, color, mode:'return', enabled:true, targets:[0,1], start:0, duration:200, fadeMs:1000, samples:[{x:100,y:100,size:60,t:0},{x:100,y:100,size:60,t:200}], ...extra });
const project = clips => ({ version:1, duration:3000, clips });
const pixel = (data, x=100, y=100) => [...data.slice((y*CANVAS_WIDTH+x)*4,(y*CANVAS_WIDTH+x)*4+4)];
const blue = '#002185', yellow = '#fcd200', green = [61,147,62,255];

test('ANALOG mixes blue and yellow into pigment green while NORMAL paints the top color', () => {
 const below=clip('below',blue), above=clip('above',yellow);
 assert.deepEqual(pixel(new RGBAScene(project([below,above])).draw(0,100)),[252,210,0,255]);
 assert.deepEqual(pixel(new RGBAScene(project([below,{...above,blendMode:'analog'}])).draw(0,100)),green);
 const mixer=new PigmentMixer();assert.equal(mixer.mix(0x002185,0xfcd200,0),0x002185);assert.equal(mixer.mix(0x002185,0xfcd200,100),0xfcd200);assert.equal(mixer.mix(0xff0000,0xff0000,50),0xff0000);
});
test('mixing occurs only over real paint and preserves straight alpha during fading', () => {
 const top=clip('top',yellow,{blendMode:'analog'}), scene=new RGBAScene(project([top]));
 assert.deepEqual(pixel(scene.draw(0,100)),[252,210,0,255]);assert.deepEqual(pixel(scene.draw(0,700)),[252,210,0,64]);assert.deepEqual(pixel(scene.draw(0,700),0,0),[0,0,0,0]);
 const black=new RGBAScene(project([clip('black','#000000',{blendMode:'analog'})]));assert.deepEqual(pixel(black.draw(0,100)),[0,0,0,255]);
 const normal=new Uint8ClampedArray([0,33,133,128]), analog=normal.slice(), mixer=new PigmentMixer();
 compositePixel(normal,0,252,210,0,.25,{},mixer);compositePixel(analog,0,252,210,0,.25,{blendMode:'analog'},mixer);assert.equal(normal[3],analog[3]);assert.notDeepEqual([...normal.slice(0,3)],[...analog.slice(0,3)]);
 const base=clip('base',blue), allTop=clip('top',yellow,{blendMode:'analog',mixAmount:100});const a=new RGBAScene(project([base,allTop])).draw(0,700),b=new RGBAScene(project([base,{...allTop,blendMode:'normal'}])).draw(0,700);let differences=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])differences++;assert.equal(differences,0);
});
test('all drawing modes, shapes and their edges use the same pigment compositor', () => {
 for(const mode of ['trail','return','move','place']) for(const shape of ['circle','rect']) {
  const extra=mode==='place'?{duration:0,fadeInMs:0,holdMs:1000,fadeOutMs:100,samples:[{x:100,y:100,size:40,t:0}]}:{samples:[{x:100,y:100,size:40,t:0},{x:100,y:100,size:40,t:200}]};
  const above=clip('above',yellow,{...extra,mode,shape,edgeWidth:5,edgeColor:'#ff0000',blendMode:'analog'});
  const scene=new RGBAScene(project([clip('below',blue),above]));assert.deepEqual(pixel(scene.draw(0,100)),green,`${mode}/${shape}`);
  const edge=pixel(scene.draw(0,100),118,100),mixed=new PigmentMixer().mix(0x002185,0xff0000);assert.deepEqual(edge,[mixed>>16,(mixed>>8)&255,mixed&255,255]);
  assert.deepEqual(pixel(scene.draw(0,100),128,100),[0,33,133,255]);
 }
});
test('scoped blends, stack order, undo/redo and JSON round-trip preserve the mixed result', () => {
 const base=clip('base',blue), top=editLayer(clip('top',yellow),'1',item=>({...item,blendMode:'analog',mixAmount:50}));
 const p=normalizeProject(project([base,top])), scene=new RGBAScene(p);assert.deepEqual(pixel(scene.draw(0,100)),[252,210,0,255]);assert.deepEqual(pixel(scene.draw(1,100)),green);
 const restored=parseProject(serializeProject(p,{playing:false,phase:100})).project;assert.deepEqual(restored,p);assert.equal(resolveLayer(restored.clips[1],1).blendMode,'analog');assert.equal(resolveLayer(restored.clips[1],0).blendMode,undefined);
 const history=new EditHistory();history.reset(p);const reordered={...p,clips:moveLayer(p.clips,'top',-1)};history.record(reordered);assert.deepEqual(pixel(new RGBAScene(reordered).draw(1,100)),[0,33,133,255]);assert.deepEqual(pixel(new RGBAScene(history.undo()).draw(1,100)),green);assert.deepEqual(pixel(new RGBAScene(history.redo()).draw(1,100)),[0,33,133,255]);
 for(const patch of [{blendMode:'multiply'},{mixAmount:-1},{mixAmount:101},{mixAmount:NaN},{mixAmount:.5}])assert.throws(()=>normalizeProject(project([base,{...top,...patch}])));
 assert.throws(()=>normalizeProject(project([base,{...top,eyeOverrides:{1:{blendMode:'unknown'}}}])));
});
test('pigment color caches remain bounded without changing the result after eviction', () => {
 const mixer=new PigmentMixer({colorLimit:2,mixLimit:4}), expected=mixer.mix(0x002185,0xfcd200,50);
 for(let i=1;i<12;i++)mixer.mix(0x110000+i*100,0x00bb00+i*500,50);
 assert.ok(mixer.colors.size<=2);assert.ok(mixer.mixes.size<=4);assert.equal(mixer.mix(0x002185,0xfcd200,50),expected);
});
