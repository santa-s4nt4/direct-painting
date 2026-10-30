import { positionCamera } from './camera-view.js';
import { cameraExposure, cameraProjection, projectedBounds, cameraCircleConic } from './camera-exposure.js';
import { motionExposure, exposureBounds, MOTION_SAMPLES } from './motion-blur.js';
import { motionUniforms, motionCoverage } from './motion-shader.js';
import { colorAtTime } from '../color.js';
import { Matrix3, Matrix4, Vector2, Vector3, Vector4 } from 'three';
import { WebGLPaintingRenderer, target, material } from './webgl.js';
import { screenVertex, blurFragment, analogFragment, analogComposite } from './shaders.js';
import { VIEWPORT_WIDTH as VW, VIEWPORT_HEIGHT as VH, CANVAS_WIDTH as W, CANVAS_HEIGHT as H } from '../canvas.js';
import { BOX_SPEC, IDENTITY_PLANE, lineGeometry, pointInSpace, projectSpace, insideBox, multiply } from '../space.js';
import { viewRotation } from '../view.js';
import { CachedGesture, gestureVisible, gestureTime, gestureOpacity } from '../loop.js';
import { sameGeometry } from './stroke.js';
import { layerEffects, DEFAULT_RING_WIDTH } from '../effects.js';
import { tracePlaybackClip, traceHead, traceVisual } from '../trace-motion.js';
import { IntersectionDetector, IntersectionPulseTracker } from '../intersections.js';
export const volumeVertex = `
precision highp float;
in vec3 position;
uniform vec4 bounds;
uniform highp int cameraCount;
uniform vec4 cameraBounds;
uniform vec2 resolution;
uniform mat4 planeMatrix,projectionMatrix,modelViewMatrix;
out vec2 pixel;
out vec3 volumePoint;
void main(){
 if(cameraCount>0){pixel=vec2(0.);volumePoint=vec3(0.);vec2 p=cameraBounds.xy+(position.xy+.5)*cameraBounds.zw;gl_Position=vec4(p.x/resolution.x*2.-1.,1.-p.y/resolution.y*2.,0.,1.);return;}
 pixel=bounds.xy+(position.xy+.5)*bounds.zw;
 volumePoint=(planeMatrix*vec4(pixel-vec2(${W/2}.,${H/2}.),0.,1.)).xyz;
 gl_Position=projectionMatrix*modelViewMatrix*vec4(volumePoint.x,-volumePoint.y,volumePoint.z,1.);
}`;
const screenComposite = analogComposite.replace('vec2 uv=vec2(pixel.x/resolution.x,1.-pixel.y/resolution.y);','vec2 uv=gl_FragCoord.xy/resolution;');
const processedFragment = `precision highp float;
in vec2 texCoord;
uniform vec2 resolution;
uniform sampler2D image;
out vec4 result;
vec4 layerColor(){vec4 p=texture(image,texCoord);return p.a>0.?vec4(p.rgb/p.a,p.a):vec4(0.);}
`+screenComposite;
export function spatialFragment(fragment){
 return fragment.replace('in vec2 pixel;', 'in vec2 pixel;\nin vec3 volumePoint;'+motionUniforms)
 .replace('vec4 layerColor() {', `vec4 layerColor() {\n if(clipInsideBox==0&&cameraCount==0&&any(greaterThan(abs(volumePoint),vec3(${BOX_SPEC.width/2}.,${BOX_SPEC.height/2}.,${BOX_SPEC.depth/2}.))))return vec4(0.);\n ${motionCoverage}\n if(directShape>=5){vec2 p=pixel-directBrush.xy;float c=cos(directAngle),s=sin(directAngle);p=vec2(c*p.x+s*p.y,-s*p.x+c*p.y);float coverage=directShape==5?capsuleCoverage(p,directBrush.zw):traceCoverage(p,directBrush.zw,directShape==7,edgeSize);return vec4(fillColor,layerOpacity*coverage);}`)
 .replace('vec2 uv=vec2(pixel.x/resolution.x,1.-pixel.y/resolution.y);','vec2 uv=gl_FragCoord.xy/resolution;');
}
const SCREEN={x:0,y:0,width:VW,height:VH};
function union(a,b){if(!a)return {...b};const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return {x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y};}
const overlaps=(a,b)=>a&&a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;

