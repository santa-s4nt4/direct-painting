import { VolumePaintingRenderer } from '../src/render/volume.js';
import { CPUVolumeRenderer } from '../src/render/volume-cpu.js';
import { target } from '../src/render/webgl.js';
import { analogFragment } from '../src/render/shaders.js';
import { layerEffects, DEFAULT_EFFECTS } from '../src/effects.js';
import { DEFAULT_VIEW, canvasView, CAMERA_DISTANCE } from '../src/view.js';
import { workingPlane, pointInSpace, projectSpace } from '../src/space.js';
import { traceHead, traceHeadMarkers, MAX_TRACE_HEAD_MARKERS } from '../src/trace-motion.js';
import { cameraProjection } from '../src/render/camera-exposure.js';
import { CameraSampler, DEFAULT_CAMERA } from '../src/camera-motion.js';

// Retain the full-frame composition algorithm as an independent reference for
// dirty-region synchronization. Both paths use the current contour shaders.
// Compare painting coverage independently of the white overlay. Head continuity
// and the unchanged intersection-dot footprint have their own pixel checks below.
class CheckedRenderer extends VolumePaintingRenderer {
  drawSharpOverlayMarkers(markers){super.drawSharpOverlayMarkers(this.hideTraceHeads?markers.filter(m=>!m.traceHead):markers);}
}
class CheckedCPU extends CPUVolumeRenderer {
  drawSharpOverlayMarkers(markers){super.drawSharpOverlayMarkers(this.hideTraceHeads?markers.filter(m=>!m.traceHead):markers);}
}
class FullFrameReference extends CheckedRenderer {
  draw(...args) { this.referenceComposed = false; super.draw(...args); }
  pass(shader, rt) { super.pass(shader, rt); }
  prepareLayer(shader, item, ...args) {
    const bounds = super.prepareLayer(shader, item, ...args);
    if (shader.uniforms.cameraConicCount.value) {
      const projection = cameraProjection(item.clip, item.exposure, bounds);
      projection.inverse.forEach((m, i) => shader.uniforms.cameraInverse.value[i].set(...m)); shader.uniforms.cameraConicCount.value = 0;
    }
    return bounds;
  }
  compose(item, time, opacity, visual) {
    const clip = item.clip, effects = layerEffects(clip); let shader;
    if (effects.blur && effects.blurRadius > 0) {
      this.prepareEffects(); this.clearTarget(this.effectSource);
      this.prepareLayer(this.normalMaterial, item, time, opacity, visual); this.pass(this.normalMaterial, this.effectSource);
      this.copyMaterial.uniforms.image.value = this.effectSource.texture; this.pass(this.copyMaterial, this.blurA);
      const radius = effects.blurRadius * this.view.scale;
      this.blurMaterial.uniforms.image.value = this.blurA.texture; this.blurMaterial.uniforms.direction.value.set(radius / 16 / 1920, 0); this.pass(this.blurMaterial, this.blurB);
      this.blurMaterial.uniforms.image.value = this.blurB.texture; this.blurMaterial.uniforms.direction.value.set(0, radius / 16 / 1080); this.pass(this.blurMaterial, this.blurA);
      shader = this.effectMaterial; shader.uniforms.image.value = this.blurA.texture;
    } else {
      this.analogMaterial ??= this.layerMaterial(analogFragment); shader = this.analogMaterial;
      this.prepareLayer(shader, item, time, opacity, visual);
    }
    this.alternate ??= target(1920, 1080, true);
    if (this.referenceComposed) { this.copyMaterial.uniforms.image.value = this.current.texture; this.pass(this.copyMaterial, this.alternate); }
    else this.clearTarget(this.alternate);
    shader.uniforms.belowTexture.value = this.current.texture; shader.uniforms.mixAmount.value = (clip.mixAmount ?? 50) / 100;
    this.pass(shader, this.alternate); [this.current, this.alternate] = [this.alternate, this.current]; this.referenceComposed = true;
  }
}
const next = () => new Promise(requestAnimationFrame);
const project = clips => ({ version: 1, duration: 16000, clips });
const clip = (i, extra = {}) => ({ id: `gpu-${i}`, mode: 'move', shape: 'ring', color: i % 2 ? '#0055ff' : '#ff8020', targets: [0], enabled: true, opacity: 1, ringWidth: 10,
  effects: { ...DEFAULT_EFFECTS, motionBlur: false }, plane: workingPlane(DEFAULT_VIEW), duration: 1000, start: 0, fadeMs: 1000,
  samples: [{ x: 1800 + i * 70, y: 1080, size: 320, t: 0 }, { x: 2000 + i * 25, y: 1140, size: 480, t: 1000 }], ...extra });
