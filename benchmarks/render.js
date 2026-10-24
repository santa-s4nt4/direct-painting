import { createPaintingRenderer } from '../src/render/index.js';
import { WebGLPaintingRenderer } from '../src/render/webgl.js';
import { LoopScene } from '../src/scene.js';
import { RGBAScene } from '../src/rgba.js';
const result = document.querySelector('#result'), button = document.querySelector('#run');
const gpu = new WebGLPaintingRenderer(document.querySelector('#gpu'));
const ctx = document.querySelector('#cpu').getContext('2d');
const project = clips => ({ version: 1, clips, duration: 10000 });
const clip = (id, mode = 'return', extra = {}) => ({ id, mode, color: '#0d99ff', enabled: true, targets: [0], duration: 200, start: 0, fadeMs: 1000, samples: [{ x: 180, y: 200, size: 60, t: 0 }, { x: 380, y: 200, size: 60, t: 200 }], ...extra });
const gpuPixel = (data, x, y) => [...data.slice(((1080 - 1 - y) * 1920 + x) * 4, ((1080 - 1 - y) * 1920 + x) * 4 + 4)];
const cpuPixel = (data, x, y) => { const i = (y * 1920 + x) * 4, a = data[i + 3] / 255; return [Math.round(data[i] * a), Math.round(data[i + 1] * a), Math.round(data[i + 2] * a), data[i + 3]]; };
const pause = () => new Promise(resolve => requestAnimationFrame(resolve));
const measure = run => { const start = performance.now(); run(); return performance.now() - start; };
const summary = times => ({ meanMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2), p95Ms: +times.slice().sort((a, b) => a - b)[Math.floor(times.length * .95)].toFixed(2) });

