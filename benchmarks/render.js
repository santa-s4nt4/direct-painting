import { CANVAS_WIDTH as W, CANVAS_HEIGHT as H, VIEWPORT_WIDTH as VW, VIEWPORT_HEIGHT as VH } from '../src/canvas.js';
import { createPaintingRenderer } from '../src/render/index.js';
import { WebGLPaintingRenderer } from '../src/render/webgl.js';
import { LoopScene } from '../src/scene.js';
import { DEFAULT_VIEW, MIN_ZOOM, MAX_ZOOM, canvasView, worldToScreen } from '../src/view.js';
import { DEFAULT_EFFECTS } from '../src/effects.js';
import { RGBAScene } from '../src/rgba.js';
const result = document.querySelector('#result'), button = document.querySelector('#run');
const gpu = new WebGLPaintingRenderer(document.querySelector('#gpu'));
const ctx = document.querySelector('#cpu').getContext('2d');
const project = clips => ({ version: 1, clips, duration: 10000 });
const clip = (id, mode = 'return', extra = {}) => ({ id, mode, blendMode: 'analog', effects: { ...DEFAULT_EFFECTS, blur: false }, color: '#0d99ff', enabled: true, targets: [0], duration: 200, start: 0, fadeMs: 1000, samples: [{ x: 180, y: 200, size: 60, t: 0 }, { x: 380, y: 200, size: 60, t: 200 }], ...extra });
const gpuPixel = (data, x, y) => [...data.slice(((H - 1 - y) * W + x) * 4, ((H - 1 - y) * W + x) * 4 + 4)];
const presentedPixel = (data, x, y) => [...data.slice(((VH - 1 - y) * VW + x) * 4, ((VH - 1 - y) * VW + x) * 4 + 4)];
const cpuPixel = (data, x, y) => { const i = (y * W + x) * 4, a = data[i + 3] / 255; return [Math.round(data[i] * a), Math.round(data[i + 1] * a), Math.round(data[i + 2] * a), data[i + 3]]; };
const pause = () => new Promise(resolve => requestAnimationFrame(resolve));
const measure = run => { const start = performance.now(); run(); return performance.now() - start; };
const summary = times => ({ meanMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2), p95Ms: +times.slice().sort((a, b) => a - b)[Math.floor(times.length * .95)].toFixed(2) });

