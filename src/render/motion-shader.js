import { MOTION_SAMPLES } from './motion-blur.js';
import { CAMERA_NEAR, CAMERA_FAR } from '../view.js';
export const motionUniforms = `
uniform highp int cameraCount;
uniform mat3 cameraInverse[16];
uniform int cameraDepthClipped;
uniform int cameraConicCount;
uniform vec2 cameraCircleRadii;
uniform int motionCount;
uniform vec4 motionBrush[${MOTION_SAMPLES}];
uniform vec4 motionInfo[${MOTION_SAMPLES}];
uniform vec3 motionColor[${MOTION_SAMPLES}];
`;
export const motionCoverage = `
 if(cameraConicCount>0){
  float sum=0.;
  for(int i=0;i<16;i++){
   if(i>=cameraConicCount)break;
   mat3 conic=cameraInverse[i];
   vec2 p=vec2(gl_FragCoord.x,resolution.y-gl_FragCoord.y)-conic[2].xy;
   float q=dot(conic[0],vec3(p.x*p.x,p.x*p.y,p.y*p.y));
   float z=dot(conic[1],vec3(p,1.));z*=z;
   float d=q-cameraCircleRadii.x*z;
   if(cameraCircleRadii.y>0.)d=max(d,cameraCircleRadii.y*z-q);
   sum+=edgeCoverage(d);
  }
  return vec4(fillColor,motionInfo[0].y*sum/float(cameraConicCount));
 }
 if(motionCount>0){
  vec4 sum=vec4(0.);
  for(int i=0;i<${MOTION_SAMPLES};i++){
   if(i>=motionCount)break;
   vec4 brush=motionBrush[i],info=motionInfo[i];
   int shape=int(info.z);bool rect=shape==2||shape==4||shape==7;
   vec2 center=smoothEdges==1||shape>=5?brush.xy:floor(brush.xy)+(rect?vec2(0.):mod(brush.zw,2.)*.5);
   vec2 sourcePixel=pixel;
   if(cameraCount>0){
    vec3 projected=cameraInverse[i]*vec3(gl_FragCoord.x,resolution.y-gl_FragCoord.y,1.);
    if(abs(projected.z)<.000001)continue;
    sourcePixel=projected.xy/projected.z;
    if(cameraDepthClipped==1&&(projected.z<1./${CAMERA_FAR}.||projected.z>1./${CAMERA_NEAR}.))continue;
   }
   vec2 p=sourcePixel-center;float c=cos(info.x),s=sin(info.x);
   if(rect||shape==5||shape==6)p=vec2(c*p.x+s*p.y,-s*p.x+c*p.y);
   float coverage;
   if(shape==0){vec2 uv=(sourcePixel-maskBounds.xy)/maskBounds.zw;uv.y=1.-uv.y;vec4 mask=texture(maskTexture,uv);coverage=mask.a>.1?1.:0.;if(trail==1){float age=(dot(round(mask.rgb*255.),vec3(65536.,256.,1.))-1.)*.25;float fade=max(0.,1.-max(0.,sourceTime-age)/1800.);coverage*=floor(fade*fade*255.+.5)/255.;}}
   else if(shape>=6)coverage=traceCoverage(p,brush.zw,rect,info.w);
   else if(shape==5)coverage=capsuleCoverage(p,brush.zw);
   else if(smoothEdges==1)coverage=shapeCoverage(p,brush.zw,rect,(shape==3||shape==4)?info.w:0.);
   else{coverage=footprint(p,brush.zw,rect);if((shape==3||shape==4)&&footprint(p,brush.zw-info.w*2.,rect)>.5)coverage=0.;}
   float a=coverage*info.y;sum+=vec4(motionColor[i]*a,a);
  }
  sum/=float(motionCount);
  return sum.a>0.?vec4(sum.rgb/sum.a,sum.a):vec4(0.);
 }
`;
