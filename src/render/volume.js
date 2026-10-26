import { motionExposure, exposureBounds, MOTION_SAMPLES } from './motion-blur.js';
import { motionUniforms, motionCoverage } from './motion-shader.js';
import { colorAtTime } from '../color.js';
import { Matrix4, Vector2, Vector3, Vector4 } from 'three';
import { WebGLPaintingRenderer, target, material } from './webgl.js';
import { screenVertex, blurFragment, analogFragment, analogComposite } from './shaders.js';
import { VIEWPORT_WIDTH as VW, VIEWPORT_HEIGHT as VH, CANVAS_WIDTH as W, CANVAS_HEIGHT as H } from '../canvas.js';
import { BOX_SPEC, IDENTITY_PLANE, lineGeometry, pointInSpace, multiply } from '../space.js';
import { viewRotation } from '../view.js';
import { CachedGesture, gestureVisible, gestureTime, gestureOpacity } from '../loop.js';
import { sameGeometry } from './stroke.js';
import { layerEffects } from '../effects.js';
export const volumeVertex = `
precision highp float;
in vec3 position;
uniform vec4 bounds;
uniform mat4 planeMatrix,projectionMatrix,modelViewMatrix;
out vec2 pixel;
out vec3 volumePoint;
void main(){
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
 .replace('vec4 layerColor() {', `vec4 layerColor() {\n if(any(greaterThan(abs(volumePoint),vec3(${BOX_SPEC.width/2}.,${BOX_SPEC.height/2}.,${BOX_SPEC.depth/2}.))))return vec4(0.);\n ${motionCoverage}\n if(directShape==5){vec2 p=pixel-directBrush.xy;vec2 q=vec2(max(abs(p.x)-directBrush.z*.5,0.),p.y);return dot(q,q)<=directBrush.w*directBrush.w*.25?vec4(fillColor,layerOpacity):vec4(0.);}`)
 .replace('vec2 uv=vec2(pixel.x/resolution.x,1.-pixel.y/resolution.y);','vec2 uv=gl_FragCoord.xy/resolution;');
}

// Each recorded stroke keeps its own drawing plane in the box. Composition is
// viewport-sized; additional orientations never allocate additional 4K canvases.
export class VolumePaintingRenderer extends WebGLPaintingRenderer {
 constructor(canvas, options={}){
  super(canvas,{...options,volume:true});
  this.presentMaterial.vertexShader=screenVertex;this.presentMaterial.depthTest=false;this.presentMaterial.depthWrite=false;this.presentMaterial.needsUpdate=true;
  this.passMesh.material=this.presentMaterial;this.renderer.compile(this.passScene,this.camera);
 }
 layerMaterial(fragment, blending){
  const shader=super.layerMaterial(fragment,blending);
  shader.vertexShader=volumeVertex;shader.fragmentShader=spatialFragment(fragment);
  shader.uniforms.planeMatrix={value:new Matrix4()};
  shader.uniforms.motionCount={value:0};
  shader.uniforms.motionBrush={value:Array.from({length:MOTION_SAMPLES},()=>new Vector4())};
  shader.uniforms.motionInfo={value:Array.from({length:MOTION_SAMPLES},()=>new Vector4())};
  shader.uniforms.motionColor={value:Array.from({length:MOTION_SAMPLES},()=>new Vector3())};shader.uniforms.resolution.value.set(VW,VH);return shader;
 }
 setView(view){
  super.setView(view);
  this.passMesh.matrixAutoUpdate=false;this.passMesh.matrix.copy(this.painting.matrix);this.passMesh.matrixWorldNeedsUpdate=true;
 }
 setProject(project){
  super.setProject(project);
  for(const item of this.items){
   const previous=item.markers??[];
   item.markers=(item.clip.linePending?item.clip.lineMarkers??[]:[]).map((source,i)=>{
    const clip={...source,id:`${item.source.id}-marker-${i}`,mode:'move',shape:'ring',enabled:true,targets:item.clip.targets,effects:item.clip.effects};
    const old=previous[i];return old&&sameGeometry(old.source,clip)?{...old,source:clip,clip,gesture:Object.assign(old.gesture,{clip:{...clip,samples:old.gesture.clip.samples}})}:{source:clip,clip,bounds:{},gesture:new CachedGesture(clip)};
   });
  }
 }
 prepareEffects(){
  if(this.effectMaterial)return;
  this.effectMaterial=material(screenVertex,processedFragment,{resolution:{value:new Vector2(VW,VH)},image:{value:null},belowTexture:{value:null},mixAmount:{value:.5}});
  this.effectSource=target(VW,VH,true);this.blurA=target(VW/4,VH/4,true);this.blurB=target(VW/4,VH/4,true);
  this.blurMaterial=material(screenVertex,blurFragment,{image:{value:null},direction:{value:new Vector2()}});
  for(const rt of [this.effectSource,this.blurA,this.blurB])this.clearTarget(rt);
  for(const shader of [this.effectMaterial,this.blurMaterial]){this.passMesh.material=shader;this.renderer.compile(this.passScene,this.camera);}
 }
 pass(shader,rt){
  rt.scissorTest=false;this.passMesh.material=shader;this.renderer.setRenderTarget(rt);this.renderer.render(this.passScene,this.camera);
  if(shader===this.copyMaterial)this.stats.copyPixels+=rt.width*rt.height;
  if(shader===this.blurMaterial)this.stats.blurPixels+=rt.width*rt.height;
 }
 prepareLayer(shader,item,time,opacity,visual){
  const capsule=visual?.shape==='capsule';
  const b=super.prepareLayer(shader,item,time,opacity,capsule?{...visual,shape:'rect',width:visual.width+visual.height}:visual);
  const r=item.clip.plane??IDENTITY_PLANE,o=item.clip.origin??[0,0,0];
  shader.uniforms.planeMatrix.value.set(r[0],r[1],r[2],o[0],r[3],r[4],r[5],o[1],r[6],r[7],r[8],o[2],0,0,0,1);
  if(capsule){shader.uniforms.directShape.value=5;shader.uniforms.directBrush.value.set(visual.x,visual.y,visual.width,visual.height);}
  const exposure=item.exposure;shader.uniforms.motionCount.value=exposure?.length??0;
  if(exposure){
   exposure.forEach((sample,i)=>{
    const v=sample.visual??visual,shape={circle:1,rect:2,ring:3,'rect-ring':4,capsule:5}[v.shape]??1;
    const rect=shape===2||shape===4,w=rect||shape===5?(v.width??v.size):Math.max(1,Math.round(v.size)),h=rect||shape===5?(v.height??v.size):w;
    shader.uniforms.motionBrush.value[i].set(Math.round(v.x),Math.round(v.y),w,h);
    shader.uniforms.motionInfo.value[i].set((v.angle??0)*Math.PI/180,sample.opacity*(item.clip.opacity??1),shape,item.clip.ringWidth??5);
    const color=Number.parseInt(colorAtTime(item.clip,sample.time,v).slice(1),16);
    shader.uniforms.motionColor.value[i].set((color>>16)/255,((color>>8)&255)/255,(color&255)/255);
   });
   const box=exposureBounds(exposure);shader.uniforms.bounds.value.set(box.x,box.y,box.width,box.height);return box;
  }
  return b;
 }
 compose(item,time,opacity,visual){
  const clip=item.clip,effects=layerEffects(clip);let shader;
  if(effects.blur&&effects.blurRadius>0){
   this.clearTarget(this.effectSource);this.prepareLayer(this.normalMaterial,item,time,opacity,visual);this.pass(this.normalMaterial,this.effectSource);
   this.copyMaterial.uniforms.image.value=this.effectSource.texture;this.pass(this.copyMaterial,this.blurA);
   const radius=effects.blurRadius*this.view.scale;
   this.blurMaterial.uniforms.image.value=this.blurA.texture;this.blurMaterial.uniforms.direction.value.set(radius/16/VW,0);this.pass(this.blurMaterial,this.blurB);
   this.blurMaterial.uniforms.image.value=this.blurB.texture;this.blurMaterial.uniforms.direction.value.set(0,radius/16/VH);this.pass(this.blurMaterial,this.blurA);
   shader=this.effectMaterial;shader.uniforms.image.value=this.blurA.texture;
  }else{
   this.analogMaterial??=this.layerMaterial(analogFragment,undefined);shader=this.analogMaterial;this.prepareLayer(shader,item,time,opacity,visual);
  }
  this.alternate??=target(VW,VH);
  if(this.composed){this.copyMaterial.uniforms.image.value=this.current.texture;this.pass(this.copyMaterial,this.alternate);}else this.clearTarget(this.alternate);
  shader.uniforms.belowTexture.value=this.current.texture;shader.uniforms.mixAmount.value=(clip.mixAmount??50)/100;
  this.pass(shader,this.alternate);[this.current,this.alternate]=[this.alternate,this.current];this.composed=true;
 }
 draw(side,phase,{now=performance.now(),placementPreview=false}={}){
  if(this.contextLost)return;
  this.frame++;this.renderer.info.reset();this.current=this.accumulator;this.clearTarget(this.current);this.composed=false;
  const jobs=[],add=(item,time,opacity,visual)=>{
   const exposure=item.exposure??(item.gesture?motionExposure(item.clip,time,visual,t=>item.gesture.render(t)):null);
   jobs.push({item:exposure?{...item,exposure}:item,time,opacity,visual});
  };
  for(const item of this.items){
   const clip=item.clip;if(!clip.enabled||!clip.targets.includes(side)||!gestureVisible(clip,phase,this.duration))continue;item.lastUsed=this.frame;
   if(clip.mode==='line'&&clip.linePending){
    if(item.markers.length){for(const m of item.markers)if(gestureVisible(m.clip,phase,this.duration)){const t=gestureTime(m.clip,phase,this.duration);const visual=m.gesture.render(t);if(visual.active!==false)add(m,t,gestureOpacity(m.clip,t),visual);}}
    else for(const p of clip.samples)add({...item,clip:{...clip,ringWidth:Math.min(clip.ringWidth??5,12,Math.floor(p.size/4))}},0,1,{...p,shape:'ring'});
    continue;
   }
   const t=gestureTime(clip,phase,this.duration),opacity=(placementPreview&&clip.mode==='place'&&t<1?1:gestureOpacity(clip,t));
   if(clip.mode==='line'&&clip.points3D){const g=lineGeometry(clip,this.view);add({...item,clip:{...clip,plane:g.plane,origin:g.origin}},t,opacity,g.visual);}
   else if(item.moving){const visual=item.gesture.render(t);if(visual.active!==false)add(item,t,opacity*(visual.opacity??1),visual);}
   else{this.paintMask(item,clip.mode==='line'?1:Math.min(t,clip.duration),null,t);add(item,t,opacity,null);}
  }
  const live=this.live;
  if(live.id&&live.targets?.includes(side)){
   const clip={id:live.id,mode:live.mode,color:live.color,opacity:live.opacity,effects:live.effects,ringWidth:live.ringWidth,plane:live.plane};
   const visual=live.move??live.head,exposure=motionExposure(clip,live.elapsed,visual,t=>live.motionAt(t),{live:true});
   add({clip,bounds:{},target:null,exposure},live.time(now),1,visual);
  }
  const r=viewRotation(this.view);
  for(const job of jobs){const c=job.item.clip,p=job.visual?pointInSpace(job.visual,c.plane,c.origin):pointInSpace({x:job.item.bounds.x+job.item.bounds.width/2,y:job.item.bounds.y+job.item.bounds.height/2},c.plane);job.depth=multiply(r,p)[2];}
  jobs.sort((a,b)=>a.depth-b.depth);
  for(const job of jobs)this.compose(job.item,job.time,job.opacity,job.visual);
  this.accumulator=this.current;this.paintingTexture=this.current.texture;this.presentMaterial.uniforms.image.value=this.current.texture;
  this.passMesh.material=this.presentMaterial;this.renderer.setRenderTarget(null);this.renderer.setClearColor(0,1);this.renderer.clear(true,true,false);this.renderer.render(this.passScene,this.camera);
  this.stats.frames++;this.stats.drawCalls=this.renderer.info.render.calls;
  if(this.stats.maskBytes>this.cacheBytes)for(const item of this.items.filter(i=>i.target&&i.lastUsed!==this.frame).sort((a,b)=>a.lastUsed-b.lastUsed)){this.release(item);if(this.stats.maskBytes<=this.cacheBytes)break;}
 }
 readPixels(){const pixels=new Uint8Array(VW*VH*4);const gl=this.renderer.getContext();gl.readPixels(0,0,VW,VH,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;}
}
