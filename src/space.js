import { DEFAULT_RING_WIDTH } from './effects.js';
import { CANVAS_WIDTH as W, CANVAS_HEIGHT as H, BOX_SPEC } from './canvas.js';
import { CAMERA_DISTANCE, viewRotation, invertHomography } from './view.js';
export { BOX_SPEC } from './canvas.js';
export const IDENTITY_PLANE = Object.freeze([1,0,0,0,1,0,0,0,1]);
export const transpose = r => [r[0],r[3],r[6],r[1],r[4],r[7],r[2],r[5],r[8]].map(v=>v||0);
export const multiply = (r,p) => [r[0]*p[0]+r[1]*p[1]+r[2]*p[2],r[3]*p[0]+r[4]*p[1]+r[5]*p[2],r[6]*p[0]+r[7]*p[1]+r[8]*p[2]];
export const workingPlane = view => transpose(viewRotation(view));
export function pointInSpace(point, plane = IDENTITY_PLANE, origin = [0,0,0]) { return multiply(plane,[point.x-W/2,point.y-H/2,0]).map((v,i)=>v+origin[i]); }
export function insideBox(p) { return p.every((v,i)=>Number.isFinite(v)&&Math.abs(v)<=[BOX_SPEC.width,BOX_SPEC.height,BOX_SPEC.depth][i]/2+1e-5); }
export function drawingPoint(screen,view) { return {x:(screen.x-view.x-W*view.scale/2)*(view.distance??CAMERA_DISTANCE)/view.scale/CAMERA_DISTANCE+W/2,y:(screen.y-view.y-H*view.scale/2)*(view.distance??CAMERA_DISTANCE)/view.scale/CAMERA_DISTANCE+H/2}; }
export function projectSpace(point,view) {
  const [x,y,z]=multiply(viewRotation(view),point), k=view.scale*CAMERA_DISTANCE/((view.distance??CAMERA_DISTANCE)-z);
  return {x:view.x+W*view.scale/2+x*k,y:view.y+H*view.scale/2+y*k};
}
export function validatePlane(plane) {
  if(plane===undefined)return;
  if(!Array.isArray(plane)||plane.length!==9||plane.some(v=>!Number.isFinite(v)||Math.abs(v)>1.00001))throw new Error('Invalid drawing plane');
  const cols=[[plane[0],plane[3],plane[6]],[plane[1],plane[4],plane[7]],[plane[2],plane[5],plane[8]]];
  for(let i=0;i<3;i++)for(let j=i;j<3;j++)if(Math.abs(cols[i].reduce((s,v,k)=>s+v*cols[j][k],0)-(i===j?1:0))>1e-4)throw new Error('Invalid drawing plane basis');
  const determinant=plane[0]*(plane[4]*plane[8]-plane[5]*plane[7])-plane[1]*(plane[3]*plane[8]-plane[5]*plane[6])+plane[2]*(plane[3]*plane[7]-plane[4]*plane[6]);
  if(Math.abs(determinant-1)>1e-4)throw new Error('Invalid drawing plane handedness');
}
export function lineGeometry(clip,view) {
  const points=clip.points3D??clip.samples.map(p=>pointInSpace(p,clip.plane));
  const a=points[0],b=points[1]??a, delta=b.map((v,i)=>v-a[i]),length=Math.hypot(...delta),camera=workingPlane(view);
  const u=length>1e-6?delta.map(v=>v/length):[camera[0],camera[3],camera[6]],n=[camera[2],camera[5],camera[8]];
  let v=[n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]],d=Math.hypot(...v);
  if(d<1e-6){const near= a.reduce((s,x,i)=>s+x*n[i],0)>b.reduce((s,x,i)=>s+x*n[i],0)?a:b;return {plane:camera,origin:[...near],visual:{x:W/2,y:H/2,size:clip.ringWidth??DEFAULT_RING_WIDTH,shape:'circle'}};}v=v.map(x=>x/d);
  const z=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  return {plane:[u[0],v[0],z[0],u[1],v[1],z[1],u[2],v[2],z[2]],origin:a.map((x,i)=>(x+b[i])/2),visual:{x:W/2,y:H/2,size:clip.ringWidth??DEFAULT_RING_WIDTH,width:length,height:clip.ringWidth??DEFAULT_RING_WIDTH,shape:'capsule'}};
}
export function boxEdges(view) {
  const p=[];for(const z of [-1,1])for(const y of [-1,1])for(const x of [-1,1])p.push(projectSpace([x*BOX_SPEC.width/2,y*BOX_SPEC.height/2,z*BOX_SPEC.depth/2],view));
  const edges=[];for(let i=0;i<8;i++)for(const bit of [1,2,4])if(!(i&bit))edges.push([p[i],p[i|bit]]);return edges;
}
export function planeHomography(plane=IDENTITY_PLANE,origin=[0,0,0],view){
 const r=viewRotation(view),p=plane,m=Array.from({length:9},(_,i)=>{const row=Math.floor(i/3),col=i%3;return r[row*3]*p[col]+r[row*3+1]*p[3+col]+r[row*3+2]*p[6+col];}),o=multiply(r,origin),cx=view.x+W*view.scale/2,cy=view.y+H*view.scale/2;
 const distance=view.distance??CAMERA_DISTANCE,f=view.scale*CAMERA_DISTANCE/distance;
 const a=f*m[0]-cx*m[6]/distance,b=f*m[1]-cx*m[7]/distance,d=f*m[3]-cy*m[6]/distance,e=f*m[4]-cy*m[7]/distance,g=-m[6]/distance,h=-m[7]/distance;
 return[a,b,cx*(1-o[2]/distance)+f*o[0]-a*W/2-b*H/2,d,e,cy*(1-o[2]/distance)+f*o[1]-d*W/2-e*H/2,g,h,1-o[2]/distance-g*W/2-h*H/2];
}
export function clipPolygonToBox(points){
 let polygon=points;
 for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
  const half=[BOX_SPEC.width,BOX_SPEC.height,BOX_SPEC.depth][axis]/2,next=[];
  for(let i=0;i<polygon.length;i++){
   const a=polygon[i],b=polygon[(i+1)%polygon.length],da=half-sign*a[axis],db=half-sign*b[axis];
   if(da>=0)next.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);next.push(a.map((x,k)=>x+(b[k]-x)*t));}
  }polygon=next;
 }return polygon;
}

export function drawingPointOnPlane(screen,view,plane,origin){
 const m=invertHomography(planeHomography(plane,origin,view)),w=m[6]*screen.x+m[7]*screen.y+m[8];
 return {x:(m[0]*screen.x+m[1]*screen.y+m[2])/w,y:(m[3]*screen.x+m[4]*screen.y+m[5])/w};
}
