import { cameraExposure } from './camera-exposure.js';
import { motionExposure } from './motion-blur.js';
import { canvasView, invertHomography, viewRotation } from '../view.js';
import { VIEWPORT_WIDTH as VW, VIEWPORT_HEIGHT as VH, CANVAS_WIDTH as W, CANVAS_HEIGHT as H, MARKER_DIAMETER } from '../canvas.js';
import { pointInSpace, projectPlanePolygon, lineGeometry, multiply, planeHomography } from '../space.js';
import { CachedGesture, gestureVisible, gestureTime, gestureOpacity } from '../loop.js';
import { paintingStyle, DEFAULT_RING_WIDTH } from '../effects.js';
import { layerVariants } from '../layers.js';
import { colorAtTime } from '../color.js';
import { LiveStroke } from './stroke.js';
import { CPULayerEffects } from './cpu-effects.js';
import { compositePixel, PigmentMixer } from '../blend.js';
import { tracePlaybackClip, traceHeadMarkers, traceHeadFrameWindow, traceVisual, traceSamplesAt, traceFillPolygons } from '../trace-motion.js';
import { IntersectionDetector, IntersectionPulseTracker } from '../intersections.js';
function polygons(p,style){
 const shape=p.shape,w=p.width??p.size,h=p.height??p.size,r=p.size/2,edge=style.ringWidth??DEFAULT_RING_WIDTH,angle=(p.angle??0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
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
function traceOutlineFaces(clip,time){
 const points=[];
 for(const p of traceSamplesAt(clip,time)){
  while(points.length>1){const a=points.at(-2),b=points.at(-1),ax=b.x-a.x,ay=b.y-a.y,bx=p.x-b.x,by=p.y-b.y;if(Math.abs(ax*by-ay*bx)>1e-5||ax*bx+ay*by<0)break;points.pop();}
  points.push(p);
 }
 const stroke=clip.trace.strokeWidth??20;
 if(points.length===1)return polygons({...points[0],size:stroke,shape:'circle'},clip);
 return points.slice(1).flatMap((b,i)=>{const a=points[i];return polygons({x:(a.x+b.x)/2,y:(a.y+b.y)/2,width:Math.hypot(b.x-a.x,b.y-a.y),height:stroke,size:stroke,shape:'capsule',angle:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI},clip);});
}
export class CPUVolumeRenderer {
 backend='cpu';view=canvasView();live=new LiveStroke();effects=new CPULayerEffects();mixer=new PigmentMixer();intersectionDetector=new IntersectionDetector();
 constructor(canvas,{onBackendChange=()=>{},width=VW,height=VH}={}){this.canvas=canvas;this.outputWidth=width;this.outputHeight=height;canvas.width=width;canvas.height=height;this.outputCtx=canvas.getContext('2d');this.surface=document.createElement('canvas');this.surface.width=VW;this.surface.height=VH;this.ctx=this.surface.getContext('2d');this.layer=document.createElement('canvas');this.layer.width=VW;this.layer.height=VH;this.layerCtx=this.layer.getContext('2d',{willReadFrequently:true});this.pixels=new Uint8ClampedArray(VW*VH*4);this.image=new ImageData(VW,VH);canvas.dataset.renderer='cpu';canvas.dataset.resolution=`${width}x${height}`;onBackendChange('cpu');this.items=[];this.intersectionPulses=new IntersectionPulseTracker();this.setIntersectionTiming({});}
 setOutputSize(width,height){this.outputWidth=width;this.outputHeight=height;this.canvas.width=width;this.canvas.height=height;this.canvas.dataset.resolution=`${width}x${height}`;}
 setView(view){this.view=canvasView(view);}
 setProject(project){if(project.settings?.view)this.setView(project.settings.view);this.intersections=project.settings?.intersections===true;this.setIntersectionTiming(project.settings??{});this.intersectionPulses.reset();this.duration=project.duration;this.items=project.clips.flatMap(layerVariants).map(paintingStyle).map(tracePlaybackClip).map(clip=>({clip,gesture:new CachedGesture(clip),markers:(clip.linePending?clip.lineMarkers??[]:[]).map(m=>({clip:{...m,effects:clip.effects},gesture:new CachedGesture({...m,mode:'move',shape:'ring'})}))}));}
 setIntersectionTiming(settings){this.intersectionTiming={fadeInMs:settings.intersectionFadeInMs??0,holdMs:settings.intersectionHoldMs??200,fadeOutMs:settings.intersectionFadeOutMs??0};}
 setLiveStroke(stroke,now,move){this.live.setLocal(stroke,now,move);}
 receiveLive(packet,now){this.live.update(packet,now);}
 draw(side,phase,{now=performance.now(),cameraViews=null}={}){
  const headWindow=traceHeadFrameWindow(this.headFrame,phase,now);this.headFrame={phase,now};
  const jobs=[],intersectionEntries=[],markers=[],add=(clip,time,opacity,visual,bitmap,sample,live=false)=>{ if(visual?.active!==false)jobs.push({clip,time,opacity,visual,bitmap,exposure:cameraViews&&visual?cameraExposure(clip,time,visual,sample,cameraViews,{live}):sample?motionExposure(clip,time,visual,sample,{live}):null}); };
  for(const item of this.items){const c=item.clip;if(!c.enabled||!c.targets.includes(side)||!gestureVisible(c,phase,this.duration))continue;
   if(c.mode==='line'&&c.linePending){if(item.markers.length){for(const m of item.markers)if(gestureVisible(m.clip,phase,this.duration)){const t=gestureTime(m.clip,phase,this.duration),visual=m.gesture.render(t),alpha=gestureOpacity(m.clip,t)*(m.clip.opacity??1);add(m.clip,t,gestureOpacity(m.clip,t),visual,null,s=>m.gesture.render(s));intersectionEntries.push({clip:m.clip,owner:c.id,visual,time:t,alpha});}}else for(const p of c.samples){const preview={...c,ringWidth:Math.min(c.ringWidth??DEFAULT_RING_WIDTH,12,Math.floor(p.size/4))},visual={...p,shape:'ring'};add(preview,0,1,visual);intersectionEntries.push({clip:preview,visual,time:0,alpha:1});}continue;}
   const t=gestureTime(c,phase,this.duration),opacity=gestureOpacity(c,t);
   if(c.mode==='line'&&c.points3D){const g=lineGeometry(c,this.view),lineClip={...c,plane:g.plane,origin:g.origin};add(lineClip,t,opacity,g.visual);intersectionEntries.push({clip:lineClip,visual:g.visual,time:t,alpha:opacity*(c.opacity??1)});}
   else if(c.trace&&!c.trace.pending){add(c,t,opacity,traceVisual(c,t));}
   else{const visual=item.gesture.render(t);if(c.mode==='move'||c.mode==='place'){add(c,t,opacity*(visual.opacity??1),visual,null,s=>item.gesture.render(s));intersectionEntries.push({clip:c,visual,time:t,alpha:opacity*(visual.opacity??1)*(c.opacity??1)});}else add(c,t,opacity,null,visual);}
   if(c.trace&&!c.trace.pending){const alpha=opacity*(c.opacity??1);for(const marker of traceHeadMarkers(c,t,this.view,headWindow)){marker.alpha*=alpha;markers.push(marker);}intersectionEntries.push({clip:c,visual:null,time:t,alpha});}
  }
  const live=this.live;if(live.id&&live.targets.includes(side)){const visual=live.move??live.head;add(live,live.elapsed,1,visual,null,t=>live.motionAt(t),true);intersectionEntries.push({clip:live,visual,time:live.elapsed,alpha:live.opacity??1});}
  const r=viewRotation(this.view);for(const job of jobs)job.depth=multiply(r,pointInSpace(job.visual??{x:W/2,y:H/2},job.clip.plane,job.clip.origin))[2];jobs.sort((a,b)=>a.depth-b.depth);
  this.pixels.fill(0);
  for(const {clip,time,opacity,visual,bitmap,exposure} of jobs){
   this.layerCtx.clearRect(0,0,VW,VH);
   if(visual){
    const samples=exposure??[{visual,time,opacity:1}];this.layerCtx.globalCompositeOperation=exposure?'lighter':'source-over';
    for(const sample of samples){
     if(!sample.visual||sample.opacity<=0)continue;
     this.layerCtx.globalAlpha=sample.opacity/samples.length;this.layerCtx.fillStyle=colorAtTime(clip,sample.time,sample.visual);this.layerCtx.beginPath();
     const tracing=sample.visual.shape?.startsWith('trace-'),faces=tracing?(sample.visual.traceFill?traceFillPolygons(clip,sample.time):traceOutlineFaces(clip,sample.time)):polygons(sample.visual,clip),view=sample.view??this.view,matrix=planeHomography(clip.plane,clip.origin,view);
     for(const polygon of faces){const {points}=projectPlanePolygon(polygon,clip.plane,clip.origin,view,matrix);if(!points.length)continue;this.layerCtx.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))this.layerCtx.lineTo(p.x,p.y);this.layerCtx.closePath();}this.layerCtx.fill(tracing?'nonzero':'evenodd');
    }
    this.layerCtx.globalAlpha=1;this.layerCtx.globalCompositeOperation='source-over';
   }
   else if(bitmap){const m=invertHomography(planeHomography(clip.plane,clip.origin,this.view)),img=new ImageData(VW,VH);if(m.every(Number.isFinite)){for(let y=0;y<VH;y++)for(let x=0;x<VW;x++){const w=m[6]*(x+.5)+m[7]*(y+.5)+m[8],px=Math.floor((m[0]*(x+.5)+m[1]*(y+.5)+m[2])/w),py=Math.floor((m[3]*(x+.5)+m[4]*(y+.5)+m[5])/w);if(px>=0&&py>=0&&px<W&&py<H){const a=(py*W+px)*4,b=(y*VW+x)*4;for(let k=0;k<4;k++)img.data[b+k]=bitmap[a+k];}}}this.layerCtx.putImageData(img,0,0);}
   const data=this.layerCtx.getImageData(0,0,VW,VH).data,effects={...clip.effects,blurRadius:Math.round((clip.effects?.blurRadius??16)*this.view.scale)},source=this.effects.apply(data,VW,VH,{...clip,effects},time);
   for(let p=0;p<source.length;p+=4)if(source[p+3])compositePixel(this.pixels,p,source[p],source[p+1],source[p+2],source[p+3]/255*(exposure?1:opacity)*(clip.opacity??1),clip,this.mixer);
  }
  for(let p=0;p<this.pixels.length;p+=4){const a=this.pixels[p+3]/255;this.image.data[p]=this.pixels[p]*a;this.image.data[p+1]=this.pixels[p+1]*a;this.image.data[p+2]=this.pixels[p+2]*a;this.image.data[p+3]=255;}this.ctx.putImageData(this.image,0,0);
  // Keep screen-space markers out of cameraExposure samples and layer effects.
  if(this.intersections)markers.push(...this.intersectionPulses.update(side,this.intersectionDetector.find(intersectionEntries,this.view),phase,this.intersectionTiming,this.view,intersectionEntries));
  else this.intersectionPulses.reset();
  this.drawSharpOverlayMarkers(markers);
  this.outputCtx.imageSmoothingEnabled=true;this.outputCtx.drawImage(this.surface,0,0,VW,VH,0,0,this.outputWidth,this.outputHeight);
 }
 drawSharpOverlayMarkers(markers){this.ctx.save();for(const marker of markers){this.ctx.globalAlpha=Math.max(0,Math.min(1,marker.alpha??1));this.ctx.fillStyle='#fff';this.ctx.beginPath();this.ctx.arc(marker.x,marker.y,MARKER_DIAMETER/2,0,Math.PI*2);this.ctx.fill();}this.ctx.restore();}
 dispose(){this.items=[];this.live.clear();}
}