const views = Array.from({ length: 16 }, (_, i) => canvasView({ ...DEFAULT_VIEW, yaw: -3 + i * .4, pitch: -1 + i * .15 }));
const statsDelta = (after, before) => Object.fromEntries(['copyPixels', 'blurPixels', 'masksCreated', 'maskBytes', 'directLayers', 'culledLayers', 'cameraFastLayers'].map(k => [k, after[k] - before[k]]));

export async function measureGPU(renderer, source, { frames = 24, phase = 400, cameraViews = null } = {}) {
  renderer.setView(cameraViews?.at(-1) ?? DEFAULT_VIEW); renderer.setProject(source);
  for (let i = 0; i < 8; i++) { renderer.draw(0, phase, { cameraViews }); await next(); }
  const gl = renderer.renderer.getContext(), timer = gl.getExtension('EXT_disjoint_timer_query_webgl2'), cpuMs = [], gpuMs = [], before = { ...renderer.stats };
  for (let i = 0; i < frames; i++) {
    await next(); const query = timer ? gl.createQuery() : null;
    if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    const begin = performance.now(); renderer.draw(0, phase, { cameraViews }); cpuMs.push(performance.now() - begin);
    if (query) {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      let ready = false;
      for (let j = 0; j < 120; j++) { await next(); if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) { ready = true; break; } }
      if (ready && !gl.getParameter(timer.GPU_DISJOINT_EXT)) gpuMs.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query);
    }
  }
  const summary = values => { const sorted = values.toSorted((a, b) => a - b); return sorted.length ? { samples: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] } : null; };
  const work = statsDelta(renderer.stats, before); for (const key of Object.keys(work)) work[key] /= frames;
  const scratchBytes = [renderer.effectSource, renderer.blurA, renderer.blurB].reduce((bytes, target) => bytes + (target ? target.width * target.height * 4 : 0), 0);
  return { cpuSubmission: summary(cpuMs), gpu: summary(gpuMs), residentMaskBytes: renderer.stats.maskBytes, scratchBytes, perFrame: { ...work, drawCalls: renderer.stats.drawCalls } };
}

