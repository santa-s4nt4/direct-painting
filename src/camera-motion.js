import { canvasView, wrapAngle, CAMERA_DISTANCE } from './view.js';
import { FRAME_MS } from './timing.js';
export const CAMERA_MODES = ['normal','midi-auto'];
export const CAMERA_BLUR_SAMPLES = 16;
export const DEFAULT_CAMERA = Object.freeze({mode:'normal',note:24,attack:400,decay:300,sustain:.65,release:900,blur:true,blurAmount:100});
export const ease = t => {t=Math.max(0,Math.min(1,t));return t*t*t*(t*(t*6-15)+10);};
export function cameraConfig(value) {
 if(value!==undefined&&(!value||typeof value!=='object'||Array.isArray(value)))throw new Error('Invalid camera settings');
 const c={...DEFAULT_CAMERA,...value};
 // Retired recordings must never prevent an existing painting from loading.
 if(c.mode==='rec')c.mode='normal';
 if(!CAMERA_MODES.includes(c.mode)||!Number.isInteger(c.note)||c.note<0||c.note>127||typeof c.blur!=='boolean')throw new Error('Invalid camera settings');
 for(const key of ['attack','decay','release','blurAmount'])if(!Number.isInteger(c[key])||c[key]<0||c[key]>(key==='blurAmount'?200:16000))throw new Error(`Invalid camera ${key}`);
 if(!Number.isFinite(c.sustain)||c.sustain<0||c.sustain>1)throw new Error('Invalid camera sustain');
 return {mode:c.mode,note:c.note,attack:c.attack,decay:c.decay,sustain:c.sustain,release:c.release,blur:c.blur,blurAmount:c.blurAmount};
}
export function mixView(a,b,t) {
 if(t<=0)return canvasView(a);if(t>=1)return canvasView(b);
 const result={...a};
 for(const key of ['pitch','yaw','rotation'])result[key]=wrapAngle((a[key]??0)+wrapAngle((b[key]??0)-(a[key]??0))*t);
 for(const key of ['scale','x','y'])result[key]=a[key]+(b[key]-a[key])*t;
 if(a.distance!==undefined||b.distance!==undefined)result.distance=(a.distance??CAMERA_DISTANCE)+((b.distance??CAMERA_DISTANCE)-(a.distance??CAMERA_DISTANCE))*t;
 return canvasView(result);
}
export function centered(view) {return canvasView({...view,x:(1920-3840*view.scale)/2,y:(1080-2160*view.scale)/2});}
export function randomCamera(base,random=Math.random) {return centered({...base,yaw:random()*360-180,pitch:random()*110-55,rotation:0,distance:4500+random()*4000});}
export function newCameraEvent(from,rest,config,at,key,random=Math.random) {return {at,key,from:centered(from),rest:centered(rest),target:randomCamera(rest,random),attack:config.attack,decay:config.decay,sustain:config.sustain,release:config.release,releaseAt:null};}
export function autoPose(event,time) {
 if(!event)return null;
 if(event.releaseAt!==null&&time>=event.releaseAt)return mixView(event.releasePose,event.rest,event.release?ease((time-event.releaseAt)/event.release):1);
 const elapsed=Math.max(0,time-event.at);
 if(elapsed<event.attack)return mixView(event.from,event.target,ease(elapsed/event.attack));
 const sustained=mixView(event.rest,event.target,event.sustain);
 return event.decay?mixView(event.target,sustained,ease((elapsed-event.attack)/event.decay)):sustained;
}
export function releaseCameraEvent(event,time) {return !event||event.releaseAt!==null?event:{...event,releaseAt:time,releasePose:autoPose(event,time)};}
export function cameraPose(snapshot,base,phase,time) {
 const config=snapshot?.config??DEFAULT_CAMERA;
 if(config.mode==='midi-auto'){
  const pose=autoPose(snapshot?.event,time)??base;return centered({...pose,scale:base.scale});
 }
 return base;
}
export function mergeCamera(current,update) {
 if(!update?.config||current?.epoch===update.epoch&&current.revision>update.revision)return current;
 return {...update,config:cameraConfig(update.config)};
}
const viewDiff=(a,b)=>['scale','x','y','pitch','yaw','rotation','distance'].some(k=>Math.abs((a[k]??(k==='distance'?CAMERA_DISTANCE:0))-(b[k]??(k==='distance'?CAMERA_DISTANCE:0)))>1e-7);
export class CameraSampler {
 history=[];movingUntil=0;
 frame(snapshot,base,phase,time,now) {
  const config=snapshot?.config??DEFAULT_CAMERA,view=cameraPose(snapshot,base,phase,time);
  if(this.mode!==config.mode){this.history=[];this.mode=config.mode;}
  const previous=this.history.at(-1);if(previous&&viewDiff(previous.view,view))this.movingUntil=now+FRAME_MS*2+1;
  if(previous&&now<previous.t)this.history=[];
  if(this.history.at(-1)?.t===now)this.history[this.history.length-1]={t:now,view};else this.history.push({t:now,view});
  if(this.history.length>32)this.history.splice(0,this.history.length-32);
  while(this.history.length>2&&this.history[1].t<now-100)this.history.shift();
  const shutter=FRAME_MS*config.blurAmount/100;
  if(!config.blur||!shutter)return {view,cameraViews:null,cameraShutter:0};
  const manual=config.mode==='normal';
  const sampleAtOffset=offset=>{
   if(!manual)return cameraPose(snapshot,base,Math.max(0,phase-offset),time-offset);
   const t=now-offset,samples=this.history;let index=samples.length-1;while(index>0&&samples[index].t>t)index--;
   const a=samples[index],b=samples[index+1];return b&&b.t>a.t?mixView(a.view,b.view,Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t)))):a.view;
  };
  const old=sampleAtOffset(shutter),angle=Math.max(...['pitch','yaw','rotation'].map(k=>Math.abs(wrapAngle((view[k]??0)-(old[k]??0)))));
  const fast=angle>.75||Math.abs((view.distance??CAMERA_DISTANCE)-(old.distance??CAMERA_DISTANCE))>50||Math.abs(view.x-old.x)>12||Math.abs(view.y-old.y)>12||Math.abs(view.scale-old.scale)>.01;
  const count=fast?CAMERA_BLUR_SAMPLES:8;
  const cameraViews=Array.from({length:count},(_,i)=>sampleAtOffset(shutter*(count-1-i)/(count-1)));
  return {view,cameraViews:cameraViews.some(p=>viewDiff(p,view))?cameraViews:null,cameraShutter:shutter};
 }
 reset(){this.history=[];this.movingUntil=0;}
}
