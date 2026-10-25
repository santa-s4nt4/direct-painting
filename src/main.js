import { setupColorPanel } from './color-panel.js';
import { DEFAULT_VIEW, MIN_ZOOM, MAX_ZOOM, canvasView, screenToWorld, worldToScreen, zoomAt, PinchGesture } from './view.js';
import './style.css';
import { VIEWPORT_WIDTH, VIEWPORT_HEIGHT, MAX_BRUSH_SIZE, CANVAS_SPEC } from './canvas.js';
import { FPS, FRAME_MS, frameNumber } from './timing.js';
import { setupEditorShell } from './editor-shell.js';
import { brushSize, canvasPoint, timestamp } from './drawing.js';
import { SmoothedCircle } from './motion.js';
import { createPaintingRenderer } from './render/index.js';
import { DEFAULT_EFFECTS, DEFAULT_RING_WIDTH, MAX_RING_WIDTH, EFFECT_LIMITS, layerEffects } from './effects.js';
import { LoopClock, DEFAULT_LOOP_MS, minimumLoop, gestureLength, trimRange, playbackLength, trimGesture, resetGestureTrim, fitGestureTrim, MIN_TRIM_MS, layerSizeRange, resizeGesture } from './loop.js';
import { createPublisher, createLivePublisher, createViewPublisher, playbackSnapshot } from './relay.js';
import { loadProject, saveProject } from './cache.js';
import { DEFAULT_SETTINGS, MAX_PROJECT_BYTES, normalizeProject, singleCanvasProject, serializeProject, parseProject } from './project.js';
import { colorHSL, editLayerLightness, pickLayerColor, hasColorGradient, hasFireworkColor, hasSampleColor } from './color.js';
import { dimensionRange, resizeDimension } from './geometry.js';
import { editLayer, removeLayerSides, moveLayer } from './layers.js';
import { EditHistory } from './history.js';

