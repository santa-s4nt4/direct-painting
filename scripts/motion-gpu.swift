import Foundation
import OpenGL
import OpenGL.GL3
import CoreGraphics
import CoreText
import ImageIO
let fixture=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1]))) as! [String:Any]
var format:CGLPixelFormatObj?,context:CGLContextObj?,formatCount:GLint=0
var attributes:[CGLPixelFormatAttribute]=[kCGLPFAOpenGLProfile,CGLPixelFormatAttribute(rawValue:0x4100),kCGLPFAAccelerated,CGLPixelFormatAttribute(rawValue:0)]
guard CGLChoosePixelFormat(&attributes,&format,&formatCount)==kCGLNoError,let format,CGLCreateContext(format,nil,&context)==kCGLNoError,let context else{fatalError("Offscreen GPU context unavailable")}
CGLSetCurrentContext(context)
defer{CGLDestroyContext(context);CGLDestroyPixelFormat(format)}
func shader(_ type:GLenum,_ source:String)->GLuint{
 let shader=glCreateShader(type);var text:UnsafePointer<GLchar>?=("#version 410 core\n"+source).withCString{strdup($0)}.map{UnsafePointer($0)}
 defer{free(UnsafeMutableRawPointer(mutating:text))};glShaderSource(shader,1,&text,nil);glCompileShader(shader)
 var ok:GLint=0;glGetShaderiv(shader,GLenum(GL_COMPILE_STATUS),&ok)
 if ok==0{var message=[GLchar](repeating:0,count:32768);glGetShaderInfoLog(shader,32768,nil,&message);fatalError(String(cString:message))};return shader
}
func program(_ fragment:String)->GLuint{
 let v=shader(GLenum(GL_VERTEX_SHADER),fixture["vertex"] as! String),f=shader(GLenum(GL_FRAGMENT_SHADER),fragment),p=glCreateProgram();glAttachShader(p,v);glAttachShader(p,f);glLinkProgram(p);glDeleteShader(v);glDeleteShader(f)
 var ok:GLint=0;glGetProgramiv(p,GLenum(GL_LINK_STATUS),&ok);if ok==0{var log=[GLchar](repeating:0,count:32768);glGetProgramInfoLog(p,32768,nil,&log);fatalError(String(cString:log))};return p
}
let normal=program(fixture["normal"] as! String),analog=program(fixture["analog"] as! String);defer{glDeleteProgram(normal);glDeleteProgram(analog)}
let width=1920,height=1080,length=1920*1080*4
var vao:GLuint=0,buffer:GLuint=0,framebuffer:GLuint=0,texture:GLuint=0,mask:GLuint=0
glGenVertexArrays(1,&vao);glBindVertexArray(vao);glGenBuffers(1,&buffer);glBindBuffer(GLenum(GL_ARRAY_BUFFER),buffer)
let vertices:[GLfloat]=[-0.5,-0.5,0,0.5,-0.5,0,0.5,0.5,0,-0.5,-0.5,0,0.5,0.5,0,-0.5,0.5,0]
vertices.withUnsafeBytes{glBufferData(GLenum(GL_ARRAY_BUFFER),$0.count,$0.baseAddress,GLenum(GL_STATIC_DRAW))}
let position=GLuint(glGetAttribLocation(normal,"position"));glEnableVertexAttribArray(position);glVertexAttribPointer(position,3,GLenum(GL_FLOAT),GLboolean(GL_FALSE),0,nil)
glGenTextures(1,&texture);glBindTexture(GLenum(GL_TEXTURE_2D),texture);glTexImage2D(GLenum(GL_TEXTURE_2D),0,GL_RGBA8,GLsizei(width),GLsizei(height),0,GLenum(GL_RGBA),GLenum(GL_UNSIGNED_BYTE),nil)
glGenFramebuffers(1,&framebuffer);glBindFramebuffer(GLenum(GL_FRAMEBUFFER),framebuffer);glFramebufferTexture2D(GLenum(GL_FRAMEBUFFER),GLenum(GL_COLOR_ATTACHMENT0),GLenum(GL_TEXTURE_2D),texture,0)
guard glCheckFramebufferStatus(GLenum(GL_FRAMEBUFFER))==GLenum(GL_FRAMEBUFFER_COMPLETE) else{fatalError("Incomplete framebuffer")}
glGenTextures(1,&mask);glBindTexture(GLenum(GL_TEXTURE_2D),mask);var zero:[UInt8]=[0,0,0,0];zero.withUnsafeBytes{glTexImage2D(GLenum(GL_TEXTURE_2D),0,GL_RGBA8,1,1,0,GLenum(GL_RGBA),GLenum(GL_UNSIGNED_BYTE),$0.baseAddress)}
glViewport(0,0,GLsizei(width),GLsizei(height));glUseProgram(normal)
func location(_ name:String)->GLint{glGetUniformLocation(normal,name)}
func floats(_ value:Any)->[GLfloat]{(value as! [NSNumber]).map{$0.floatValue}}
func uniform4(_ name:String,_ values:[GLfloat]){values.withUnsafeBufferPointer{glUniform4fv(location(name),GLsizei(values.count/4),$0.baseAddress)}}
func matrix(_ name:String,_ values:Any){floats(values).withUnsafeBufferPointer{glUniformMatrix4fv(location(name),1,GLboolean(GL_FALSE),$0.baseAddress)}}
func render(_ test:[String:Any],_ frames:[[String:Any]],_ temporal:Bool)->[UInt8]{
 glClearColor(0,0,0,0);glClear(GLbitfield(GL_COLOR_BUFFER_BIT));glUniform2f(location("resolution"),1920,1080);matrix("projectionMatrix",test["projection"]!);matrix("modelViewMatrix",test["modelView"]!);matrix("planeMatrix",test["plane"]!);uniform4("bounds",floats(test["bounds"]!));
 let shape=(test["shape"] as! NSNumber).int32Value
 func brush(_ frame:[String:Any])->[GLfloat]{let p=frame["visual"] as! [String:Any];let x=(p["x"] as! NSNumber).floatValue.rounded(),y=(p["y"] as! NSNumber).floatValue.rounded(),size=(p["size"] as! NSNumber).floatValue.rounded();return[x,y,shape==2||shape==4 ? (p["width"] as! NSNumber).floatValue:size,shape==2||shape==4 ? (p["height"] as! NSNumber).floatValue:size]}
 let current=frames.last!,point=current["visual"] as! [String:Any],color=floats(current["color"]!)
 glUniform1i(location("directShape"),shape);uniform4("directBrush",brush(current));glUniform1f(location("directAngle"),(point["angle"] as! NSNumber).floatValue * .pi / 180);glUniform1f(location("edgeSize"),10);glUniform1f(location("layerOpacity"),(current["opacity"] as! NSNumber).floatValue);glUniform3f(location("fillColor"),color[0],color[1],color[2]);
 glUniform1i(location("motionCount"),temporal ? GLsizei(frames.count):0)
 if temporal{
  uniform4("motionBrush[0]",frames.flatMap{brush($0)});uniform4("motionInfo[0]",frames.flatMap{f->[GLfloat] in let p=f["visual"] as! [String:Any];return[(p["angle"] as! NSNumber).floatValue * .pi / 180,(f["opacity"] as! NSNumber).floatValue,GLfloat(shape),10]})
  let colors=frames.flatMap{floats($0["color"]!)};colors.withUnsafeBufferPointer{glUniform3fv(location("motionColor[0]"),GLsizei(frames.count),$0.baseAddress)}
 }
 glDrawArrays(GLenum(GL_TRIANGLES),0,6);var pixels=[UInt8](repeating:0,count:length);pixels.withUnsafeMutableBytes{glReadPixels(0,0,GLsizei(width),GLsizei(height),GLenum(GL_RGBA),GLenum(GL_UNSIGNED_BYTE),$0.baseAddress)};return pixels
}
func comparison(_ motion:[UInt8],_ sharp:[UInt8],_ path:String) throws {
 let w=720,h=300;var pixels=[UInt8](repeating:0,count:w*h*4)
 for y in 0..<h{for x in 0..<w{let p=(y*w+x)*4;pixels[p+3]=255}}
 for (side,source) in [motion,sharp].enumerated(){for y in 0..<240{for x in 0..<320{
  let a=((1079-(420+y))*1920+760+x)*4,b=((y+44)*w+20+side*360+x)*4
  for c in 0..<3{pixels[b+c]=source[a+c]}
 }}}
 try pixels.withUnsafeMutableBytes{buffer in
  let context=CGContext(data:buffer.baseAddress,width:w,height:h,bitsPerComponent:8,bytesPerRow:w*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
  for (i,text) in ["Motion blur ON (1 frame)","Motion blur OFF"].enumerated(){
   let label=NSAttributedString(string:text,attributes:[NSAttributedString.Key(kCTFontAttributeName as String):CTFontCreateWithName("Helvetica" as CFString,15,nil),NSAttributedString.Key(kCTForegroundColorAttributeName as String):CGColor(gray:1,alpha:1)])
   context.textPosition=CGPoint(x:20+i*360,y:h-26);CTLineDraw(CTLineCreateWithAttributedString(label),context)
  }
  let destination=CGImageDestinationCreateWithURL(URL(fileURLWithPath:path) as CFURL,"public.png" as CFString,1,nil)!
  CGImageDestinationAddImage(destination,context.makeImage()!,nil);guard CGImageDestinationFinalize(destination)else{throw NSError(domain:"PNG",code:1)}
 }
}
var checks=[[String:Any]](),allPassed=true
for test in fixture["cases"] as! [[String:Any]]{
 let frames=test["frames"] as! [[String:Any]],actual=render(test,frames,true);var expected=[Float](repeating:0,count:length)
 for frame in frames{let crisp=render(test,[frame],false);for i in 0..<length{expected[i]+=Float(crisp[i])/Float(frames.count)}}
 var error=0,painted=0;for i in 0..<length{error=max(error,abs(Int(actual[i])-Int(expected[i].rounded())));if i%4==3&&actual[i]>0{painted+=1}}
 if test["name"] as? String == "moving ellipse",CommandLine.arguments.count>3{try comparison(actual,render(test,[frames.last!],false),CommandLine.arguments[3])}
 let passed=error<=2&&painted>0;allPassed = allPassed && passed;checks.append(["name":test["name"]!,"passed":passed,"maxChannelError":error,"paintedPixels":painted])
}
let error=glGetError();allPassed = allPassed && error==GLenum(GL_NO_ERROR)
let report:[String:Any]=["date":ISO8601DateFormatter().string(from:Date()),"backend":"macOS offscreen OpenGL (actual production GLSL; not browser WebGL2)","renderer":String(cString:glGetString(GLenum(GL_RENDERER))),"checks":checks,"glError":error,"passed":allPassed]
let json=try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]);print(String(data:json,encoding:.utf8)!)
if CommandLine.arguments.count>2{try json.write(to:URL(fileURLWithPath:CommandLine.arguments[2]))}
glDeleteBuffers(1,&buffer);glDeleteVertexArrays(1,&vao);glDeleteFramebuffers(1,&framebuffer);glDeleteTextures(1,&texture);glDeleteTextures(1,&mask)
if !allPassed{exit(1)}
