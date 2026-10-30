import spectral from './vendor/spectral.glsl?raw';

export const stampVertex = `
precision highp float;
in vec3 position;
in vec4 brush; // x, y, width, height
in vec3 appearance; // angle in radians, rectangle flag, sample time
uniform vec4 targetBounds;
out vec2 localPoint;
flat out vec2 brushSize;
flat out vec3 info;
void main() {
  bool rect = appearance.y == 1. || appearance.y == 3.;
  vec2 center = floor(brush.xy) + (rect ? vec2(0.) : mod(brush.zw, 2.) * .5);
  vec2 extent = rect ? vec2(length(brush.zw) * .5 + 1.) : brush.zw * .5;
  localPoint = position.xy * extent * 2.;
  brushSize = brush.zw; info = appearance;
  vec2 p = (center + localPoint - targetBounds.xy) / targetBounds.zw;
  gl_Position = vec4(p.x * 2. - 1., 1. - p.y * 2., 0., 1.);
}`;

const footprint = `
float footprint(vec2 p, vec2 size, bool rect) {
  if (size.x <= 0. || size.y <= 0.) return 0.;
  if (rect) return float(p.x >= -size.x*.5 && p.x < size.x*.5 && p.y >= -size.y*.5 && p.y < size.y*.5);
  return float(dot(p,p) <= size.x*size.x*.25);
}`;

