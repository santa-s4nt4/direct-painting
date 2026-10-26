import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLoopRelay } from '../server/loop-relay.js';
import { DEFAULT_CAMERA,cameraPose } from '../src/camera-motion.js';
import { DEFAULT_VIEW } from '../src/view.js';
test('host camera controls share MIDI ADSR, timeline independence and stale snapshot protection',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'direct-camera-')),file=join(dir,'loop.json'),relay=await createLoopRelay(file);
 const server=createServer((req,res)=>relay(req,res,()=>{res.writeHead(404);res.end();}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const get=async path=>(await(await fetch(base+path)).json());
 const post=async(path,data)=>{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});assert.equal(response.status,200,await response.clone().text());return response.json();};let revision=0;
 const command=data=>post('/api/camera',{session:'editor',revision:++revision,...data});
 const original={project:{version:1,clips:[],duration:16000,settings:{view:DEFAULT_VIEW,camera:DEFAULT_CAMERA}},playback:{playing:false,phase:4000}};
 try{
  await post('/api/loop',original);
  const auto=await command({kind:'settings',camera:{...DEFAULT_CAMERA,mode:'midi-auto',note:60}});assert.equal(auto.config.note,60);
  relay.receiveCameraNote({type:'on',note:59,channel:1,at:Date.now()});assert.equal((await get('/api/camera')).event,null);
  const at=Date.now();relay.receiveCameraNote({type:'on',note:60,channel:1,at});const triggered=await get('/api/camera');assert.equal(triggered.event.at,at);assert.equal(triggered.event.key,'1:60');
  const output=await get('/api/loop');assert.deepEqual(output.camera.event,triggered.event);assert.equal(output.state.playback.playing,false,'Camera notes do not restart the timeline');
  await post('/api/loop',original);assert.equal((await get('/api/camera')).config.mode,'midi-auto','Stale painting snapshots cannot disable automation');
  relay.receiveCameraNote({type:'off',note:60,channel:2,at:at+100});assert.equal((await get('/api/camera')).event.releaseAt,null);
  relay.receiveCameraNote({type:'off',note:60,channel:1,at:at+100});const released=await get('/api/camera');assert.equal(released.event.releaseAt,at+100);assert.ok(Number.isFinite((cameraPose(released,released.baseView,0,at+1000).distance??5000)));
  const before=(await get('/api/loop')).state.playback;
  await command({kind:'settings',camera:{...released.config,mode:'normal',blur:false}});
  assert.deepEqual((await get('/api/loop')).state.playback,before,'Changing camera modes does not stop or restart the timeline');
  const retired=await fetch(base+'/api/camera',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:'editor',revision:++revision,kind:'record-start',takeId:'retired',view:DEFAULT_VIEW})});assert.equal(retired.status,400);
  await post('/api/view',{session:'editor',revision:1,takeId:'retired',view:{...DEFAULT_VIEW,yaw:90}});assert.notEqual((await get('/api/camera')).baseView.yaw,90,'Late recording packets cannot move the camera');
  relay.restartFromMidi(Date.now());const restarted=await get('/api/loop');assert.equal(restarted.state.playback.phase,0);assert.equal(restarted.state.playback.playing,true);assert.equal(restarted.state.project.duration,16000);assert.equal('recording' in restarted.camera,false);assert.equal('track' in restarted.camera.config,false);
  assert.equal(JSON.parse(await readFile(file,'utf8')).project.settings.camera.mode,'normal');
 }finally{await relay.dispose();await new Promise(r=>server.close(r));await rm(dir,{recursive:true});}
});