const icons = {
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h11a7 7 0 0 1 0 14"/>',
  redo: '<path d="m16 4 5 5-5 5M21 9H10a7 7 0 0 0 0 14"/>',
  trail: '<path d="M3 17c4 0 3-10 8-10h6"/><circle cx="19" cy="7" r="3"/>',
  return: '<path d="M5 8h10a6 6 0 0 1 0 12h-3M8 4 4 8l4 4"/>',
  ring: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="5"/>',
  move: '<circle cx="12" cy="12" r="5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const modes = ['trail', 'return', 'move'];
const modeHints = { trail: 'A continuous trail that gradually fades away', return: 'Draw a continuous path and fade after release', move: 'Move a smoothed shape and fade after release' };

document.querySelector('#app').innerHTML = `
  <main>
    <section class="studio" data-mode="trail" aria-label="Motion canvases">
      <aside class="toolbar" aria-label="Drawing and loop controls">
          <button id="save-project" class="secondary-button">SAVE JSON</button>
          <button id="import-project" class="secondary-button">IMPORT JSON</button>
          <input id="import-file" type="file" accept=".json,application/json" hidden>
        <span id="output-status" role="status">CONNECTING OUTPUTS…</span>
        <button class="clear-button" id="clear" aria-label="Clear canvas">${icon('trash')}<span>CLEAR</span></button>
        <div class="control-section effect-controls">
          <span class="section-label">RELEASE FADE</span>
          <div class="effect-value"><label for="fade-seconds">TIME</label><input id="fade-seconds" type="number" min="0.1" max="10" step="0.1" value="2" inputmode="decimal" aria-label="RETURN and MOVE fade time in seconds"><span>s</span></div>
          <input id="fade-range" type="range" min="0.1" max="10" step="0.1" value="2" aria-label="Release fade duration slider">
        </div>
        <div class="control-section">
          <span class="section-label">SHAPE</span>
          <select id="shape" aria-label="Drawing shape"><option value="circle">CIRCLE</option><option value="rect">RECTANGLE</option></select>
        </div>
        <div id="draw-blur-controls" class="control-section">
          <label class="checkbox-control"><input id="draw-blur" type="checkbox" checked><span>Blur</span></label>
          <div class="effect-value"><label for="draw-blur-radius">Radius</label><input id="draw-blur-radius" type="number" min="0" max="192" step="1" value="16" aria-label="Brush blur radius in pixels"><span>px</span></div>
          <input id="draw-blur-range" type="range" min="0" max="192" step="1" value="16" aria-label="Brush blur radius">
        </div>
        <div class="control-section size-controls" id="circle-controls">
          <span class="section-label">SIZE RANGE</span>
          ${['min', 'max'].map((bound, i) => `<div class="size-bound"><label for="size-${bound}">${bound.toUpperCase()}</label><input id="size-${bound}" type="number" min="1" max="${MAX_BRUSH_SIZE}" step="1" inputmode="numeric" value="${i === 0 ? 15 : 100}" aria-label="${i === 0 ? 'Minimum' : 'Maximum'} diameter in pixels"><span>px</span><input id="range-${bound}" type="range" min="1" max="${MAX_BRUSH_SIZE}" step="1" value="${i === 0 ? 15 : 100}" aria-label="${i === 0 ? 'Minimum' : 'Maximum'} diameter slider"></div>`).join('')}
        </div>
        <div class="control-section" id="ring-controls" hidden><div class="effect-value"><label for="ring-width">Stroke</label><input id="ring-width" type="number" min="1" max="${MAX_RING_WIDTH}" step="1" value="5" aria-label="Ring stroke width in pixels"><span>px</span></div></div>
        <div class="control-section" id="rectangle-controls" hidden>
          ${['width', 'height'].map(axis => `<span class="section-label">${axis.toUpperCase()} RANGE</span>${['Min', 'Max'].map((bound, i) => `<div class="size-bound"><label for="${axis}-${bound}">${bound.toUpperCase()}</label><input id="${axis}-${bound}" type="number" min="1" max="${MAX_BRUSH_SIZE}" step="1" value="${i ? 100 : 20}" inputmode="numeric" aria-label="Rectangle ${axis} ${bound.toLowerCase()} in pixels"><span>px</span><input id="${axis}-range-${bound}" type="range" min="1" max="${MAX_BRUSH_SIZE}" step="1" value="${i ? 100 : 20}" aria-label="Rectangle ${axis} ${bound.toLowerCase()} slider"></div>`).join('')}`).join('')}
          <div class="effect-value"><label for="shape-angle">ANGLE</label><input id="shape-angle" type="number" min="-180" max="180" step="1" value="0" aria-label="Rectangle angle in degrees"><span>°</span></div>
        </div>
        <div class="input-controls">
          <label class="checkbox-control"><input type="checkbox" id="pressure" checked><span>PRESSURE</span></label>
          <label class="checkbox-control"><input type="checkbox" id="touch"><span>TOUCH</span></label>
        </div>
      </aside>
      <div class="workspace">
      <div class="canvas-pair">
        <article class="canvas-panel active" data-panel="0"><div class="canvas-frame"><canvas id="canvas-0" width="${VIEWPORT_WIDTH}" height="${VIEWPORT_HEIGHT}" aria-label="4K painting canvas with Full HD viewport" tabindex="0"></canvas><span class="brush-cursor" aria-hidden="true"></span><div class="canvas-empty" aria-hidden="true"><span class="empty-cross">+</span><span>A blank canvas. Endless possibilities.</span><small>Draw with Apple Pencil or your mouse</small></div></div><div class="canvas-footer"><span class="canvas-dimensions">3840 × 2160 · 4K</span><span class="canvas-state">View 1920 × 1080</span><span class="pointer-position" id="pointer-position">X — &nbsp; Y —</span></div></article>
      </div>
        <div class="loop-controls">
          <span class="section-label">LOOP</span>
          <div class="playback-actions"><button id="play" class="secondary-button" aria-label="Pause loop">PAUSE</button><button id="restart" class="icon-button" aria-label="Restart loop" title="Restart loop">↺</button></div>
          <div class="loop-duration"><label for="loop-duration">LENGTH</label><input id="loop-duration" type="number" min="1" step="0.5" value="${DEFAULT_LOOP_MS / 1000}" inputmode="decimal" aria-label="Loop length in seconds"><span>s</span></div>
          <input id="loop-progress" class="loop-progress" type="range" min="0" max="${DEFAULT_LOOP_MS - 1}" step="1" value="0" aria-label="Loop position" aria-valuetext="0.00 of 10.00 seconds" title="Seek to pause and choose the start time.">
          <span id="loop-time" class="time-readout">0.00 / 10.00s</span>
        </div>
      <div class="workspace-bottom">
        <section class="layers-panel" aria-label="Motion layer selection">
          <div class="layer-heading"><span class="section-label">LAYERS <span id="layer-count">00</span></span><button id="fold-layers" class="secondary-button">EXPAND ALL</button></div>
          <div id="layer-list" aria-label="Cached motion layers"></div>
          <span id="cache-status" role="status">RESTORING…</span>
        </section>

      </div>
      </div>
    </section>

  </main>
  <div class="history-actions" role="group" aria-label="Edit history">
    <button id="undo" class="secondary-button" disabled aria-label="Undo last edit" title="Undo (⌘/Ctrl Z)">${icon('undo')}<span>UNDO</span></button>
    <button id="redo" class="secondary-button" disabled aria-label="Redo last edit" title="Redo (⌘/Ctrl Shift Z)">${icon('redo')}<span>REDO</span></button>
  </div>
  <div id="toast" role="status" aria-live="polite"></div>
`;

const $ = selector => document.querySelector(selector);
const shell = setupEditorShell({ icon, modes, modeHints, onMode: mode => setMode(mode), onShape: shape => setShape(shape), onTab: tab => { colorContext = { id: tab === 'layer' ? selectedLayerId : null, field: 'fill' }; syncFloatingColor(); } });
const painting = createPaintingRenderer($('#canvas-0'), { onBackendChange: backend => {
  const label = document.querySelector('.fps-label');
  if (label) label.textContent = `${FPS} fps · ${backend === 'cpu' ? 'CPU' : backend === 'webgl2-lost' ? 'GPU paused' : 'GPU'}`;
} });
const canvases = [painting.canvas];
const paintingBoundary = document.createElement('div'); paintingBoundary.className = 'painting-boundary'; paintingBoundary.hidden = true; paintingBoundary.setAttribute('aria-hidden', 'true');
canvases[0].after(paintingBoundary);
const layers = [{ circle: null, lastFrame: -Infinity }];
const state = { ...DEFAULT_SETTINGS, effects: { ...DEFAULT_EFFECTS }, view: { ...DEFAULT_VIEW } };
let colorContext = { id: null, field: 'fill' }, refreshSelectedLayer = () => {};
const colorPanel = setupColorPanel($('.canvas-stage'), { onChange: editFloatingColor, onVisibility: visible => { state.colorPanelVisible = visible; queueSave(); } });
let stroke = null, trimDrag = null, toastTimer, dirty = false, selectedLayerId = null;
const layerDisclosure = new Map();
const clock = new LoopClock(performance.now());
const scene = painting;
const history = new EditHistory();
let clips = [], ready = false, cacheTimer, saveQueue = Promise.resolve(), revision = 0;
let cacheFailed = false;
const liveSession = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let liveRevision = 0, viewRevision = 0;
const pinch = new PinchGesture();
let zoomSaveTimer, viewDirty = false;
$('.sidebar-scroll').inert = true; $('.loop-controls').inert = true;
const outputStatus = connected => { $('#output-status').textContent = connected ? 'Live output connected' : 'Output offline'; $('#output-status').dataset.connected = String(connected); };
const publisher = createPublisher(() => ({ project: { version: 1, canvas: { ...CANVAS_SPEC }, clips, duration: clock.duration, settings: state }, playback: playbackSnapshot(clock, performance.now()), viewState: { session: liveSession, revision: viewRevision, view: state.view }, liveState: { session: liveSession, revision: liveRevision, id: stroke?.id ?? null } }), outputStatus);
const livePublisher = createLivePublisher(from => {
  if (!stroke) return null;
  const elapsed = Math.max(performance.now() - stroke.started, stroke.samples.at(-1).t);
  const circle = layers[stroke.targets[0]].circle;
  if (circle) circle.update(performance.now());
  return { session: liveSession, revision: liveRevision, id: stroke.id, mode: stroke.mode, color: stroke.color, opacity: stroke.opacity, effects: stroke.effects, ringWidth: stroke.ringWidth, targets: stroke.targets, from, samples: stroke.samples.slice(from), elapsed, head: { ...stroke.last, t: elapsed }, move: circle?.displayPoint() };
}, outputStatus);

const viewPublisher = createViewPublisher(() => ({ session: liveSession, revision: viewRevision, view: state.view }), outputStatus);

function fitLoop() {
  const required = Math.ceil(minimumLoop(clips) / 500) * 500;
  if (clock.duration < required) clock.resize(required, performance.now());
}
const trimTrackObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
  for (const { target } of entries) {
    const handles = target.querySelectorAll('.layer-trim-handle');
    if (handles.length === 2) target.classList.toggle('crowded', Math.abs(parseFloat(handles[0].style.left) - parseFloat(handles[1].style.left)) / 100 * target.clientWidth < 32);
  }
}) : null;
function layerFold(id, key, title, children) {
  const details = document.createElement('details'); details.className = key === 'card' ? 'layer-card' : 'layer-fold';
  details.dataset.fold = key;
  details.open = layerDisclosure.get(`${id}:${key}`) ?? false;
  const summary = document.createElement('summary');
  if (typeof title === 'string') summary.textContent = title; else summary.append(...title);
  details.append(summary, ...children);
  details.addEventListener('toggle', () => {
    if (!details.isConnected) return;
    layerDisclosure.set(`${id}:${key}`, details.open);
    if (key === 'card') syncLayerDisclosure();
  });
  return details;
}
function syncLayerDisclosure() {
  const cards = [...document.querySelectorAll('.layer-card')];
  $('#fold-layers').textContent = !cards.length || cards.some(card => !card.open) ? 'EXPAND ALL' : 'COLLAPSE ALL';
  $('#fold-layers').disabled = !cards.length;
}
$('#fold-layers').addEventListener('click', () => {
  const cards = [...document.querySelectorAll('.layer-card')], open = cards.some(card => !card.open);
  for (const card of cards) { card.open = open; layerDisclosure.set(`${card.closest('.cached-layer').dataset.layerId}:card`, open); }
  syncLayerDisclosure();
});
function rebuildCache() {
  const listScrollTop = $('#layer-list').scrollTop;
  for (const row of document.querySelectorAll('.cached-layer')) for (const details of row.querySelectorAll('details[data-fold]')) layerDisclosure.set(`${row.dataset.layerId}:${details.dataset.fold}`, details.open);
  trimTrackObserver?.disconnect();
  scene.setProject({ clips, duration: clock.duration });
  $('#layer-count').textContent = String(clips.length);
  if (!clips.some(clip => clip.id === selectedLayerId)) selectedLayerId = null;
  refreshSelectedLayer = () => {};
  if ($('#tab-layer').getAttribute('aria-selected') === 'true' && selectedLayerId !== colorContext.id) colorContext = { id: selectedLayerId, field: 'fill' };
  shell.clearSelectionProperties();
  $('#layer-empty').hidden = clips.length > 0;
  $('.canvas-empty').hidden = clips.length > 0 || Boolean(stroke);
  $('#layer-list').replaceChildren();
  clips.forEach((clip, index) => {
    const row = document.createElement('div'); row.className = 'cached-layer'; row.dataset.layerId = clip.id;
    // Build detailed controls only for the selected layer. Ten gestures should
    // create ten small rows, not thousands of hidden inputs and listeners.
    if (clip.id !== selectedLayerId) {
      row.style.setProperty('--layer-accent', clip.color); row.classList.toggle('layer-muted', !clip.enabled);
      const visibility = document.createElement('button'); visibility.className = 'layer-toggle'; visibility.innerHTML = icon('eye');
      visibility.setAttribute('aria-label', `Layer ${index + 1}: toggle visibility`); visibility.setAttribute('aria-pressed', String(clip.enabled));
      visibility.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation(); if (stroke || trimDrag) return;
        clips = clips.map(item => item.id === clip.id ? editLayer(item, 'all', value => ({ ...value, enabled: !clip.enabled })) : item);
        rebuildCache(); renderTargets([0], performance.now(), true); queueSave();
      });
      const identity = document.createElement('span'); identity.className = 'layer-identity';
      const name = document.createElement('span'); name.textContent = `${String(index + 1).padStart(2, '0')} ${clip.procedural?.label ?? (clip.mode === 'place' ? 'STATIC' : clip.mode.toUpperCase())}`;
      const timing = document.createElement('span'); timing.className = 'layer-timing'; timing.textContent = `AT ${((clip.start ?? 0) / 1000).toFixed(2)}s`; identity.append(name, timing);
      const remove = document.createElement('button'); remove.className = 'layer-remove'; remove.innerHTML = icon('trash'); remove.setAttribute('aria-label', `Delete layer ${index + 1}`);
      remove.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation(); if (stroke || trimDrag) return;
        clips = clips.filter(item => item.id !== clip.id); rebuildCache(); renderTargets([0], performance.now(), true); queueSave();
      });
      const card = layerFold(clip.id, 'card', [visibility, identity, remove], []); card.open = false;
      card.querySelector('summary').addEventListener('click', event => {
        event.preventDefault(); if (event.target.closest('button') || stroke || trimDrag) return;
        selectedLayerId = clip.id; rebuildCache();
      });
      row.append(card); $('#layer-list').prepend(row); return;
    }

    const root = () => clips.find(item => item.id === clip.id);
    const scope = () => 'all';
    const current = root;
    const sync = [];
    sync.push(() => { row.style.setProperty('--layer-accent', current().color); row.style.setProperty('--layer-tint', `${current().color}18`); row.classList.toggle('layer-muted', !current().enabled); });
    const update = (edit, rebuild = false, dragging = false) => {
      if (stroke || trimDrag && !dragging) return;
      clips = clips.map(item => item.id === clip.id ? editLayer(item, scope(), value => fitGestureTrim(edit(value), clock.duration)) : item);
      fitLoop();
      if (rebuild) rebuildCache();
      else { scene.setProject({ clips, duration: clock.duration }); sync.forEach(fn => fn()); }
      playbackUI(); renderTargets([0], performance.now(), true); queueSave();
    };
    const number = (container, text, aria, get, min, max, step, edit, unit = 'px') => {
      const label = document.createElement('label'); label.append(text);
      const input = document.createElement('input'); input.type = 'number'; input.step = step; input.inputMode = step < 1 ? 'decimal' : 'numeric';
      input.setAttribute('aria-label', `Layer ${index + 1} ${aria}`);
      const refresh = () => { const item = current(); input.min = typeof min === 'function' ? min(item) : min; input.max = typeof max === 'function' ? max(item) : max; input.value = get(item); }; sync.push(refresh);
      input.addEventListener('input', () => {
        if (!input.value || !Number.isFinite(Number(input.value))) return;
        const value = Math.max(Number(input.min), Math.min(Number(input.max), Math.round(Number(input.value) / step) * step));
        update(item => edit(item, value));
      });
      input.addEventListener('change', refresh);
      label.append(input, unit); container.append(label); return input;
    };
    const section = title => {
      const group = document.createElement('div'); group.className = 'layer-size-controls';
      const heading = document.createElement('span'); heading.className = 'layer-size-heading'; heading.textContent = title; group.append(heading); return group;
    };
    const toggle = document.createElement('button'); toggle.className = 'layer-toggle';
    toggle.setAttribute('aria-label', `Layer ${index + 1}: toggle visibility `);
    const visibility = document.createElement('span'); visibility.className = 'layer-visibility'; visibility.innerHTML = icon('eye');
    const label = document.createElement('span'); label.textContent = `${String(index + 1).padStart(2, '0')} ${clip.mode.toUpperCase()}`;
    toggle.append(visibility);
    toggle.title = 'Toggle layer visibility';
    toggle.addEventListener('click', () => update(item => ({ ...item, enabled: !current().enabled }), true));
    sync.push(() => toggle.setAttribute('aria-pressed', current().enabled));
    const timing = document.createElement('span'); timing.className = 'layer-timing';
    const track = document.createElement('div'); track.className = 'layer-track'; track.setAttribute('role', 'group'); track.setAttribute('aria-label', `Layer ${index + 1} timeline trim`);
    const rail = document.createElement('div'); rail.className = 'layer-track-rail'; rail.setAttribute('aria-hidden', 'true');
    const segments = document.createElement('div'); segments.className = 'layer-track-segments'; segments.setAttribute('aria-hidden', 'true');
    const summary = document.createElement('div'); summary.className = 'layer-trim-summary';
    const trimText = document.createElement('output');
    const reset = document.createElement('button'); reset.className = 'secondary-button'; reset.textContent = 'RESET TRIM'; reset.setAttribute('aria-label', `Reset layer ${index + 1} trim`);
    reset.addEventListener('click', () => update(item => resetGestureTrim(item, clock.duration)));
    summary.append(trimText, reset);
    const handles = {};
    for (const bound of ['in', 'out']) {
      const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'layer-trim-handle'; handle.dataset.bound = bound;
      handle.setAttribute('role', 'slider'); handle.setAttribute('aria-orientation', 'horizontal'); handle.setAttribute('aria-label', `Layer ${index + 1} trim ${bound === 'in' ? 'start' : 'end'}`);
      handle.title = `Trim ${bound === 'in' ? 'start' : 'end'} · drag to cut or restore`;
      handle.addEventListener('pointerdown', event => {
        if (!ready || stroke || trimDrag || event.button !== 0) return;
        event.preventDefault(); handle.focus(); history.endGroup();
        const initial = trimRange(current()), x = event.clientX, duration = clock.duration, width = track.getBoundingClientRect().width;
        let publishedAt = -Infinity;
        clock.pause(performance.now()); playbackUI(); publisher.publish(true);
        const finish = () => {
          if (trimDrag?.pointerId !== event.pointerId) return;
          trimDrag = null; history.endGroup(); track.classList.remove('trimming');
          if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
          historyUI(); publisher.publish(true);
        };
        trimDrag = { pointerId: event.pointerId, group: {}, finish };
        track.classList.add('trimming'); handle.setPointerCapture(event.pointerId); historyUI();
        const move = next => {
          if (trimDrag?.pointerId !== next.pointerId) return;
          const value = initial[bound] + (next.clientX - x) / width * duration;
          const preview = trimGesture(current(), bound, value, duration), range = trimRange(preview);
          clock.seek((preview.start ?? 0) + (bound === 'out' ? range.out - range.in - 1 : 0), performance.now());
          update(item => trimGesture(item, bound, value, duration), false, true);
          const now = performance.now(); if (now - publishedAt >= FRAME_MS) { publisher.publish(true); publishedAt = now; }
        };
        handle.onpointermove = move;
        handle.onpointerup = next => { if (trimDrag?.pointerId === next.pointerId) { move(next); finish(); } };
        handle.onpointercancel = handle.onlostpointercapture = finish;
      });
      handle.addEventListener('keydown', event => {
        if (trimDrag || stroke) return;
        const range = trimRange(current()), step = event.shiftKey ? 100 : 10;
        let value;
        if (event.key === 'ArrowLeft') value = range[bound] - step;
        else if (event.key === 'ArrowRight') value = range[bound] + step;
        else if (event.key === 'Home') value = bound === 'in' ? 0 : range.in + MIN_TRIM_MS;
        else if (event.key === 'End') value = bound === 'out' ? gestureLength(current()) : range.out - MIN_TRIM_MS;
        else return;
        event.preventDefault(); clock.pause(performance.now());
        const preview = trimGesture(current(), bound, value, clock.duration), trimmed = trimRange(preview);
        clock.seek((preview.start ?? 0) + (bound === 'out' ? trimmed.out - trimmed.in - 1 : 0), performance.now());
        update(item => trimGesture(item, bound, value, clock.duration)); publisher.publish(true);
      });
      handles[bound] = handle;
    }
    track.append(rail, segments, handles.in, handles.out);
    sync.push(() => {
      const item = current(), start = (item.start ?? 0) % clock.duration, length = playbackLength(item), range = trimRange(item), sourceLength = gestureLength(item);
      timing.textContent = `AT ${(start / 1000).toFixed(2)}s${item.blendMode === 'analog' ? ' · ANALOG' : ''}${hasColorGradient(item) ? ' · A → B' : ''}`;
      trimText.textContent = `IN ${(range.in / 1000).toFixed(2)}s · OUT ${(range.out / 1000).toFixed(2)}s / ${(sourceLength / 1000).toFixed(2)}s`;
      track.dataset.trimIn = range.in; track.dataset.trimOut = range.out;
      segments.replaceChildren();
      const spans = (offset, spanLength, className) => {
        const origin = ((offset % clock.duration) + clock.duration) % clock.duration, visible = Math.min(spanLength, clock.duration), first = Math.min(visible, clock.duration - origin);
        const segment = (left, width) => { if (width <= 0) return; const span = document.createElement('span'); span.className = className; span.style.left = `${left / clock.duration * 100}%`; span.style.width = `${width / clock.duration * 100}%`; segments.append(span); };
        segment(origin, first); if (visible > first) segment(0, visible - first);
      };
      spans(start - range.in, sourceLength, 'layer-source-segment'); spans(start, length, 'layer-active-segment');
      let end = (start + length) % clock.duration; if (end < .001 && length > 0) end = clock.duration;
      handles.in.style.left = `${start / clock.duration * 100}%`; handles.out.style.left = `${end / clock.duration * 100}%`;
      track.classList.toggle('crowded', Math.abs(start - end) / clock.duration * track.getBoundingClientRect().width < 32);
      for (const bound of ['in', 'out']) {
        handles[bound].setAttribute('aria-valuenow', (range[bound] / 1000).toFixed(3));
        handles[bound].setAttribute('aria-valuemin', bound === 'in' ? '0' : ((range.in + Math.min(MIN_TRIM_MS, sourceLength)) / 1000).toFixed(3));
        handles[bound].setAttribute('aria-valuemax', ((bound === 'out' ? sourceLength : range.out - Math.min(MIN_TRIM_MS, sourceLength)) / 1000).toFixed(3));
        handles[bound].setAttribute('aria-valuetext', `${(range[bound] / 1000).toFixed(3)} seconds into source`);
      }
    });
    const color = document.createElement('input'); color.className = 'layer-color'; color.type = 'color'; color.setAttribute('aria-label', `Layer ${index + 1} color`);
    color.addEventListener('click', event => { event.preventDefault(); colorContext = { id: clip.id, field: 'fill' }; syncFloatingColor(); colorPanel.open(); });
    color.addEventListener('input', () => update(item => pickLayerColor(hasSampleColor(item) ? { ...item, colorEditMode: 'color' } : item, color.value)));
    const remove = document.createElement('button'); remove.className = 'layer-remove'; remove.innerHTML = icon('trash'); remove.setAttribute('aria-label', `Delete layer ${index + 1} `);
    remove.addEventListener('click', () => {
      if (stroke) return;
      const selected = scope();
      clips = selected === 'all' ? clips.filter(item => item.id !== clip.id) : clips.map(item => item.id === clip.id ? removeLayerSides(item, [Number(selected)]) : item).filter(item => item.targets.length);
      rebuildCache(); renderTargets([0], performance.now(), true); queueSave();
    });
    const actions = document.createElement('div'); actions.className = 'layer-actions';
    const reorder = document.createElement('div'); reorder.className = 'layer-reorder';
    for (const [direction, text] of [[1, '↑'], [-1, '↓']]) {
      const button = document.createElement('button'); button.className = 'icon-button'; button.textContent = text;
      button.dataset.direction = direction; button.title = direction === 1 ? 'Move layer up' : 'Move layer down';
      button.setAttribute('aria-label', `Move layer ${index + 1} ${direction === 1 ? 'up' : 'down'}`);
      button.dataset.edge = String(direction === 1 ? index === clips.length - 1 : index === 0); button.disabled = button.dataset.edge === 'true';
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        if (!ready || stroke || trimDrag) return;
        clips = moveLayer(clips, clip.id, direction); rebuildCache(); renderTargets([0], performance.now(), true); queueSave();
        const moved = [...document.querySelectorAll('.cached-layer')].find(item => item.dataset.layerId === clip.id);
        const next = moved?.querySelector(`.layer-reorder button[data-direction="${direction}"]`);
        if (next && !next.disabled) next.focus({ preventScroll: true });
      }); reorder.append(button);
    }
    sync.push(() => { const item = current(); const name = item.procedural?.label ?? (item.mode === 'place' ? 'STATIC' : item.mode.toUpperCase()); label.textContent = `${String(index + 1).padStart(2, '0')} ${name}`; });
    const colorSettings = document.createElement('div'); colorSettings.className = 'layer-paint-field';
    const colorMode = document.createElement('select'); colorMode.className = 'layer-color-mode'; colorMode.setAttribute('aria-label', `Layer ${index + 1} color selection mode`);
    for (const [value, text] of [['color', 'PICKER'], ['lightness', 'LIGHTNESS'], ['gradient', 'GRADIENT'], ...(current().samples.some(sample => sample.color !== undefined) ? [['sample', 'SNIPPET COLORS']] : []), ...(current().fireworkColorTo || current().samples.some(sample => sample.colorProgress !== undefined) ? [['firework', 'FIREWORK FADE']] : [])]) { const option = document.createElement('option'); option.value = value; option.textContent = text; colorMode.append(option); }
    const hex = document.createElement('output'); hex.className = 'layer-color-hex';
    const lightnessControls = document.createElement('label'); lightnessControls.className = 'layer-lightness';
    const lightness = document.createElement('input'); lightness.type = 'range'; lightness.min = '0'; lightness.max = '100'; lightness.step = '0.1'; lightness.setAttribute('aria-label', `Layer ${index + 1} lightness`);
    const lightnessValue = document.createElement('output'); lightnessControls.append(lightness, lightnessValue);
    const fillLabel = document.createElement('label'); fillLabel.className = 'layer-paint-label';
    const fillText = document.createElement('span'); fillLabel.append(fillText, color);
    const gradientB = document.createElement('div'); gradientB.className = 'layer-gradient-b';
    const colorB = document.createElement('input'); colorB.type = 'color'; colorB.className = 'layer-color'; colorB.setAttribute('aria-label', `Layer ${index + 1} gradient color B`);
    const labelB = document.createElement('label'); labelB.className = 'layer-paint-label';
    const colorBText = document.createElement('span'); labelB.append(colorBText, colorB);
    const hexB = document.createElement('output'); hexB.className = 'layer-color-hex';
    const gradientPreview = document.createElement('div'); gradientPreview.className = 'layer-gradient-preview'; gradientPreview.setAttribute('aria-hidden', 'true');
    gradientB.append(labelB, hexB, gradientPreview);
    colorSettings.append(fillLabel, hex, colorMode, lightnessControls, gradientB);
    colorMode.addEventListener('change', () => update(item => {
      const range = trimRange(item), startMs = Math.round(range.in), endMs = Math.max(startMs + 1, Math.round(range.out));
      return { ...item, colorEditMode: colorMode.value, ...(colorMode.value === 'firework' && !item.fireworkColorTo ? { fireworkColorTo: item.color } : {}), ...(colorMode.value === 'gradient' && !item.colorGradient ? { colorGradient: { to: item.color.toLowerCase() === '#ffffff' ? '#4898ff' : '#ffffff', startMs, endMs } } : {}) };
    }));
    colorB.addEventListener('click', event => { event.preventDefault(); colorContext = { id: clip.id, field: 'second' }; syncFloatingColor(); colorPanel.open(); });
    colorB.addEventListener('input', () => update(item => hasFireworkColor(item) ? { ...item, fireworkColorTo: colorB.value } : { ...item, colorGradient: { ...item.colorGradient, to: colorB.value } }));
    lightness.addEventListener('input', () => update(item => editLayerLightness(item, Number(lightness.value))));
    const gradientTiming = section('COLOR TRANSITION'); gradientTiming.classList.add('layer-gradient-timing');
    for (const [key, text] of [['startMs', 'START'], ['endMs', 'END']]) {
      number(gradientTiming, text, `gradient ${text.toLowerCase()} in seconds`, item => (item.colorGradient?.[key] ?? 0) / 1000,
        key === 'startMs' ? 0 : item => ((item.colorGradient?.startMs ?? 0) + 1) / 1000,
        key === 'endMs' ? item => Math.max(gestureLength(item), item.colorGradient?.endMs ?? 0) / 1000 : item => ((item.colorGradient?.endMs ?? 1) - 1) / 1000,
        0.001, (item, value) => {
          const gradient = item.colorGradient, time = Math.round(value * 1000);
          return { ...item, colorGradient: { ...gradient, [key]: key === 'startMs' ? Math.max(0, Math.min(gradient.endMs - 1, time)) : Math.max(gradient.startMs + 1, time) } };
        }, 's');
    }
    const gradientHint = document.createElement('p'); gradientHint.className = 'layer-gradient-hint'; gradientHint.textContent = 'SOURCE TIME · A before START, B after END'; gradientTiming.append(gradientHint);
    sync.push(() => {
      const item = current(); color.value = item.color; hex.textContent = item.color.toUpperCase(); colorMode.value = item.colorEditMode ?? 'color';
      lightness.value = item.colorLightness ?? colorHSL(item.color).lightness; lightnessValue.textContent = `${Number(lightness.value).toFixed(1)}%`; lightnessControls.hidden = colorMode.value !== 'lightness';
      const gradient = hasColorGradient(item), firework = hasFireworkColor(item);
      fillText.textContent = firework ? 'LAUNCH' : gradient ? 'FILL A' : 'FILL'; colorBText.textContent = firework ? 'FADE' : 'FILL B';
      gradientB.hidden = !gradient && !firework; gradientTiming.hidden = !gradient;
      colorB.setAttribute('aria-label', `Layer ${index + 1} ${firework ? 'firework fade color' : 'gradient color B'}`);
      colorB.value = (firework ? item.fireworkColorTo : item.colorGradient?.to) ?? item.color; hexB.textContent = colorB.value.toUpperCase(); gradientPreview.style.background = `linear-gradient(to right, ${item.color}, ${colorB.value})`;
    });
    const geometry = section('SHAPE');
    const shape = document.createElement('select'); shape.className = 'layer-shape'; shape.setAttribute('aria-label', `Layer ${index + 1} shape`);
    for (const [value, text] of [['circle', 'CIRCLE'], ['ring', 'RING · OUTLINE'], ['rect', 'RECTANGLE']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; shape.append(option); }
    shape.value = current().shape ?? 'circle'; shape.addEventListener('change', () => update(item => ({ ...item, shape: shape.value }), true)); geometry.append(shape);
    const sizes = section(shape.value === 'rect' ? 'RECTANGLE DIMENSIONS' : 'CIRCLE DIAMETER');
    if (shape.value === 'rect') {
      for (const axis of ['width', 'height']) for (const bound of ['min', 'max']) number(sizes, `${axis === 'width' ? 'W' : 'H'} ${bound.toUpperCase()}`, `${axis} ${bound} in pixels`, item => dimensionRange(item, axis)[bound], 1, MAX_BRUSH_SIZE, 1, (item, value) => resizeDimension(item, axis, bound, value));
      number(sizes, 'ANGLE', 'angle in degrees', item => item.angle ?? 0, -180, 180, 1, (item, value) => ({ ...item, angle: value, followDirection: false }), '°');
    } else for (const bound of ['min', 'max']) number(sizes, bound.toUpperCase(), `${bound} recorded circle diameter in pixels`, item => layerSizeRange(item)[bound], 1, MAX_BRUSH_SIZE, 1, (item, value) => resizeGesture(item, bound, value));
    if (shape.value === 'ring') number(sizes, 'STROKE', 'ring stroke width in pixels', item => item.ringWidth ?? DEFAULT_RING_WIDTH, 1, MAX_RING_WIDTH, 1, (item, value) => ({ ...item, ringWidth: value }));
    const envelope = section('TIMING');
    number(envelope, 'START', 'start time in seconds', item => Number(((item.start ?? 0) / 1000).toFixed(3)), 0, clock.duration / 1000 - 0.001, 0.001, (item, value) => ({ ...item, start: Math.round(value * 1000) }), 's');
    if (current().mode === 'place') {
      for (const [key, text, min, max, fallback] of [['fadeInMs', 'FADE IN', 0, 10, 300], ['holdMs', 'HOLD', 0.1, 600, 1000], ['fadeOutMs', 'FADE OUT', 0, 10, 1000]]) number(envelope, text, `${text.toLowerCase()} in seconds`, item => (item[key] ?? fallback) / 1000, min, max, 0.1, (item, value) => ({ ...item, [key]: Math.round(value * 1000) }), 's');
    } else if (current().mode !== 'trail') number(envelope, 'RELEASE', 'release fade in seconds', item => (item.fadeMs ?? 2000) / 1000, 0.1, 10, 0.1, (item, value) => ({ ...item, fadeMs: Math.round(value * 1000) }), 's');
    const paints = document.createElement('div'); paints.className = 'layer-paints'; paints.append(colorSettings);
    const blending = document.createElement('div'); blending.className = 'layer-blending';
    const blendLabel = document.createElement('span'); blendLabel.className = 'layer-size-heading'; blendLabel.textContent = 'ANALOG MIX';
    const ratioLabel = document.createElement('label'); ratioLabel.className = 'layer-mix-ratio'; ratioLabel.append('RATIO');
    const ratio = document.createElement('input'); ratio.type = 'range'; ratio.min = 0; ratio.max = 100; ratio.step = 1; ratio.setAttribute('aria-label', `Layer ${index + 1} pigment mix ratio`);
    ratio.title = 'In overlaps: 0% uses the lower color; 100% uses this layer’s color.';
    const ratioValue = document.createElement('output'); ratioLabel.append(ratio, ratioValue);
    ratio.addEventListener('input', () => update(item => ({ ...item, mixAmount: Number(ratio.value) })));
    sync.push(() => { ratio.value = current().mixAmount ?? 50; ratioValue.textContent = `${ratio.value}%`; });
    blending.append(blendLabel, ratioLabel);
    const effectsPanel = document.createElement('section'); effectsPanel.className = 'layer-effects';
    const effectsHeading = document.createElement('h3'); effectsHeading.textContent = 'Effects'; effectsPanel.append(effectsHeading);
    for (const [key, title, amountKey] of [['blur', 'Blur', 'blurRadius']]) {
      const effect = document.createElement('div'); effect.className = 'layer-effect';
      const label = document.createElement('label'); label.className = 'effect-switch';
      const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.setAttribute('aria-label', `Layer ${index + 1} ${title}`);
      const name = document.createElement('span'); name.textContent = title; label.append(enabled, name); effect.append(label);
      const controls = document.createElement('div'); controls.className = 'effect-amount';
      const slider = document.createElement('input'); slider.type = 'range'; slider.min = EFFECT_LIMITS[amountKey][0]; slider.max = EFFECT_LIMITS[amountKey][1]; slider.step = 1; slider.setAttribute('aria-label', `Layer ${index + 1} ${title} amount`);
      const amount = number(controls, key === 'blur' ? 'Radius' : 'Amount', `${title} pixels`, item => layerEffects(item)[amountKey], ...EFFECT_LIMITS[amountKey], 1, (item, value) => ({ ...item, effects: { ...layerEffects(item), [amountKey]: value } }));
      controls.prepend(slider); effect.append(controls); effectsPanel.append(effect);
      enabled.addEventListener('change', () => update(item => ({ ...item, effects: { ...layerEffects(item), [key]: enabled.checked } })));
      slider.addEventListener('input', () => update(item => ({ ...item, effects: { ...layerEffects(item), [amountKey]: Number(slider.value) } })));
      sync.push(() => { const fx = layerEffects(current()); enabled.checked = fx[key]; slider.value = fx[amountKey]; slider.disabled = amount.disabled = !fx[key]; controls.classList.toggle('effect-disabled', !fx[key]); });
    }
    const identity = document.createElement('span'); identity.className = 'layer-identity'; identity.append(label, timing);
    const chevron = document.createElement('span'); chevron.className = 'layer-chevron'; chevron.textContent = '⌄'; chevron.setAttribute('aria-hidden', 'true');
    const body = document.createElement('div'); body.className = 'layer-body'; body.dataset.layerId = clip.id;
    body.append(paints, gradientTiming, effectsPanel, blending, actions, layerFold(clip.id, 'shape', 'SHAPE & SIZE', [geometry, sizes]), layerFold(clip.id, 'timing', 'TIMING & TRIM', [envelope, track, summary]));
    actions.append(reorder);
    const card = layerFold(clip.id, 'card', [toggle, identity, chevron, remove], []);
    card.open = false;
    card.querySelector('summary').addEventListener('click', event => {
      event.preventDefault();
      if (event.target.closest('button') || stroke || trimDrag) return;
      selectedLayerId = clip.id; shell.showLayer(clip.id, body);
    });
    row.append(card, body);
    body.hidden = false;
    $('#layer-list').prepend(row);
    if (clip.id === selectedLayerId) shell.showLayer(clip.id, body, false);
    refreshSelectedLayer = () => sync.forEach(fn => fn());
    refreshSelectedLayer(); trimTrackObserver?.observe(track);
  });
  syncFloatingColor();
  $('#layer-list').scrollTop = listScrollTop;
  historyUI();
  syncLayerDisclosure();
}
function historyUI() {
  const locked = !ready || Boolean(stroke) || Boolean(trimDrag);
  $('#undo').disabled = locked || !history.canUndo; $('#redo').disabled = locked || !history.canRedo;
}
function restoreHistory(direction) {
  if (!ready) return;
  trimDrag?.finish(); endStroke(null);
  const project = history[direction]();
  if (!project) return;
  const playback = playbackSnapshot(clock, performance.now());
  applyProject({ ...project, settings: { ...project.settings, view: state.view, colorPanelVisible: state.colorPanelVisible } }, playback); liveRevision++;
  queueSave(true, false); historyUI(); publisher.publish(true);
}
$('#undo').addEventListener('click', () => restoreHistory('undo'));
$('#redo').addEventListener('click', () => restoreHistory('redo'));
document.addEventListener('pointerdown', event => {
  if (trimDrag) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  history.endGroup();
}, true);
document.addEventListener('focusout', () => history.endGroup());
document.addEventListener('change', () => history.endGroup());
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || !(event.metaKey || event.ctrlKey) || event.altKey || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  const key = event.key.toLowerCase();
  if (key === 'z' || key === 'y' && event.ctrlKey) { event.preventDefault(); restoreHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo'); }
});
function playbackUI() {
  $('#play').textContent = clock.playing ? 'PAUSE' : 'PLAY';
  $('#play').setAttribute('aria-label', clock.playing ? 'Pause loop' : 'Play loop');
  $('#loop-duration').value = (clock.duration / 1000).toFixed(1).replace(/\.0$/, '');
  $('#loop-progress').max = clock.duration - 1;
  timelineUI(performance.now());
}
function timelineUI(now) {
  const phase = clock.phase(now), seek = $('#loop-progress');
  seek.value = Math.min(clock.duration - 1, Math.round(phase));
  seek.style.setProperty('--progress', `${phase / clock.duration * 100}%`);
  seek.setAttribute('aria-valuetext', `${(phase / 1000).toFixed(2)} of ${(clock.duration / 1000).toFixed(2)} seconds`);
  $('#loop-time').textContent = `${(phase / 1000).toFixed(2)} / ${(clock.duration / 1000).toFixed(2)}s`;
}
function queueSave(immediate = false, remember = true) {
  if (!ready) return;
  if (remember) {
    const control = document.activeElement;
    history.record(currentProject(), trimDrag?.group ?? (control?.matches('input, select, textarea') ? control : null));
    historyUI();
  }
  publisher.publish();
  dirty = true; revision++; $('#cache-status').textContent = 'SAVING…';
  clearTimeout(cacheTimer);
  if (immediate) flushSave(); else cacheTimer = setTimeout(flushSave, 180);
}
function flushSave() {
  clearTimeout(cacheTimer);
  if (stroke) { cacheTimer = setTimeout(flushSave, 180); return; }
  const savedRevision = revision;
  const project = structuredClone(currentProject());
  saveQueue = saveQueue.catch(() => {}).then(() => saveProject(project)).then(() => {
    if (revision === savedRevision) { dirty = false; $('#cache-status').textContent = 'SAVED LOCALLY'; }
    cacheFailed = false;
  }).catch(error => {
    $('#cache-status').textContent = 'MEMORY ONLY';
    if (!cacheFailed) toast('Local cache could not be saved. Use Files → Save project to keep your work.');
    cacheFailed = true; console.error('Local cache failed:', error);
  });
}
function cacheStroke(current, now) {
  const duration = Math.max(now - current.started, current.samples.at(-1).t);
  if (current.samples.at(-1).t < duration) current.samples.push({ ...current.last, t: duration });
  clips = [...clips, { id: current.id, mode: current.mode, shape: current.shape, angle: current.angle, followDirection: false, color: current.color, opacity: current.opacity, ringWidth: current.ringWidth, effects: { ...current.effects }, blendMode: 'analog', targets: current.targets, samples: current.samples, sizeRange: current.sizeRange, duration, start: current.start, fadeMs: state.fadeMs, enabled: true }];
  const required = Math.ceil(minimumLoop(clips) / 1000) * 1000;
  if (clock.duration < required) {
    clock.resize(required, now);
    clock.seek(current.start + duration, now);
  }
  $('.canvas-empty').hidden = true;
  current.targets.forEach(index => { layers[index].circle = null; });
  rebuildCache(); playbackUI(); queueSave();
}


