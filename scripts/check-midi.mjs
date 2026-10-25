import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createLoopRelay } from '../server/loop-relay.js';

if (process.platform !== 'darwin') throw new Error('This integration check uses macOS CoreMIDI.');
const folder=await mkdtemp(join(tmpdir(),'direct-midi-check-'));
let source,relay,server;
const report={date:new Date().toISOString(),backend:'CoreMIDI',checks:[]};
const until=async read=>{for(let i=0;i<200;i++){const value=await read();if(value)return value;await new Promise(r=>setTimeout(r,25));}throw new Error('Timed out waiting for CoreMIDI');};
try {
 const compiler=spawn('/usr/bin/swiftc',['scripts/midi-test-source.swift','-o',join(folder,'source')],{stdio:'inherit'});assert.equal((await once(compiler,'exit'))[0],0);
 source=spawn(join(folder,'source'),[],{stdio:['pipe','pipe','inherit']});
 const lines=createInterface({input:source.stdout}), id=await new Promise(resolve=>lines.once('line',resolve));
 relay=await createLoopRelay(join(folder,'loop.json'),{midi:true});
 server=createServer((req,res)=>relay(req,res,()=>{res.writeHead(404);res.end();}));server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 const get=async path=>(await(await fetch(base+path)).json());
 const post=async(path,value)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});assert.equal(r.status,200);return r.json();};
 await until(async()=>{const s=await get('/api/midi');if(s.error)throw new Error(s.error);return s.devices.some(d=>d.id===id);});
 await post('/api/loop',{project:{version:1,duration:1000,clips:[]},playback:{playing:false,phase:9000}});
 await post('/api/midi',{selected:id,note:24});await until(async()=>(await get('/api/midi')).connected);
 source.stdin.write('144 24 100\n');await until(async()=>(await get('/api/midi')).triggers===1);
 let snapshot=await get('/api/loop');assert.equal(snapshot.state.playback.playing,true);assert.equal(snapshot.state.playback.phase,0);assert.equal(snapshot.state.project.duration,16000);assert.ok(Date.now()-snapshot.state.playback.anchor<500);
 report.checks.push('A real CoreMIDI virtual source triggers Note 24 and starts the fixed 16-second timeline');
 await post('/api/loop',{project:snapshot.state.project,playback:{playing:false,phase:9000},transportState:snapshot.transport});
 source.stdin.write('144 25 100 24 0 128 24 100\n');await new Promise(r=>setTimeout(r,150));assert.equal((await get('/api/midi')).triggers,1);assert.equal((await get('/api/loop')).state.playback.playing,false);
 report.checks.push('Other notes, velocity-zero Note On and Note Off keep paused playback unchanged');
 await post('/api/midi',{selected:id,note:36});source.stdin.write('159 36 110\n');await until(async()=>(await get('/api/midi')).triggers===2);
 snapshot=await get('/api/loop');assert.equal(snapshot.state.playback.playing,true);assert.equal(snapshot.transport.revision,2);
 report.checks.push('C1 note-number 36 and MIDI channel 16 retrigger from the beginning');
 const before=(await get('/api/midi')).triggers;source.stdin.end();await once(source,'exit');await until(async()=>!(await get('/api/midi')).connected);assert.equal((await get('/api/midi')).triggers,before);
 report.checks.push('Removing the selected source disconnects input without retriggering');
 report.passed=true;
 if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{
 source?.kill();relay?.dispose();if(server)await new Promise(r=>server.close(r));await rm(folder,{recursive:true});
}
