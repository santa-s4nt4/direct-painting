import { WebGLPaintingRenderer } from '../src/render/webgl.js';
import { DEFAULT_VIEW } from '../src/view.js';
const result = document.querySelector('#result'), run = document.querySelector('#run');
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const rounded = x => +x.toFixed(2);
const summary = times => ({ meanMs: rounded(times.reduce((a, b) => a + b, 0) / times.length), p95Ms: rounded(times.toSorted((a, b) => a - b)[Math.ceil(times.length * .95) - 1]), maxMs: rounded(Math.max(...times)) });
function clips(count, size, blur) {
  return Array.from({ length: count }, (_, layer) => ({ id: `trail-${size}-${layer}`, mode: 'trail', color: ['#0d99ff', '#ff7331', '#83dc92'][layer % 3], enabled: true, targets: [0], duration: 5000, start: 0, effects: { blur, blurRadius: 16 }, samples: Array.from({ length: 301 }, (_, i) => ({ x: 1100 + i * 5, y: 700 + layer * 8 + Math.sin(i / 15 + layer) * 180, size, t: i * 1000 / 60 })) }));
}
run.onclick = async () => {
  run.disabled = true; delete result.dataset.complete;
  const report = { date: new Date().toISOString(), userAgent: navigator.userAgent, canvas: [3840, 2160], viewport: [1920, 1080], budgetMs: 12, samplesPerCase: 24, cases: [] };
  let gpu;
  try {
    gpu = new WebGLPaintingRenderer(document.querySelector('#gpu')); gpu.setView(DEFAULT_VIEW);
    const gl = gpu.renderer.getContext(); report.device = { vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER), maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
    const timed = draw => { const start = performance.now(); draw(); gpu.finish(); if (gpu.contextLost || gl.isContextLost()) throw new Error('GPU context lost: this test exceeded available device resources'); return performance.now() - start; };
    // Warm shaders before cold geometry measurements; no editor/network state is used.
    gpu.setProject({ duration: 10000, clips: clips(2, 96, true) }); gpu.draw(0, 100); gpu.finish();
    for (const size of [96, 600, 3000]) for (const blur of [false, true]) for (const count of [1, 4, 8, 10, 16]) {
      if (size === 3000 && count > 10) continue;
      result.textContent = `計測中: ${size}px · Blur ${blur ? 'ON' : 'OFF'} · ${count}本\n` + JSON.stringify(report, null, 2); await nextFrame();
      gpu.setProject({ duration: 10000, clips: [] }); // Release masks between cases.
      const p = { duration: 10000, clips: clips(count, size, blur) };
      const coldMs = timed(() => { gpu.setProject(p); gpu.draw(0, 2500); });
      const before = { ...gpu.stats }, times = [];
      for (let i = 1; i <= report.samplesPerCase; i++) { await nextFrame(); times.push(timed(() => gpu.draw(0, 2500 + i * 1000 / 60))); }
      const warmCopyPixels = (gpu.stats.copyPixels - before.copyPixels) / report.samplesPerCase, warmBlurPixels = (gpu.stats.blurPixels - before.blurPixels) / report.samplesPerCase;
      const warm = summary(times), maskMiB = rounded(gpu.stats.maskBytes / 1048576), allocationsDuringPlayback = gpu.stats.masksCreated - before.masksCreated;
      const seekStampsBefore = gpu.stats.stamps;
      const seekMs = timed(() => gpu.draw(0, 2000)), seekStamps = gpu.stats.stamps - seekStampsBefore;
      const restartMs = timed(() => gpu.draw(0, 0));
      gpu.draw(0, 3000); gpu.finish(); // Start drawing over fully established trails.
      const started = performance.now(), sample = { x: 1920, y: 1080, size, t: 0 };
      const live = { id: 'probe', mode: 'trail', color: '#ffffff', effects: { blur, blurRadius: 16 }, targets: [0], samples: [sample], last: sample, started };
      const firstPointMs = timed(() => { gpu.setLiveStroke(live, started); gpu.draw(0, 3000, { now: started }); });
      const liveTimes = [];
      for (let i = 1; i <= 12; i++) { await nextFrame(); liveTimes.push(timed(() => { gpu.setLiveStroke(live, started + i * 1000 / 60); gpu.draw(0, 3000 + i * 1000 / 60, { now: started + i * 1000 / 60 }); })); }
      gpu.setLiveStroke(null);
      gpu.draw(0, 9000); gpu.finish(); // All trails disappear; exercise the inactive-mask budget.
      const beforeLoop = gpu.stats.masksCreated;
      const loopReentryMs = timed(() => gpu.draw(0, 0));
      const loopAllocations = gpu.stats.masksCreated - beforeLoop;
      report.cases.push({ size, blur, count, coldMs: rounded(coldMs), warm, seekMs: rounded(seekMs), restartMs: rounded(restartMs), firstPointMs: rounded(firstPointMs), live: summary(liveTimes), maskMiB, warmCopyPixels, warmBlurPixels, seekStamps, loopReentryMs: rounded(loopReentryMs), loopAllocations, allocationsDuringPlayback, drawCalls: gpu.stats.drawCalls });
    }
    result.textContent = '60秒の長いTrailをシーク中…'; await nextFrame();
    gpu.setProject({ duration: 90000, clips: [] });
    const long = clips(10, 96, true).map((c, layer) => ({ ...c, duration: 60000, samples: Array.from({ length: 3601 }, (_, i) => ({ x: 1920 + Math.sin(i / 120) * 650, y: 1080 + Math.sin(i / 80 + layer) * 180, size: 96, t: i * 1000 / 60 })) }));
    gpu.setProject({ duration: 90000, clips: long }); gpu.draw(0, 59000); gpu.finish();
    const stampsBefore = gpu.stats.stamps;
    report.longSeek = { layers: 10, size: 96, sourceMs: 60000, seekToMs: 57000, renderMs: rounded(timed(() => gpu.draw(0, 57000))), stamps: gpu.stats.stamps - stampsBefore };
    report.recommended = [96, 600, 3000].flatMap(size => [false, true].map(blur => ({ size, blur, testedLayers: Math.max(0, ...report.cases.filter(c => c.size === size && c.blur === blur && c.warm.p95Ms <= report.budgetMs && c.live.p95Ms <= report.budgetMs).map(c => c.count)), criterion: 'warm and live p95 <= 12ms; cold/seek spikes reported separately; not a thermal endurance test' })));
    report.passed = report.cases.every(c => c.allocationsDuringPlayback === 0);
  } catch (error) { report.passed = false; report.error = String(error.stack || error); }
  finally { gpu?.dispose(); }
  const status = document.querySelector('#summary');
  status.textContent = report.recommended ? report.recommended.map(r => `${r.size}px / Blur ${r.blur ? 'ON' : 'OFF'}: ${r.testedLayers}本まで計測基準内`).join(' · ') : '計測未完了。下のエラーと完了したケースを確認してください。';
  const save = document.querySelector('#save'); save.hidden = false;
  save.onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'direct-painting-trail-performance.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  result.textContent = JSON.stringify(report, null, 2); result.dataset.complete = 'true'; run.disabled = false;
};
