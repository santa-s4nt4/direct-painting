import { MOTION_SAMPLES } from './motion-blur.js';
export const motionUniforms = `
uniform int cameraCount;
uniform mat3 cameraInverse[16];
uniform mat4 planeMatrix;
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
   vec2 sourcePixel=pixel;
   if(cameraCount>0){
    vec3 projected=cameraInverse[i]*vec3(gl_FragCoord.x,resolution.y-gl_FragCoord.y,1.);
    if(abs(projected.z)<.000001)continue;
    sourcePixel=projected.xy/projected.z;
    vec3 world=(planeMatrix*vec4(sourcePixel-vec2(1920.,1080.),0.,1.)).xyz;
    if(any(greaterThan(abs(world),vec3(1920.,1740.,1740.))))continue;
   }
   vec2 p=sourcePixel-center;float c=cos(info.x),s=sin(info.x);
   if(rect||shape==5)p=vec2(c*p.x+s*p.y,-s*p.x+c*p.y);
   float coverage;
   if(shape==0){vec2 uv=(sourcePixel-maskBounds.xy)/maskBounds.zw;uv.y=1.-uv.y;vec4 mask=texture(maskTexture,uv);coverage=mask.a>.1?1.:0.;if(trail==1){float age=(dot(round(mask.rgb*255.),vec3(65536.,256.,1.))-1.)*.25;float fade=max(0.,1.-max(0.,sourceTime-age)/1800.);coverage*=floor(fade*fade*255.+.5)/255.;}}
   else if(shape==5){vec2 q=vec2(max(abs(p.x)-brush.z*.5,0.),p.y);coverage=float(dot(q,q)<=brush.w*brush.w*.25);}
   else{coverage=footprint(p,brush.zw,rect);if((shape==3||shape==4)&&footprint(p,brush.zw-info.w*2.,rect)>.5)coverage=0.;}
   float a=coverage*info.y;sum+=vec4(motionColor[i]*a,a);
  }
  sum/=float(motionCount);
  return sum.a>0.?vec4(sum.rgb/sum.a,sum.a):vec4(0.);
 }
`;
