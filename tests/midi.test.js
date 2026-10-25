import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MidiDecoder, isRestartNote, RESTART_NOTE, LOOP_MS, BPM, BEATS_PER_BAR, BARS } from '../src/transport.js';
import { FixedLoopClock } from '../src/loop.js';
import { normalizeProject } from '../src/project.js';
import { createMidiInput } from '../server/midi.js';
import { createLoopRelay } from '../server/loop-relay.js';

test('120 BPM, 4/4, eight bars stays fixed at 16s through resize, import and long fades', () => {
 assert.equal(LOOP_MS, 60000/BPM*BEATS_PER_BAR*BARS); assert.equal(LOOP_MS,16000);
 const clock=new FixedLoopClock(0);clock.seek(15500,0);clock.resize(90000,100);assert.equal(clock.duration,16000);assert.equal(clock.phase(600),100);
 const clip={id:'long',mode:'move',color:'#ffffff',targets:[0],enabled:true,start:0,duration:20000,fadeMs:10000,samples:[{x:1920,y:1080,size:20,t:0},{x:1920,y:1080,size:20,t:20000}]};
 for(const duration of [200,10000,60000])assert.equal(normalizeProject({version:1,duration,clips:[clip]}).duration,16000);
});
test('MIDI parser restarts only on note 24 across packets, running status, realtime bytes and channels', () => {
 const messages=[], decoder=new MidiDecoder(m=>messages.push(m));
 decoder.push([0x93,24]);decoder.push([0xf8,127,24,0,12,100,0x83,24,127,0xc0,5,0xf0,1,24,100,0xf8,0xf7,0x90,24,100]);
 assert.deepEqual(messages,[[0x93,24,127],[0x93,24,0],[0x93,12,100],[0x83,24,127],[0xc0,5],[0x90,24,100]]);
 assert.equal(RESTART_NOTE,24);assert.equal(messages.filter(m=>isRestartNote(m)).length,2);assert.equal(isRestartNote([0x9f,24,1]),true);
 for(const message of [[0x90,24,0],[0x80,24,100],[0x90,12,100],[0x90,36,100]])assert.equal(isRestartNote(message),false);
 decoder.push([0x90,24]);decoder.reset();decoder.push([127]);assert.equal(messages.length,6);
});
test('MIDI device selection persists and legacy note 12/36 preferences migrate to fixed note 24', async () => {
 const folder=await mkdtemp(join(tmpdir(),'direct-midi-')),file=join(folder,'midi.json');let count=0;
 const input=await createMidiInput({configFile:file,autoStart:false,onRestart:()=>count++});
 try {
  input.receive({type:'devices',devices:[{id:'a',name:'Interface A'},{id:'b',name:'Interface B'}],selected:'',connected:false});
  await input.configure({selected:'a'}); input.receive({type:'devices',devices:[{id:'a',name:'Interface A'}],selected:'a',connected:true});
  input.receive({type:'data',id:'b',bytes:[0x90,24,100]});input.receive({type:'data',id:'a',bytes:[0x90,12,100,36,100,24,0,24,100]});assert.equal(count,1);
  input.receive({type:'data',id:'a',bytes:[0x91,24,110]});assert.equal(count,2);
  input.receive({type:'devices',devices:[],selected:'a',connected:false});input.receive({type:'data',id:'a',bytes:[0x90,24,100]});assert.equal(count,2);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{selected:'a',note:24});
  for(const legacyNote of [12,36]){
   await writeFile(file,JSON.stringify({selected:'a',note:legacyNote}));
   const restored=await createMidiInput({configFile:file,autoStart:false});assert.equal(restored.snapshot().selected,'a');assert.equal(restored.snapshot().note,24);restored.dispose();
  }
  await assert.rejects(input.configure({selected:'missing',note:24}));
  for(const note of [12,36,60])await assert.rejects(input.configure({selected:'a',note}));
 }finally{input.dispose();await rm(folder,{recursive:true});}
});
test('MIDI restart plays from zero, releases completed lines, rejects stale transport snapshots and retriggers', async () => {
 const folder=await mkdtemp(join(tmpdir(),'direct-midi-relay-')),handler=await createLoopRelay(join(folder,'loop.json'));
 const server=createServer((req,res)=>handler(req,res,()=>res.end()));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/loop`;
 const post=async value=>(await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})).json();
 const get=async()=>(await(await fetch(url)).json());
 const line={id:'line',mode:'line',color:'#ffffff',targets:[0],enabled:true,duration:0,start:20,fadeMs:100,ringWidth:5,linePending:true,lineIncomplete:false,samples:[{x:100,y:100,size:64,t:0},{x:200,y:100,size:64,t:0}]};
 const original={project:{version:1,duration:20000,clips:[line]},playback:{playing:false,phase:9000}};
 try {
  await post(original);const initial=await get(), now=Date.now();handler.restartFromMidi(now);
  const restarted=await get();assert.equal(restarted.state.playback.playing,true);assert.equal(restarted.state.playback.anchor,now);assert.equal(restarted.state.playback.phase,0);assert.equal(restarted.state.project.duration,16000);assert.equal(restarted.state.project.clips[0].linePending,false);
  await post({...original,transportState:initial.transport});const stale=await get();assert.equal(stale.state.playback.anchor,now);assert.equal(stale.state.playback.playing,true);assert.equal(stale.state.project.clips[0].linePending,false);
  await post({...original,transportState:restarted.transport,playback:{playing:false,phase:5000}});assert.equal((await get()).state.playback.playing,false);
  const again=Date.now()+10;handler.restartFromMidi(again);const triggered=await get();assert.equal(triggered.state.playback.anchor,again);assert.equal(triggered.transport.revision,2);
 } finally {await handler.dispose();await new Promise(r=>server.close(r));await rm(folder,{recursive:true});}
});