button.onclick = async () => {
  button.disabled = true; result.textContent = 'Running pixel and cache checks…';
  const report = { resolution: '1920x1080', targetFPS: 60, userAgent: navigator.userAgent, checks: [], benchmark: {} };
  try {
    const cases = [
      ['return', [clip('r')]], ['trail', [clip('t', 'trail')]], ['move', [clip('m', 'move')]],
      ['rectangle', [clip('rect', 'return', { shape: 'rect', angle: 32, edgeColor: '#ff4040', edgeWidth: 9, samples: [{ x: 180, y: 200, size: 60, width: 80, height: 40, t: 0 }, { x: 380, y: 200, size: 60, width: 80, height: 40, t: 200 }] })]],
      ['gradient', [clip('gradient', 'return', { colorEditMode: 'gradient', colorGradient: { to: '#ff8800', startMs: 0, endMs: 900 }, edgeColor: '#ffffff' })]],
      ['black', [clip('black', 'return', { color: '#000000' })]],
      ['analog over black', [clip('black-base', 'return', { color: '#000000' }), clip('yellow-over-black', 'return', { color: '#fcd200', blendMode: 'analog' })]],
      ['analog', [clip('below', 'return', { color: '#002185' }), clip('above', 'return', { color: '#fcd200', blendMode: 'analog' })]],
      ['two analog layers', [clip('blue', 'return', { color: '#002185' }), clip('yellow', 'return', { color: '#fcd200', blendMode: 'analog' }), clip('red', 'return', { color: '#ff0000', blendMode: 'analog', mixAmount: 30 })]],
      ['place legacy', [clip('static', 'place', { duration: 0, fadeInMs: 0, holdMs: 1000, fadeOutMs: 100, samples: [{ x: 180, y: 200, size: 60, t: 0 }] })]],
    ];
    for (const [name, clips] of cases) {
      const p = project(clips), cpu = new RGBAScene(p); gpu.setProject(p); let worst = 0;
      for (const time of [0, 100, 700, 4000, 100]) {
        gpu.draw(0, time); const actual = gpu.readPixels(), expected = cpu.draw(0, time);
        for (const [x, y] of [[180, 200], [190, 200], [180, 220], [200, 210], [380, 200], [20, 20]]) {
          const a = gpuPixel(actual, x, y), e = cpuPixel(expected, x, y);
          const error = Math.max(...a.map((v, i) => Math.abs(v - e[i]))); worst = Math.max(worst, error);
          if (error > 5) throw new Error(`${name} at ${time} (${x},${y}): GPU ${a}, CPU ${e}`);
        }
      }
      report.checks.push({ name, passed: true, maxChannelError: worst });
      await pause();
    }
    const clips = Array.from({ length: 10 }, (_, layer) => clip(`bench-${layer}`, 'trail', {
      color: ['#0d99ff', '#ff7331', '#83dc92'][layer % 3], duration: 1800,
      samples: Array.from({ length: 109 }, (_, i) => ({ x: 180 + i * 13, y: 170 + layer * 68 + Math.sin(i / 11) * 55, size: 60 + (i % 30), t: i * 1000 / 60 })),
    }));
    const p = project(clips), cpu = new LoopScene();
    result.textContent = 'Running 10-layer CPU reference…'; await pause();
    report.benchmark.cpuColdMs = +measure(() => { cpu.setProject(p); cpu.draw(ctx, 0, 500); }).toFixed(2);
    const cpuTimes = [];
    for (let i = 1; i <= 30; i++) { cpuTimes.push(measure(() => cpu.draw(ctx, 0, 500 + i * 1000 / 60))); await pause(); }
    report.benchmark.cpu = summary(cpuTimes); cpu.items = [];
    result.textContent = 'Running 10-layer WebGL2 renderer…'; await pause();
    report.benchmark.gpuColdMs = +measure(() => { gpu.setProject(p); gpu.draw(0, 500); gpu.finish(); }).toFixed(2);
    const allocations = gpu.stats.masksCreated, gpuTimes = [];
    for (let i = 1; i <= 30; i++) { gpuTimes.push(measure(() => { gpu.draw(0, 500 + i * 1000 / 60); gpu.finish(); })); await pause(); }
    report.benchmark.gpu = summary(gpuTimes);
    const stable = gpu.stats.masksCreated === allocations;
    report.checks.push({ name: '10-layer warm playback reuses GPU masks', passed: stable }); if (!stable) throw new Error('GPU targets reallocated during warm playback');
    const live = { id: 'bench-live', mode: 'trail', color: '#ffffff', targets: [0], started: performance.now(), last: { x: 960, y: 540, size: 80, t: 0 }, samples: [{ x: 960, y: 540, size: 80, t: 0 }] };
    report.benchmark.gpuFirstPointWith10LayersMs = +measure(() => { gpu.setLiveStroke(live, live.started); gpu.draw(0, 1000, { now: live.started }); gpu.finish(); }).toFixed(2);
    gpu.setLiveStroke(null); const before = gpu.stats.masksCreated;
    gpu.setProject({ ...p, clips: p.clips.map((c, i) => i === 0 ? { ...c, color: '#ff00ff' } : c) }); gpu.draw(0, 1100); gpu.finish();
    report.checks.push({ name: 'color edits reuse existing geometry and masks', passed: before === gpu.stats.masksCreated });
    if (before !== gpu.stats.masksCreated) throw new Error('Color edit invalidated raster geometry');
    // Late packets must extend the path from the last received source sample,
    // even when the locally predicted head has already advanced in time.
    gpu.setProject(project([]));
    const packet = { id: 'remote-live', from: 0, mode: 'trail', color: '#ff0000', targets: [0], elapsed: 0, samples: [{ x: 100, y: 400, size: 20, t: 0 }], head: { x: 100, y: 400, size: 20, t: 0 } };
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
    fallback.setProject(project([clip('fallback')])); fallback.draw(0, 100);
    const fallbackPixel = [...fallback.ctx.getImageData(180, 200, 1, 1).data];
    if (fallback.backend !== 'cpu' || fallbackPixel[2] !== 255) throw new Error('CPU fallback did not paint');
    fallback.dispose(); report.checks.push({ name: 'WebGL2-unavailable devices use a working CPU fallback', passed: true });
    report.benchmark.speedup = +(report.benchmark.cpu.meanMs / report.benchmark.gpu.meanMs).toFixed(1);
    report.passed = true;
  } catch (error) { report.passed = false; report.error = error.stack || error.message; }
  result.textContent = JSON.stringify(report, null, 2); result.dataset.complete = 'true'; button.disabled = false;
};
