import test from 'node:test';
import assert from 'node:assert/strict';
import { BOX_SPEC, workingPlane, pointInSpace, drawingPoint, projectSpace, insideBox, validatePlane, lineGeometry, planeHomography } from '../src/space.js';
import { DEFAULT_VIEW, canvasView } from '../src/view.js';
import { CANVAS_WIDTH as W, CANVAS_HEIGHT as H, CANVAS_SPEC } from '../src/canvas.js';
import { DEFAULT_SETTINGS, normalizeProject, serializeProject, parseProject } from '../src/project.js';
import { validateProject, minimumLoop } from '../src/loop.js';
import { validateLive } from '../server/loop-relay.js';
import { LiveStroke } from '../src/render/stroke.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const marker=(extra={})=>({id:'marker',mode:'move',shape:'ring',color:'#ffffff',targets:[0],enabled:true,start:100,fadeMs:500,ringWidth:7,plane:workingPlane({yaw:90}),duration:100,samples:[{x:W/2+100,y:H/2,size:15,pressure:0,t:0},{x:W/2+100,y:H/2,size:180,pressure:1,t:100}],...extra});
test('the box has the requested volume and each new working plane faces the camera through complete orbits',()=>{
 assert.deepEqual(BOX_SPEC,{width:3840,height:3480,depth:3480});
 for(const pose of [{},{yaw:90},{yaw:180},{yaw:135,pitch:-90,rotation:50},{yaw:-120,pitch:170,rotation:-80}]){
  const view=canvasView({...DEFAULT_VIEW,...pose}),plane=workingPlane(view);validatePlane(plane);
  const screen={x:1200,y:700},p=drawingPoint(screen,view),world=pointInSpace(p,plane),back=projectSpace(world,view);
  assert.ok(insideBox(world));near(back.x,screen.x);near(back.y,screen.y);
  const hom=planeHomography(plane,undefined,view),d=hom[6]*p.x+hom[7]*p.y+hom[8];near((hom[0]*p.x+hom[1]*p.y+hom[2])/d,screen.x);
 }
});
test('turning a stroke changes its projection but never reorients its saved spatial plane',()=>{
 const view=canvasView({...DEFAULT_VIEW,yaw:90}),plane=workingPlane(view),p=drawingPoint({x:1260,y:640},view),world=pointInSpace(p,plane);
 assert.ok(Math.abs(world[2])>250);near(projectSpace(world,view).x,1260);near(projectSpace(world,DEFAULT_VIEW).x,960);
});
test('spatial line ribbons connect points recorded on different planes',()=>{
 const points=[[-300,0,0],[0,200,300]],view=canvasView({...DEFAULT_VIEW,yaw:80,pitch:30}),g=lineGeometry({points3D:points,samples:[],ringWidth:10},view);validatePlane(g.plane);
 near(g.visual.width,Math.hypot(300,200,300));
 const a=pointInSpace({x:W/2-g.visual.width/2,y:H/2},g.plane,g.origin),b=pointInSpace({x:W/2+g.visual.width/2,y:H/2},g.plane,g.origin);
 for(let i=0;i<3;i++){near(a[i],points[0][i]);near(b[i],points[1][i]);}
});
test('line Ring gestures retain pressure, diameter, fade and spatial frames in files and relay',()=>{
 const m=marker(),endpoint={...m.samples.at(-1),t:0},line={id:'line',mode:'line',shape:'circle',color:'#ffffff',targets:[0],enabled:true,start:100,duration:0,fadeMs:500,ringWidth:5,samples:[endpoint],points3D:[pointInSpace(endpoint,m.plane)],lineMarkers:[m],linePending:true,lineIncomplete:true};
 const p=normalizeProject({version:1,canvas:CANVAS_SPEC,duration:5000,clips:[line],settings:{mode:'line',viewVersion:4,view:canvasView({...DEFAULT_VIEW,yaw:180})}});
 assert.deepEqual(parseProject(serializeProject(p,{playing:false,phase:0})).project,p);assert.equal(p.clips[0].lineMarkers[0].samples[0].size,15);
 const packet={session:'a',revision:1,id:'a',mode:'move',color:'#ffffff',targets:[0],ringWidth:7,plane:m.plane,from:0,samples:[m.samples[0]],head:m.samples[0],elapsed:0};
 assert.deepEqual(validateLive(packet).plane,m.plane);const live=new LiveStroke();live.update(packet,0);assert.deepEqual(live.plane,m.plane);
 assert.throws(()=>validateLive({...packet,plane:Array(9).fill(0)}));
 assert.throws(()=>validateProject({...p,clips:[{...line,points3D:[[0,0,1800]]}]}));
 assert.throws(()=>validateProject({...p,clips:[{...line,lineMarkers:[{...m,shape:'rect'}]}]}));
 assert.equal(minimumLoop([{...line,lineMarkers:[marker({duration:8000,fadeMs:2000,samples:[{...m.samples[0],t:0},{...m.samples[1],t:8000}]})]}]),10000);
});
test('new rectangles default to 1600px squares; untouched old defaults migrate and custom dimensions remain',()=>{
 assert.equal(DEFAULT_SETTINGS.widthMax,1600);assert.equal(DEFAULT_SETTINGS.heightMax,1600);
 const base={version:1,duration:10000,clips:[]};
 assert.equal(normalizeProject({...base,settings:{widthMin:20,heightMin:20,widthMax:100,heightMax:100}}).settings.widthMax,1600);
 const custom=normalizeProject({...base,settings:{widthMin:20,heightMin:20,widthMax:400,heightMax:200}}).settings;
 assert.deepEqual([custom.widthMax,custom.heightMax],[400,200]);
 assert.throws(()=>normalizeProject({...base,settings:{rectangleDefaultsVersion:99}}));
});

test('a view-aligned spatial segment has a round near end cap instead of collapsing',()=>{
 const g=lineGeometry({points3D:[[0,0,0],[0,0,300]],samples:[],ringWidth:10},DEFAULT_VIEW);
 assert.equal(g.visual.shape,'circle');assert.deepEqual(g.origin,[0,0,300]);validatePlane(g.plane);
});
