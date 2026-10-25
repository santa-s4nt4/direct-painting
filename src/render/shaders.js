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
out vec4 result;
${footprint}
vec4 layerColor() {
  float alpha = layerOpacity;
  if (directShape > 0) {
    bool rect = directShape == 2 || directShape == 4;
    vec2 center = floor(directBrush.xy) + (rect ? vec2(0.) : mod(directBrush.zw,2.)*.5);
    vec2 p = pixel - center;
    float c = cos(directAngle), s = sin(directAngle);
    if (rect) p = vec2(c*p.x+s*p.y,-s*p.x+c*p.y);
    if (footprint(p,directBrush.zw,rect) < .5) return vec4(0.);
    if ((directShape == 3 || directShape == 4) && footprint(p,directBrush.zw-edgeSize*2.,rect) > .5) return vec4(0.);
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
const analogComposite = `
uniform sampler2D belowTexture;
uniform float mixAmount;
${spectral}
void main() {
  vec2 uv=vec2(pixel.x/resolution.x,1.-pixel.y/resolution.y);
  vec4 below=texture(belowTexture,uv), paint=layerColor();
  if (paint.a<=0.) { result=below; return; }
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