// Each recorded stroke keeps its own drawing plane in the box. Composition is
// viewport-sized; additional orientations never allocate additional 4K canvases.
export class VolumePaintingRenderer extends WebGLPaintingRenderer {
 constructor(canvas, options={}){
  super(canvas,{...options,volume:true});
  Object.assign(this.stats,{compositePixels:0,directLayers:0,culledLayers:0,cameraFastLayers:0});
  this.intersectionPulses=new IntersectionPulseTracker();this.intersectionDetector=new IntersectionDetector();this.setIntersectionTiming({});
  this.presentMaterial.vertexShader=screenVertex;this.presentMaterial.depthTest=false;this.presentMaterial.depthWrite=false;this.presentMaterial.needsUpdate=true;
  this.passMesh.material=this.presentMaterial;this.renderer.compile(this.passScene,this.camera);
  // Compile pigment mixing before playback. Orbiting can make previously
  // disjoint layers overlap for the first time; that frame must not compile.
  this.analogMaterial=this.layerMaterial(analogFragment,undefined);this.analogMaterial.uniforms=this.normalMaterial.uniforms;
  this.passMesh.material=this.analogMaterial;this.renderer.compile(this.passScene,this.camera);
  this.passMesh.material=this.copyMaterial;this.renderer.compile(this.passScene,this.camera);
  // ANGLE/Metal can defer pipeline setup until the first draw, even after link.
  // Exercise both paths on the existing transparent 1px target before playback.
  const previousTarget=this.renderer.getRenderTarget();this.renderer.setRenderTarget(this.liveTarget);
  for(const shader of [this.analogMaterial,this.copyMaterial]){this.passMesh.material=shader;this.renderer.render(this.passScene,this.camera);}
  this.clearTarget(this.liveTarget);this.renderer.setRenderTarget(previousTarget);this.passMesh.material=this.presentMaterial;
 }
 layerMaterial(fragment, blending){
  const shader=super.layerMaterial(fragment,blending);
  shader.uniforms.smoothEdges.value=1;
  shader.vertexShader=volumeVertex;shader.fragmentShader=spatialFragment(fragment);
  shader.uniforms.planeMatrix={value:new Matrix4()};
  shader.uniforms.clipInsideBox={value:0};
  shader.uniforms.cameraConicCount={value:0};shader.uniforms.cameraCircleRadii={value:new Vector2()};
  shader.uniforms.cameraCount={value:0};shader.uniforms.cameraBounds={value:new Vector4()};shader.uniforms.cameraInverse={value:Array.from({length:16},()=>new Matrix3())};
  shader.uniforms.motionCount={value:0};
  shader.uniforms.motionBrush={value:Array.from({length:MOTION_SAMPLES},()=>new Vector4())};
  shader.uniforms.motionInfo={value:Array.from({length:MOTION_SAMPLES},()=>new Vector4())};
  shader.uniforms.motionColor={value:Array.from({length:MOTION_SAMPLES},()=>new Vector3())};shader.uniforms.resolution.value.set(VW,VH);return shader;
 }
 setView(view){
  super.setView(view);
  this.passMesh.matrixAutoUpdate=false;this.passMesh.matrix.identity();positionCamera(this.camera,this.view);this.passMesh.matrixWorldNeedsUpdate=true;
 }
 setProject(project){
  this.intersections=project.settings?.intersections===true;
  this.setIntersectionTiming(project.settings??{});this.intersectionPulses.reset();
  super.setProject({...project,clips:project.clips.map(tracePlaybackClip)});
  // Reserve the composition pair during project updates, before an orbit can
  // reveal the first overlap. A one-layer project keeps the single buffer.
  if(this.items.length>1&&!this.alternate){this.alternate=target(VW,VH,true);this.clearTarget(this.alternate);}
  for(const item of this.items){
   const previous=item.markers??[];
   item.markers=(item.clip.linePending?item.clip.lineMarkers??[]:[]).map((source,i)=>{
    const clip={...source,id:`${item.source.id}-marker-${i}`,mode:'move',shape:'ring',enabled:true,targets:item.clip.targets,effects:item.clip.effects};
    const old=previous[i];return old&&sameGeometry(old.source,clip)?{...old,source:clip,clip,gesture:Object.assign(old.gesture,{clip:{...clip,samples:old.gesture.clip.samples}})}:{source:clip,clip,bounds:{},gesture:new CachedGesture(clip)};
   });
  }
 }
 setIntersectionTiming(settings){this.intersectionTiming={fadeInMs:settings.intersectionFadeInMs??0,holdMs:settings.intersectionHoldMs??200,fadeOutMs:settings.intersectionFadeOutMs??0};}
 prepareEffects(){
  if(this.effectMaterial)return;
  this.effectMaterial=material(screenVertex,processedFragment,{resolution:{value:new Vector2(VW,VH)},image:{value:null},belowTexture:{value:null},mixAmount:{value:.5}});
  this.effectSource=target(VW,VH,true);this.blurA=target(VW/4,VH/4,true);this.blurB=target(VW/4,VH/4,true);
  this.blurMaterial=material(screenVertex,blurFragment,{image:{value:null},direction:{value:new Vector2()}});
  for(const rt of [this.effectSource,this.blurA,this.blurB])this.clearTarget(rt);
  for(const shader of [this.effectMaterial,this.blurMaterial]){this.passMesh.material=shader;this.renderer.compile(this.passScene,this.camera);}
 }
 pass(shader,rt,bounds=SCREEN){
  const x=Math.max(0,Math.floor(bounds.x*rt.width/VW)),y=Math.max(0,Math.floor(bounds.y*rt.height/VH));
  const right=Math.min(rt.width,Math.ceil((bounds.x+bounds.width)*rt.width/VW)),bottom=Math.min(rt.height,Math.ceil((bounds.y+bounds.height)*rt.height/VH));
  const width=Math.max(0,right-x),height=Math.max(0,bottom-y);if(!width||!height)return;
  rt.scissor.set(x,rt.height-bottom,width,height);rt.scissorTest=true;
  this.passMesh.material=shader;this.renderer.setRenderTarget(rt);this.renderer.render(this.passScene,this.camera);rt.scissorTest=false;
  if(shader===this.copyMaterial)this.stats.copyPixels+=width*height;
  else if(shader===this.blurMaterial)this.stats.blurPixels+=width*height;
  else this.stats.compositePixels+=width*height;
 }
 prepareLayer(shader,item,time,opacity,visual){
  const capsule=visual?.shape==='capsule',trace=visual?.shape?.startsWith('trace-'),rectTrace=visual?.shape==='trace-rect';
  const boundsVisual=capsule?{...visual,shape:'rect',width:visual.width+visual.height}:trace?{...visual,shape:rectTrace?'rect':'circle',size:visual.size+visual.strokeWidth,width:visual.width+visual.strokeWidth,height:visual.height+visual.strokeWidth}:visual;
  const b=super.prepareLayer(shader,item,time,opacity,boundsVisual);
  const r=item.clip.plane??IDENTITY_PLANE,o=item.clip.origin??[0,0,0];
  shader.uniforms.planeMatrix.value.set(r[0],r[1],r[2],o[0],r[3],r[4],r[5],o[1],r[6],r[7],r[8],o[2],0,0,0,1);
  if(visual){const rect=capsule||trace||['rect','rect-ring'].includes(visual.shape);shader.uniforms.directBrush.value.set(visual.x,visual.y,rect?visual.width??visual.size:visual.size,rect?visual.height??visual.size:visual.size);}
  if(capsule)shader.uniforms.directShape.value=5;
  if(trace){shader.uniforms.directShape.value=rectTrace?7:6;shader.uniforms.edgeSize.value=visual.strokeWidth;shader.uniforms.traceProgress.value=visual.traceProgress;const angle=visual.traceProgress*Math.PI*2;shader.uniforms.traceEnd.value.set(Math.sin(angle),-Math.cos(angle));}
  const exposure=item.exposure;shader.uniforms.motionCount.value=exposure?.length??0;shader.uniforms.cameraCount.value=item.cameraExposure?exposure.length:0;shader.uniforms.cameraConicCount.value=0;
  const box=exposure?.some(s=>s.visual)?exposureBounds(exposure):b;
  shader.uniforms.clipInsideBox.value=[[box.x,box.y],[box.x+box.width,box.y],[box.x+box.width,box.y+box.height],[box.x,box.y+box.height]].every(([x,y])=>insideBox(pointInSpace({x,y},item.clip.plane,item.clip.origin)))?1:0;
  if(item.cameraExposure){
   const projection=cameraProjection(item.clip,exposure,b);projection.inverse.forEach((m,i)=>shader.uniforms.cameraInverse.value[i].set(...m));const box=projection.bounds;shader.uniforms.cameraBounds.value.set(box.x,box.y,box.width,box.height);
   const circle=visual&&(!visual.shape||visual.shape==='circle'),ring=visual?.shape==='ring',completeTrace=visual?.shape==='trace-circle'&&visual.traceProgress>=1;
   // Keep every camera sample. Static circles can be tested directly in screen
   // space instead of dividing back into the source plane at every pixel.
   if((circle||ring||completeTrace)&&shader.uniforms.clipInsideBox.value===1&&exposure.every(s=>s.time===time&&s.visual===visual)){
    const conics=projection.inverse.map(m=>cameraCircleConic(m,visual.x,visual.y));
    if(conics.every(Boolean)){
     const radius=visual.size/2,stroke=completeTrace?visual.strokeWidth:(item.clip.ringWidth??DEFAULT_RING_WIDTH),outer=radius+(completeTrace?stroke/2:0),inner=circle?0:Math.max(0,radius-(completeTrace?stroke/2:stroke));
     conics.forEach((m,i)=>shader.uniforms.cameraInverse.value[i].set(...m));shader.uniforms.cameraCircleRadii.value.set(outer*outer,inner*inner);shader.uniforms.cameraConicCount.value=exposure.length;this.stats.cameraFastLayers++;
    }
   }
  }
  if(exposure){
   exposure.forEach((sample,i)=>{
    const v=sample.visual??visual??{x:0,y:0,size:1},shape=sample.visual===null?0:{circle:1,rect:2,ring:3,'rect-ring':4,capsule:5,'trace-circle':6,'trace-rect':7}[v.shape]??1;
    const rect=shape===2||shape===4||shape===7,w=rect||shape===5?(v.width??v.size):Math.max(1,v.size),h=rect||shape===5?(v.height??v.size):w;
    shader.uniforms.motionBrush.value[i].set(v.x,v.y,w,h);
    shader.uniforms.motionInfo.value[i].set((v.angle??0)*Math.PI/180,sample.opacity*(item.clip.opacity??1),shape,v.strokeWidth??item.clip.ringWidth??DEFAULT_RING_WIDTH);
    const color=Number.parseInt(colorAtTime(item.clip,sample.time,v).slice(1),16);
    shader.uniforms.motionColor.value[i].set((color>>16)/255,((color>>8)&255)/255,(color&255)/255);
   });
   if(item.cameraExposure)return b;
   const box=exposureBounds(exposure);shader.uniforms.bounds.value.set(box.x,box.y,box.width,box.height);return box;
  }
  return b;
 }
 layerScreenBounds(shader,item,bounds){
  if(item.cameraExposure){const b=shader.uniforms.cameraBounds.value;return {x:b.x,y:b.y,width:b.z,height:b.w};}
  return projectedBounds(item.clip,bounds,this.view);
 }
 compose(item,time,opacity,visual){
  const clip=item.clip,effects=layerEffects(clip);let shader,bounds;
  if(opacity*(clip.opacity??1)<=0)return;
  if(effects.blur&&effects.blurRadius>0){
   const b=this.prepareLayer(this.normalMaterial,item,time,opacity,visual);bounds=this.layerScreenBounds(this.normalMaterial,item,b);
   if(!bounds.width||!bounds.height){this.stats.culledLayers++;return;}
   this.prepareEffects();
   this.clearTarget(this.effectSource);this.pass(this.normalMaterial,this.effectSource,bounds);
   const radius=effects.blurRadius*this.view.scale;
   bounds={x:bounds.x-radius-8,y:bounds.y-radius-8,width:bounds.width+2*(radius+8),height:bounds.height+2*(radius+8)};
   this.clearTarget(this.blurA);this.copyMaterial.uniforms.image.value=this.effectSource.texture;this.pass(this.copyMaterial,this.blurA,bounds);
   this.clearTarget(this.blurB);this.blurMaterial.uniforms.image.value=this.blurA.texture;this.blurMaterial.uniforms.direction.value.set(radius/16/VW,0);this.pass(this.blurMaterial,this.blurB,bounds);
   this.clearTarget(this.blurA);this.blurMaterial.uniforms.image.value=this.blurB.texture;this.blurMaterial.uniforms.direction.value.set(0,radius/16/VH);this.pass(this.blurMaterial,this.blurA,bounds);
   shader=this.effectMaterial;shader.uniforms.image.value=this.blurA.texture;
  }else{
   const b=this.prepareLayer(this.normalMaterial,item,time,opacity,visual);bounds=this.layerScreenBounds(this.normalMaterial,item,b);
   if(!bounds.width||!bounds.height){this.stats.culledLayers++;return;}
   // Nothing underneath (or 100% paint mixing) is exactly source-over. Keep
   // these layers in the current buffer without a texture read/copy/swap.
   if(!this.composedBounds.some(previous=>overlaps(previous,bounds))||(clip.mixAmount??50)===100){
    this.pass(this.normalMaterial,this.current,bounds);this.pendingBounds=union(this.pendingBounds,bounds);this.composedBounds.push(bounds);this.stats.directLayers++;return;
   }
   if(!this.analogMaterial){this.analogMaterial=this.layerMaterial(analogFragment,undefined);this.analogMaterial.uniforms=this.normalMaterial.uniforms;}
   // The normal/Analog programs use the same per-layer inputs. In particular,
   // upload camera homographies once instead of solving every exposure twice.
   shader=this.analogMaterial;
  }
  this.alternate??=target(VW,VH,true);
  // Both targets agree before composing. Only the region written since the
  // last swap needs copying; clear stale previous-frame pixels once per frame.
  if(!this.pairReady){this.clearTarget(this.alternate);this.pairReady=true;}
  if(this.pendingBounds){this.copyMaterial.uniforms.image.value=this.current.texture;this.pass(this.copyMaterial,this.alternate,this.pendingBounds);}
  shader.uniforms.belowTexture.value=this.current.texture;shader.uniforms.mixAmount.value=(clip.mixAmount??50)/100;
  this.pass(shader,this.alternate,bounds);[this.current,this.alternate]=[this.alternate,this.current];this.pendingBounds=bounds;this.composedBounds.push(bounds);
 }
 draw(side,phase,{now=performance.now(),placementPreview=false,cameraViews=null}={}){
  if(this.contextLost)return;
  this.frame++;this.renderer.info.reset();this.current=this.accumulator;this.clearTarget(this.current);this.pendingBounds=null;this.composedBounds=[];this.pairReady=false;
  const jobs=[],intersectionEntries=[],markers=[],add=(item,time,opacity,visual)=>{
   const exposure=item.exposure??(cameraViews?cameraExposure(item.clip,time,visual,item.gesture?t=>item.gesture.render(t):null,cameraViews):(item.gesture?motionExposure(item.clip,time,visual,t=>item.gesture.render(t)):null));
   jobs.push({item:exposure?{...item,exposure,cameraExposure:!!cameraViews}:item,time,opacity,visual});
  };
  for(const item of this.items){
   const clip=item.clip;if(!clip.enabled||!clip.targets.includes(side)||!gestureVisible(clip,phase,this.duration))continue;item.lastUsed=this.frame;
   if(clip.mode==='line'&&clip.linePending){
    if(item.markers.length){for(const m of item.markers)if(gestureVisible(m.clip,phase,this.duration)){const t=gestureTime(m.clip,phase,this.duration),visual=m.gesture.render(t),alpha=gestureOpacity(m.clip,t)*(m.clip.opacity??1);if(visual.active!==false){add(m,t,gestureOpacity(m.clip,t),visual);intersectionEntries.push({clip:m.clip,owner:clip.id,visual,time:t,alpha});}}}
    else for(const p of clip.samples){const preview={...item,clip:{...clip,ringWidth:Math.min(clip.ringWidth??DEFAULT_RING_WIDTH,12,Math.floor(p.size/4))}},visual={...p,shape:'ring'};add(preview,0,1,visual);intersectionEntries.push({clip:preview.clip,visual,time:0,alpha:1});}
    continue;
   }
   const t=gestureTime(clip,phase,this.duration),opacity=(placementPreview&&clip.mode==='place'&&t<1?1:gestureOpacity(clip,t));
   if(clip.mode==='line'&&clip.points3D){const g=lineGeometry(clip,this.view),lineClip={...clip,plane:g.plane,origin:g.origin};add({...item,clip:lineClip},t,opacity,g.visual);intersectionEntries.push({clip:lineClip,visual:g.visual,time:t,alpha:opacity*(clip.opacity??1)});}
   else if(clip.trace&&!clip.trace.pending){add(item,t,opacity,traceVisual(clip,t));}
   else if(item.moving){const visual=item.gesture.render(t);if(visual.active!==false){const alpha=opacity*(visual.opacity??1)*(clip.opacity??1);add(item,t,opacity*(visual.opacity??1),visual);intersectionEntries.push({clip,visual,time:t,alpha});}}
   else{this.paintMask(item,clip.mode==='line'?1:Math.min(t,clip.duration),null,t);add(item,t,opacity,null);}
   if(clip.trace&&!clip.trace.pending){
    const alpha=opacity*(clip.opacity??1),head=traceHead(clip,t),space=head&&pointInSpace(head,clip.plane,clip.origin);
    if(space&&insideBox(space)){const point=projectSpace(space,this.view);if(Number.isFinite(point.x)&&Number.isFinite(point.y))markers.push({x:point.x,y:point.y,alpha});}
    intersectionEntries.push({clip,visual:null,time:t,alpha});
   }
  }
  const live=this.live;
  if(live.id&&live.targets?.includes(side)){
   const clip={id:live.id,mode:live.mode,color:live.color,opacity:live.opacity,effects:live.effects,ringWidth:live.ringWidth,plane:live.plane};
   const visual=live.move??live.head;intersectionEntries.push({clip,visual,time:live.elapsed,alpha:live.opacity??1});
   const exposure=cameraViews?cameraExposure(clip,live.elapsed,visual,t=>live.motionAt(t),cameraViews,{live:true}):motionExposure(clip,live.elapsed,visual,t=>live.motionAt(t),{live:true});
   add({clip,bounds:{},target:null,exposure},live.time(now),1,visual);
  }
  const r=viewRotation(this.view);
  for(const job of jobs){const c=job.item.clip,p=job.visual?pointInSpace(job.visual,c.plane,c.origin):pointInSpace({x:job.item.bounds.x+job.item.bounds.width/2,y:job.item.bounds.y+job.item.bounds.height/2},c.plane);job.depth=multiply(r,p)[2];}
  jobs.sort((a,b)=>a.depth-b.depth);
  for(const job of jobs)this.compose(job.item,job.time,job.opacity,job.visual);
  this.accumulator=this.current;this.paintingTexture=this.current.texture;this.presentMaterial.uniforms.image.value=this.current.texture;
  this.passMesh.material=this.presentMaterial;this.renderer.setRenderTarget(null);this.renderer.setClearColor(0,1);this.renderer.clear(true,true,false);this.renderer.render(this.passScene,this.camera);
  // Intersection markers use the current camera projection and are appended
  // after every camera-exposure layer has been composited, so they stay sharp.
  if(this.intersections)markers.push(...this.intersectionPulses.update(side,this.intersectionDetector.find(intersectionEntries,this.view),phase,this.intersectionTiming,this.view,intersectionEntries));
  else this.intersectionPulses.reset();
  this.drawSharpOverlayMarkers(markers);
  this.stats.frames++;this.stats.drawCalls=this.renderer.info.render.calls;
  if(this.stats.maskBytes>this.cacheBytes)for(const item of this.items.filter(i=>i.target&&i.lastUsed!==this.frame).sort((a,b)=>a.lastUsed-b.lastUsed)){this.release(item);if(this.stats.maskBytes<=this.cacheBytes)break;}
 }
 readPixels(){const pixels=new Uint8Array(VW*VH*4);const gl=this.renderer.getContext();gl.readPixels(0,0,VW,VH,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;}
}
