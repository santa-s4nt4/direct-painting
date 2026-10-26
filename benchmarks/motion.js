import { Vector3 } from 'three';
import { DEFAULT_CAMERA,CameraSampler,newCameraEvent } from '../src/camera-motion.js';
import { VolumePaintingRenderer } from '../src/render/volume.js';
import { CPUVolumeRenderer } from '../src/render/volume-cpu.js';
import { DEFAULT_EFFECTS } from '../src/effects.js';
import { DEFAULT_VIEW,canvasView } from '../src/view.js';
import { workingPlane } from '../src/space.js';
import { FRAME_MS } from '../src/timing.js';
const result=document.querySelector('#result'),run=document.querySelector('#run');
const project=clips=>({version:1,duration:16000,clips});
const clip=(extra={})=>({id:'moving',mode:'move',shape:'circle',color:'#ffffff',enabled:true,targets:[0],duration:500,start:0,fadeMs:500,effects:{...DEFAULT_EFFECTS},plane:workingPlane(DEFAULT_VIEW),samples:Array.from({length:31},(_,i)=>({x:1600+Math.min(i,6)*100,y:1080,size:100,t:i*FRAME_MS})),...extra});
const pixel=(data,x,y=540)=>data[((1079-y)*1920+x)*4];
const next=()=>new Promise(r=>requestAnimationFrame(r));
run.onclick=async()=>{
 run.disabled=true;delete result.dataset.complete;
 const report={date:new Date().toISOString(),checks:[],defaultEffects:DEFAULT_EFFECTS};let gpu,sharp,cpu;
 const check=(name,value,extra={})=>{report.checks.push({name,passed:!!value,...extra});if(!value)throw new Error(name);};
 try{
  gpu=new VolumePaintingRenderer(document.querySelector('#motion'));sharp=new VolumePaintingRenderer(document.querySelector('#sharp'));gpu.setView(DEFAULT_VIEW);sharp.setView(DEFAULT_VIEW);
  const draw=(renderer,source,phase)=>{renderer.setProject(project([source]));renderer.draw(0,phase);return renderer.readPixels();};
  const same=(a,b)=>a.every((v,i)=>v===b[i]);
  check('Default effects are Blur OFF and Motion blur ON at a 16.7ms shutter',!DEFAULT_EFFECTS.blur&&DEFAULT_EFFECTS.motionBlur&&DEFAULT_EFFECTS.motionBlurAmount===100);
  const source=clip();let example;
  for(const shape of ['circle','ring','rect','rect-ring']){
   const c=clip({shape,ringWidth:10,samples:source.samples.map(p=>({...p,shape,width:120,height:80,angle:35}))});
   const actual=draw(gpu,c,80),expected=new Float32Array(actual.length),steps=gpu.analogMaterial.uniforms.motionCount.value;
   if(steps<8||steps>32)throw new Error("Moving fixture did not integrate its shutter");
   for(let i=0;i<steps;i++){const image=draw(sharp,{...c,effects:{...DEFAULT_EFFECTS,motionBlur:false}},80-FRAME_MS*(steps-1-i)/(steps-1));for(let p=0;p<image.length;p++)expected[p]+=image[p]/steps;}
   let error=0,changed=0;const crisp=draw(sharp,{...c,effects:{...DEFAULT_EFFECTS,motionBlur:false}},80);
   for(let p=0;p<actual.length;p++){error=Math.max(error,Math.abs(actual[p]-Math.round(expected[p])));if(p%4!==3&&actual[p]!==crisp[p])changed++;}
   check(`${shape}: analytic GPU shutter matches independently rendered temporal frames`,error<=2&&changed>0,{maxChannelError:error,changedChannels:changed});
   if(shape==='circle')example=c;
  }
  const staticRing=clip({shape:'ring',ringWidth:10,samples:[{x:1920,y:1080,size:180,shape:'ring',t:0},{x:1920,y:1080,size:180,shape:'ring',t:500}]});
  check('Stationary rings stay pixel-identical, with an empty center',same(draw(gpu,staticRing,80),draw(sharp,{...staticRing,effects:{...DEFAULT_EFFECTS,motionBlur:false}},80))&&pixel(gpu.readPixels(),960)===0);
  const atStart=draw(gpu,example,0);draw(gpu,example,80);check('Seeking back / MIDI-style restart leaves no prior-frame ghost',same(draw(gpu,example,0),atStart));
  const blurred=draw(gpu,example,80);draw(gpu,{...example,effects:{...DEFAULT_EFFECTS,motionBlur:false}},80);check('Turning Motion blur OFF and ON is reversible without saved masks',same(draw(gpu,example,80),blurred)&&gpu.stats.masksCreated===0);
  const gaussian=draw(gpu,{...example,effects:{...DEFAULT_EFFECTS,blur:true}},80);check('Gaussian Blur can be enabled independently alongside Motion blur',!same(gaussian,blurred));
  const views=Array.from({length:8},(_,i)=>canvasView({...DEFAULT_VIEW,yaw:-6+i*2,pitch:-3+i,distance:5000+i*50}));
  const cameraClip=clip({id:'camera',effects:{...DEFAULT_EFFECTS,motionBlur:false},duration:6000,samples:[{x:2200,y:1200,size:100,t:0},{x:2200,y:1200,size:100,t:6000}]});
  gpu.setView(views.at(-1));gpu.setProject(project([cameraClip]));gpu.draw(0,80,{cameraViews:views});const cameraImage=gpu.readPixels(),cameraMean=new Float32Array(cameraImage.length);
  for(const view of views){sharp.setView(view);const data=draw(sharp,cameraClip,80);for(let i=0;i<data.length;i++)cameraMean[i]+=data[i]/views.length;}
  let squared=0,bad=0;for(let i=0;i<cameraImage.length;i++){const delta=Math.abs(cameraImage[i]-Math.round(cameraMean[i]));squared+=delta*delta;if(delta>2)bad++;}
  check('Camera Motion Blur matches independent camera projections',Math.sqrt(squared/cameraImage.length)<.15&&bad<128,{rmsError:Math.sqrt(squared/cameraImage.length),channelsOver2:bad});
  check('The actual Three.js camera looks at the origin from its orbital position',Math.abs(gpu.camera.getWorldDirection(new Vector3()).dot(gpu.camera.position.clone().normalize())+1)<1e-6&&Math.abs(gpu.camera.position.length()-5350)<1e-6);
  const config={...DEFAULT_CAMERA,mode:'midi-auto'},event=newCameraEvent(DEFAULT_VIEW,DEFAULT_VIEW,config,0,'1:60',()=>.65),sampler=new CameraSampler();
  const sampled=sampler.frame({config,event},DEFAULT_VIEW,1000,200,0);
  gpu.setView(sampled.view);gpu.setProject(project([cameraClip]));gpu.draw(0,1000,{cameraViews:sampled.cameraViews});const automated=gpu.readPixels();
  const repeat=sampler.frame({config,event},DEFAULT_VIEW,17000,200,1);gpu.setView(repeat.view);gpu.draw(0,17000,{cameraViews:repeat.cameraViews});check('MIDI camera exposure is independent of timeline phase',same(automated,gpu.readPixels()));
  gpu.setView(DEFAULT_VIEW);sharp.setView(DEFAULT_VIEW);
  // Fast live input: history tracks the actual displayed (smoothed) head.
  gpu.setProject(project([]));sharp.setProject(project([]));const a={x:1800,y:1080,size:40,t:0},b={x:1920,y:1080,size:40,t:FRAME_MS};
  const live={...clip(),id:'live',started:0,samples:[a],last:a};gpu.setLiveStroke(live,0,a);live.samples.push(b);live.last=b;gpu.setLiveStroke(live,FRAME_MS,b);gpu.draw(0,0,{now:FRAME_MS});const liveImage=gpu.readPixels();
  sharp.setLiveStroke({...live,effects:{...DEFAULT_EFFECTS,motionBlur:false}},FRAME_MS,b);sharp.draw(0,0,{now:FRAME_MS});check('Live drawing blurs toward its preceding displayed position',pixel(liveImage,850)>0&&pixel(sharp.readPixels(),850)===0);
  gpu.setLiveStroke(null,FRAME_MS);gpu.receiveLive({id:'remote',from:0,mode:'move',color:'#ffffff',targets:[0],effects:DEFAULT_EFFECTS,plane:live.plane,samples:[a],head:a,move:a,elapsed:0},0);
  gpu.receiveLive({id:'remote',from:1,mode:'move',color:'#ffffff',targets:[0],effects:DEFAULT_EFFECTS,plane:live.plane,samples:[b],head:b,move:b,elapsed:FRAME_MS},FRAME_MS);gpu.draw(0,0,{now:FRAME_MS});check('Network output and local live input integrate the same shutter',same(gpu.readPixels(),liveImage));gpu.receiveLive(null,FRAME_MS);
  const cpuCanvas=document.createElement('canvas');cpuCanvas.width=1920;cpuCanvas.height=1080;cpu=new CPUVolumeRenderer(cpuCanvas);cpu.setView(DEFAULT_VIEW);cpu.setProject(project([example]));cpu.draw(0,80);
  const cpuImage=cpu.ctx.getImageData(0,0,1920,1080).data,gpuImage=draw(gpu,example,80);let cpuError=0;
  const interior=Array.from({length:32},(_,i)=>gpu.items[0].gesture.render(80-FRAME_MS*(31-i)/31));
  for(let y=510;y<570;y+=10)for(let x=600;x<1260;x+=10)if(interior.every(p=>Math.abs(Math.hypot(x-(p.x-960),y-(p.y-540))-p.size/2)>3))cpuError=Math.max(cpuError,Math.abs(cpuImage[(y*1920+x)*4]-pixel(gpuImage,x,y)));
  check('CPU fallback also integrates spatial motion with matching interior pixels',cpuError<=3,{maxInteriorError:cpuError});cpu.dispose();cpu=null;
  const clips=Array.from({length:10},(_,i)=>clip({id:`layer-${i}`,shape:'rect-ring',ringWidth:15,duration:2000,fadeMs:2000,plane:workingPlane(canvasView({...DEFAULT_VIEW,yaw:i*9,pitch:i*4})),samples:Array.from({length:121},(_,j)=>({x:1920+Math.sin(j/8+i)*250,y:1080+Math.cos(j/10+i)*100,size:1600,width:1600,height:1600,shape:'rect-ring',angle:i%2?45:0,t:j*FRAME_MS}))}));
  gpu.setProject(project(clips));gpu.draw(0,300);gpu.finish();const times=[];
  for(let i=0;i<24;i++){await next();const begin=performance.now();gpu.draw(0,300+i*FRAME_MS);gpu.finish();times.push(performance.now()-begin);}
  report.performance={layers:10,size:1600,shutterMs:FRAME_MS,meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:times.toSorted((a,b)=>a-b)[22],stats:{...gpu.stats}};
  check('Ten moving 3D layers do not create saved masks or upload CPU pixels',gpu.stats.masksCreated===0&&gpu.stats.cpuPixelUploads===0);
  // Keep the final visual comparison large enough to see directional blur.
  const showcase=clip({color:'#ff8b3d',samples:source.samples.map(p=>({...p,size:140}))});draw(gpu,{...showcase,effects:{...DEFAULT_EFFECTS,motionBlurAmount:200}},80);draw(sharp,{...showcase,effects:{...DEFAULT_EFFECTS,motionBlur:false}},80);
  report.passed=true;
 }catch(error){report.passed=false;report.error=String(error.stack??error);}finally{gpu?.dispose();sharp?.dispose();cpu?.dispose();}
 result.textContent=JSON.stringify(report,null,2);result.dataset.complete='true';run.disabled=false;
};
