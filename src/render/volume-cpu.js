import { cameraExposure } from './camera-exposure.js';
import { motionExposure } from './motion-blur.js';
import { canvasView, invertHomography, viewRotation } from '../view.js';
import { VIEWPORT_WIDTH as VW, VIEWPORT_HEIGHT as VH, CANVAS_WIDTH as W, CANVAS_HEIGHT as H } from '../canvas.js';
import { pointInSpace, projectSpace, lineGeometry, multiply, clipPolygonToBox, planeHomography } from '../space.js';
import { CachedGesture, gestureVisible, gestureTime, gestureOpacity } from '../loop.js';
import { paintingStyle } from '../effects.js';
import { layerVariants } from '../layers.js';
import { colorAtTime } from '../color.js';
import { LiveStroke } from './stroke.js';
import { CPULayerEffects } from './cpu-effects.js';
import { compositePixel, PigmentMixer } from '../blend.js';
function polygons(p,style){
 const shape=p.shape,w=p.width??p.size,h=p.height??p.size,r=p.size/2,edge=style.ringWidth??5,angle=(p.angle??0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 const transform=points=>points.map(([x,y])=>({x:p.x+x*c-y*s,y:p.y+x*s+y*c}));
 const disk=radius=>Array.from({length:96},(_,i)=>[Math.cos(i*Math.PI/48)*radius,Math.sin(i*Math.PI/48)*radius]);
 const rect=(w,h)=>[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]];
 if(shape==='capsule'){
  const points=[];for(let i=0;i<=48;i++){const a=-Math.PI/2+i*Math.PI/48;points.push([w/2+Math.cos(a)*h/2,Math.sin(a)*h/2]);}for(let i=0;i<=48;i++){const a=Math.PI/2+i*Math.PI/48;points.push([-w/2+Math.cos(a)*h/2,Math.sin(a)*h/2]);}return[transform(points)];
 }
 const rectangular=['rect','rect-ring'].includes(shape),outer=rectangular?rect(w,h):disk(r),result=[transform(outer)];
 if(shape==='ring'&&r>edge)result.push(transform(disk(r-edge)));
 if(shape==='rect-ring'&&w>edge*2&&h>edge*2)result.push(transform(rect(w-edge*2,h-edge*2)));
 return result;
}
export class CPUVolumeRenderer {
 backend='cpu';view=canvasView();live=new LiveStroke();effects=new CPULayerEffects();mixer=new PigmentMixer();
 constructor(canvas,{onBackendChange=()=>{}}={}){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.layer=document.createElement('canvas');this.layer.width=VW;this.layer.height=VH;this.layerCtx=this.layer.getContext('2d',{willReadFrequently:true});this.pixels=new Uint8ClampedArray(VW*VH*4);this.image=new ImageData(VW,VH);canvas.dataset.renderer='cpu';onBackendChange('cpu');this.items=[];}
 setView(view){this.view=canvasView(view);}
 setProject(project){if(project.settings?.view)this.setView(project.settings.view);this.duration=project.duration;this.items=project.clips.flatMap(layerVariants).map(paintingStyle).map(clip=>({clip,gesture:new CachedGesture(clip),markers:(clip.linePending?clip.lineMarkers??[]:[]).map(m=>({clip:{...m,effects:clip.effects},gesture:new CachedGesture({...m,mode:'move',shape:'ring'})}))}));}
 setLiveStroke(stroke,now,move){this.live.setLocal(stroke,now,move);}
 receiveLive(packet,now){this.live.update(packet,now);}
 draw(side,phase,{now=performance.now(),cameraViews=null}={}){
  const jobs=[],add=(clip,time,opacity,visual,bitmap,sample,live=false)=>{ if(visual?.active!==false)jobs.push({clip,time,opacity,visual,bitmap,exposure:cameraViews&&visual?cameraExposure(clip,time,visual,sample,cameraViews,{live}):sample?motionExposure(clip,time,visual,sample,{live}):null}); };
  for(const item of this.items){const c=item.clip;if(!c.enabled||!c.targets.includes(side)||!gestureVisible(c,phase,this.duration))continue;
   if(c.mode==='line'&&c.linePending){if(item.markers.length){for(const m of item.markers)if(gestureVisible(m.clip,phase,this.duration)){const t=gestureTime(m.clip,phase,this.duration);add(m.clip,t,gestureOpacity(m.clip,t),m.gesture.render(t),null,s=>m.gesture.render(s));}}else for(const p of c.samples)add({...c,ringWidth:Math.min(c.ringWidth??5,12,Math.floor(p.size/4))},0,1,{...p,shape:'ring'});continue;}
   const t=gestureTime(c,phase,this.duration),opacity=gestureOpacity(c,t);
   if(c.mode==='line'&&c.points3D){const g=lineGeometry(c,this.view);add({...c,plane:g.plane,origin:g.origin},t,opacity,g.visual);}
   else{const visual=item.gesture.render(t);if(c.mode==='move'||c.mode==='place')add(c,t,opacity*(visual.opacity??1),visual,null,s=>item.gesture.render(s));else add(c,t,opacity,null,visual);}
  }
  const live=this.live;if(live.id&&live.targets.includes(side))add(live,live.elapsed,1,live.move??live.head,null,t=>live.motionAt(t),true);
  const r=viewRotation(this.view);for(const job of jobs)job.depth=multiply(r,pointInSpace(job.visual??{x:W/2,y:H/2},job.clip.plane,job.clip.origin))[2];jobs.sort((a,b)=>a.depth-b.depth);
  this.pixels.fill(0);
  for(const {clip,time,opacity,visual,bitmap,exposure} of jobs){
   this.layerCtx.clearRect(0,0,VW,VH);
   if(visual){
    const samples=exposure??[{visual,time,opacity:1}];this.layerCtx.globalCompositeOperation=exposure?'lighter':'source-over';
    for(const sample of samples){
     if(!sample.visual||sample.opacity<=0)continue;
     this.layerCtx.globalAlpha=sample.opacity/samples.length;this.layerCtx.fillStyle=colorAtTime(clip,sample.time,sample.visual);this.layerCtx.beginPath();
     for(const polygon of polygons(sample.visual,clip)){const points=clipPolygonToBox(polygon.map(p=>pointInSpace(p,clip.plane,clip.origin))).map(p=>projectSpace(p,sample.view??this.view));if(!points.length)continue;this.layerCtx.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))this.layerCtx.lineTo(p.x,p.y);this.layerCtx.closePath();}this.layerCtx.fill('evenodd');
    }
    this.layerCtx.globalAlpha=1;this.layerCtx.globalCompositeOperation='source-over';
   }
   else if(bitmap){const m=invertHomography(planeHomography(clip.plane,clip.origin,this.view)),img=new ImageData(VW,VH);if(m.every(Number.isFinite)){for(let y=0;y<VH;y++)for(let x=0;x<VW;x++){const w=m[6]*(x+.5)+m[7]*(y+.5)+m[8],px=Math.floor((m[0]*(x+.5)+m[1]*(y+.5)+m[2])/w),py=Math.floor((m[3]*(x+.5)+m[4]*(y+.5)+m[5])/w);if(px>=0&&py>=0&&px<W&&py<H){const a=(py*W+px)*4,b=(y*VW+x)*4;for(let k=0;k<4;k++)img.data[b+k]=bitmap[a+k];}}}this.layerCtx.putImageData(img,0,0);}
   const data=this.layerCtx.getImageData(0,0,VW,VH).data,effects={...clip.effects,blurRadius:Math.round((clip.effects?.blurRadius??16)*this.view.scale)},source=this.effects.apply(data,VW,VH,{...clip,effects},time);
   for(let p=0;p<source.length;p+=4)if(source[p+3])compositePixel(this.pixels,p,source[p],source[p+1],source[p+2],source[p+3]/255*(exposure?1:opacity)*(clip.opacity??1),clip,this.mixer);
  }
  for(let p=0;p<this.pixels.length;p+=4){const a=this.pixels[p+3]/255;this.image.data[p]=this.pixels[p]*a;this.image.data[p+1]=this.pixels[p+1]*a;this.image.data[p+2]=this.pixels[p+2]*a;this.image.data[p+3]=255;}this.ctx.putImageData(this.image,0,0);
 }
 dispose(){this.items=[];this.live.clear();}
}
