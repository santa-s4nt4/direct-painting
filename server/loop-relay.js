import { cameraConfig, cameraPose, newCameraEvent, centered } from '../src/camera-motion.js';
import { DEFAULT_VIEW } from '../src/view.js';
import { randomUUID } from 'node:crypto';
import { LOOP_MS } from '../src/transport.js';
import { createMidiInput } from './midi.js';
import { validatePlane } from '../src/space.js';
import { LineSchedule, firstCyclePending, finishFirstCycle, fixedLineStyle } from '../src/line-tool.js';
import { validateView, canvasView, importedView } from '../src/view.js';
import { MAX_BRUSH_SIZE, CANVAS_SPEC } from '../src/canvas.js';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateProject } from '../src/loop.js';
import { validateEffects, validateRingWidth, DEFAULT_RING_WIDTH } from '../src/effects.js';

export function validateSnapshot(value, now) {
  const project = { ...validateProject(value?.project), duration: LOOP_MS };
  if (project.settings !== undefined) {
    if (!project.settings || typeof project.settings !== 'object' || Array.isArray(project.settings)) throw new Error('Invalid drawing settings');
    for (const key of ['traceMotion', 'intersections']) if (project.settings[key] !== undefined && typeof project.settings[key] !== 'boolean') throw new Error(`Invalid ${key}`);
    if (project.settings.traceDurationMs !== undefined && (!Number.isInteger(project.settings.traceDurationMs) || project.settings.traceDurationMs < 100 || project.settings.traceDurationMs > 10000)) throw new Error('Invalid trace duration');
  }
  if (project.settings?.viewVersion !== undefined && project.settings.viewVersion !== 2 && project.settings.viewVersion !== 3 && project.settings.viewVersion !== 4) throw new Error('Invalid canvas view version');
  if (project.settings?.view !== undefined) project.settings = { ...project.settings, view: importedView(project.settings.view, project.canvas, project.settings.viewVersion), viewVersion: 4 };
  if (project.canvas) project.canvas = { ...CANVAS_SPEC };
  project.clips = project.clips.map(fixedLineStyle);
  if(project.settings?.camera!==undefined)project.settings={...project.settings,camera:cameraConfig(project.settings.camera)};
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
  validateEffects(value.effects); validateRingWidth(value.ringWidth); validatePlane(value.plane);
  if (!control.id || !['trail', 'return', 'move', 'place'].includes(value.mode) || !/^#[0-9a-f]{6}$/i.test(value.color) || !Array.isArray(value.targets) || !value.targets.length || value.targets.length > 2 || value.targets.some(side => side !== 0 && side !== 1) || !Number.isSafeInteger(value.from) || value.from < 0 || !Array.isArray(value.samples) || value.samples.length > 100000 || !Number.isFinite(value.elapsed) || value.elapsed < 0) throw new Error('Invalid live drawing');
  const point = (sample, timed) => {
    if (!sample || !['x', 'y', 'size'].every(key => Number.isFinite(sample[key])) || sample.size < 1 || sample.size > MAX_BRUSH_SIZE || (timed && (!Number.isFinite(sample.t) || sample.t < 0 || sample.t > value.elapsed))) throw new Error('Invalid live point');
    if (sample.shape !== undefined && !['circle', 'rect', 'ring', 'rect-ring'].includes(sample.shape)) throw new Error('Invalid live shape');
    if (['rect', 'rect-ring'].includes(sample.shape) && (!['width', 'height', 'angle'].every(key => Number.isFinite(sample[key])) || sample.width < 1 || sample.width > MAX_BRUSH_SIZE || sample.height < 1 || sample.height > MAX_BRUSH_SIZE || Math.abs(sample.angle) > 720)) throw new Error('Invalid live rectangle');
    validateRingWidth(sample.ringWidth);
    return { x: sample.x, y: sample.y, size: sample.size, ...(sample.shape === 'ring' ? { shape: 'ring', ringWidth: sample.ringWidth ?? value.ringWidth ?? DEFAULT_RING_WIDTH } : {}), ...(['rect', 'rect-ring'].includes(sample.shape) ? { shape: sample.shape, width: sample.width, height: sample.height, angle: sample.angle } : {}), ...(timed ? { t: sample.t } : {}) };
  };
  const samples = value.samples.map(sample => point(sample, true));
  if (samples.some((sample, index) => index && sample.t < samples[index - 1].t) || (value.from === 0 && (!samples.length || samples[0].t !== 0))) throw new Error('Invalid live sample timing');
  return { ...control, mode: value.mode, color: value.color, opacity: value.opacity, effects: value.effects, ringWidth: value.ringWidth, plane: value.plane, targets: value.targets, from: value.from, samples, elapsed: value.elapsed, head: point(value.head, true), ...(value.move ? { move: point(value.move, false) } : {}) };
}
export function validateViewControl(value) {
  if (!value || typeof value.session !== 'string' || !value.session.length || value.session.length > 100 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.view) throw new Error('Invalid view control');
  validateView(value.view); if(value.takeId!==undefined&&value.takeId!==null&&(typeof value.takeId!=='string'||value.takeId.length>150))throw new Error('Invalid camera take');
  return { session: value.session, revision: value.revision, view: canvasView(value.view), ...(value.takeId?{takeId:value.takeId}:{}) };
}
export async function createLoopRelay(cacheFile, { midi = false } = {}) {
  let state = null, version = 0, writes = Promise.resolve(), live = null, liveVersion = 0, lastLiveAt = 0;
  const transport = { epoch: randomUUID(), revision: 0 };
  let midiInput;
  const camera={epoch:randomUUID(),revision:0,event:null},cameraControls=new Map();
  const clients = new Set(), controls = new Map(), viewControls = new Map();
  const lineSchedule = new LineSchedule(), releasedFirstCycles = new Map();
  try {
    const saved = JSON.parse(await readFile(cacheFile, 'utf8'));
    state = validateSnapshot(saved, Date.now());
    if (Number.isFinite(saved.playback.anchor)) state.playback.anchor = saved.playback.anchor;
    version++;
  } catch (error) { if (error.code !== 'ENOENT') console.warn('Output cache could not be restored:', error.message); }
  const fullLive = () => live ? { ...live, from: 0 } : null;
  const cameraSnapshot=()=>({...camera,config:cameraConfig(state?.project.settings?.camera),baseView:state?.project.settings?.view??DEFAULT_VIEW});
  const message = (since, includeLive = true) => ({ version, serverNow: Date.now(), transport: { ...transport }, camera:cameraSnapshot(), state: since === version ? null : state, ...(includeLive ? { liveVersion, live: fullLive() } : {}) });
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
  const persist = snapshot => {
    writes = writes.catch(() => {}).then(async () => {
      await mkdir(dirname(cacheFile), { recursive: true }); await writeFile(`${cacheFile}.tmp`, JSON.stringify(snapshot)); await rename(`${cacheFile}.tmp`, cacheFile);
    });
    return writes;
  };
  const phaseAt = now => { const time = state.playback.playing ? now - state.playback.anchor : state.playback.phase; return ((time % state.project.duration) + state.project.duration) % state.project.duration; };
  const revealLines = now => {
    if (!state) return;
    const revealed = lineSchedule.advance(state.project.clips, phaseAt(now), state.project.duration, now, state.playback.playing);
    if (!revealed.size) return;
    for (const id of revealed) releasedFirstCycles.set(id, false);
    state = { ...state, project: { ...state.project, clips: state.project.clips.map(clip => revealed.has(clip.id) ? finishFirstCycle(clip) : clip) } }; version++;
    emit('state', message(-1)); void persist(state).catch(error => console.warn('Line reveal could not be saved:', error.message));
  };
  if (state) lineSchedule.rebase(state.project.clips, phaseAt(Date.now()), state.project.duration, Date.now());
  // Continue the first-cycle handoff even when the iPad tab sleeps or closes.
  const lineTicker = setInterval(() => revealLines(Date.now()), 1000 / 60); lineTicker.unref();
  const emitCamera=()=>emit('camera',{...cameraSnapshot(),serverNow:Date.now(),version});
  const restartFromMidi = now => {
    if (!state) return;
    transport.revision++;
    state = { ...state, playback: { playing: true, phase: 0, anchor: now }, project: { ...state.project, clips: state.project.clips.map(clip => {
      if (clip.mode === 'line' && !clip.lineIncomplete || firstCyclePending(clip)) releasedFirstCycles.set(clip.id, false);
      return finishFirstCycle(clip);
    }) } };
    version++;
    lineSchedule.rebase(state.project.clips, 0, LOOP_MS, now);
    emit('transport', { transport: { ...transport }, playback: state.playback, serverNow: now });
    emit('state', message(-1));
    void persist(state).catch(error => console.warn('MIDI restart could not be saved:', error.message));
  };
  const receiveCameraNote=message=>{
    if(!state)return;
    const config=cameraConfig(state.project.settings?.camera);if(config.mode!=='midi-auto')return;
    if(message.type!=='on'||message.note!==config.note)return;
    const base=state.project.settings?.view??DEFAULT_VIEW,from=cameraPose(cameraSnapshot(),base,phaseAt(message.at),message.at);
    camera.event=newCameraEvent(from,base,config,message.at,`${message.channel}:${message.note}`);
    camera.revision++;emitCamera();
  };
  const midiEpoch = randomUUID(); let midiRevision = 0;
  const receiveMidiNote = message => {
    // Flash on the received event, independent of camera mode and 1s polling.
    emit('midi', { ...message, epoch: midiEpoch, revision: ++midiRevision });
    receiveCameraNote(message);
  };
  if (midi) midiInput = await createMidiInput({ configFile: `${cacheFile}.midi.json`, onRestart: restartFromMidi, onNote:receiveMidiNote });
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
    if (url.pathname === '/api/midi') {
      if (!midiInput) return json(response, 503, { error: 'MIDI input is not enabled on this server' });
      if (request.method === 'GET') return json(response, 200, { ...midiInput.snapshot(), transport: { ...transport }, playback: state?.playback, camera:cameraSnapshot(), serverNow: Date.now() });
      if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/json')) return json(response, 405, { error: 'Use JSON POST or GET' });
      try { await midiInput.configure(await readJSON(request)); return json(response, 200, midiInput.snapshot()); }
      catch (error) { return json(response, 400, { error: error.message }); }
    }
    if(url.pathname==='/api/camera'){
      if(request.method==='GET')return json(response,200,{...cameraSnapshot(),serverNow:Date.now(),version});
      if(request.method!=='POST'||!request.headers['content-type']?.startsWith('application/json'))return json(response,405,{error:'Use JSON POST'});
      try{
        const value=await readJSON(request);
        if(!state)return json(response,409,{error:'Project not ready'});
        if(typeof value.session!=='string'||!value.session.length||value.session.length>100||!Number.isSafeInteger(value.revision)||value.revision<0)throw new Error('Invalid camera control');
        const known=cameraControls.get(value.session);if(known!==undefined&&known>=value.revision)return json(response,200,cameraSnapshot());
        if(value.kind==='settings'){
          if(!value.camera||typeof value.camera!=='object')throw new Error('Camera settings required');
          const incoming=cameraConfig(value.camera),old=cameraConfig(state.project.settings?.camera),now=Date.now(),base=state.project.settings?.view??DEFAULT_VIEW;
          const pose=cameraPose(cameraSnapshot(),base,phaseAt(now),now);
          if(incoming.mode!==old.mode||incoming.motion!==old.motion){camera.event=null;state={...state,project:{...state.project,settings:{...state.project.settings,view:incoming.mode==='midi-auto'?centered(pose):pose}}};}
          state={...state,project:{...state.project,settings:{...state.project.settings,camera:incoming}}};
        }else throw new Error('Unknown camera command');
        cameraControls.set(value.session,value.revision);if(cameraControls.size>128)cameraControls.delete(cameraControls.keys().next().value);
        camera.revision++;version++;emitCamera();await persist(state);return json(response,200,cameraSnapshot());
      }catch(error){return json(response,400,{error:error.message});}
    }
    if (!['/api/loop', '/api/live', '/api/view'].includes(url.pathname)) return next();
    if (url.pathname === '/api/loop' && request.method === 'GET') return json(response, 200, message(Number(url.searchParams.get('since')), url.searchParams.get('live') !== '0'));
    if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/json')) return json(response, 405, { error: 'Use JSON POST or GET' });
    try {
      const value = await readJSON(request);
      if (url.pathname === '/api/view') {
        const control = validateViewControl(value), known = viewControls.get(control.session);
        if(control.takeId)return json(response,200,{version}); // Ignore delayed packets from retired camera recordings.
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
      revealLines(Date.now());
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
      const ids = new Set(candidate.project.clips.map(clip => clip.id));
      for (const id of releasedFirstCycles.keys()) if (!ids.has(id)) releasedFirstCycles.delete(id);
      candidate.project = { ...candidate.project, clips: candidate.project.clips.map(clip => {
        if (!releasedFirstCycles.has(clip.id)) return clip;
        if (!firstCyclePending(clip)) { releasedFirstCycles.set(clip.id, true); return clip; }
        if (!releasedFirstCycles.get(clip.id)) return finishFirstCycle(clip); // A late first-cycle snapshot cannot reopen a released gate.
        releasedFirstCycles.delete(clip.id); return clip; // An acknowledged gate may be explicitly restored by Undo/import.
      }) };
      const staleCamera=camera.revision>0&&(value.cameraState?.epoch!==camera.epoch||value.cameraState?.revision!==camera.revision);
      if(staleCamera&&state)candidate.project={...candidate.project,settings:{...candidate.project.settings,camera:state.project.settings?.camera,view:state.project.settings?.view}};
      else if(state&&JSON.stringify(candidate.project.settings?.camera)!==JSON.stringify(state.project.settings?.camera)){camera.event=null;camera.revision++;}
      // A snapshot sent before a MIDI trigger must never undo that restart.
      if (transport.revision > 0 && (value.transportState?.epoch !== transport.epoch || value.transportState?.revision !== transport.revision) && state) candidate.playback = { ...state.playback };
      state = candidate; version++;
      lineSchedule.rebase(state.project.clips, state.playback.phase, state.project.duration, Date.now());
      // Notify renderers before touching disk. Live frames are never persisted.
      emit('state', message(-1));
      await persist(candidate); json(response, 200, { version });
    } catch (error) { json(response, 400, { error: error.message }); }
  };
  handler.restartFromMidi = restartFromMidi;
  handler.receiveCameraNote=receiveCameraNote;
  handler.receiveMidiNote=receiveMidiNote;
  handler.dispose = () => { midiInput?.dispose(); clearInterval(heartbeat); clearInterval(expiry); clearInterval(lineTicker); for (const response of clients) response.end(); clients.clear(); return writes; };
  return handler;
}