// Coverage is evaluated at the existing render resolution. Only a one-pixel
// boundary gets fractional alpha; no extra texture or full-screen AA pass.
const analyticCoverage = `
float edgeCoverage(float distance) {
  return clamp(.5-distance/max(fwidth(distance),.0001),0.,1.);
}
float shapeDistance(vec2 p,vec2 size,bool rect) {
  if(rect){vec2 q=abs(p)-size*.5;return max(q.x,q.y);}
  return dot(p,p)-size.x*size.x*.25;
}
float shapeCoverage(vec2 p,vec2 size,bool rect,float stroke) {
  float d=shapeDistance(p,size,rect);
  vec2 inner=size-stroke*2.;
  if(stroke>0.&&all(greaterThan(inner,vec2(0.))))d=max(d,-shapeDistance(p,inner,rect));
  return edgeCoverage(d);
}
float capsuleCoverage(vec2 p,vec2 size) {
  vec2 q=vec2(max(abs(p.x)-size.x*.5,0.),p.y);
  return edgeCoverage(dot(q,q)-size.y*size.y*.25);
}
float traceCoverage(vec2 p,vec2 size,bool rect,float stroke) {
  float halfStroke=stroke*.5,d;
  if(!rect){
    float radius=size.x*.5,q=dot(p,p);
    float ring=q-(radius+halfStroke)*(radius+halfStroke);
    if(radius>halfStroke)ring=max(ring,(radius-halfStroke)*(radius-halfStroke)-q);
    if(traceProgress>=1.)return edgeCoverage(ring);
    // Arc caps cannot reach outside this radial band. Reject its empty
    // interior/exterior before evaluating the partial arc and its joins.
    float radialAA=max(fwidth(q),.0001);
    if(q>(radius+halfStroke)*(radius+halfStroke)+radialAA)return 0.;
    if(radius>halfStroke&&q<(radius-halfStroke)*(radius-halfStroke)-radialAA)return 0.;
    float crossEnd=p.x*traceEnd.y-p.y*traceEnd.x;
    bool onArc=traceProgress<=.5?(p.x>=0.&&crossEnd>=0.):(p.x>=0.||crossEnd>=0.);
    vec2 start=p-vec2(0.,-radius),end=p-traceEnd*radius;
    // Use consistent distance units across the arc/cap join. Square roots
    // only run in the narrow radial band, never across the empty circle.
    d=(onArc&&traceProgress>0.?abs(length(p)-radius):sqrt(min(dot(start,start),dot(end,end))))-halfStroke;
  }else{
    vec2 halfSize=size*.5;
    if(traceProgress>=1.){
      vec2 q=abs(p)-halfSize;
      return edgeCoverage(abs(length(max(q,0.))+min(max(q.x,q.y),0.))-halfStroke);
    }
    float lengthDrawn=traceProgress*2.*(size.x+size.y);
    vec2 q=p-vec2(clamp(p.x,-halfSize.x,-halfSize.x+min(lengthDrawn,size.x)),-halfSize.y);
    d=dot(q,q);
    if(lengthDrawn>size.x){q=p-vec2(halfSize.x,clamp(p.y,-halfSize.y,-halfSize.y+min(lengthDrawn-size.x,size.y)));d=min(d,dot(q,q));}
    if(lengthDrawn>size.x+size.y){q=p-vec2(clamp(p.x,halfSize.x-min(lengthDrawn-size.x-size.y,size.x),halfSize.x),halfSize.y);d=min(d,dot(q,q));}
    if(lengthDrawn>2.*size.x+size.y){q=p-vec2(-halfSize.x,clamp(p.y,halfSize.y-min(lengthDrawn-2.*size.x-size.y,size.y),halfSize.y));d=min(d,dot(q,q));}
    d-=halfStroke*halfStroke;
  }
  return edgeCoverage(d);
}`;
export const stampFragment = `
precision highp float;
in vec2 localPoint;
flat in vec2 brushSize;
flat in vec3 info;
uniform float edgeSize;
out vec4 result;
${footprint}
void main() {
  bool rect = info.y == 1. || info.y == 3.;
  float c = cos(info.x), s = sin(info.x);
  vec2 p = rect ? vec2(c*localPoint.x+s*localPoint.y, -s*localPoint.x+c*localPoint.y) : localPoint;
  if (footprint(p,brushSize,rect) < .5) discard;
  if (info.y > 1.5 && footprint(p, brushSize - edgeSize*2., rect) > .5) discard;
  float time = min(16777215., floor(max(0.,info.z)*4.+.5)+1.);
  vec3 encoded = vec3(floor(time/65536.), floor(mod(time,65536.)/256.), mod(time,256.));
  result = vec4(encoded/255., 1.);
}`;
export const layerVertex = `
precision highp float;
in vec3 position;
uniform vec4 bounds;
uniform vec2 resolution;
out vec2 pixel;
void main() {
  pixel = bounds.xy + (position.xy+.5)*bounds.zw;
  vec2 p = pixel / resolution;
  gl_Position = vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);
}`;
const layerSource = `
precision highp float;
in vec2 pixel;
uniform vec2 resolution;
uniform vec4 bounds;
uniform sampler2D maskTexture;
uniform vec4 maskBounds;
uniform vec3 fillColor;
uniform float sourceTime;
uniform float layerOpacity;
uniform int trail;
uniform int directShape;
uniform vec4 directBrush;
uniform float directAngle;
uniform float edgeSize;
uniform int smoothEdges;
uniform float traceProgress;
uniform vec2 traceEnd;
out vec4 result;
${footprint}
${analyticCoverage}
vec4 layerColor() {
  float alpha = layerOpacity;
  if (directShape > 0) {
    bool rect = directShape == 2 || directShape == 4;
    vec2 center = smoothEdges==1?directBrush.xy:floor(directBrush.xy) + (rect ? vec2(0.) : mod(directBrush.zw,2.)*.5);
    vec2 p = pixel - center;
    float c = cos(directAngle), s = sin(directAngle);
    if (rect) p = vec2(c*p.x+s*p.y,-s*p.x+c*p.y);
    if(smoothEdges==1)alpha*=shapeCoverage(p,directBrush.zw,rect,(directShape==3||directShape==4)?edgeSize:0.);
    else {
      if (footprint(p,directBrush.zw,rect) < .5) return vec4(0.);
      if ((directShape == 3 || directShape == 4) && footprint(p,directBrush.zw-edgeSize*2.,rect) > .5) return vec4(0.);
    }
  } else {
    vec2 uv = (pixel-maskBounds.xy)/maskBounds.zw; uv.y=1.-uv.y;
    vec4 mask = texture(maskTexture,uv);
    if (mask.a < .1) return vec4(0.);
    if (trail == 1) {
      float time = (dot(round(mask.rgb*255.),vec3(65536.,256.,1.))-1.)*.25;
      float fade = max(0.,1.-max(0.,sourceTime-time)/1800.);
      alpha *= floor(fade*fade*255.+.5)/255.;
    }
  }
  return vec4(fillColor,alpha);
}`;
export const normalFragment = `${layerSource}
void main() { vec4 paint=layerColor(); result=vec4(paint.rgb*paint.a,paint.a); }
`;
export const analogComposite = `
uniform sampler2D belowTexture;
uniform float mixAmount;
${spectral}
void main() {
  vec2 uv=vec2(pixel.x/resolution.x,1.-pixel.y/resolution.y);
  vec4 paint=layerColor();
  if (paint.a<=0.) discard;
  vec4 below=texture(belowTexture,uv);
  if (below.a>0.) {
    vec3 color=clamp(round(below.rgb/below.a*255.)/255.,0.,1.);
    vec3 mixed=mixAmount<=0. ? color : mixAmount>=1. ? paint.rgb : spectral_mix(color,paint.rgb,mixAmount);
    paint.rgb=mix(paint.rgb,round(clamp(mixed,0.,1.)*255.)/255.,below.a);
  }
  result=vec4(paint.rgb*paint.a+below.rgb*(1.-paint.a),paint.a+below.a*(1.-paint.a));
}`;
export const analogFragment = layerSource + analogComposite;
export const effectFragment = `
precision highp float;
in vec2 pixel;
uniform vec2 resolution;
uniform sampler2D image;
out vec4 result;
vec4 layerColor() {
  vec2 uv=vec2(pixel.x/resolution.x,1.-pixel.y/resolution.y);
  vec4 paint=texture(image,uv);
  return paint.a>0. ? vec4(paint.rgb/paint.a,paint.a) : vec4(0.);
}
` + analogComposite;
export const screenVertex = `
precision highp float;
in vec3 position;
in vec2 uv;
out vec2 texCoord;
void main() { texCoord=uv; gl_Position=vec4(position.xy*2.,0.,1.); }
`;
export const copyFragment = `
precision highp float;
in vec2 texCoord;
uniform sampler2D image;
out vec4 result;
void main() { result=texture(image,texCoord); }
`;
export const presentVertex = `
precision highp float;
in vec3 position;
in vec2 uv;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
out vec2 texCoord;
void main() { texCoord=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }
`;
export const presentFragment = `
precision highp float;
in vec2 texCoord;
uniform sampler2D image;
out vec4 result;
void main() { result=vec4(texture(image,texCoord).rgb,1.); }
`;
export const blurFragment = `
precision highp float;
in vec2 texCoord;
uniform sampler2D image;
uniform vec2 direction;
out vec4 result;
void main() {
  vec4 sum=vec4(0.); float total=0.;
  for (int i=-16;i<=16;i++) {
    float weight=exp(-float(i*i)/128.);
    vec2 uv=texCoord+direction*float(i);
    if (all(greaterThanEqual(uv,vec2(0.))) && all(lessThanEqual(uv,vec2(1.)))) sum+=texture(image,uv)*weight;
    total+=weight;
  }
  result=sum/total;
}`;
