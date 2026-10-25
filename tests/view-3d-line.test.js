import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Matrix4, Vector3 } from 'three';
import { DEFAULT_VIEW, canvasView, validateView, worldToScreen, screenToWorld, viewRotation, PinchGesture, CAMERA_DISTANCE } from '../src/view.js';
import { CANVAS_SPEC, CANVAS_WIDTH as W, CANVAS_HEIGHT as H } from '../src/canvas.js';
import { visitShape, strokePoints } from '../src/drawing.js';
import { CachedGesture, gestureVisible, validateProject } from '../src/loop.js';
import { normalizeProject, serializeProject, parseProject, singleCanvasProject } from '../src/project.js';
import { LineSchedule } from '../src/line-tool.js';
import { validateLive } from '../server/loop-relay.js';
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-7, `${a} != ${b}`);

test('perspective plane projection and input inverse match the Three.js camera through zoom, roll and tilt', () => {
  for (const pose of [{}, { rotation: 90 }, { yaw: -35, pitch: 25, rotation: -40 }, { yaw: 75, pitch: -75, rotation: 179 }]) for (const scale of [.5,1,5]) {
    const view=canvasView({...DEFAULT_VIEW,scale,...pose}); validateView(view);
    const camera=new PerspectiveCamera(2*Math.atan(1080/(2*CAMERA_DISTANCE))*180/Math.PI,1920/1080,1,20000);
    camera.position.z=CAMERA_DISTANCE;camera.zoom=scale;
    camera.setViewOffset(1920,1080,960-view.x-W*scale/2,540-view.y-H*scale/2,1920,1080);camera.updateProjectionMatrix();camera.updateMatrixWorld();
    const r=viewRotation(view), matrix=new Matrix4().set(r[0],-r[1],r[2],0,-r[3],r[4],-r[5],0,r[6],-r[7],r[8],0,0,0,0,1);
    for(const point of [{x:0,y:0},{x:W,y:H},{x:1920,y:1080},{x:2211,y:789}]) {
      const screen=worldToScreen(point,view),back=screenToWorld(screen,view),p=new Vector3(point.x-W/2,H/2-point.y,0).applyMatrix4(matrix).project(camera);
      near(screen.x,(p.x+1)*960);near(screen.y,(1-p.y)*540);near(back.x,point.x);near(back.y,point.y);
    }
  }
});
test('two-finger twist rotates around its midpoint while preserving tilted input and remaining-finger suppression', () => {
  const initial=canvasView({...DEFAULT_VIEW,pitch:20,yaw:-15}),p=new PinchGesture();
  p.down(1,{x:860,y:540},initial);p.down(2,{x:1060,y:540},initial);
  p.move(1,{x:960,y:440});const view=p.move(2,{x:960,y:640});
  near(view.rotation,90);near(view.scale,1);
  const anchor=screenToWorld({x:960,y:540},initial),projected=worldToScreen(anchor,view);near(projected.x,960);near(projected.y,540);
  p.up(1);assert.equal(p.blocked,true);assert.equal(p.move(2,{x:800,y:800}),null);p.up(2);assert.equal(p.blocked,false);
});
test('rectangle outlines leave their rotated interiors empty and interpolate width, angle and stroke', () => {
  for(const angle of [0,45,17]) {
    const p={x:200,y:200,size:100,shape:'rect-ring',width:120,height:80,angle,ringWidth:5},pixels=new Set();
    visitShape(p,(a,b)=>{for(let i=a;i<b;i++)pixels.add(i);});
    assert.ok(pixels.size>500);assert.ok(pixels.size<2000);assert.equal(pixels.has(200*W+200),false);
    const interpolated=strokePoints(p,{...p,x:230,angle:angle+15});assert.equal(interpolated.at(-1).shape,'rect-ring');assert.equal(interpolated.at(-1).ringWidth,5);
  }
  const point={x:100,y:100,size:100,shape:'rect-ring',width:120,height:80,angle:45,t:0};
  assert.equal(validateLive({session:'a',revision:1,id:'a',mode:'move',color:'#ffffff',ringWidth:5,targets:[0],from:0,samples:[point],head:point,elapsed:0}).samples[0].shape,'rect-ring');
});
const line = extra => ({id:'line',mode:'line',shape:'circle',color:'#ffffff',enabled:true,targets:[0],ringWidth:4,duration:0,start:2000,fadeMs:2000,linePending:false,lineIncomplete:false,samples:[{x:200,y:200,size:60,t:0},{x:800,y:200,size:60,t:0}],...extra});
test('a line is complete at its first source frame; the gated first cycle contains only endpoint rings', () => {
  const c=line({}),full=new CachedGesture(c).render(0),pending=new CachedGesture(line({linePending:true})).render(0),alpha=(image,x,y)=>image[(y*W+x)*4+3];
  assert.equal(alpha(full,500,200),255);assert.equal(alpha(full,500,208),0);
  assert.equal(alpha(pending,500,200),0);assert.equal(alpha(pending,200,200),0);assert.equal(alpha(pending,228,200),255);assert.equal(alpha(pending,828,200),255);
  assert.equal(alpha(new CachedGesture(line({linePending:true,ringWidth:1500})).render(0),200,200),0);
  assert.equal(gestureVisible(c,1900,10000),false);assert.equal(gestureVisible(c,2000,10000),true);assert.equal(gestureVisible({...c,linePending:true},1900,10000),true);
});
test('next-loop line scheduling waits through pause, survives a seam, and ignores incomplete endpoints', () => {
  const clips=[line({linePending:true}),line({id:'draft',linePending:true,lineIncomplete:true,samples:[{x:200,y:200,size:60,t:0}]})],q=new LineSchedule();
  q.rebase(clips,3000,10000,0);
  assert.equal(q.advance(clips,9999,10000,6999,true).size,0);
  assert.equal(q.advance(clips,9999,10000,20000,false).size,0);
  assert.deepEqual([...q.advance(clips,2000,10000,22001,true)],['line']);
});
test('pose, rectangle outline, line source and initial-cycle gate round trip and invalid line state is rejected', () => {
  const project=normalizeProject({version:1,canvas:CANVAS_SPEC,duration:10000,clips:[line({linePending:true})],settings:{mode:'line',shape:'rect-ring',lineWidth:7,viewVersion:3,view:canvasView({...DEFAULT_VIEW,scale:5,rotation:35,pitch:-25,yaw:-35})}});
  assert.deepEqual(parseProject(serializeProject(project,{playing:false,phase:0})).project,project);
  for(const mode of ['trail','return','place']) assert.equal(singleCanvasProject({...project,settings:{...project.settings,mode}}).settings.mode,'move');
  for(const extra of [{samples:[]},{linePending:'true'},{lineIncomplete:true},{duration:100}]) assert.throws(()=>validateProject({...project,clips:[line(extra)]}));
});

test('changing loop duration or line start retargets the next-loop gate, while seeking rebases without revealing', () => {
  const clips=[line({linePending:true})],q=new LineSchedule();
  q.rebase(clips,3000,10000,0);
  assert.equal(q.advance(clips,4000,6000,1000,true).size,0);
  assert.equal(q.advance(clips,1999,6000,4999,true).size,0);
  assert.deepEqual([...q.advance(clips,2000,6000,5000,true)],['line']);
  q.rebase(clips,1000,6000,6000);
  const moved=[{...clips[0],start:3000}];
  assert.equal(q.advance(moved,1500,6000,6500,true).size,0);
  q.rebase(moved,3500,6000,7000);
  assert.equal(q.advance(moved,3500,6000,20000,false).size,0);
  assert.equal(q.advance(moved,2999,6000,25499,true).size,0);
  assert.deepEqual([...q.advance(moved,3000,6000,25500,true)],['line']);
});
