import { MOTION_SAMPLES } from './motion-blur.js';
export const motionUniforms = `
uniform int motionCount;
uniform vec4 motionBrush[${MOTION_SAMPLES}];
uniform vec4 motionInfo[${MOTION_SAMPLES}];
uniform vec3 motionColor[${MOTION_SAMPLES}];
`;
export const motionCoverage = `
 if(motionCount>0){
  vec4 sum=vec4(0.);
  for(int i=0;i<${MOTION_SAMPLES};i++){
   if(i>=motionCount)break;
   vec4 brush=motionBrush[i],info=motionInfo[i];
   int shape=int(info.z);bool rect=shape==2||shape==4;
   vec2 center=shape==5?brush.xy:floor(brush.xy)+(rect?vec2(0.):mod(brush.zw,2.)*.5);
   vec2 p=pixel-center;float c=cos(info.x),s=sin(info.x);
   if(rect||shape==5)p=vec2(c*p.x+s*p.y,-s*p.x+c*p.y);
   float coverage;
   if(shape==5){vec2 q=vec2(max(abs(p.x)-brush.z*.5,0.),p.y);coverage=float(dot(q,q)<=brush.w*brush.w*.25);}
   else{coverage=footprint(p,brush.zw,rect);if((shape==3||shape==4)&&footprint(p,brush.zw-info.w*2.,rect)>.5)coverage=0.;}
   float a=coverage*info.y;sum+=vec4(motionColor[i]*a,a);
  }
  sum/=float(motionCount);
  return sum.a>0.?vec4(sum.rgb/sum.a,sum.a):vec4(0.);
 }
`;