function toast(message) {
  $('#toast').textContent = message; $('#toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4000);
}
function selectCanvas() {
  state.active = 0;
  $('#clear').setAttribute('aria-label', 'Clear canvas');
}
function setSync() { state.sync = false; selectCanvas(); }
function setMode(mode, restoring = false) {
  if (!modes.includes(mode) || !restoring && (!ready || trimDrag)) return;
  endStroke(null);
  state.mode = mode;
  $('.studio').dataset.mode = mode;
  shell.setMode(mode);
  layers.forEach(layer => layer.circle = null);
  renderTargets([0], performance.now(), true); queueSave();
}
function renderCanvas(index, now, force = false, phase = clock.phase(now)) {
  const layer = layers[index];
  const frame = frameNumber(now);
  if (!force && frame === layer.lastFrame) return;
  layer.lastFrame = frame;
  layer.circle?.update(now);
  painting.setLiveStroke(stroke, now, layer.circle?.displayPoint());
  painting.setView(state.view);
  painting.draw(index, phase, { now, placementPreview: !clock.playing });
}
function renderTargets(targets, now = performance.now(), force = false, phase = clock.phase(now)) { targets.forEach(index => renderCanvas(index, now, force, phase)); }
let animationFrame = -1;
function animate(now) {
  const frame = frameNumber(now);
  if (frame !== animationFrame) {
    animationFrame = frame;
    if (stroke) livePublisher.publish(now);
    if (viewDirty) { renderTargets([0], now, true); viewDirty = false; void viewPublisher.publish(); }
    for (let i = 0; i < canvases.length; i++) if ((clock.playing && scene.items.some(item => item.clip.enabled && item.clip.targets.includes(i))) || layers[i].circle?.moving || stroke?.targets.includes(i)) renderCanvas(i, now);
    timelineUI(now);
  }
  requestAnimationFrame(animate);
}
renderTargets([0]); requestAnimationFrame(animate);
function point(event, canvas) {
  const pressure = state.pressure && event.pointerType === 'pen' ? (Number.isFinite(event.pressure) ? Math.max(0, Math.min(1, event.pressure)) : 0.5) : 1;
  const geometry = state.shape === 'rect' ? { shape: 'rect', width: brushSize(state.widthMin, state.widthMax, pressure, 'pen', true), height: brushSize(state.heightMin, state.heightMax, pressure, 'pen', true), heading: 0, angle: state.angle } : state.shape === 'ring' ? { shape: 'ring', ringWidth: state.ringWidth } : {};
  return { ...screenToWorld(canvasPoint(event, canvas.getBoundingClientRect()), state.view), pressure, size: brushSize(state.minSize, state.maxSize, pressure, 'pen', true), ...geometry };
}
function drawPoint(pointValue) {
  if (stroke.mode === 'move') layers[0].circle.setTarget(pointValue);
  dirty = true;
}
function samplePoint(next) {
  if (stroke.shape === 'rect') next = { ...next, angle: stroke.angle, heading: 0 };
  drawPoint(next);
  stroke.last = next;
  stroke.samples.push({ ...next, t: Math.max(stroke.samples.at(-1).t + 0.01, performance.now() - stroke.started) });
}
function endStroke(event) {
  if (!stroke || (event && event.pointerId !== stroke.pointerId)) return;
  if (event?.type === 'pointerup') samplePoint({ ...stroke.last, ...screenToWorld(canvasPoint(event, stroke.canvas.getBoundingClientRect()), state.view) });
  const current = stroke; stroke = null; liveRevision++;
  if (current.canvas.hasPointerCapture(current.pointerId)) current.canvas.releasePointerCapture(current.pointerId);
  const now = performance.now(); cacheStroke(current, now);
  publisher.publish();
  renderTargets([0], now, true);
}
function syncViewUI() {
  const percent = `${Math.round(state.view.scale * 100)}%`;
  $('#zoom-out').disabled = state.view.scale <= MIN_ZOOM; $('#zoom-in').disabled = state.view.scale >= MAX_ZOOM;
  $('.canvas-state').textContent = `View ${Math.round(Math.min(CANVAS_SPEC.width, VIEWPORT_WIDTH / state.view.scale))} × ${Math.round(Math.min(CANVAS_SPEC.height, VIEWPORT_HEIGHT / state.view.scale))}`;
  $('#reset-view').textContent = percent; $('#reset-view').title = `${percent} · Reset to center · 1920 × 1080`;
  paintingBoundary.hidden = state.view.scale >= VIEWPORT_WIDTH / CANVAS_SPEC.width;
  Object.assign(paintingBoundary.style, { left: `${state.view.x / VIEWPORT_WIDTH * 100}%`, top: `${state.view.y / VIEWPORT_HEIGHT * 100}%`, width: `${CANVAS_SPEC.width * state.view.scale / VIEWPORT_WIDTH * 100}%`, height: `${CANVAS_SPEC.height * state.view.scale / VIEWPORT_HEIGHT * 100}%` });
  painting.setView(state.view); canvases[0].dataset.zoom = state.view.scale;
}
function changeView(view) {
  state.view = canvasView(view); viewRevision++; syncViewUI(); viewDirty = true;
}
function finishView() { clearTimeout(zoomSaveTimer); queueSave(false, false); publisher.publish(true); }
function cancelTouchStroke() {
  if (!stroke || stroke.pointerType !== 'touch') { endStroke(null); return; }
  const current = stroke; stroke = null; liveRevision++;
  current.targets.forEach(index => layers[index].circle = null);
  if (!current.wasPlaying) { clock.seek(current.start, performance.now()); clock.pause(performance.now()); playbackUI(); }
  $('.canvas-empty').hidden = clips.length > 0; historyUI(); publisher.publish(true); renderTargets([0], performance.now(), true);
}
$('#reset-view').addEventListener('click', () => { if (!ready || trimDrag) return; endStroke(null); changeView(DEFAULT_VIEW); finishView(); });
for (const [id, factor] of [['zoom-in', 1.25], ['zoom-out', .8]]) $(`#${id}`).addEventListener('click', () => { if (!ready || trimDrag) return; endStroke(null); changeView(zoomAt(state.view, state.view.scale * factor, { x: VIEWPORT_WIDTH / 2, y: VIEWPORT_HEIGHT / 2 })); finishView(); });
canvases.forEach((canvas, index) => {
  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') {
      if (!ready || trimDrag) return;
      event.preventDefault(); canvas.setPointerCapture(event.pointerId);
      const started = pinch.down(event.pointerId, canvasPoint(event, canvas.getBoundingClientRect()), state.view);
      if (started) cancelTouchStroke();
      if (pinch.blocked || !state.touch) return;
    }
    if (!ready || stroke || trimDrag || event.button !== 0) return;
    const startPoint = point(event, canvas);
    if (startPoint.x < 0 || startPoint.y < 0 || startPoint.x >= CANVAS_SPEC.width || startPoint.y >= CANVAS_SPEC.height) return;
    event.preventDefault(); selectCanvas(index); canvas.setPointerCapture(event.pointerId);
    const now = performance.now(), wasPlaying = clock.playing; clock.play(now); playbackUI(); liveRevision++;
    stroke = { id: `${liveSession}-${liveRevision}`, pointerId: event.pointerId, pointerType: event.pointerType, wasPlaying, canvas, targets: state.sync ? [0] : [index], color: state.color, opacity: state.opacity, mode: state.mode, shape: state.shape, ringWidth: state.ringWidth, effects: { ...state.effects }, angle: state.angle, followDirection: false, sizeRange: { min: state.minSize, max: state.maxSize }, last: startPoint, started: now, start: clock.phase(now), samples: [] };
    stroke.samples.push({ ...stroke.last, t: 0 });
    history.endGroup(); historyUI();
    if (stroke.mode === 'move') {
      const circle = new SmoothedCircle(stroke.last, stroke.color, performance.now());
      stroke.targets.forEach(index => layers[index].circle = circle);
    }
    $('.canvas-empty').hidden = true; drawPoint(stroke.last); renderTargets(stroke.targets, now, true); if (!wasPlaying) publisher.publish(); livePublisher.publish();
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') {
      const view = pinch.move(event.pointerId, canvasPoint(event, canvas.getBoundingClientRect()));
      if (view) changeView(view);
      if (pinch.blocked || !state.touch) { event.preventDefault(); return; }
    }
    const cursorPoint = point(event, canvas), cursor = canvas.parentElement.querySelector('.brush-cursor');
    $('#pointer-position').textContent = `X ${Math.round(cursorPoint.x)}  Y ${Math.round(cursorPoint.y)}`;
    const scale = canvas.getBoundingClientRect().width / VIEWPORT_WIDTH * state.view.scale;
    const cursorScreen = worldToScreen(cursorPoint, state.view);
    cursor.style.left = `${cursorScreen.x / VIEWPORT_WIDTH * 100}%`; cursor.style.top = `${cursorScreen.y / VIEWPORT_HEIGHT * 100}%`;
    cursor.style.width = `${Math.max(3, (cursorPoint.width ?? cursorPoint.size) * scale)}px`;
    cursor.style.height = `${Math.max(3, (cursorPoint.height ?? cursorPoint.size) * scale)}px`;
    cursor.style.borderRadius = state.shape === 'rect' ? '0' : '50%';
    cursor.style.transform = `translate(-50%, -50%) rotate(${cursorPoint.angle ?? 0}deg)`;
    if (!stroke || event.pointerId !== stroke.pointerId) return;
    event.preventDefault();
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    for (const sample of coalesced.length ? coalesced : [event]) samplePoint(point(sample, canvas));
    renderTargets(stroke.targets);
  });
  const finishPointer = event => {
    if (event.pointerType === 'touch' && pinch.up(event.pointerId)) { if (!pinch.points.size) finishView(); return; }
    endStroke(event);
  };
  canvas.addEventListener('pointerup', finishPointer); canvas.addEventListener('pointercancel', finishPointer); canvas.addEventListener('lostpointercapture', finishPointer);
  canvas.addEventListener('wheel', event => {
    if (!event.ctrlKey || !ready || trimDrag) return;
    event.preventDefault(); endStroke(null);
    changeView(zoomAt(state.view, state.view.scale * Math.exp(-event.deltaY * .01), canvasPoint(event, canvas.getBoundingClientRect())));
    clearTimeout(zoomSaveTimer); zoomSaveTimer = setTimeout(finishView, 150);
  }, { passive: false });
  canvas.addEventListener('contextmenu', event => event.preventDefault()); canvas.addEventListener('focus', () => selectCanvas(index));
});
$('#pressure').addEventListener('change', event => { state.pressure = event.target.checked; queueSave(); });
$('#touch').addEventListener('change', event => { state.touch = event.target.checked; queueSave(); });
function syncSizeUI() {
  ['min', 'max'].forEach(bound => { const value = state[`${bound}Size`]; $(`#size-${bound}`).value = value; $(`#range-${bound}`).value = value; });
}
function updateSize(bound, rawValue) {
  if (rawValue === '' || !Number.isFinite(Number(rawValue))) return;
  const value = Math.min(MAX_BRUSH_SIZE, Math.max(1, Math.round(Number(rawValue))));
  state[`${bound}Size`] = value;
  if (state.minSize > state.maxSize) state[bound === 'min' ? 'maxSize' : 'minSize'] = value;
  syncSizeUI(); queueSave();
}
['min', 'max'].forEach(bound => {
  $(`#range-${bound}`).addEventListener('input', event => updateSize(bound, event.target.value));
  $(`#size-${bound}`).addEventListener('input', event => updateSize(bound, event.target.value));
  $(`#size-${bound}`).addEventListener('change', syncSizeUI);
});
function syncShapeUI() {
  $('#shape').value = state.shape;
  $('#circle-controls').hidden = state.shape === 'rect'; $('#ring-controls').hidden = state.shape !== 'ring'; $('#ring-width').value = state.ringWidth; shell.setShape(state.shape); $('#rectangle-controls').hidden = state.shape !== 'rect';
  for (const axis of ['width', 'height']) for (const bound of ['Min', 'Max']) { $(`#${axis}-${bound}`).value = $(`#${axis}-range-${bound}`).value = state[`${axis}${bound}`]; }
  $('#shape-angle').value = state.angle;
}
function setShape(shape) { if (!ready || trimDrag) return; endStroke(null); state.shape = shape; syncShapeUI(); queueSave(); }
$('#shape').addEventListener('change', event => setShape(event.target.value));
$('#ring-width').addEventListener('input', event => { if (!event.target.value) return; state.ringWidth = Math.max(1, Math.min(MAX_RING_WIDTH, Math.round(Number(event.target.value)))); syncShapeUI(); queueSave(); });
for (const axis of ['width', 'height']) for (const bound of ['Min', 'Max']) {
  const update = raw => {
    if (raw === '' || !Number.isFinite(Number(raw))) return;
    const value = Math.max(1, Math.min(MAX_BRUSH_SIZE, Math.round(Number(raw)))); state[`${axis}${bound}`] = value;
    if (state[`${axis}Min`] > state[`${axis}Max`]) state[`${axis}${bound === 'Min' ? 'Max' : 'Min'}`] = value;
    syncShapeUI(); queueSave();
  };
  for (const selector of [`#${axis}-${bound}`, `#${axis}-range-${bound}`]) $(selector).addEventListener('input', event => update(event.target.value));
  $(`#${axis}-${bound}`).addEventListener('change', syncShapeUI);
}
$('#shape-angle').addEventListener('input', event => {
  if (event.target.value === '' || !Number.isFinite(Number(event.target.value))) return;
  state.angle = Math.max(-180, Math.min(180, Math.round(Number(event.target.value)))); syncShapeUI(); queueSave();
});
function syncFloatingColor() {
  const clip = clips.find(item => item.id === colorContext.id);
  if (!clip) colorContext = { id: null, field: 'fill' };
  const second = clip && colorContext.field === 'second';
  colorPanel.setColor(clip ? (second ? (hasFireworkColor(clip) ? clip.fireworkColorTo : clip.colorGradient?.to) ?? clip.color : clip.color) : state.color, clip ? clip.opacity ?? 1 : state.opacity, clip ? `Layer ${String(clips.indexOf(clip) + 1).padStart(2, '0')}${second ? ' · B' : ''}` : 'Brush');
}
function editFloatingColor(color, opacity) {
  if (!ready || stroke || trimDrag) { syncFloatingColor(); return; }
  const clip = clips.find(item => item.id === colorContext.id);
  if (!clip) { state.color = color; state.opacity = opacity; }
  else {
    clips = clips.map(item => item.id !== clip.id ? item : editLayer(item, 'all', value => {
      let next = { ...value, opacity };
      if (colorContext.field === 'second') next = hasFireworkColor(value) ? { ...next, fireworkColorTo: color } : { ...next, colorGradient: { ...value.colorGradient, to: color } };
      else if (color !== value.color) next = pickLayerColor(hasSampleColor(value) ? { ...next, colorEditMode: 'color' } : next, color);
      return next;
    }));
    scene.setProject({ clips, duration: clock.duration }); refreshSelectedLayer(); renderTargets([0], performance.now(), true);
  }
  syncFloatingColor(); queueSave();
}
function setColor(color) { state.color = color; syncFloatingColor(); queueSave(); }
$('#play').addEventListener('click', () => {
  endStroke(null); const now = performance.now();
  if (clock.playing) clock.pause(now); else clock.play(now);
  playbackUI(); renderTargets([0], now, true); publisher.publish(true);
});
$('#loop-progress').addEventListener('pointerdown', event => {
  if (!ready || event.button !== 0) return;
  endStroke(null);
  const now = performance.now(); clock.pause(now); playbackUI(); renderTargets([0], now, true); publisher.publish(true);
});
$('#loop-progress').addEventListener('input', event => {
  if (!ready) return;
  endStroke(null);
  const now = performance.now(); clock.pause(now); clock.seek(Number(event.target.value), now);
  playbackUI(); renderTargets([0], now, true); publisher.publish(true);
});
$('#restart').addEventListener('click', () => { endStroke(null); clock.restart(performance.now()); renderTargets([0], performance.now(), true); publisher.publish(true); });
$('#loop-duration').addEventListener('change', event => {
  endStroke(null);
  const seconds = Number(event.target.value);
  if (!Number.isFinite(seconds * 1000) || seconds <= 0) { playbackUI(); return; }
  const minimum = Math.ceil(minimumLoop(clips) / 500) * 500;
  clock.resize(Math.max(minimum, seconds * 1000), performance.now()); playbackUI(); rebuildCache(); renderTargets([0], performance.now(), true); queueSave();
  if (seconds * 1000 < minimum) toast(`These layers need at least ${minimum / 1000}s to finish their motion.`);
});
function syncEffectsUI() {
  $('#fade-seconds').value = $('#fade-range').value = state.fadeMs / 1000;
  $('#draw-blur').checked = state.effects.blur; $('#draw-blur-radius').value = $('#draw-blur-range').value = state.effects.blurRadius;
  $('#draw-blur-radius').disabled = $('#draw-blur-range').disabled = !state.effects.blur;
}
$('#draw-blur').addEventListener('change', event => { state.effects = { ...state.effects, blur: event.target.checked }; syncEffectsUI(); queueSave(); });
const setBrushBlur = event => { if (event.target.value === '') return; state.effects = { ...state.effects, blurRadius: Math.max(0, Math.min(192, Math.round(Number(event.target.value)))) }; syncEffectsUI(); queueSave(); };
$('#draw-blur-radius').addEventListener('input', setBrushBlur); $('#draw-blur-range').addEventListener('input', setBrushBlur);
function setFade(raw) {
  if (raw === '' || !Number.isFinite(Number(raw))) return;
  state.fadeMs = Math.round(Math.max(0.1, Math.min(10, Number(raw))) * 10) * 100;
  clips = clips.map(clip => editLayer(clip, 'all', item => ['return', 'move'].includes(item.mode) ? fitGestureTrim({ ...item, fadeMs: state.fadeMs }, clock.duration) : item));
  const required = Math.ceil(minimumLoop(clips) / 500) * 500;
  if (clock.duration < required) clock.resize(required, performance.now());
  syncEffectsUI(); playbackUI(); rebuildCache(); renderTargets([0], performance.now(), true); queueSave();
}
$('#fade-range').addEventListener('input', event => setFade(event.target.value));
$('#fade-seconds').addEventListener('input', event => setFade(event.target.value));
$('#fade-seconds').addEventListener('change', syncEffectsUI);
$('#clear').addEventListener('click', () => {
  if (!ready || trimDrag) return;
  endStroke(null);
  const targets = state.sync ? [0] : [state.active];
  targets.forEach(index => { layers[index].circle = null; });
  clips = clips.map(clip => removeLayerSides(clip, targets)).filter(clip => clip.targets.length);
  rebuildCache(); renderTargets(targets, performance.now(), true); queueSave();
});

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  // Safari may still be reading the object URL after the click.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function currentProject() { return { version: 1, canvas: { ...CANVAS_SPEC }, clips, duration: clock.duration, settings: state }; }
$('#save-project').addEventListener('click', () => {
  if (!ready) return;
  endStroke(null);
  download(new Blob([serializeProject(currentProject(), playbackSnapshot(clock, performance.now()))], { type: 'application/json' }), `direct-painting-${timestamp()}.json`);
});
function importProjectText(text) {
  const imported = parseProject(text);
  if (!ready || stroke || trimDrag) throw new Error('Finish drawing, then import the project again.');
  applyProject(imported.project, imported.playback); queueSave(true);
  toast('Project imported. Layers and drawing settings restored.');
}
$('#import-project').addEventListener('click', () => { if (ready && !trimDrag) { endStroke(null); $('#import-file').click(); } });
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file || !ready || stroke) return;
  try {
    if (file.size > MAX_PROJECT_BYTES) throw new Error('Project exceeds 16MB');
    importProjectText(await file.text());
  } catch (error) { toast(`Could not import JSON: ${error.message}`); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { trimDrag?.finish(); endStroke(null); if (dirty) flushSave(); }
});
window.addEventListener('beforeunload', event => { if (dirty || stroke) { event.preventDefault(); event.returnValue = ''; } });

