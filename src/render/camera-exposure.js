import { FRAME_MS } from '../timing.js';
import { layerEffects } from '../effects.js';
import { gestureOpacity } from '../loop.js';
import { planeHomography,pointInSpace,clipPolygonToBox,projectSpace } from '../space.js';
import { invertHomography } from '../view.js';
import { visualBounds } from './motion-blur.js';
export function cameraExposure(clip,time,visual,sample,views,{live=false}={}) {
 const fx=layerEffects(clip),moving=clip.mode==='move'&&fx.motionBlur;
 return views.map((view,i)=>{
  const offset=moving?FRAME_MS*fx.motionBlurAmount/100*(views.length-1-i)/(views.length-1):0,t=Math.max(clip.trimIn??0,time-offset);
  const v=moving&&sample?sample(t):visual;
  return {view,time:t,visual:v,opacity:v?.active===false?0:(live?1:gestureOpacity(clip,t))*(v?.opacity??1)};
 });
}
export function cameraProjection(clip,exposure,fallbackBounds) {
 const inverse=exposure.map(s=>{const m=invertHomography(planeHomography(clip.plane,clip.origin,s.view));return m.every(Number.isFinite)?m:Array(9).fill(0);});
 const points=[];
 for(const sample of exposure){
  const b=sample.visual?visualBounds(sample.visual):fallbackBounds;
  const polygon=clipPolygonToBox([[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]].map(([x,y])=>pointInSpace({x,y},clip.plane,clip.origin)));
  points.push(...polygon.map(p=>projectSpace(p,sample.view)).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
 }
 return {inverse,bounds:screenBounds(points)};
}
function screenBounds(points) {
 if(!points.length)return {x:0,y:0,width:0,height:0};
 const x=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x)))-2),y=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))-2),right=Math.min(1920,Math.ceil(Math.max(...points.map(p=>p.x)))+2),bottom=Math.min(1080,Math.ceil(Math.max(...points.map(p=>p.y)))+2);
 return {x,y,width:Math.max(0,right-x),height:Math.max(0,bottom-y)};
}
export function projectedBounds(clip,bounds,view) {
 const {x,y,width,height}=bounds;
 const polygon=clipPolygonToBox([[x,y],[x+width,y],[x+width,y+height],[x,y+height]].map(([x,y])=>pointInSpace({x,y},clip.plane,clip.origin)));
 return screenBounds(polygon.map(p=>projectSpace(p,view)).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
}

// A projected circle is a conic. Center screen coordinates before squaring to
// keep thin outlines accurate in float32. The packed matrix uses the existing
// cameraInverse uniform slot: q coefficients, projective denominator, origin.
export function cameraCircleConic(m,x,y) {
 const ax=m[0]-x*m[6],ay=m[1]-x*m[7],az=m[2]-x*m[8];
 const bx=m[3]-y*m[6],by=m[4]-y*m[7],bz=m[5]-y*m[8],det=ax*by-ay*bx;
 if(!Number.isFinite(det)||Math.abs(det)<1e-10)return null;
 const sx=(ay*bz-az*by)/det,sy=(az*bx-ax*bz)/det,z=m[6]*sx+m[7]*sy+m[8];
 const packed=[ax*ax+bx*bx,m[6],sx,2*(ax*ay+bx*by),m[7],sy,ay*ay+by*by,z,0];
 return packed.every(Number.isFinite)?packed:null;
}
