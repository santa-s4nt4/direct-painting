import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera,Vector3 } from 'three';
import { DEFAULT_CAMERA,cameraConfig,ease,mixView,newCameraEvent,autoPose,releaseCameraEvent,cameraPose,CameraSampler,mergeCamera } from '../src/camera-motion.js';
import { DEFAULT_VIEW,canvasView,CAMERA_DISTANCE,transformAt } from '../src/view.js';
import { workingPlane,pointInSpace,projectSpace,drawingPoint,drawingPointOnPlane } from '../src/space.js';
import { positionCamera } from '../src/render/camera-view.js';
import { cameraExposure,cameraProjection } from '../src/render/camera-exposure.js';
import { normalizeProject,serializeProject,parseProject } from '../src/project.js';
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const camera=()=>new PerspectiveCamera(2*Math.atan(1080/(2*CAMERA_DISTANCE))*180/Math.PI,1920/1080,1,20000);

test('actual cameras orbit the origin at the requested distance and share CPU projection and inverse input',()=>{
 for(const pose of [{},{yaw:120,pitch:-50,rotation:30,distance:8500},{yaw:-175,pitch:90,distance:3500},{pitch:170,yaw:50,rotation:-120,distance:12000}]){
  const view=canvasView({...DEFAULT_VIEW,...pose}),c=camera();c.zoom=view.scale;c.setViewOffset(1920,1080,960-view.x-1920*view.scale,540-view.y-1080*view.scale,1920,1080);c.updateProjectionMatrix();positionCamera(c,view);
  near(c.position.length(),view.distance??CAMERA_DISTANCE);near(c.getWorldDirection(new Vector3()).dot(c.position.clone().normalize()),-1);
  for(const point of [[0,0,0],[200,150,-300],[-400,500,300]]){
   const projected=new Vector3(point[0],-point[1],point[2]).project(c),expected=projectSpace(point,view);near((projected.x+1)*960,expected.x);near((1-projected.y)*540,expected.y);
  }
  const screen={x:1150,y:660},source=drawingPoint(screen,view),world=pointInSpace(source,workingPlane(view));near(projectSpace(world,view).x,screen.x);near(projectSpace(world,view).y,screen.y);
  const plane=workingPlane({...DEFAULT_VIEW,yaw:30,pitch:20}),p={x:2100,y:1300},onScreen=projectSpace(pointInSpace(p,plane),view),back=drawingPointOnPlane(onScreen,view,plane);near(back.x,p.x);near(back.y,p.y);
 }
 const view=canvasView({...DEFAULT_VIEW,distance:8000,yaw:30,pitch:20}),anchor={x:960,y:540},next=transformAt(view,{scale:1.25},anchor);near(next.x+1920*next.scale,anchor.x);near(next.y+1080*next.scale,anchor.y);
});
test('MIDI ADSR has continuous attack/retrigger/release and deterministic shared random destinations',()=>{
 const config=cameraConfig({...DEFAULT_CAMERA,mode:'midi-auto'}),event=newCameraEvent(DEFAULT_VIEW,DEFAULT_VIEW,config,1000,'1:60',()=>.75);
 assert.deepEqual(autoPose(event,1000),canvasView(DEFAULT_VIEW));near(autoPose(event,1400).distance,event.target.distance);
 const held=autoPose(event,1700),later=autoPose(event,10000);assert.deepEqual(later,held);
 const released=releaseCameraEvent(event,1500);assert.deepEqual(autoPose(released,1500),autoPose(event,1500));near(autoPose(released,2400).distance??CAMERA_DISTANCE,5000);
 const retrigger=newCameraEvent(autoPose(event,1200),DEFAULT_VIEW,config,1200,'1:60',()=>.1);assert.deepEqual(autoPose(retrigger,1200),autoPose(event,1200));
 const snapshot={config,event};assert.deepEqual(cameraPose(snapshot,DEFAULT_VIEW,500,1450),cameraPose(structuredClone(snapshot),DEFAULT_VIEW,9000,1450));
 assert.equal(ease(0),0);assert.equal(ease(1),1);assert.ok(ease(.2)<.2);
});
test('retired rec projects migrate to normal, discard recordings and preserve painting and MIDI settings',()=>{
 const config=cameraConfig({...DEFAULT_CAMERA,mode:'rec',note:60,track:{id:'take',samples:[{t:0,view:DEFAULT_VIEW}]}});
 assert.equal(config.mode,'normal');assert.equal(config.note,60);assert.equal('track' in config,false);
 const saved=normalizeProject({version:1,clips:[],settings:{camera:config}});assert.deepEqual(parseProject(serializeProject(saved,{playing:true,phase:0})).project,saved);
 assert.deepEqual(cameraPose({config},DEFAULT_VIEW,500,1000),DEFAULT_VIEW);
});
test('camera exposure is default ON, clears at resets, tolerates duplicate frame times and uses bounded manual history',()=>{
 const sampler=new CameraSampler(),snap={config:DEFAULT_CAMERA};assert.equal(sampler.frame(snap,DEFAULT_VIEW,0,0,0).cameraViews,null);
 const turned=canvasView({...DEFAULT_VIEW,yaw:10});const moved=sampler.frame(snap,turned,16,16,16);assert.equal(moved.cameraViews.length,16);
 assert.ok(sampler.frame(snap,turned,16,16,16).cameraViews.every(p=>Number.isFinite(p.scale)&&Number.isFinite(p.x)));
 sampler.frame(snap,turned,100,100,100);assert.equal(sampler.frame(snap,turned,120,120,120).cameraViews,null);
 for(let i=0;i<100;i++)sampler.frame(snap,turned,120+i,120+i,120+i);assert.ok(sampler.history.length<=32);
 sampler.reset();assert.equal(sampler.frame(snap,turned,0,0,0).cameraViews,null);
 assert.equal(sampler.frame({config:{...DEFAULT_CAMERA,blur:false}},DEFAULT_VIEW,1,1,1).cameraViews,null);
});
test('camera projection bounds and inverse homographies cover every exposure on a stored drawing plane',()=>{
 const views=Array.from({length:8},(_,i)=>canvasView({...DEFAULT_VIEW,yaw:i*2,distance:5000+i*80})),clip={mode:'move',color:'#ffffff',duration:1000,fadeMs:1000,plane:workingPlane(DEFAULT_VIEW),effects:{motionBlur:false}},visual={x:2200,y:1080,size:100};
 const exposure=cameraExposure(clip,100,visual,()=>visual,views),projection=cameraProjection(clip,exposure,{});
 assert.equal(projection.inverse.length,8);assert.ok(projection.bounds.width>0);
 views.forEach((view,i)=>{const screen=projectSpace(pointInSpace(visual,clip.plane),view),m=projection.inverse[i],z=m[6]*screen.x+m[7]*screen.y+m[8];near((m[0]*screen.x+m[1]*screen.y+m[2])/z,visual.x);assert.ok(screen.x>=projection.bounds.x&&screen.x<=projection.bounds.x+projection.bounds.width);});
});
test('invalid camera settings fail before import and stale or retired incremental messages are ignored',()=>{
 for(const value of [null,[],{mode:'other'},{note:128},{attack:-1},{sustain:2},{blur:1},{blurAmount:201}])assert.throws(()=>cameraConfig(value));
 assert.throws(()=>normalizeProject({version:1,clips:[],settings:{camera:{release:Infinity}}}));
 const initial={epoch:'host',revision:3,config:DEFAULT_CAMERA};
 assert.equal(mergeCamera(initial,{epoch:'host',revision:4,index:2,takeId:'x',point:{t:2,view:DEFAULT_VIEW}}),initial);
 assert.equal(mergeCamera(initial,{...initial,revision:2}),initial);
 const next=mergeCamera(initial,{...initial,revision:4,config:{...DEFAULT_CAMERA,mode:'midi-auto'}});assert.equal(next.config.mode,'midi-auto');
});
