import { FRAME_MS } from '../timing.js';
import { layerEffects } from '../effects.js';
import { gestureOpacity } from '../loop.js';
import { planeHomography,projectPlanePolygon } from '../space.js';
import { invertHomography, CAMERA_DISTANCE } from '../view.js';
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
 const inverse=[],points=[];let depthClipped=false;
 for(const sample of exposure){
  const b=sample.visual?visualBounds(sample.visual):fallbackBounds;
  const matrix=planeHomography(clip.plane,clip.origin,sample.view),m=invertHomography(matrix);
  inverse.push(m.every(Number.isFinite)?m:Array(9).fill(0));
  const projected=projectBounds(clip,b,sample.view,matrix);points.push(...projected.points);depthClipped||=projected.depthClipped;
 }
 // For the uncommon near/far crossing, homogeneous w becomes 1/cameraDepth.
 // This lets the shader reject hidden samples without another world transform.
 if(depthClipped)inverse.forEach((m,i)=>{const distance=exposure[i].view.distance??CAMERA_DISTANCE;for(let k=0;k<9;k++)m[k]/=distance;});
 return {inverse,bounds:screenBounds(points),depthClipped};
}
function screenBounds(points) {
 if(!points.length)return {x:0,y:0,width:0,height:0};
 const x=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x)))-2),y=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))-2),right=Math.min(1920,Math.ceil(Math.max(...points.map(p=>p.x)))+2),bottom=Math.min(1080,Math.ceil(Math.max(...points.map(p=>p.y)))+2);
 return {x,y,width:Math.max(0,right-x),height:Math.max(0,bottom-y)};
}
export function projectedBounds(clip,bounds,view) {
 return screenBounds(projectBounds(clip,bounds,view).points);
}
function projectBounds(clip,{x,y,width,height},view,matrix) {
 return projectPlanePolygon([{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}],clip.plane,clip.origin,view,matrix);
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
