import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { setupCameraControls } from '../src/camera-controls.js';
import { setupOrientationCube } from '../src/orientation-cube.js';
import { cameraConfig,DEFAULT_CAMERA } from '../src/camera-motion.js';
import { DEFAULT_VIEW } from '../src/view.js';
import { createLoopRelay } from '../server/loop-relay.js';
import { createServer } from 'node:http';
import { readFile,writeFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function dom(){
 const window=new Window({url:'http://localhost/'}),old=new Map();
 for(const [key,value] of Object.entries({window,document:window.document,Option:function(text,value){const option=window.document.createElement('option');option.textContent=text;option.value=value;return option;},matchMedia:window.matchMedia.bind(window)})){old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 window.Element.prototype.setPointerCapture=function(id){this._pointer=id;};window.Element.prototype.hasPointerCapture=function(id){return this._pointer===id;};window.Element.prototype.releasePointerCapture=function(){this._pointer=null;};
 return {window,restore:async()=>{await window.happyDOM.abort();for(const [key,value] of old){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}}};
}
test('camera controls offer only normal and MIDI auto, select received notes and edit ADSR',async()=>{
 const env=dom(),d=env.window.document;d.body.innerHTML='<div id="midi"></div><div id="bottom"></div><div id="effects"></div>';let config=cameraConfig();
 try{
  const ui=setupCameraControls({midi:d.querySelector('#midi'),bottom:d.querySelector('#bottom'),effects:d.querySelector('#effects'),getCamera:()=>config,onChange:value=>{config=cameraConfig(value);}});ui.sync();ui.setReceived([60,64]);
  assert.deepEqual(['attack','decay','sustain','release'].map(key=>d.querySelector(`#camera-${key}`).value),['0.2','0','0','0.2']);
  const select=d.querySelector('#camera-note');assert.deepEqual([...select.options].map(o=>o.value),['24','60','64']);select.value='60';select.dispatchEvent(new env.window.Event('change'));assert.equal(config.note,60);
  const enabled=d.querySelector('#camera-midi-enabled');enabled.checked=true;enabled.dispatchEvent(new env.window.Event('change'));ui.sync();assert.equal(config.mode,'midi-auto');
  for(const [key,value,expected] of [['attack','0.8',800],['decay','0.2',200],['sustain','75',.75],['release','1.2',1200]]){const input=d.querySelector(`#camera-${key}`);input.value=value;input.dispatchEvent(new env.window.Event('input'));assert.equal(config[key],expected);}
  assert.deepEqual([...d.querySelectorAll('[data-camera-mode]')].map(b=>b.dataset.cameraMode),['normal','midi-auto']);ui.setReceived([60]);assert.match(d.querySelector('#camera-mode-status').textContent,/MIDI 60/);
  const blur=d.querySelector('#camera-motion-blur');blur.checked=false;blur.dispatchEvent(new env.window.Event('change'));ui.sync();assert.equal(d.querySelector('#camera-blur-amount').disabled,true);
 }finally{await env.restore();}
});
test('MIDI auto locks cube pointer, keyboard and Front controls; normal restores interaction',async()=>{
 const env=dom(),d=env.window.document;let view=DEFAULT_VIEW,starts=0,finishes=0;
 try{
  const cube=setupOrientationCube(d.body,{getView:()=>view,onChange:value=>view=value,onStart:()=>starts++,onFinish:()=>finishes++}),svg=d.querySelector('svg');
  cube.setDisabled(true);svg.dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'ArrowRight'}));svg.dispatchEvent(new env.window.PointerEvent('pointerdown',{pointerId:1,button:0,clientX:0,clientY:0}));d.querySelector('button').click();assert.equal(starts,0);assert.equal(svg.tabIndex,-1);
  cube.setDisabled(false);svg.dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'ArrowRight'}));assert.equal(view.yaw,5);assert.equal(starts,1);assert.equal(finishes,1);
  svg.dispatchEvent(new env.window.PointerEvent('pointerdown',{pointerId:2,button:0,clientX:0,clientY:0}));svg.dispatchEvent(new env.window.PointerEvent('pointermove',{pointerId:2,clientX:20,clientY:10}));assert.equal(starts,2);cube.setDisabled(true);assert.equal(finishes,2);assert.equal(svg.hasPointerCapture(2),false);
 }finally{await env.restore();}
});
test('editor timeline stays responsive and Pencil drawing continues during independent cube touch gestures',async()=>{
 const env=dom(),d=env.window.document;d.body.innerHTML='<div id="app"></div>';const folder=await mkdtemp(join(tmpdir(),'direct-camera-ui-')),relay=await createLoopRelay(join(folder,'loop.json'));
 const server=createServer((req,res)=>relay(req,res,()=>{res.writeHead(404);res.end();}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,nativeFetch=globalThis.fetch,streams=[];let raf=null,saved,renderer,failDraw=false;
 const old={fetch:globalThis.fetch,EventSource:globalThis.EventSource,requestAnimationFrame:globalThis.requestAnimationFrame,ResizeObserver:globalThis.ResizeObserver,mocks:globalThis.__cameraTestMocks};
 const state=async()=>(await(await nativeFetch(base+'/api/loop')).json());const camera=async()=>(await(await nativeFetch(base+'/api/camera')).json());
 const until=async predicate=>{for(let i=0;i<100;i++){const value=await predicate();if(value)return value;await sleep(15);}throw new Error('UI update timed out');};
 class Events {constructor(){this.listeners=new Map();streams.push(this);}addEventListener(name,fn){const list=this.listeners.get(name)??[];list.push(fn);this.listeners.set(name,list);}emit(name,data){for(const fn of this.listeners.get(name)??[])fn({data:JSON.stringify(data)});}close(){this.listeners.clear();}}
 try{
  globalThis.fetch=async(input,options)=>{
   if(input==='/api/midi'){const data=await state();return new Response(JSON.stringify({available:true,starting:false,devices:[],selected:'',connected:false,note:24,receivedNotes:[24,60],camera:data.camera,transport:data.transport,playback:data.state?.playback,serverNow:data.serverNow}),{headers:{'Content-Type':'application/json'}});}
   return nativeFetch(new URL(String(input),base),options);
  };
  globalThis.EventSource=Events;globalThis.requestAnimationFrame=fn=>{raf=fn;return 1;};globalThis.ResizeObserver=class{observe(){}disconnect(){}};
  globalThis.__cameraTestMocks={
   setupColorPanel:()=>({setColor(){},setVisible(){},open(){}}),loadProject:async()=>({version:1,duration:16000,clips:[{id:'moving',mode:'move',shape:'circle',color:'#ffffff',enabled:true,targets:[0],duration:15000,fadeMs:1000,samples:[{x:1920,y:1080,size:100,t:0},{x:2200,y:1200,size:100,t:15000}]}],settings:{camera:{...DEFAULT_CAMERA,mode:'rec',track:{id:'old',samples:[{t:0,view:DEFAULT_VIEW}]}}}}),saveProject:async value=>{saved=structuredClone(value);},
   createPaintingRenderer:canvas=>(renderer={canvas,items:[],setProject(p){this.items=p.clips.map(clip=>({clip}));},setView(view){this.view=view;},setLiveStroke(stroke){this.live=stroke;},draw(_side,phase,options){if(failDraw)throw new Error('test drawing backend failure');this.lastPhase=phase;this.lastDraw=options;}}),
  };
  let source=await readFile(resolve('src/main.js'),'utf8');source=source.replace(/^import '\.\/style\.css';\n/m,'').replace(/^import \{ ([^}]+) \} from '\.\/(?:render\/index|cache|color-panel)\.js';$/gm,(_line,names)=>`const { ${names} }=globalThis.__cameraTestMocks;`).replace(/from '(\.\/[^']+)'/g,(_all,path)=>`from '${pathToFileURL(resolve('src',path))}'`);
  const entry=join(folder,'editor.mjs');await writeFile(entry,'const setTimeout=window.setTimeout.bind(window),clearTimeout=window.clearTimeout.bind(window);\n'+source);await import(pathToFileURL(entry).href);
  await until(async()=>!!(await state()).state);await until(()=>d.querySelector('.sidebar-scroll')?.inert===false);
  const tick=now=>{const callback=raf;raf=null;assert.ok(callback,'The next frame is scheduled');callback(now);};
  const progress=d.querySelector('#loop-progress'),phase=()=>Number(progress.value);
  assert.equal(d.querySelector('[data-camera-mode="rec"]'),null);assert.equal(d.querySelector('[data-camera-mode="normal"]').getAttribute('aria-pressed'),'true');
  const start=performance.now()+50,cubeFace=d.querySelector('.orientation-cube polygon'),boxEdge=d.querySelector('.painting-boundary line');
  tick(start);let previous=phase();
  for(let i=1;i<=60;i++){tick(start+i*1000/60);const current=phase();assert.ok(current>previous&&current-previous<=18,'Playback advances each 60Hz frame');previous=current;}
  assert.equal(d.querySelector('.orientation-cube polygon'),cubeFace,'A still camera does not rebuild cube SVG each painting frame');assert.equal(d.querySelector('.painting-boundary line'),boxEdge);assert.ok(renderer.lastPhase>900);
  failDraw=true;assert.throws(()=>tick(start+1100),/drawing backend failure/);assert.ok(raf,'A renderer exception cannot cancel future timeline frames');const failedPhase=phase();failDraw=false;tick(start+1200);assert.ok(phase()>failedPhase);
  assert.equal(d.querySelector('#play'),null,'Pause button is removed');assert.ok(d.querySelector('.orientation-details .camera-mode-controls'));assert.ok(d.querySelector('.orientation-details > .orientation-front [aria-label="Front view"]'));
  progress.value='4200';progress.dispatchEvent(new env.window.Event('input'));assert.equal(phase(),4200);tick(performance.now()+100);const resumed=phase();assert.ok(resumed>=4300&&resumed<4400);
  progress.dispatchEvent(new env.window.PointerEvent('pointerdown',{pointerId:301,button:0}));progress.value='5000';progress.dispatchEvent(new env.window.Event('input'));tick(performance.now()+100);assert.equal(progress.value,'5000','Playback does not fight the seek handle while held');progress.dispatchEvent(new env.window.PointerEvent('pointerup',{pointerId:301}));tick(performance.now()+150);assert.ok(phase()>5100,'Playback keeps running after seeking');
  d.querySelector('[data-camera-mode="midi-auto"]').click();assert.equal(d.querySelector('.orientation-cube').getAttribute('aria-disabled'),'true');await until(async()=>(await camera()).config.mode==='midi-auto');
  const previousCamera=await camera(),note=d.querySelector('#camera-note');note.value='60';note.dispatchEvent(new env.window.Event('change'));for(const stream of streams)stream.emit('camera',previousCamera);
  await until(async()=>(await camera()).config.note===60);assert.equal(d.querySelector('#camera-note').value,'60');
  relay.receiveCameraNote({type:'on',note:60,channel:1,at:Date.now()});for(const stream of streams)stream.emit('camera',await camera());
  const autoStart=performance.now()+200;tick(autoStart);previous=phase();for(let i=1;i<=20;i++){tick(autoStart+i*1000/60);assert.ok(phase()>previous);previous=phase();}
  relay.restartFromMidi(Date.now());const restarted=await state();for(const stream of streams)stream.emit('transport',restarted);tick(performance.now()+50);assert.ok(phase()<200,'MIDI 24 restarts playback at zero');assert.ok(raf,'MIDI starts continuous playback without a pause toggle');
  const enabled=d.querySelector('#camera-midi-enabled');enabled.checked=false;enabled.dispatchEvent(new env.window.Event('change'));await until(async()=>(await camera()).config.mode==='normal');assert.equal(d.querySelector('.orientation-cube').getAttribute('aria-disabled'),'false');
  const transportBefore=(await state()).transport,svg=d.querySelector('.orientation-cube');svg.dispatchEvent(new env.window.PointerEvent('pointerdown',{pointerId:1,button:0,clientX:10,clientY:10}));svg.dispatchEvent(new env.window.PointerEvent('pointermove',{pointerId:1,clientX:60,clientY:20}));tick(performance.now()+100);svg.dispatchEvent(new env.window.PointerEvent('pointerup',{pointerId:1}));
  const canvas=d.querySelector('#canvas-0');canvas.getBoundingClientRect=()=>({left:0,top:0,width:1920,height:1080});
  const shape=d.querySelector('#shape');shape.value='ring';shape.dispatchEvent(new env.window.Event('change'));assert.equal(d.querySelector('#ring-width').value,'20');
  const pointer=(target,type,id,pointerType,x=960,y=540,pressure=.5)=>target.dispatchEvent(new env.window.PointerEvent(type,{pointerId:id,pointerType,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,pressure,bubbles:true,cancelable:true}));
  pointer(canvas,'pointerdown',101,'pen');const live=renderer.live,plane=structuredClone(live.plane);assert.ok(canvas.hasPointerCapture(101));assert.equal(live.ringWidth,20);
  pointer(svg,'pointerdown',202,'touch',10,10);assert.equal(renderer.live,live,'Touching the cube does not finish the Pencil stroke');assert.ok(svg.hasPointerCapture(202));
  pointer(svg,'pointermove',202,'touch',30,15);pointer(canvas,'pointermove',101,'pen',985,550,.8);assert.equal(renderer.live.id,live.id);assert.ok(live.samples.length>=2);assert.deepEqual(live.plane,plane,'The active drawing plane remains stable while the camera turns');
  pointer(svg,'pointerup',202,'touch',30,15);assert.ok(canvas.hasPointerCapture(101),'Lifting the finger preserves Pencil capture');assert.equal(renderer.live,live);
  pointer(canvas,'pointermove',101,'pen',1000,560,.3);pointer(canvas,'pointerup',101,'pen',1000,560,.3);assert.equal(renderer.live,null);assert.equal(canvas.hasPointerCapture(101),false);
  await until(()=>saved?.clips.length===2);assert.equal(saved.clips.at(-1).id,live.id);assert.ok(saved.clips.at(-1).samples.length>=3);assert.ok(saved.clips.at(-1).samples.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));assert.deepEqual(saved.clips.at(-1).plane,plane);assert.equal(saved.clips.at(-1).ringWidth,20);
  await until(async()=>(await state()).state.project.clips.length===2);
  pointer(svg,'pointerdown',203,'touch',10,10);pointer(canvas,'pointerdown',102,'pen');const secondLive=renderer.live;assert.ok(secondLive);
  pointer(canvas,'pointermove',102,'pen',990,550,.6);pointer(canvas,'pointerup',102,'pen',990,550,.6);assert.ok(svg.hasPointerCapture(203),'Lifting the Pencil preserves cube capture');
  const yaw=renderer.view.yaw??0;pointer(svg,'pointermove',203,'touch',40,15);assert.notEqual(renderer.view.yaw??0,yaw,'Cube rotation continues after the Pencil lifts');pointer(svg,'pointerup',203,'touch',40,15);
  await until(()=>saved?.clips.length===3);assert.equal(saved.clips.at(-1).id,secondLive.id);
  await until(()=>saved?.settings.camera.mode==='normal');assert.equal('track' in saved.settings.camera,false);assert.equal(saved.clips.length,3);assert.equal(saved.duration,16000);assert.deepEqual((await state()).transport,transportBefore,'Moving the cube never resets transport');
 }finally{
  env.window.dispatchEvent(new env.window.Event('pagehide'));await sleep(250);globalThis.fetch=nativeFetch;globalThis.EventSource=old.EventSource;globalThis.requestAnimationFrame=old.requestAnimationFrame;globalThis.ResizeObserver=old.ResizeObserver;globalThis.__cameraTestMocks=old.mocks;
  await relay.dispose();await new Promise(r=>server.close(r));await env.restore();await rm(folder,{recursive:true});
 }
});