// Optional browser agent API; the editor works normally without it.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const register = tool => { try { Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(console.error); } catch (error) { console.error(error); } };
  register({ name: 'read_editor_state', description: 'Read the canvas size and brush settings.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => ({ ...state }) });
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}

function applyProject(project, playback = { playing: true, phase: 0 }) {
  project = singleCanvasProject(project);
  const wasReady = ready; ready = false;
  try {
    clips = structuredClone(project.clips);
    layers.forEach(layer => { layer.circle = null; });
    Object.assign(state, DEFAULT_SETTINGS, project.settings);
    setMode(state.mode, true); setColor(state.color); setSync(state.sync); selectCanvas(state.active);
    viewRevision++; syncViewUI(); colorPanel.setVisible(state.colorPanelVisible);
    syncSizeUI(); syncShapeUI(); syncEffectsUI();
    $('#pressure').checked = state.pressure; $('#touch').checked = state.touch;
    const now = performance.now(); clock.resize(project.duration, now); clock.seek(playback.phase, now);
    if (playback.playing) clock.play(now); else clock.pause(now);
    rebuildCache(); playbackUI(); renderTargets([0], now, true);
  } finally { ready = wasReady; }
}
async function restoreProject() {
  try {
    let stored;
    try { stored = await loadProject(); } catch { cacheFailed = true; }
    if (!stored) {
      try { const response = await fetch('/api/loop', { cache: 'no-store' }); const shared = await response.json(); stored = shared.state?.project; } catch { /* Drawing remains available without the relay. */ }
    }
    if (stored) {
      applyProject(normalizeProject(stored));
    }
    $('#cache-status').textContent = cacheFailed ? 'MEMORY ONLY' : clips.length ? 'SAVED LOCALLY' : 'DRAW TO ADD A LAYER';
  } catch (error) {
    $('#cache-status').textContent = 'MEMORY ONLY'; cacheFailed = true;
    toast('Local cache could not be restored. You can still draw and save a project.'); console.error(error);
  } finally {
    history.reset(currentProject()); ready = true; historyUI(); $('.sidebar-scroll').inert = false; $('.loop-controls').inert = false; clock.restart(performance.now()); playbackUI(); rebuildCache(); renderTargets([0], performance.now(), true); publisher.publish(true);
  }
}
restoreProject();
