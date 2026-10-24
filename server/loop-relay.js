import { validateView, canvasView, importedView } from '../src/view.js';
import { MAX_BRUSH_SIZE, CANVAS_SPEC } from '../src/canvas.js';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateProject } from '../src/loop.js';
import { validateEffects, validateRingWidth } from '../src/effects.js';

export function validateSnapshot(value, now) {
  const project = validateProject(value?.project);
  if (project.settings?.view !== undefined) project.settings = { ...project.settings, view: importedView(project.settings.view, project.canvas) };
  if (project.canvas) project.canvas = { ...CANVAS_SPEC };
  const playback = value?.playback;
  if (!playback || typeof playback.playing !== 'boolean' || !Number.isFinite(playback.phase) || playback.phase < 0) throw new Error('Invalid playback');
  const phase = playback.phase % project.duration;
  return { project, playback: { playing: playback.playing, phase, anchor: now - phase } };
}
function validateControl(value) {
  if (!value || typeof value.session !== 'string' || value.session.length > 100 || !Number.isSafeInteger(value.revision) || value.revision < 0 || (value.id !== null && (typeof value.id !== 'string' || !value.id.length || value.id.length > 200))) throw new Error('Invalid live drawing control');
  return { session: value.session, revision: value.revision, id: value.id };
}
export function validateLive(value) {
  const control = validateControl(value);
  if (value.opacity !== undefined && (!Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 1)) throw new Error('Invalid live opacity');
  validateEffects(value.effects); validateRingWidth(value.ringWidth);
  if (!control.id || !['trail', 'return', 'move', 'place'].includes(value.mode) || !/^#[0-9a-f]{6}$/i.test(value.color) || !Array.isArray(value.targets) || !value.targets.length || value.targets.length > 2 || value.targets.some(side => side !== 0 && side !== 1) || !Number.isSafeInteger(value.from) || value.from < 0 || !Array.isArray(value.samples) || value.samples.length > 100000 || !Number.isFinite(value.elapsed) || value.elapsed < 0) throw new Error('Invalid live drawing');
  const point = (sample, timed) => {
    if (!sample || !['x', 'y', 'size'].every(key => Number.isFinite(sample[key])) || sample.size < 1 || sample.size > MAX_BRUSH_SIZE || (timed && (!Number.isFinite(sample.t) || sample.t < 0 || sample.t > value.elapsed))) throw new Error('Invalid live point');
    if (sample.shape !== undefined && !['circle', 'rect', 'ring'].includes(sample.shape)) throw new Error('Invalid live shape');
    if (sample.shape === 'rect' && (!['width', 'height', 'angle'].every(key => Number.isFinite(sample[key])) || sample.width < 1 || sample.width > MAX_BRUSH_SIZE || sample.height < 1 || sample.height > MAX_BRUSH_SIZE || Math.abs(sample.angle) > 720)) throw new Error('Invalid live rectangle');
    validateRingWidth(sample.ringWidth);
    return { x: sample.x, y: sample.y, size: sample.size, ...(sample.shape === 'ring' ? { shape: 'ring', ringWidth: sample.ringWidth ?? value.ringWidth ?? 5 } : {}), ...(sample.shape === 'rect' ? { shape: 'rect', width: sample.width, height: sample.height, angle: sample.angle } : {}), ...(timed ? { t: sample.t } : {}) };
  };
  const samples = value.samples.map(sample => point(sample, true));
  if (samples.some((sample, index) => index && sample.t < samples[index - 1].t) || (value.from === 0 && (!samples.length || samples[0].t !== 0))) throw new Error('Invalid live sample timing');
  return { ...control, mode: value.mode, color: value.color, opacity: value.opacity, effects: value.effects, ringWidth: value.ringWidth, targets: value.targets, from: value.from, samples, elapsed: value.elapsed, head: point(value.head, true), ...(value.move ? { move: point(value.move, false) } : {}) };
}
export function validateViewControl(value) {
  if (!value || typeof value.session !== 'string' || !value.session.length || value.session.length > 100 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.view) throw new Error('Invalid view control');
  validateView(value.view); return { session: value.session, revision: value.revision, view: canvasView(value.view) };
}
export async function createLoopRelay(cacheFile) {
  let state = null, version = 0, writes = Promise.resolve(), live = null, liveVersion = 0, lastLiveAt = 0;
  const clients = new Set(), controls = new Map(), viewControls = new Map();
  try {
    const saved = JSON.parse(await readFile(cacheFile, 'utf8'));
    state = validateSnapshot(saved, Date.now());
    if (Number.isFinite(saved.playback.anchor)) state.playback.anchor = saved.playback.anchor;
    version++;
  } catch (error) { if (error.code !== 'ENOENT') console.warn('Output cache could not be restored:', error.message); }
  const fullLive = () => live ? { ...live, from: 0 } : null;
  const message = (since, includeLive = true) => ({ version, serverNow: Date.now(), state: since === version ? null : state, ...(includeLive ? { liveVersion, live: fullLive() } : {}) });
  const json = (response, code, data) => { response.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
  const emit = (event, data) => { const text = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const response of clients) response.write(text); };
  const remember = control => {
    controls.set(control.session, control);
    if (controls.size > 128) controls.delete(controls.keys().next().value);
  };
  const rememberView = control => { viewControls.set(control.session, control); if (viewControls.size > 128) viewControls.delete(viewControls.keys().next().value); };
  const heartbeat = setInterval(() => { for (const response of clients) response.write(': keepalive\n\n'); }, 15000); heartbeat.unref();
  const expiry = setInterval(() => {
    if (live && Date.now() - lastLiveAt > 2000) { live = null; liveVersion++; emit('live', { live: null, liveVersion }); }
  }, 250); expiry.unref();
  const readJSON = async request => {
    let bytes = 0; const chunks = [];
    for await (const chunk of request) { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) throw new Error('Project exceeds 16MB'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString());
  };
  const handler = async (request, response, next) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api/stream' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      response.flushHeaders(); clients.add(response);
      response.write(`event: state\ndata: ${JSON.stringify(message(-1))}\n\n`);
      response.on('close', () => clients.delete(response)); return;
    }
    if (!['/api/loop', '/api/live', '/api/view'].includes(url.pathname)) return next();
    if (url.pathname === '/api/loop' && request.method === 'GET') return json(response, 200, message(Number(url.searchParams.get('since')), url.searchParams.get('live') !== '0'));
    if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/json')) return json(response, 405, { error: 'Use JSON POST or GET' });
    try {
      const value = await readJSON(request);
      if (url.pathname === '/api/view') {
        const control = validateViewControl(value), known = viewControls.get(control.session);
        if (!state) return json(response, 409, { error: 'Project not ready' });
        if (known && known.revision >= control.revision) return json(response, 200, { version });
        rememberView(control);
        state = { ...state, project: { ...state.project, settings: { ...state.project.settings, view: control.view } } }; version++;
        emit('view', { view: control.view, version });
        return json(response, 200, { version });
      }
      if (url.pathname === '/api/live') {
        const frame = validateLive(value), known = controls.get(frame.session);
        if (known && (known.revision > frame.revision || (known.revision === frame.revision && known.id !== frame.id))) return json(response, 200, { next: frame.from });
        if (!live || live.id !== frame.id || live.session !== frame.session) {
          if (frame.from !== 0) return json(response, 200, { next: 0 });
          live = { ...frame, samples: [] };
        }
        if (live.samples.length !== frame.from) return json(response, 200, { next: live.samples.length });
        if (frame.elapsed < live.elapsed || (frame.samples.length && live.samples.length && frame.samples[0].t < live.samples.at(-1).t)) return json(response, 400, { error: 'Out-of-order live drawing' });
        const samples = live.samples;
        for (const sample of frame.samples) samples.push(sample);
        live = { ...frame, samples, from: 0 }; lastLiveAt = Date.now(); liveVersion++;
        remember({ session: frame.session, revision: frame.revision, id: frame.id });
        emit('live', { live: frame, liveVersion });
        return json(response, 200, { next: samples.length });
      }
      const candidate = validateSnapshot(value, Date.now()), control = value.liveState === undefined ? null : validateControl(value.liveState);
      if (value.viewState !== undefined) {
        const incoming = validateViewControl(value.viewState), known = viewControls.get(incoming.session);
        if (known && known.revision > incoming.revision) candidate.project = { ...candidate.project, settings: { ...candidate.project.settings, view: state?.project.settings?.view ?? known.view } };
        else { rememberView(incoming); candidate.project = { ...candidate.project, settings: { ...candidate.project.settings, view: incoming.view } }; }
      }
      if (control) {
        const known = controls.get(control.session);
        if (!known || control.revision >= known.revision) {
          remember(control);
          if (live && (live.session !== control.session || (live.revision <= control.revision && live.id !== control.id))) { live = null; liveVersion++; }
        }
      }
      if (live && candidate.project.clips.some(clip => clip.id === live.id)) { live = null; liveVersion++; }
      state = candidate; version++;
      // Notify renderers before touching disk. Live frames are never persisted.
      emit('state', message(-1));
      writes = writes.catch(() => {}).then(async () => {
        await mkdir(dirname(cacheFile), { recursive: true }); await writeFile(`${cacheFile}.tmp`, JSON.stringify(candidate)); await rename(`${cacheFile}.tmp`, cacheFile);
      });
      await writes; json(response, 200, { version });
    } catch (error) { json(response, 400, { error: error.message }); }
  };
  handler.dispose = () => { clearInterval(heartbeat); clearInterval(expiry); for (const response of clients) response.end(); clients.clear(); };
  return handler;
}
