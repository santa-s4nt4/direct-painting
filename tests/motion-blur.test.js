import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EFFECTS, validateEffects, paintingStyle } from '../src/effects.js';
import { normalizeProject, serializeProject, parseProject } from '../src/project.js';
import { validateLive } from '../server/loop-relay.js';
import { FRAME_MS } from '../src/timing.js';
import { motionExposure, exposureBounds } from '../src/render/motion-blur.js';
import { LiveStroke } from '../src/render/stroke.js';
const sample=t=>({x:t*10,y:100,size:20,t});
const clip={id:'motion',mode:'move',color:'#ffffff',enabled:true,targets:[0],start:0,duration:100,fadeMs:1000,effects:{...DEFAULT_EFFECTS},samples:[sample(0),sample(100)]};

test('new and legacy projects use Blur OFF / Motion blur ON; subsequent explicit choices survive JSON',()=>{
 assert.deepEqual(DEFAULT_EFFECTS,{blur:false,blurRadius:16,motionBlur:true,motionBlurAmount:100});
 const project=normalizeProject({version:1,clips:[{...clip,effects:{blur:true,blurRadius:64},lineMarkers:undefined}],settings:{effects:{blur:true,blurRadius:16}}});
 assert.deepEqual(project.settings.effects,DEFAULT_EFFECTS);assert.deepEqual(project.clips[0].effects,{...DEFAULT_EFFECTS,blurRadius:64});
 const explicit={...DEFAULT_EFFECTS,blur:true,motionBlur:false,motionBlurAmount:175};
 const edited=normalizeProject({...project,settings:{...project.settings,effects:explicit},clips:[{...clip,effects:explicit}]});
 assert.deepEqual(parseProject(serializeProject(edited,{playing:false,phase:100})).project,edited);
 assert.deepEqual(paintingStyle({...clip,effects:explicit}).effects,explicit);
});
test('motion shutter is source-time based, bounded to the visible trim, reversible and disabled for stationary/static tools',()=>{
 const exposure=motionExposure(clip,80,sample(80),sample);
 assert.equal(exposure.length,32);assert.ok(Math.abs(exposure[0].time-(80-FRAME_MS))<1e-8);assert.equal(exposure.at(-1).time,80);
 assert.equal(motionExposure(clip,80,sample(80),t=>({...sample(80),x:sample(80).x+(t-80)*.01})).length,8);
 assert.deepEqual(motionExposure(clip,80,sample(80),sample),exposure);
 assert.ok(exposureBounds(exposure).x<sample(80).x-20);
 const trimmed=motionExposure({...clip,trimIn:75},80,sample(80),sample);assert.equal(trimmed[0].time,75);
 assert.equal(motionExposure(clip,0,sample(0),sample),null);
 assert.equal(motionExposure(clip,80,sample(80),()=>sample(80)),null);
 for(const mode of ['line','place','trail'])assert.equal(motionExposure({...clip,mode},80,sample(80),sample),null);
 for(const effects of [{...DEFAULT_EFFECTS,motionBlur:false},{...DEFAULT_EFFECTS,motionBlurAmount:0}])assert.equal(motionExposure({...clip,effects},80,sample(80),sample),null);
 const longer=motionExposure({...clip,effects:{...DEFAULT_EFFECTS,motionBlurAmount:200}},80,sample(80),sample);assert.ok(longer[0].time<exposure[0].time);
});
test('motion integrates pressure and rotation while transparent/inactive source frames do not contribute',()=>{
 const pressure=t=>({...sample(80),size:20+t,angle:t,t});
 assert.ok(motionExposure(clip,80,pressure(80),pressure));
 const hidden=motionExposure(clip,80,{...sample(80),opacity:0},t=>({...sample(t),opacity:0}));assert.equal(hidden,null);
 const gap=motionExposure(clip,80,sample(80),t=>({...sample(t),active:false}));assert.equal(gap[0].opacity,0);assert.equal(gap.at(-1).opacity,1);
});
test('live motion history is bounded, matches network input and resets on the next stroke',()=>{
 const local=new LiveStroke(),remote=new LiveStroke();
 for(let t=0;t<=1000;t+=10){
  const point=sample(t),samples=[point],stroke={...clip,id:'live',started:0,samples,last:point};local.setLocal(stroke,t,point);
  remote.update({id:'live',from:t/10,mode:'move',color:'#ffffff',targets:[0],samples,head:point,move:point,elapsed:t,effects:DEFAULT_EFFECTS},t);
 }
 assert.ok(local.motionPositions.length<=12);assert.deepEqual(local.motionAt(995),remote.motionAt(995));
 const point=sample(0);local.setLocal({...clip,id:'next',started:2000,samples:[point],last:point},2000,point);assert.equal(local.motionPositions.length,1);assert.equal(local.motionAt(995).x,0);
 local.clear();assert.equal(local.motionPositions.length,0);
});
test('invalid motion parameters fail JSON and live validation before renderer updates',()=>{
 for(const effects of [{motionBlur:1},{motionBlurAmount:-1},{motionBlurAmount:201},{motionBlurAmount:1.5}]){
  assert.throws(()=>validateEffects(effects));assert.throws(()=>normalizeProject({version:1,clips:[{...clip,effects}]}));
  assert.throws(()=>validateLive({session:'test',revision:0,id:'live',mode:'move',color:'#ffffff',targets:[0],from:0,samples:[sample(0)],head:sample(0),elapsed:0,effects}));
 }
});
