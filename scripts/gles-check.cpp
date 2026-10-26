#include <dlfcn.h>
#include <cstdio>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

// Exercise the production GLSL ES 3.00 pair in ANGLE, without a browser.
#define FN(ret, name, ...) auto name = (ret (*)(__VA_ARGS__))dlsym(lib, #name)
std::string read(const char* path) {
  std::ifstream file(path); std::stringstream source; source << file.rdbuf(); return source.str();
}
int main(int argc, char** argv) {
  if (argc != 5) return 2;
  void* lib = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
  if (!lib) { std::cerr << dlerror(); return 2; }
  FN(void*, eglGetDisplay, void*); FN(unsigned, eglInitialize, void*, int*, int*);
  FN(unsigned, eglChooseConfig, void*, const int*, void**, int, int*);
  FN(void*, eglCreateContext, void*, void*, void*, const int*);
  FN(void*, eglCreatePbufferSurface, void*, void*, const int*);
  FN(unsigned, eglMakeCurrent, void*, void*, void*, void*);
  void* display = eglGetDisplay(nullptr); int major, minor, count;
  if (!eglInitialize(display, &major, &minor)) return 2;
  void* config;
  int attributes[] = {0x3033, 1, 0x3040, 0x40, 0x3024, 8, 0x3023, 8, 0x3022, 8, 0x3021, 8, 0x3038};
  if (!eglChooseConfig(display, attributes, &config, 1, &count) || !count) return 2;
  int contextAttributes[] = {0x3098, 3, 0x3038}, surfaceAttributes[] = {0x3057, 64, 0x3056, 36, 0x3038};
  void* context = eglCreateContext(display, config, nullptr, contextAttributes);
  void* surface = eglCreatePbufferSurface(display, config, surfaceAttributes);
  if (!context || !surface || !eglMakeCurrent(display, surface, surface, context)) return 2;
  lib = dlopen(argv[2], RTLD_NOW | RTLD_GLOBAL); if (!lib) return 2;
  FN(const unsigned char*, glGetString, unsigned); FN(unsigned, glCreateShader, unsigned);
  FN(void, glShaderSource, unsigned, int, const char* const*, const int*); FN(void, glCompileShader, unsigned);
  FN(void, glGetShaderiv, unsigned, unsigned, int*); FN(void, glGetShaderInfoLog, unsigned, int, int*, char*);
  FN(unsigned, glCreateProgram); FN(void, glAttachShader, unsigned, unsigned); FN(void, glLinkProgram, unsigned);
  FN(void, glGetProgramiv, unsigned, unsigned, int*); FN(void, glGetProgramInfoLog, unsigned, int, int*, char*);
  unsigned program = glCreateProgram();
  for (int i = 0; i < 2; i++) {
    auto source = read(argv[3 + i]); const char* text = source.c_str();
    unsigned shader = glCreateShader(i ? 0x8b30 : 0x8b31); glShaderSource(shader, 1, &text, nullptr); glCompileShader(shader);
    int ok; glGetShaderiv(shader, 0x8b81, &ok);
    if (!ok) { char log[32768]; glGetShaderInfoLog(shader, sizeof(log), nullptr, log); std::cerr << log; return 3; }
    glAttachShader(program, shader);
  }
  glLinkProgram(program); int ok; glGetProgramiv(program, 0x8b82, &ok);
  if (!ok) { char log[32768]; glGetProgramInfoLog(program, sizeof(log), nullptr, log); std::cerr << log; return 4; }
  FN(void, glUseProgram, unsigned); FN(int, glGetUniformLocation, unsigned, const char*);
  FN(void, glUniform1i, int, int); FN(void, glUniform1f, int, float);
  FN(void, glUniform2f, int, float, float); FN(void, glUniform3f, int, float, float, float);
  FN(void, glUniform4f, int, float, float, float, float); FN(void, glUniformMatrix4fv, int, int, unsigned char, const float*);
  FN(void, glGenBuffers, int, unsigned*); FN(void, glBindBuffer, unsigned, unsigned);
  FN(void, glBufferData, unsigned, long, const void*, unsigned); FN(int, glGetAttribLocation, unsigned, const char*);
  FN(void, glEnableVertexAttribArray, unsigned); FN(void, glVertexAttribPointer, unsigned, int, unsigned, unsigned char, int, const void*);
  FN(void, glGenTextures, int, unsigned*); FN(void, glBindTexture, unsigned, unsigned);
  FN(void, glTexImage2D, unsigned, int, int, int, int, int, unsigned, unsigned, const void*);
  FN(void, glTexParameteri, unsigned, unsigned, int); FN(void, glViewport, int, int, int, int);
  FN(void, glClearColor, float, float, float, float); FN(void, glClear, unsigned); FN(void, glDrawArrays, unsigned, int, int);
  FN(void, glReadPixels, int, int, int, int, unsigned, unsigned, void*); FN(unsigned, glGetError);
  glUseProgram(program);
  auto location = [&](const char* name) { return glGetUniformLocation(program, name); };
  float identity[] = {1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1};
  float projection[] = {5000.f/960,0,0,0, 0,5000.f/540,0,0, 0,0,-1.0001f,-1, 0,0,-2.0001f,0};
  float model[] = {1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-5000,1};
  glUniformMatrix4fv(location("planeMatrix"), 1, 0, identity);
  glUniformMatrix4fv(location("projectionMatrix"), 1, 0, projection);
  glUniformMatrix4fv(location("modelViewMatrix"), 1, 0, model);
  glUniform1i(location("cameraCount"), 0); glUniform1i(location("motionCount"), 0);
  glUniform2f(location("resolution"), 1920, 1080); glUniform4f(location("bounds"), 1518, 678, 804, 804);
  glUniform4f(location("directBrush"), 1920, 1080, 800, 800); glUniform1i(location("directShape"), 1);
  glUniform1f(location("layerOpacity"), 1); glUniform3f(location("fillColor"), 1, .25, .125);
  unsigned texture, buffer; glGenTextures(1, &texture); glBindTexture(0x0de1, texture);
  unsigned char transparent[] = {0,0,0,0}; glTexImage2D(0x0de1, 0, 0x1908, 1, 1, 0, 0x1908, 0x1401, transparent);
  glTexParameteri(0x0de1, 0x2801, 0x2600); glTexParameteri(0x0de1, 0x2800, 0x2600);
  float vertices[] = {-.5,-.5,0, .5,-.5,0, -.5,.5,0, .5,.5,0};
  glGenBuffers(1, &buffer); glBindBuffer(0x8892, buffer); glBufferData(0x8892, sizeof(vertices), vertices, 0x88e4);
  int position = glGetAttribLocation(program, "position"); glEnableVertexAttribArray(position); glVertexAttribPointer(position, 3, 0x1406, 0, 12, nullptr);
  glViewport(0, 0, 64, 36); glClearColor(0,0,0,0); glClear(0x4000); glDrawArrays(5, 0, 4);
  std::vector<unsigned char> pixels(64*36*4); glReadPixels(0, 0, 64, 36, 0x1908, 0x1401, pixels.data());
  int painted = 0; for (int i = 0; i < 64*36; i++) if (pixels[i*4] > 100 && pixels[i*4+3] > 100) painted++;
  unsigned error = glGetError();
  std::cout << "{\"version\":" << std::quoted((const char*)glGetString(0x1f02)) << ",\"paintedPixels\":" << painted << ",\"glError\":" << error << "}" << std::endl;
  return painted > 100 && error == 0 ? 0 : 5;
}
