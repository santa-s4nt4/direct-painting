import { spawnSync } from 'node:child_process';
import { mkdtemp,writeFile,access,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { volumeVertex,spatialFragment } from '../src/render/volume.js';
import { normalFragment,analogFragment } from '../src/render/shaders.js';

if(process.platform!=='darwin')throw new Error('This ANGLE offscreen check currently supports macOS.');
const candidates=[process.env.ANGLE_LIBRARY_DIR,
 '/Applications/Visual Studio Code.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries',
 '/Applications/TouchDesigner_2025.32050.app/Contents/MacOS/TouchDesigner Web Render.app/Contents/Frameworks/Chromium Embedded Framework.framework/Libraries'].filter(Boolean);
let library;
for(const folder of candidates){try{await access(join(folder,'libEGL.dylib'));await access(join(folder,'libGLESv2.dylib'));library=folder;break;}catch{}}
if(!library)throw new Error('Set ANGLE_LIBRARY_DIR to a directory containing libEGL.dylib and libGLESv2.dylib.');
const folder=await mkdtemp(join(tmpdir(),'direct-gles-'));
try{
 const executable=join(folder,'check'),vertex=join(folder,'volume.vert'),fragment=join(folder,'volume.frag');
 const built=spawnSync('clang++',['-std=c++17',fileURLToPath(new URL('./gles-check.cpp',import.meta.url)),'-o',executable],{encoding:'utf8'});
 if(built.status!==0)throw new Error(built.stderr);
 await writeFile(vertex,'#version 300 es\n'+volumeVertex);
 const run=()=>spawnSync(executable,[join(library,'libEGL.dylib'),join(library,'libGLESv2.dylib'),vertex,fragment],{encoding:'utf8'});
 await writeFile(fragment,'#version 300 es\n'+spatialFragment(normalFragment).replace('uniform highp int cameraCount;','uniform int cameraCount;'));
 const broken=run();if(broken.status!==4||!broken.stderr.includes('cameraCount'))throw new Error('The pre-fix precision mismatch was not reproduced: '+broken.stderr);
 const report={date:new Date().toISOString(),backend:'ANGLE OpenGL ES 3.0 offscreen (not browser UI)',regression:broken.stderr.trim(),checks:[]};
 for(const [name,source] of [['normal layer',normalFragment],['Analog layer',analogFragment]]){
  await writeFile(fragment,'#version 300 es\n'+spatialFragment(source));const result=run();
  if(result.status!==0)throw new Error(name+': '+result.stderr+' '+result.stdout);
  report.checks.push({name,...JSON.parse(result.stdout),passed:true});
 }
 report.passed=true;if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await rm(folder,{recursive:true});}
