import { canvasView, wrapAngle, CAMERA_DISTANCE, MIN_ZOOM, MAX_ZOOM } from './view.js';
import { FRAME_MS } from './timing.js';
export const CAMERA_MODES = ['normal','midi-auto'];
export const CAMERA_BLUR_SAMPLES = 16;
export const CAMERA_MOTIONS = ['position','zoom','both'];
export const CAMERA_EASINGS = ['smooth','ease-in-out','ease-out','linear'];
export const DEFAULT_CAMERA = Object.freeze({mode:'normal',note:24,motion:'both',duration:800,easing:'smooth',zoomMin:.5,zoomMax:2,blur:true,blurAmount:100});
export const ease = t => {t=Math.max(0,Math.min(1,t));return t*t*t*(t*(t*6-15)+10);};
export function cameraEase(t,kind='smooth') {
 t=Math.max(0,Math.min(1,t));
 if(kind==='linear')return t;
 if(kind==='ease-out')return 1-(1-t)**3;
 if(kind==='ease-in-out')return t<.5?4*t*t*t:1-(-2*t+2)**3/2;
 return ease(t);
}
export function cameraConfig(value) {
 if(value!==undefined&&(!value||typeof value!=='object'||Array.isArray(value)))throw new Error('Invalid camera settings');
 const c={...DEFAULT_CAMERA,...value};
 // Old ADSR projects retain their transition time, without retaining an envelope.
 for(const key of ['attack','decay','release'])if(value?.[key]!==undefined&&(!Number.isInteger(value[key])||value[key]<0||value[key]>16000))throw new Error(`Invalid camera ${key}`);
 if(value?.sustain!==undefined&&(!Number.isFinite(value.sustain)||value.sustain<0||value.sustain>1))throw new Error('Invalid camera sustain');
 if(value?.duration===undefined&&(value?.attack!==undefined||value?.decay!==undefined))c.duration=Math.max(50,Math.min(16000,(value.attack??0)+(value.decay??0)));
 if(c.mode==='rec')c.mode='normal';
 if(!CAMERA_MODES.includes(c.mode)||!CAMERA_MOTIONS.includes(c.motion)||!CAMERA_EASINGS.includes(c.easing)||!Number.isInteger(c.note)||c.note<0||c.note>127||typeof c.blur!=='boolean')throw new Error('Invalid camera settings');
 if(!Number.isInteger(c.duration)||c.duration<50||c.duration>16000)throw new Error('Invalid camera transition time');
 if(!Number.isInteger(c.blurAmount)||c.blurAmount<0||c.blurAmount>200)throw new Error('Invalid camera blurAmount');
 if(!Number.isFinite(c.zoomMin)||!Number.isFinite(c.zoomMax)||c.zoomMin<MIN_ZOOM||c.zoomMax>MAX_ZOOM||c.zoomMin>c.zoomMax)throw new Error('Invalid camera zoom range');
 return {mode:c.mode,note:c.note,motion:c.motion,duration:c.duration,easing:c.easing,zoomMin:c.zoomMin,zoomMax:c.zoomMax,blur:c.blur,blurAmount:c.blurAmount};
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
export function randomCamera(from,config=DEFAULT_CAMERA,random=Math.random) {
 const target={...from};
 // Camera position (orbit angles and radius) and view magnification are separate axes.
 if(config.motion!=='zoom'){target.yaw=random()*360-180;target.pitch=random()*110-55;target.distance=4500+random()*4000;}
 if(config.motion!=='position')target.scale=config.zoomMin*(config.zoomMax/config.zoomMin)**random();
 return centered(target);
}
export function newCameraEvent(from,base,config,at,key,random=Math.random) {
 return {at,key,from:centered(from),target:randomCamera(from,config,random),duration:config.duration,easing:config.easing,baseScale:base.scale};
}
export function autoPose(event,time) {
 if(!event)return null;
 const t=cameraEase((time-event.at)/event.duration,event.easing),pose=mixView(event.from,event.target,t);
 // Equal ratios of magnification take equal time, making large zooms feel even.
 return centered({...pose,scale:event.from.scale*(event.target.scale/event.from.scale)**t});
}
export function cameraPose(snapshot,base,phase,time) {
 const config=snapshot?.config??DEFAULT_CAMERA;
 if(config.mode==='midi-auto'){
  const pose=autoPose(snapshot?.event,time)??base;return centered({...pose,scale:pose.scale*(snapshot?.event?base.scale/snapshot.event.baseScale:1)});
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