button.onclick = async () => {
  button.disabled = true; result.textContent = 'Running pixel and cache checks…';
  const report = { resolution: '3840x2160', viewport: '1920x1080', zoomRange: [MIN_ZOOM, MAX_ZOOM], targetFPS: 60, userAgent: navigator.userAgent, checks: [], benchmark: {} };
  try {
    const cases = [
      ['return', [clip('r')]], ['trail', [clip('t', 'trail')]],
      ['long trail window', [clip('long-trail', 'trail', { duration: 4000, samples: Array.from({ length: 81 }, (_, i) => ({ x: 200 + Math.sin(i / 5) * 20, y: 200, size: 50, t: i * 50 })) })]], ['move', [clip('m', 'move')]],
      ['rectangle', [clip('rect', 'return', { shape: 'rect', angle: 32, samples: [{ x: 180, y: 200, size: 60, width: 80, height: 40, t: 0 }, { x: 380, y: 200, size: 60, width: 80, height: 40, t: 200 }] })]],
      ['gradient', [clip('gradient', 'return', { colorEditMode: 'gradient', colorGradient: { to: '#ff8800', startMs: 0, endMs: 900 } })]],
      ['ring move', [clip('ring-move', 'move', { shape: 'ring', ringWidth: 7 })]],
      ['rectangle outline move', [clip('rect-ring-move', 'move', { shape: 'rect-ring', angle: 45, ringWidth: 5, samples: [{ x: 180, y: 200, size: 60, width: 80, height: 40, t: 0 }, { x: 380, y: 200, size: 60, width: 80, height: 40, t: 200 }] })]],
      ['rectangle outline cached', [clip('rect-ring-cached', 'return', { shape: 'rect-ring', angle: 17, ringWidth: 5, samples: [{ x: 180, y: 200, size: 60, width: 80, height: 40, t: 0 }, { x: 380, y: 200, size: 60, width: 80, height: 40, t: 200 }] })]],
      ['line first frame', [clip('line', 'line', { duration: 0, ringWidth: 6, linePending: false, lineIncomplete: false, samples: [{ x: 180, y: 200, size: 60, t: 0 }, { x: 380, y: 200, size: 60, t: 0 }] })]],
      ['line initial endpoint rings', [clip('line-pending', 'line', { duration: 0, ringWidth: 6, linePending: true, lineIncomplete: false, samples: [{ x: 180, y: 200, size: 60, t: 0 }, { x: 380, y: 200, size: 60, t: 0 }] })]],
      ['line wide-width endpoint rings', [clip('line-wide-pending', 'line', { duration: 0, ringWidth: 1500, linePending: true, lineIncomplete: false, samples: [{ x: 180, y: 200, size: 60, t: 0 }, { x: 380, y: 200, size: 60, t: 0 }] })]],
      ['line incomplete first ring', [clip('line-incomplete', 'line', { duration: 0, ringWidth: 6, linePending: true, lineIncomplete: true, samples: [{ x: 180, y: 200, size: 60, t: 0 }] })]],
      ['ring trail', [clip('ring-trail', 'trail', { shape: 'ring', ringWidth: 7 })]],
      ['opacity', [clip('opacity', 'return', { opacity: .35 })]],
      ['4K far edge', [clip('far-edge', 'return', { samples: [{ x: 3500, y: 1980, size: 80, t: 0 }, { x: 3600, y: 1980, size: 80, t: 200 }] })]],
      ['black', [clip('black', 'return', { color: '#000000' })]],
      ['analog over black', [clip('black-base', 'return', { color: '#000000' }), clip('yellow-over-black', 'return', { color: '#fcd200', blendMode: 'analog' })]],
      ['analog', [clip('below', 'return', { color: '#002185' }), clip('above', 'return', { color: '#fcd200', blendMode: 'analog' })]],
      ['two analog layers', [clip('blue', 'return', { color: '#002185' }), clip('yellow', 'return', { color: '#fcd200', blendMode: 'analog' }), clip('red', 'return', { color: '#ff0000', blendMode: 'analog', mixAmount: 30 })]],
      ['place legacy', [clip('static', 'place', { duration: 0, fadeInMs: 0, holdMs: 1000, fadeOutMs: 100, samples: [{ x: 180, y: 200, size: 60, t: 0 }] })]],
    ];
    for (const [name, clips] of cases) {
      const p = project(clips), cpu = new RGBAScene(p); gpu.setProject(p); let worst = 0;
      for (const time of (name === 'long trail window' ? [2500, 2200, 0] : [0, 100, 700, 4000, 100])) {
        gpu.draw(0, time); const actual = gpu.readPixels(), expected = cpu.draw(0, time);
        for (const [x, y] of [[180, 200], [190, 200], [208, 200], [280, 200], [180, 220], [200, 210], [380, 200], [20, 20], [3500, 1980], [3600, 1980]]) {
          const a = gpuPixel(actual, x, y), e = cpuPixel(expected, x, y);
          const error = Math.max(...a.map((v, i) => Math.abs(v - e[i]))); worst = Math.max(worst, error);
          if (error > 5) throw new Error(`${name} at ${time} (${x},${y}): GPU ${a}, CPU ${e}`);
        }
      }
      report.checks.push({ name, passed: true, maxChannelError: worst });
      await pause();
    }
    const effectClip = clip('fx', 'return', { duration: 100, samples: [{ x: 500, y: 500, size: 160, t: 0 }, { x: 500, y: 500, size: 160, t: 100 }] });
    const drawFX = (effects, time = 50) => { gpu.setProject(project([{ ...effectClip, effects }])); gpu.draw(0, time); return gpu.readPixels(); };
    const off = { ...DEFAULT_EFFECTS, blur: false }, sharp = drawFX(off), masks = gpu.stats.masksCreated;
    const soft = drawFX(DEFAULT_EFFECTS);
    if (gpuPixel(sharp, 590, 500)[3] !== 0 || gpuPixel(soft, 590, 500)[3] < 3) throw new Error('Default blur did not spread this layer');
    const restored = drawFX(off);
    if (restored.some((v, i) => v !== sharp[i]) || gpu.stats.masksCreated !== masks) throw new Error('Toggling effects changed or rebuilt the source geometry');
    report.checks.push({ name: 'Blur defaults to 16px, toggles reversibly and reuses masks', passed: true });
    const retired = drawFX({ ...off, glitch: true, chromatic: true });
    if (retired.some((v, i) => v !== sharp[i])) throw new Error('Retired effects still affect the painting');
    const beforeViewMasks = gpu.stats.masksCreated;
    gpu.setView({ scale: 2, x: -500, y: -500 }); gpu.draw(0, 50);
    const zoomed = gpu.readPixels({ presented: true });
    if (presentedPixel(zoomed, 610, 500)[2] < 200 || gpuPixel(sharp, 610, 500)[3] !== 0) throw new Error('Zoom did not transform the final painting');
    gpu.setView({ scale: .5, x: 0, y: 0 }); gpu.draw(0, 50);
    if (presentedPixel(gpu.readPixels({ presented: true }), 250, 250)[2] < 200) throw new Error('Zoom out has the wrong anchor');
    gpu.setView(DEFAULT_VIEW); gpu.draw(0, 50);
    if (gpu.readPixels().some((v, i) => v !== sharp[i]) || beforeViewMasks !== gpu.stats.masksCreated) throw new Error('View changes rebuilt or mutated the painting');
    report.checks.push({ name: 'Zoom in/out and reset transform presentation without rebuilding source geometry', passed: true });
    const far = clip('4k-viewport', 'return', { samples: [{ x: 3500, y: 1980, size: 80, t: 0 }, { x: 3500, y: 1980, size: 80, t: 200 }] });
    gpu.setProject(project([far])); gpu.draw(0, 50);
    if (gpu.canvas.width !== VW || gpu.canvas.height !== VH || presentedPixel(gpu.readPixels({ presented: true }), 1750, 990)[2] !== 0) throw new Error('Default output is not the center Full HD region');
    gpu.setView({ scale: .1, x: 200, y: 0 }); gpu.draw(0, 50);
    if (gpu.view.scale !== .5 || gpu.view.x !== 0 || gpu.view.y !== 0 || presentedPixel(gpu.readPixels({ presented: true }), 1750, 990)[2] < 200) throw new Error('Fitting 4K hides the far edge or exceeds bounds');
    gpu.setView({ scale: 1, x: -99999, y: -99999 }); gpu.draw(0, 50);
    if (gpu.view.x !== -1920 || gpu.view.y !== -1740 || presentedPixel(gpu.readPixels({ presented: true }), 1580, 240)[2] < 200) throw new Error('Panning does not reach the far 4K region');
    gpu.setView({ scale: 8, x: 5000, y: -99999 });
    if (gpu.view.scale !== 5 || gpu.view.x !== 0 || gpu.view.y !== -13020) throw new Error('Zoom exceeds the 4K bounds');
    gpu.setView(DEFAULT_VIEW);
    const centerClip = clip('center-viewport', 'return', { samples: [{ x: 1920, y: 1080, size: 80, t: 0 }, { x: 1920, y: 1080, size: 80, t: 200 }] });
    gpu.setProject(project([centerClip])); gpu.draw(0, 50);
    if (presentedPixel(gpu.readPixels({ presented: true }), 960, 540)[2] < 200) throw new Error('100% does not center the 4K painting');
    gpu.setView({ scale: .1 }); gpu.draw(0, 50);
    const overview = gpu.readPixels({ presented: true });
    if (presentedPixel(overview, 960, 540)[2] < 200 || presentedPixel(overview, 10, 10)[2] !== 0) throw new Error('50% did not center the entire painting');
    gpu.setView(DEFAULT_VIEW);
    report.checks.push({ name: '4K far-edge painting, 50–500% bounds and centered Full HD default output', passed: true });
    const pose = canvasView({ scale: 1.3, yaw: -35, pitch: 25, rotation: 37 });
    const point3D = { x: 2220, y: 1180, size: 80, t: 0 }, expected3D = worldToScreen(point3D, pose);
    const p3D = project([clip('3d-probe', 'move', { samples: [point3D, { ...point3D, t: 200 }] })]);
    gpu.setProject(p3D); gpu.setView(pose); gpu.draw(0, 50);
    if (!gpu.camera.isPerspectiveCamera || gpu.painting.geometry.parameters.width !== W || presentedPixel(gpu.readPixels({ presented: true }), Math.floor(expected3D.x), Math.floor(expected3D.y))[2] < 200) throw new Error('3D plane and inverse input projection disagree');
    gpu.setView(DEFAULT_VIEW);
    report.checks.push({ name: 'Perspective camera, tilted plane and combined roll project the recorded point correctly', passed: true });
    const untouched = clip('untouched', 'return', { color: '#ff0000', duration: 100, samples: [{ x: 900, y: 500, size: 80, t: 0 }, { x: 900, y: 500, size: 80, t: 100 }] });
    gpu.setProject(project([{ ...effectClip, effects: { ...DEFAULT_EFFECTS } }, untouched])); gpu.draw(0, 50);
    if (gpuPixel(gpu.readPixels(), 945, 500)[3] !== 0 || gpuPixel(gpu.readPixels(), 900, 500)[0] !== 255) throw new Error('An effect leaked into another layer');
    report.checks.push({ name: 'Effects are isolated per layer', passed: true });
    for (const mode of ['trail', 'return', 'move']) {
      const large = clip('large-' + mode, mode, { samples: [{ x: 960, y: 540, size: 3000, t: 0 }, { x: 960, y: 540, size: 3000, t: 200 }] });
      gpu.setProject(project([large])); gpu.draw(0, 100);
      if (gpuPixel(gpu.readPixels(), 10, 10)[2] !== 255 || gpuPixel(gpu.readPixels(), 1910, 1070)[2] !== 255) throw new Error('A 3000px brush was clamped in ' + mode);
    }
    report.checks.push({ name: '3000px brushes render across the Full HD canvas in every motion mode', passed: true });
    const referenceCanvas = document.createElement('canvas');
    class FullPassReference extends WebGLPaintingRenderer {
      prepareLayer(shader, item, ...args) { return super.prepareLayer(shader, item.paintBounds ? { ...item, paintBounds: undefined } : item, ...args); }
      pass(shader, target) { return super.pass(shader, target); }
      compose(...args) { if (this.pendingBounds) this.pendingBounds = { x: 0, y: 0, width: W, height: H }; return super.compose(...args); }
    }
    const reference = new FullPassReference(referenceCanvas);
    try {
      const roiClips = [clip('left', 'trail', { effects: DEFAULT_EFFECTS, samples: [{ x: 2, y: 10, size: 120, t: 0 }, { x: 1000, y: 700, size: 200, t: 200 }] }), clip('right', 'return', { effects: { blur: true, blurRadius: 192 }, color: '#ff8800', samples: [{ x: 3800, y: 2100, size: 100, t: 0 }, { x: 3838, y: 2150, size: 100, t: 200 }] }), clip('overlap', 'return', { effects: DEFAULT_EFFECTS, color: '#ffffff', samples: [{ x: 300, y: 300, size: 400, t: 0 }, { x: 900, y: 650, size: 80, t: 200 }] })];
      gpu.setProject(project(roiClips)); reference.setProject(project(roiClips));
      let worst = 0;
      for (const phase of [100, 2000, 50]) {
        gpu.draw(0, phase); reference.draw(0, phase);
        const actual = gpu.readPixels(), expected = reference.readPixels();
        for (let i = 0; i < actual.length; i++) worst = Math.max(worst, Math.abs(actual[i] - expected[i]));
      }
      gpu.setProject(project([])); reference.setProject(project([]));
      const livePoint = { x: 1920, y: 1080, size: 100, t: 0 };
      const liveProbe = { id: 'region-live', mode: 'trail', color: '#ff00ff', effects: DEFAULT_EFFECTS, targets: [0], samples: [livePoint], last: livePoint, started: 0 };
      for (const now of [0, 100]) {
        if (now) { liveProbe.last = { x: 3000, y: 2000, size: 3000, t: now }; liveProbe.samples.push(liveProbe.last); }
        gpu.setLiveStroke(liveProbe, now); reference.setLiveStroke(liveProbe, now);
        gpu.draw(0, 0, { now }); reference.draw(0, 0, { now });
        const actual = gpu.readPixels(), expected = reference.readPixels();
        for (let i = 0; i < actual.length; i++) worst = Math.max(worst, Math.abs(actual[i] - expected[i]));
      }
      gpu.setLiveStroke(null); reference.setLiveStroke(null);
      if (worst > 1) throw new Error(`Region passes differ from full-frame reference: ${worst}`);
      report.checks.push({ name: 'Region copies and Blur match full-frame passes at overlaps, edges, seeks and growing live strokes', passed: true, maxChannelError: worst });
    } finally { reference.dispose(); }
    const clips = Array.from({ length: 10 }, (_, layer) => clip(`bench-${layer}`, 'trail', {
      color: ['#0d99ff', '#ff7331', '#83dc92'][layer % 3], duration: 1800,
      samples: Array.from({ length: 109 }, (_, i) => ({ x: 180 + i * 13, y: 170 + layer * 68 + Math.sin(i / 11) * 55, size: 60 + (i % 30), t: i * 1000 / 60 })),
    }));
    const p = project(clips), cpu = new LoopScene();
    result.textContent = 'Running 10-layer CPU reference…'; await pause();
    report.benchmark.cpuColdMs = +measure(() => { cpu.setProject(p); cpu.draw(ctx, 0, 500); }).toFixed(2);
    const cpuTimes = [];
    for (let i = 1; i <= 6; i++) { cpuTimes.push(measure(() => cpu.draw(ctx, 0, 500 + i * 1000 / 60))); await pause(); }
    report.benchmark.cpuSamples = cpuTimes.length; report.benchmark.cpu = summary(cpuTimes); cpu.items = [];
    result.textContent = 'Running 10-layer WebGL2 renderer…'; await pause();
    report.benchmark.gpuColdMs = +measure(() => { gpu.setProject(p); gpu.draw(0, 500); gpu.finish(); }).toFixed(2);
    const allocations = gpu.stats.masksCreated, gpuTimes = [];
    for (let i = 1; i <= 30; i++) { gpuTimes.push(measure(() => { gpu.draw(0, 500 + i * 1000 / 60); gpu.finish(); })); await pause(); }
    report.benchmark.gpu = summary(gpuTimes);
    const stable = gpu.stats.masksCreated === allocations;
    report.checks.push({ name: '10-layer warm playback reuses GPU masks', passed: stable }); if (!stable) throw new Error('GPU targets reallocated during warm playback');
    const live = { id: 'bench-live', mode: 'trail', effects: { ...DEFAULT_EFFECTS, blur: false }, color: '#ffffff', targets: [0], started: performance.now(), last: { x: 960, y: 540, size: 80, t: 0 }, samples: [{ x: 960, y: 540, size: 80, t: 0 }] };
    report.benchmark.gpuFirstPointWith10LayersMs = +measure(() => { gpu.setLiveStroke(live, live.started); gpu.draw(0, 1000, { now: live.started }); gpu.finish(); }).toFixed(2);
    gpu.setLiveStroke(null); const before = gpu.stats.masksCreated;
    gpu.setProject({ ...p, clips: p.clips.map((c, i) => i === 0 ? { ...c, color: '#ff00ff' } : c) }); gpu.draw(0, 1100); gpu.finish();
    report.checks.push({ name: 'color edits reuse existing geometry and masks', passed: before === gpu.stats.masksCreated });
    if (before !== gpu.stats.masksCreated) throw new Error('Color edit invalidated raster geometry');
    const effectProject = { ...p, clips: p.clips.map(c => ({ ...c, effects: { ...DEFAULT_EFFECTS } })) };
    gpu.setProject(effectProject); gpu.draw(0, 900); gpu.finish();
    const effectTimes = [];
    for (let i = 0; i < 30; i++) { effectTimes.push(measure(() => { gpu.draw(0, 900 + i * 1000 / 60); gpu.finish(); })); await pause(); }
    report.benchmark.gpu10LayersBlur = summary(effectTimes);
    const effectLive = { ...live, id: 'effect-live', effects: DEFAULT_EFFECTS, started: performance.now() };
    report.benchmark.gpuFirstPointWith10BlurLayersMs = +measure(() => { gpu.setLiveStroke(effectLive, effectLive.started); gpu.draw(0, 1100, { now: effectLive.started }); gpu.finish(); }).toFixed(2);
    gpu.setLiveStroke(null);
    // Late packets must extend the path from the last received source sample,
    // even when the locally predicted head has already advanced in time.
    gpu.setProject(project([]));
    const packet = { id: 'remote-live', from: 0, mode: 'trail', effects: { ...DEFAULT_EFFECTS, blur: false }, color: '#ff0000', targets: [0], elapsed: 0, samples: [{ x: 100, y: 400, size: 20, t: 0 }], head: { x: 100, y: 400, size: 20, t: 0 } };
    gpu.receiveLive(packet, 1000); gpu.draw(0, 0, { now: 1000 }); gpu.draw(0, 0, { now: 1200 });
    gpu.receiveLive({ ...packet, from: 1, elapsed: 100, samples: [{ x: 300, y: 400, size: 20, t: 100 }], head: { x: 300, y: 400, size: 20, t: 100 } }, 1200);
    gpu.draw(0, 0, { now: 1200 });
    const middle = gpuPixel(gpu.readPixels(), 200, 400);
    if (middle[0] < 220 || middle[3] < 220) throw new Error('A late live packet left a gap in the path');
    report.checks.push({ name: 'late live packets preserve the whole path', passed: true });
    gpu.receiveLive(null, 1201);
    gpu.setProject(p); gpu.draw(0, 1100); const probe = clips[0].samples[60], beforeLoss = gpuPixel(gpu.readPixels(), Math.floor(probe.x), Math.floor(probe.y));
    const loss = gpu.renderer.getContext().getExtension('WEBGL_lose_context');
    if (loss) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Context restore timed out')), 5000);
        gpu.canvas.addEventListener('webglcontextrestored', () => { clearTimeout(timeout); resolve(); }, { once: true });
        gpu.canvas.addEventListener('webglcontextlost', () => setTimeout(() => loss.restoreContext(), 50), { once: true });
        loss.loseContext();
      });
      gpu.draw(0, 1100); const afterLoss = gpuPixel(gpu.readPixels(), Math.floor(probe.x), Math.floor(probe.y));
      if (afterLoss.some((value, i) => Math.abs(value - beforeLoss[i]) > 1)) throw new Error('Context restore changed the painting');
      report.checks.push({ name: 'WebGL context loss recovers painting from source data', passed: true });
    }
    report.benchmark.gpuStats = { ...gpu.stats, cachedMaskMiB: +(gpu.stats.maskBytes / 1024 / 1024).toFixed(2) };
    const blocked = document.createElement('canvas'); blocked.width = 1920; blocked.height = 1080;
    const originalContext = blocked.getContext.bind(blocked);
    blocked.getContext = (kind, options) => kind === 'webgl2' ? null : originalContext(kind, options);
    const fallback = createPaintingRenderer(blocked);
    fallback.setView({ scale: 1, x: 0, y: 0 }); fallback.setProject(project([clip('fallback')])); fallback.draw(0, 100);
    const fallbackPixel = [...fallback.ctx.getImageData(180, 200, 1, 1).data];
    if (fallback.backend !== 'cpu' || fallbackPixel[2] !== 255) throw new Error('CPU fallback did not paint');
    fallback.setProject(p3D); fallback.setView(pose); fallback.draw(0, 50);
    if (fallback.ctx.getImageData(Math.floor(expected3D.x), Math.floor(expected3D.y), 1, 1).data[2] < 200) throw new Error('CPU fallback does not project the same 3D plane');
    fallback.dispose(); report.checks.push({ name: 'WebGL2-unavailable devices use a working CPU fallback', passed: true });
    report.benchmark.speedup = +(report.benchmark.cpu.meanMs / report.benchmark.gpu.meanMs).toFixed(1);
    report.passed = true;
  } catch (error) { report.passed = false; report.error = error.stack || error.message; }
  result.textContent = JSON.stringify(report, null, 2); result.dataset.complete = 'true'; button.disabled = false;
};
