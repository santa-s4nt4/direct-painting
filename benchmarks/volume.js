import { VolumePaintingRenderer } from '../src/render/volume.js';
import { CPUVolumeRenderer } from '../src/render/volume-cpu.js';
import { DEFAULT_VIEW,canvasView } from '../src/view.js';
import { workingPlane,pointInSpace,projectSpace,BOX_SPEC } from '../src/space.js';
import { CANVAS_WIDTH as W,CANVAS_HEIGHT as H } from '../src/canvas.js';
import { DEFAULT_SETTINGS } from '../src/project.js';
const result=document.querySelector('#result'),run=document.querySelector('#run');
const marker=(extra={})=>({id:'ring',mode:'move',shape:'ring',color:'#ff784f',targets:[0],enabled:true,opacity:1,ringWidth:7,effects:{blur:false,blurRadius:16},plane:workingPlane(DEFAULT_VIEW),duration:100,start:0,fadeMs:200,samples:[{x:W/2+200,y:H/2,size:30,pressure:0,t:0},{x:W/2+200,y:H/2,size:200,pressure:1,t:100}],...extra});
const project=clips=>({version:1,duration:10000,space:BOX_SPEC,clips});
const pixel=(data,x,y)=>[...data.slice(((1079-y)*1920+x)*4,((1079-y)*1920+x)*4+4)];
const nextFrame=()=>new Promise(r=>requestAnimationFrame(r));
run.onclick=async()=>{
 run.disabled=true;delete result.dataset.complete;const report={date:new Date().toISOString(),userAgent:navigator.userAgent,space:BOX_SPEC,checks:[]};let gpu,cpu;
 const check=(name,passed,extra={})=>{report.checks.push({name,passed,...extra});if(!passed)throw new Error(name);};
 try{
  gpu=new VolumePaintingRenderer(document.querySelector('#gpu'));gpu.setView(DEFAULT_VIEW);
  check('Volume composition uses Full HD targets; live Move never allocates a 4K mask',gpu.accumulator.width===1920&&gpu.effectSource.width===1920&&gpu.liveTarget.width===1);
  check('Rectangle defaults are 1600 x 1600',DEFAULT_SETTINGS.widthMax===1600&&DEFAULT_SETTINGS.heightMax===1600);
  const m=marker(),p={...m.samples.at(-1),t:0};
  const line={id:'line',mode:'line',color:m.color,targets:[0],enabled:true,duration:0,start:0,fadeMs:200,ringWidth:5,effects:m.effects,samples:[p],points3D:[pointInSpace(p,m.plane)],lineMarkers:[m],linePending:true,lineIncomplete:true};
  let worst=0,startRadius=0;
  const ringRadius=data=>{let radius=0;for(let dx=-130;dx<=130;dx++)if(pixel(data,1160+dx,540)[0]>0)radius=Math.max(radius,Math.abs(dx));return radius;};
  for(const phase of [0,120,400]){
   gpu.setProject(project([line]));gpu.draw(0,phase);const actual=gpu.readPixels();gpu.setProject(project([m]));gpu.draw(0,phase);const expected=gpu.readPixels();
   for(let i=0;i<actual.length;i++)worst=Math.max(worst,Math.abs(actual[i]-expected[i]));
   if(phase===0){startRadius=ringRadius(actual);check('Pressure Ring starts at the recorded small size with an empty center',pixel(actual,1160,540)[0]===0&&pixel(actual,1173,540)[0]>0&&pixel(actual,1200,540)[0]===0);}
   if(phase===120)check('Pressure Ring expands with the same recorded pressure as Move',ringRadius(actual)>startRadius+10);
   if(phase===400)check('Initial line Ring disappears after its inherited release fade',actual.every((v,i)=>i%4===3||v===0));
  }
  check('Line previews exactly match the Circle Ring Move tool across pressure and fade',worst===0,{maxChannelError:worst});
  const probes=[];
  for(const pose of [{},{yaw:90},{yaw:180},{yaw:137,pitch:-80,rotation:35}]){
   const view=canvasView({...DEFAULT_VIEW,...pose}),plane=workingPlane(view),point={x:W/2+220,y:H/2+120,size:80,t:0};
   const c=marker({id:'facing',shape:'circle',plane,samples:[point,{...point,t:100}]});gpu.setView(view);gpu.setProject(project([c]));gpu.draw(0,0);
   const expected=projectSpace(pointInSpace(point,plane),view),color=pixel(gpu.readPixels(),Math.floor(expected.x),Math.floor(expected.y));
   check(`Drawing faces the screen at yaw ${pose.yaw??0}, pitch ${pose.pitch??0}`,color[0]>200,{expected,world:pointInSpace(point,plane)});probes.push({view,c,expected});
  }
  const sideways=probes[1];gpu.setView(DEFAULT_VIEW);gpu.setProject(project([sideways.c]));gpu.draw(0,0);
  check('A stroke retains depth instead of being flattened onto the original canvas',pixel(gpu.readPixels(),1180,660)[0]===0&&Math.abs(pointInSpace(sideways.c.samples[0],sideways.c.plane)[2])>200);
  const a=[-300,-50,0],b=[0,300,300],cross={...line,id:'cross',linePending:false,lineIncomplete:false,lineMarkers:[],samples:[p,p],points3D:[a,b],ringWidth:10};
  gpu.setView(DEFAULT_VIEW);gpu.setProject(project([cross]));gpu.draw(0,0);const mid=projectSpace(a.map((v,i)=>(v+b[i])/2),DEFAULT_VIEW);
  check('A completed line connects endpoints in different drawing planes',pixel(gpu.readPixels(),Math.floor(mid.x),Math.floor(mid.y))[0]>200);
  gpu.setProject(project([{...cross,id:'depth-line',points3D:[[0,0,0],[0,0,300]]}]));gpu.draw(0,0);check('A view-aligned 3D line retains a visible round end cap',pixel(gpu.readPixels(),960,540)[0]>200);
  cpu=new CPUVolumeRenderer(document.querySelector('#cpu'));cpu.setView(sideways.view);cpu.setProject(project([sideways.c]));cpu.draw(0,0);
  check('CPU fallback also renders a new front-facing plane after a 90-degree orbit',cpu.ctx.getImageData(Math.floor(sideways.expected.x),Math.floor(sideways.expected.y),1,1).data[0]>200);cpu.dispose();cpu=null;
  const clips=Array.from({length:10},(_,i)=>marker({id:`layer-${i}`,duration:1000,fadeMs:5000,shape:'rect-ring',plane:workingPlane(canvasView({...DEFAULT_VIEW,yaw:i*13,pitch:i*7})),ringWidth:18,effects:{blur:true,blurRadius:16},samples:[{x:W/2+(i-5)*35,y:H/2,size:1600,shape:'rect-ring',width:1600,height:1600,angle:i%2?45:0,t:0}]}));
  result.textContent='Measuring 10 spatial layers…';await nextFrame();gpu.setView(DEFAULT_VIEW);gpu.setProject(project(clips));gpu.draw(0,0);gpu.finish();const times=[];
  for(let i=0;i<24;i++){await nextFrame();const start=performance.now();gpu.draw(0,i*1000/60);gpu.finish();times.push(performance.now()-start);}
  report.performance={layers:10,size:1600,blur:16,meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:times.toSorted((a,b)=>a-b)[22],stats:{...gpu.stats}};
  check('Ten spatial Move layers reuse analytic geometry without allocating saved masks',gpu.stats.masksCreated===0&&gpu.stats.cpuPixelUploads===0);
  report.passed=true;
 }catch(e){report.passed=false;report.error=String(e.stack??e);}finally{gpu?.dispose();cpu?.dispose();}
 result.textContent=JSON.stringify(report,null,2);result.dataset.complete='true';run.disabled=false;
};