export async function runGPUChecks(canvas = document.querySelector('#gpu')) {
  const report = { date: new Date().toISOString(), checks: [] }, gpu = new CheckedRenderer(canvas), reference = new FullFrameReference(document.createElement('canvas'));
  const check = (name, passed, details = {}) => { report.checks.push({ name, passed, ...details }); if (!passed) throw new Error(name); };
  try {
    check('Unused Blur targets are not allocated', !gpu.effectSource && !gpu.blurA && !gpu.blurB);
    const prepared = new VolumePaintingRenderer(document.createElement('canvas'));
    try {
      prepared.setProject(project([0, 1].map(i => clip(i, { shape: 'circle', origin: [0, 0, i ? -320 : 320], samples: [{ x: i ? 2240 : 1600, y: 1080, size: 300, t: 0 }] }))));
      prepared.draw(0, 0); const programs = prepared.renderer.info.programs.length, textures = prepared.renderer.info.memory.textures;
      prepared.setView(canvasView({ ...DEFAULT_VIEW, yaw: 45 })); prepared.draw(0, 0);
      check('First overlap caused by a camera orbit compiles no new programs and allocates no textures', prepared.renderer.info.programs.length === programs && prepared.renderer.info.memory.textures === textures,
        { newPrograms: prepared.renderer.info.programs.length - programs, newTextures: prepared.renderer.info.memory.textures - textures });
    } finally { prepared.dispose(); }
    const scenes = [
      ['translucent pigment overlap and mixed source-over layers', [clip(0, { opacity: .7 }), clip(1, { mixAmount: 100 }), clip(2, { shape: 'rect-ring', opacity: .6 })], null],
      ['Blur halos across saved planes', [clip(0, { effects: { ...DEFAULT_EFFECTS, blur: true, motionBlur: false } }), clip(1, { plane: workingPlane(canvasView({ ...DEFAULT_VIEW, yaw: 50 })), effects: { ...DEFAULT_EFFECTS, blur: true, blurRadius: 48, motionBlur: false } }), clip(2)], null],
      ['camera exposure on rotated planes', [clip(0), clip(1, { plane: workingPlane(canvasView({ ...DEFAULT_VIEW, yaw: 60, pitch: 20 })) })], views],
      ['offscreen layer culling', [clip(0), clip(1, { samples: [{ x: 100, y: 100, size: 50, t: 0 }] })], null],
    ];
    for (const [name, clips, cameraViews] of scenes) {
      const source = project(clips); gpu.setProject(source); reference.setProject(source); gpu.setView(cameraViews?.at(-1) ?? DEFAULT_VIEW); reference.setView(gpu.view); let maxError = 0;
      for (const phase of [0, 400, 1200, 1900, 100]) {
        gpu.draw(0, phase, { cameraViews }); reference.draw(0, phase, { cameraViews }); const a = gpu.readPixels(), b = reference.readPixels();
        for (let i = 0; i < a.length; i++) maxError = Math.max(maxError, Math.abs(a[i] - b[i]));
      }
      check(`${name}: cropped rendering matches full-frame reference, including rewind`, maxError <= 2, { maxChannelError: maxError });
      await next();
    }
    const expectedCanvas = document.createElement('canvas'); expectedCanvas.width = 1920; expectedCanvas.height = 1080; const ctx = expectedCanvas.getContext('2d', { willReadFrequently: true });
    gpu.hideTraceHeads=reference.hideTraceHeads=true;
    for (const [shape, filled] of [['circle', false], ['rect', false], ['circle', true], ['rect', true]]) {
      const source = clip(0, { shape: filled ? shape : shape === 'circle' ? 'ring' : 'rect-ring', color: '#ffffff', samples: [{ x: 1920, y: 1080, size: 400, t: 0 }], trace: { pending: false, drawMs: 500, strokeWidth: 10, peak: { x: 1920, y: 1080, size: 400, width: 400, height: 260, angle: 25, t: 0 } } });
      gpu.setProject(project([source])); gpu.setView(DEFAULT_VIEW); const before = gpu.stats.masksCreated; let mismatch = 0, fractional = 0;
      for (const time of [0, 125, 250, 375, 500]) {
        gpu.draw(0, time); const actual = gpu.readPixels(), head = traceHead(source, time); ctx.clearRect(0, 0, 1920, 1080); ctx.save(); ctx.translate(960, 540); ctx.rotate(25 * Math.PI / 180); ctx.strokeStyle = '#fff'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
        const t = time / 500, progress = t * t * (3 - 2 * t);
        if (filled) { ctx.fillStyle = '#fff'; ctx.moveTo(0, 0); }
        if (shape === 'circle') { if (filled) ctx.lineTo(0, -200); ctx.arc(0, 0, 200, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * progress); }
        else { const corners = [[-200, -130], [200, -130], [200, 130], [-200, 130], [-200, -130]]; let distance = progress * 1320; if (filled) ctx.lineTo(...corners[0]); else ctx.moveTo(...corners[0]); for (let i = 0; i < 4 && distance > 0; i++) { const [a, b] = [corners[i], corners[i + 1]], length = Math.hypot(b[0] - a[0], b[1] - a[1]), fraction = Math.min(1, distance / length); ctx.lineTo(a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction); distance -= length; } }
        if (filled) { ctx.closePath(); ctx.fill(); } else if (time > 0) ctx.stroke();
        ctx.restore(); const expected = ctx.getImageData(0, 0, 1920, 1080).data;
        for (let y = 200; y < 880; y++) for (let x = 600; x < 1320; x++) {
          if (head && Math.hypot(x + .5 - (head.x - 960), y + .5 - (head.y - 540)) < 12) continue;
          const p = (y * 1920 + x) * 4, value = actual[((1079 - y) * 1920 + x) * 4]; if (value > 0 && value < 255) fractional++;
          const e = expected[p + 3]; if (e !== 0 && e !== 255) continue;
          let interior = true; for (const dy of [-2, 0, 2]) for (const dx of [-2, 0, 2]) if (expected[((y + dy) * 1920 + x + dx) * 4 + 3] !== e) interior = false;
          if (interior && Math.abs(value - e) > 2) mismatch++;
        }
      }
      check(`${shape} ${filled ? 'filled' : 'outline'} Trace matches independent Canvas paths, has fractional edge coverage and allocates no GPU mask`, mismatch === 0 && fractional > 100 && gpu.stats.masksCreated === before, { interiorMismatches: mismatch, fractionalEdgePixels: fractional, masksCreated: gpu.stats.masksCreated - before });
      const spatial = { ...source, plane: workingPlane(canvasView({ ...DEFAULT_VIEW, yaw: 40, pitch: 20 })) };
      gpu.setProject(project([spatial])); reference.setProject(project([spatial])); gpu.setView(views.at(-1)); gpu.draw(0, 250, { cameraViews: views });
      const actual = gpu.readPixels(), mean = new Float32Array(actual.length), head = traceHead(spatial, 250), heads = views.map(view => projectSpace(pointInSpace(head, spatial.plane), view));
      for (const view of views) { reference.setView(view); reference.draw(0, 250); const pixels = reference.readPixels(); for (let p = 0; p < pixels.length; p++) mean[p] += pixels[p] / views.length; }
      let maxError = 0, squared = 0, channelsOver2 = 0;
      for (let y = 0; y < 1080; y++) for (let x = 0; x < 1920; x++) {
        if (heads.some(head => Math.hypot(x + .5 - head.x, y + .5 - head.y) < 12)) continue;
        const p = ((1079 - y) * 1920 + x) * 4; for (let c = 0; c < 3; c++) { const delta = Math.abs(actual[p + c] - Math.round(mean[p + c])); maxError = Math.max(maxError, delta); squared += delta * delta; if (delta > 2) channelsOver2++; }
      }
      const rmsError = Math.sqrt(squared / (1920 * 1080 * 3));
      check(`${shape} ${filled ? 'filled' : 'outline'} Trace camera exposure matches independent sharp projections`, rmsError < .15 && channelsOver2 < 128, { maxChannelError: maxError, rmsError, channelsOver2 });
      if (shape === 'circle') {
        gpu.draw(0, 500, { cameraViews: views }); const fast = gpu.readPixels(); reference.setView(views.at(-1)); reference.draw(0, 500, { cameraViews: views }); const slow = reference.readPixels();
        let error = 0, squared = 0; for (let p = 0; p < fast.length; p++) { const delta = Math.abs(fast[p] - slow[p]); error = Math.max(error, delta); squared += delta * delta; }
        const rmsError = Math.sqrt(squared / fast.length);
        check(`Completed ${filled ? 'filled' : 'outline'} Circle Trace uses all 16 camera samples through the fast path and matches inverse projection`, gpu.normalMaterial.uniforms.cameraConicCount.value === views.length && rmsError < .15, { maxChannelError: error, rmsError, samples: gpu.normalMaterial.uniforms.cameraConicCount.value });
      }
    }
    for (const kind of ['circle', 'ring', 'outside-guide circle']) {
      const source = clip(0, { shape: kind === 'ring' ? 'ring' : 'circle', opacity: .4, plane: workingPlane(canvasView({ ...DEFAULT_VIEW, yaw: 25, pitch: -15 })),
        samples: [{ x: kind === 'outside-guide circle' ? 3800 : 2070, y: 1170, size: 800, t: 0 }] });
      const poses = Array.from({ length: 16 }, (_, i) => canvasView({ ...DEFAULT_VIEW, scale: 1.2, yaw: 58 + i * .5, pitch: 25 + i * .2, rotation: 30, distance: 5500 + i * 20 }));
      gpu.setProject(project([source])); reference.setProject(project([source])); gpu.setView(poses.at(-1)); reference.setView(gpu.view);
      gpu.draw(0, 400, { cameraViews: poses }); const actual = gpu.readPixels(); reference.draw(0, 400, { cameraViews: poses }); const expected = reference.readPixels();
      let maxError = 0, squared = 0; for (let p = 0; p < actual.length; p++) { const delta = Math.abs(actual[p] - expected[p]); maxError = Math.max(maxError, delta); squared += delta * delta; }
      const rmsError = Math.sqrt(squared / actual.length), samples = gpu.normalMaterial.uniforms.cameraConicCount.value;
      check(`${kind}: rapid orbital exposure preserves opacity and perspective through the fast path`, rmsError < .15 && samples === 16, { maxChannelError: maxError, rmsError, fastSamples: samples });
    }
    const outsideView=canvasView({...DEFAULT_VIEW,scale:.5,distance:12000}),outsideCenter={x:5500,y:3000},scale=outsideView.scale*CAMERA_DISTANCE/outsideView.distance;
    const center=projectSpace(pointInSpace(outsideCenter,workingPlane(DEFAULT_VIEW)),outsideView);
    const cpuOutside=new CheckedCPU(document.createElement('canvas'));cpuOutside.hideTraceHeads=true;
    try{for(const shape of ['circle','ring','rect','rect-ring'])for(const tracing of [false,true]){
      const source=clip(0,{shape,angle:25,color:'#ffffff',ringWidth:20,samples:[{...outsideCenter,size:400,width:400,height:260,angle:25,t:0}],...(tracing?{trace:{pending:false,drawMs:500,strokeWidth:20,peak:{...outsideCenter,size:400,width:400,height:260,angle:25,t:0}}}:{})});
      gpu.setView(outsideView);gpu.setProject(project([source]));cpuOutside.setView(outsideView);cpuOutside.setProject(project([source]));const before=gpu.stats.masksCreated;let mismatch=0,cpuMismatch=0;
      for(const time of tracing?[250,500]:[0]){
        gpu.draw(0,time);cpuOutside.draw(0,time);const actual=gpu.readPixels(),cpuPixels=cpuOutside.canvas.getContext('2d').getImageData(0,0,1920,1080).data,head=tracing&&traceHead(source,time),screenHead=head&&projectSpace(pointInSpace(head,source.plane),outsideView);
        ctx.clearRect(0,0,1920,1080);ctx.save();ctx.translate(center.x,center.y);ctx.scale(scale,scale);ctx.rotate(25*Math.PI/180);ctx.fillStyle=ctx.strokeStyle='#fff';ctx.lineWidth=20;ctx.lineJoin=ctx.lineCap='round';ctx.beginPath();
        const rect=shape==='rect'||shape==='rect-ring',filled=shape==='circle'||shape==='rect',progress=tracing?Math.min(1,time/500):1;
        if(tracing){
          if(filled)ctx.moveTo(0,0);
          if(!rect){if(filled)ctx.lineTo(0,-200);ctx.arc(0,0,200,-Math.PI/2,-Math.PI/2+Math.PI*2*progress);}
          else{const corners=[[-200,-130],[200,-130],[200,130],[-200,130],[-200,-130]];if(filled)ctx.lineTo(...corners[0]);else ctx.moveTo(...corners[0]);let remaining=progress*1320;for(let i=0;i<4&&remaining>0;i++){const a=corners[i],b=corners[i+1],length=Math.hypot(b[0]-a[0],b[1]-a[1]),t=Math.min(1,remaining/length);ctx.lineTo(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);remaining-=length;}}
        }else if(rect){const edge=filled?0:20;ctx.rect(-200+edge/2,-130+edge/2,400-edge,260-edge);}
        else ctx.arc(0,0,filled?200:190,0,Math.PI*2);
        if(filled){ctx.closePath();ctx.fill();}else ctx.stroke();ctx.restore();const expected=ctx.getImageData(0,0,1920,1080).data;
        for(let y=Math.floor(center.y)-75;y<Math.ceil(center.y)+75;y++)for(let x=Math.floor(center.x)-75;x<Math.ceil(center.x)+75;x++){
          if(screenHead&&Math.hypot(x+.5-screenHead.x,y+.5-screenHead.y)<12)continue;
          const e=expected[(y*1920+x)*4+3];if(e!==0&&e!==255)continue;
          let interior=true;for(const dy of[-2,0,2])for(const dx of[-2,0,2])if(expected[((y+dy)*1920+x+dx)*4+3]!==e)interior=false;
          if(interior&&Math.abs(actual[((1079-y)*1920+x)*4]-e)>2)mismatch++;
          if(interior&&Math.abs(cpuPixels[(y*1920+x)*4]-e)>2)cpuMismatch++;
        }
      }
      check(`Outside guide ${shape}${tracing?' Trace':''}: GPU and CPU match Canvas without new masks or larger buffers`,mismatch===0&&cpuMismatch===0&&gpu.stats.masksCreated===before&&gpu.accumulator.width===1920&&gpu.accumulator.height===1080,{interiorMismatches:mismatch,cpuInteriorMismatches:cpuMismatch,masksCreated:gpu.stats.masksCreated-before});
    }}finally{cpuOutside.dispose();}
    const nearViews=Array.from({length:16},(_,i)=>canvasView({...DEFAULT_VIEW,yaw:-.1+i*.2/15}));
    const nearSource=clip(0,{shape:'circle',color:'#ffffff',opacity:.4,origin:[0,0,4990],plane:workingPlane(canvasView({...DEFAULT_VIEW,yaw:60})),samples:[{x:1920,y:1080,size:400,t:0}]});
    gpu.setView(nearViews.at(-1));gpu.setProject(project([nearSource]));gpu.draw(0,0,{cameraViews:nearViews});const nearActual=gpu.readPixels(),nearMean=new Float32Array(nearActual.length);
    reference.setProject(project([nearSource]));for(const view of nearViews){reference.setView(view);reference.draw(0,0);const pixels=reference.readPixels();for(let p=0;p<pixels.length;p++)nearMean[p]+=pixels[p]/nearViews.length;}
    let nearSquared=0,nearMax=0;for(let p=0;p<nearActual.length;p++){const error=Math.abs(nearActual[p]-Math.round(nearMean[p]));nearSquared+=error*error;nearMax=Math.max(nearMax,error);}
    const nearRms=Math.sqrt(nearSquared/nearActual.length);
    check('Camera near-plane crossings stay finite and match independently clipped sharp views',nearRms<.15&&gpu.normalMaterial.uniforms.cameraDepthClipped.value===1&&gpu.normalMaterial.uniforms.cameraConicCount.value===0,{rmsError:nearRms,maxChannelError:nearMax});
    gpu.setView(DEFAULT_VIEW);gpu.setProject(project([{...nearSource,origin:[0,0,6000]}]));gpu.draw(0,0,{cameraViews:nearViews});
    check('Geometry behind the camera is culled without mirrored fragments',gpu.readPixels().every((v,i)=>i%4===3||v===0));
    gpu.hideTraceHeads=reference.hideTraceHeads=false;
    const movingHead=clip(0,{shape:'ring',color:'#0055ff',trace:{pending:false,drawMs:500,strokeWidth:10,peak:{x:1920,y:1080,size:800,t:0}}});
    gpu.setView(DEFAULT_VIEW);gpu.setProject(project([movingHead]));const capacity=gpu.markerCapacity,textures=gpu.renderer.info.memory.textures;
    gpu.draw(0,250-1000/30,{now:0});gpu.draw(0,250,{now:1000/30});const sweepPixels=gpu.readPixels();let gaps=0;
    for(let i=5;i<=30;i++){const p=projectSpace(pointInSpace(traceHead(movingHead,250-(1000/30)*(1-i/30)),movingHead.plane),DEFAULT_VIEW),x=Math.round(p.x),y=Math.round(p.y);if(sweepPixels[((1079-y)*1920+x)*4]<2)gaps++;}
    check('A moving white head stays connected over a 30fps step in the existing single overlay pass',gaps===0&&gpu.markerGeometry.drawRange.count>10&&gpu.markerGeometry.drawRange.count<=MAX_TRACE_HEAD_MARKERS&&gpu.stats.drawCalls===3&&gpu.markerCapacity===capacity&&gpu.renderer.info.memory.textures===textures,{gaps,markers:gpu.markerGeometry.drawRange.count,drawCalls:gpu.stats.drawCalls,markerBufferBytes:gpu.markerData.byteLength});
    const sweepCPU=new CPUVolumeRenderer(document.createElement('canvas'));
    try{sweepCPU.setProject(project([movingHead]));sweepCPU.setView(DEFAULT_VIEW);sweepCPU.draw(0,250,{now:1000/30});const data=sweepCPU.canvas.getContext('2d').getImageData(0,0,1920,1080).data;let cpuGaps=0;for(let i=5;i<=30;i++){const p=projectSpace(pointInSpace(traceHead(movingHead,250-(1000/30)*(1-i/30)),movingHead.plane),DEFAULT_VIEW);if(data[(Math.round(p.y)*1920+Math.round(p.x))*4]<2)cpuGaps++;}check('CPU fallback connects the same white-head sweep',cpuGaps===0,{gaps:cpuGaps});}finally{sweepCPU.dispose();}
    gpu.setProject(project([]));gpu.draw(0,0);gpu.drawSharpOverlayMarkers([{x:960,y:540,alpha:1}]);const intersectionPixel=gpu.readPixels();
    check('Intersection dots retain a white 15px circular footprint with no sweep',intersectionPixel[((1079-540)*1920+960)*4]===255&&intersectionPixel[((1079-540)*1920+970)*4]===0);
    const headClip = clip(0, { color: '#fffFFF', trace: { pending: false, drawMs: 500, strokeWidth: 10, peak: { x: 1920, y: 1080, size: 400, t: 0 } } });
    gpu.setView(DEFAULT_VIEW); gpu.setProject(project([headClip])); gpu.draw(0, 499); const beforeEnd = gpu.readPixels()[((1079 - 334) * 1920 + 960) * 4]; gpu.draw(0, 500); const afterEnd = gpu.readPixels()[((1079 - 334) * 1920 + 960) * 4];
    check('Trace head disappears at draw completion while its stroke remains', beforeEnd > 200 && afterEnd <= 2, { beforeEnd, afterEnd });
    gpu.setProject(project([{ ...headClip, trace: { ...headClip.trace, strokeWidth: 20, peak: { ...headClip.trace.peak, size: 10 } } }])); gpu.draw(0, 500);
    check('A Trace wider than its radius has no false central hole', gpu.readPixels()[((1079 - 540) * 1920 + 960) * 4] === 255);
    const separated = project(Array.from({ length: 10 }, (_, i) => clip(i, { shape: 'circle', samples: [{ x: 1200 + i % 5 * 350, y: 800 + Math.floor(i / 5) * 500, size: 80, t: 0 }] })));
    gpu.setProject(separated); gpu.setView(DEFAULT_VIEW); const before = { ...gpu.stats }; gpu.draw(0, 0); const work = statsDelta(gpu.stats, before);
    check('Ten disjoint shapes need no compositing copies and one drawing pass each', work.copyPixels === 0 && work.directLayers === 10, work);
    report.performance = await measureGPU(gpu, project(Array.from({ length: 10 }, (_, i) => clip(i))), { phase: 400 });
    const config = { ...DEFAULT_CAMERA, mode: 'midi-auto', duration: 200 }, event = { at: 0, key: 'benchmark', from: canvasView({ ...DEFAULT_VIEW, yaw: -30, pitch: -10, scale: .8 }), target: canvasView({ ...DEFAULT_VIEW, yaw: 100, pitch: 30, scale: 2 }), duration: 200, easing: 'smooth', baseScale: 1 };
    const burst = new CameraSampler().frame({ config, event }, DEFAULT_VIEW, 100, 100, 100);
    const traces = project(Array.from({ length: 4 }, (_, i) => clip(i, { duration: 6000, fadeMs: 5000, trace: { pending: false, drawMs: 500, strokeWidth: 20, peak: { x: 1920 + i * 20, y: 1080, size: 1400, t: 0 } } })));
    report.cameraBurst = { durationMs: 200, cameraSamples: burst.cameraViews.length, performance: await measureGPU(gpu, traces, { phase: 800, cameraViews: burst.cameraViews }) };
    check('No WebGL errors', gpu.renderer.getContext().getError() === 0); report.passed = true;
  } catch (error) { report.passed = false; report.error = String(error.stack ?? error); }
  finally { gpu.dispose(); reference.dispose(); }
  return report;
}
const run = document.querySelector('#run'), result = document.querySelector('#result');
if (run) run.onclick = async () => { run.disabled = true; result.textContent = 'Checking GPU output…'; delete result.dataset.complete; const report = await runGPUChecks(); result.textContent = JSON.stringify(report, null, 2); result.dataset.complete = 'true'; run.disabled = false; };
