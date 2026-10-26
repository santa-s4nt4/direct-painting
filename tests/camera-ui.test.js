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
test('camera controls select received notes, edit ADSR and retain the REC status while MIDI lists refresh',async()=>{
 const env=dom(),d=env.window.document;d.body.innerHTML='<div id="midi"></div><div id="bottom"></div><div id="effects"></div>';let config=cameraConfig();
 try{
  const ui=setupCameraControls({midi:d.querySelector('#midi'),bottom:d.querySelector('#bottom'),effects:d.querySelector('#effects'),getCamera:()=>config,onChange:value=>{config=cameraConfig(value);}});ui.sync();ui.setReceived([60,64]);
  const select=d.querySelector('#camera-note');assert.deepEqual([...select.options].map(o=>o.value),['24','60','64']);select.value='60';select.dispatchEvent(new env.window.Event('change'));assert.equal(config.note,60);
  const enabled=d.querySelector('#camera-midi-enabled');enabled.checked=true;enabled.dispatchEvent(new env.window.Event('change'));ui.sync();assert.equal(config.mode,'midi-auto');
  for(const [key,value,expected] of [['attack','0.8',800],['decay','0.2',200],['sustain','75',.75],['release','1.2',1200]]){const input=d.querySelector(`#camera-${key}`);input.value=value;input.dispatchEvent(new env.window.Event('input'));assert.equal(config[key],expected);}
  d.querySelector('[data-camera-mode="rec"]').click();ui.sync(true);ui.setReceived([60]);assert.equal(config.mode,'rec');assert.match(d.querySelector('#camera-record-status').textContent,/REC/);
  const blur=d.querySelector('#camera-motion-blur');blur.checked=false;blur.dispatchEvent(new env.window.Event('change'));ui.sync();assert.equal(d.querySelector('#camera-blur-amount').disabled,true);
 }finally{await env.restore();}
});
test('MIDI auto locks cube pointer, keyboard and Front controls; normal and rec restore interaction',async()=>{
 const env=dom(),d=env.window.document;let view=DEFAULT_VIEW,starts=0,finishes=0;
 try{
  const cube=setupOrientationCube(d.body,{getView:()=>view,onChange:value=>view=value,onStart:()=>starts++,onFinish:()=>finishes++}),svg=d.querySelector('svg');
  cube.setDisabled(true);svg.dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'ArrowRight'}));svg.dispatchEvent(new env.window.PointerEvent('pointerdown',{pointerId:1,button:0,clientX:0,clientY:0}));d.querySelector('button').click();assert.equal(starts,0);assert.equal(svg.tabIndex,-1);
  cube.setDisabled(false);svg.dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'ArrowRight'}));assert.equal(view.yaw,5);assert.equal(starts,1);assert.equal(finishes,1);
  svg.dispatchEvent(new env.window.PointerEvent('pointerdown',{pointerId:2,button:0,clientX:0,clientY:0}));svg.dispatchEvent(new env.window.PointerEvent('pointermove',{pointerId:2,clientX:20,clientY:10}));assert.equal(starts,2);cube.setDisabled(true);assert.equal(finishes,2);assert.equal(svg.hasPointerCapture(2),false);
 }finally{await env.restore();}
});
test('editor wiring switches modes, protects pending MIDI settings and records a replacement camera take through HTTP',async()=>{
 const env=dom(),d=env.window.document;d.body.innerHTML='<div id="app"></div>';const folder=await mkdtemp(join(tmpdir(),'direct-camera-ui-')),relay=await createLoopRelay(join(folder,'loop.json'));
 const server=createServer((req,res)=>relay(req,res,()=>{res.writeHead(404);res.end();}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,nativeFetch=globalThis.fetch,streams=[];let raf=()=>{},saved;
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
   setupColorPanel:()=>({setColor(){},setVisible(){},open(){}}),loadProject:async()=>({version:1,duration:16000,clips:[],settings:{camera:DEFAULT_CAMERA}}),saveProject:async value=>{saved=structuredClone(value);},
   createPaintingRenderer:canvas=>({canvas,items:[],setProject(p){this.items=p.clips.map(clip=>({clip}));},setView(view){this.view=view;},setLiveStroke(){},draw(_side,_phase,options){this.lastDraw=options;}}),
  };
  let source=await readFile(resolve('src/main.js'),'utf8');source=source.replace(/^import '\.\/style\.css';\n/m,'').replace(/^import \{ ([^}]+) \} from '\.\/(?:render\/index|cache|color-panel)\.js';$/gm,(_line,names)=>`const { ${names} }=globalThis.__cameraTestMocks;`).replace(/from '(\.\/[^']+)'/g,(_all,path)=>`from '${pathToFileURL(resolve('src',path))}'`);
  const entry=join(folder,'editor.mjs');await writeFile(entry,'const setTimeout=window.setTimeout.bind(window),clearTimeout=window.clearTimeout.bind(window);\n'+source);await import(pathToFileURL(entry).href);
  await until(async()=>!!(await state()).state);await until(()=>d.querySelector('.sidebar-scroll')?.inert===false);
  d.querySelector('[data-camera-mode="midi-auto"]').click();assert.equal(d.querySelector('.orientation-cube').getAttribute('aria-disabled'),'true');await until(async()=>(await camera()).config.mode==='midi-auto');
  const previous=await camera(),note=d.querySelector('#camera-note');note.value='60';note.dispatchEvent(new env.window.Event('change'));for(const stream of streams)stream.emit('camera',previous);
  await until(async()=>(await camera()).config.note===60);assert.equal(d.querySelector('#camera-note').value,'60');
  relay.receiveCameraNote({type:'on',note:60,channel:1,at:Date.now()});for(const stream of streams)stream.emit('camera',await camera());raf(performance.now()+200);
  const enabled=d.querySelector('#camera-midi-enabled');enabled.checked=false;enabled.dispatchEvent(new env.window.Event('change'));await until(async()=>(await camera()).config.mode==='normal');assert.equal(d.querySelector('.orientation-cube').getAttribute('aria-disabled'),'false');
  d.querySelector('[data-camera-mode="rec"]').click();await until(async()=>(await camera()).config.mode==='rec');const svg=d.querySelector('.orientation-cube');
  svg.dispatchEvent(new env.window.PointerEvent('pointerdown',{pointerId:1,button:0,clientX:10,clientY:10}));await until(async()=>(await camera()).recording);
  svg.dispatchEvent(new env.window.PointerEvent('pointermove',{pointerId:1,clientX:60,clientY:20}));raf(performance.now());await sleep(25);raf(performance.now());
  svg.dispatchEvent(new env.window.PointerEvent('pointerup',{pointerId:1}));await until(async()=>!(await camera()).recording);const take=await camera();assert.ok(take.config.track.samples.length>=2);assert.ok(take.config.track.samples.at(-1).view.yaw!==take.config.track.samples[0].view.yaw);
  await until(()=>saved?.settings.camera.track?.id===take.config.track.id);assert.equal(saved.duration,16000);assert.equal(saved.settings.camera.blur,true);
  svg.dispatchEvent(new env.window.PointerEvent('pointerdown',{pointerId:2,button:0,clientX:10,clientY:10}));await until(async()=>(await camera()).recording?.id!==take.config.track.id&&(await camera()).recording);const replacing=await camera();assert.equal(replacing.config.track.samples.length,1);assert.notEqual(replacing.config.track.id,take.config.track.id);
  svg.dispatchEvent(new env.window.PointerEvent('pointermove',{pointerId:2,clientX:30,clientY:15}));raf(performance.now());svg.dispatchEvent(new env.window.PointerEvent('pointerup',{pointerId:2}));await until(async()=>!(await camera()).recording);
 }finally{
  env.window.dispatchEvent(new env.window.Event('pagehide'));await sleep(250);globalThis.fetch=nativeFetch;globalThis.EventSource=old.EventSource;globalThis.requestAnimationFrame=old.requestAnimationFrame;globalThis.ResizeObserver=old.ResizeObserver;globalThis.__cameraTestMocks=old.mocks;
  await relay.dispose();await new Promise(r=>server.close(r));await env.restore();await rm(folder,{recursive:true});
 }
});
