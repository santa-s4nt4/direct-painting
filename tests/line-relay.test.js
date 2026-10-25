import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLoopRelay } from '../server/loop-relay.js';

test('relay reveals a completed line next loop without an editor, rejects stale gates and pauses unfinished lines', async () => {
  const folder=await mkdtemp(join(tmpdir(),'direct-line-')),file=join(folder,'loop.json'),handler=await createLoopRelay(file);
  const server=createServer((req,res)=>handler(req,res,()=>{res.writeHead(404);res.end();}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const line={id:'line',mode:'line',color:'#ffffff',targets:[0],enabled:true,duration:0,start:20,fadeMs:100,ringWidth:5,linePending:true,lineIncomplete:false,samples:[{x:100,y:100,size:64,t:0},{x:200,y:100,size:64,t:0}]};
  const snapshot={project:{version:1,duration:200,clips:[line]},playback:{playing:true,phase:40}};
  const post=async value=>assert.equal((await fetch(base+'/api/loop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})).status,200);
  const state=async()=>(await(await fetch(base+'/api/loop')).json()).state;
  const waitUntil=async predicate=>{for(let i=0;i<100;i++){const s=await state();if(predicate(s))return s;await new Promise(r=>setTimeout(r,10));}assert.fail('Line gate did not release');};
  try {
    await post(snapshot); assert.equal((await state()).project.clips[0].linePending,true);
    await waitUntil(s=>!s.project.clips[0].linePending);
    await post(snapshot); assert.equal((await state()).project.clips[0].linePending,false,'Late pending packet must not reopen the gate');
    await post({...snapshot,project:{...snapshot.project,clips:[{...line,linePending:false}]}});
    await post({...snapshot,playback:{playing:false,phase:40}});
    await new Promise(r=>setTimeout(r,230));assert.equal((await state()).project.clips[0].linePending,true,'Pause holds the first cycle');
    await post(snapshot);await waitUntil(s=>!s.project.clips[0].linePending);
    // Wait for the queued atomic disk write, not merely the in-memory event.
    for(let i=0;i<50;i++){if(!JSON.parse(await readFile(file,'utf8')).project.clips[0].linePending)break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(JSON.parse(await readFile(file,'utf8')).project.clips[0].linePending,false);
    await post({...snapshot,project:{...snapshot.project,clips:[{...line,id:'draft',lineIncomplete:true,samples:[line.samples[0]]}]}});
    await new Promise(r=>setTimeout(r,230));assert.equal((await state()).project.clips[0].linePending,true);
  } finally {handler.dispose();await new Promise(r=>server.close(r));await rm(folder,{recursive:true});}
});
