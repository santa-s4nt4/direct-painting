import { CameraSampler, mergeCamera } from './camera-motion.js';
import { DEFAULT_VIEW } from './view.js';
import { LOOP_MS } from './transport.js';
import './output.css';
import { frameNumber } from './timing.js';
import { createPaintingRenderer } from './render/index.js';
import { outputPhase } from './relay.js';

const FULL_HD = { width: 1920, height: 1080 };
const HD = { width: 1280, height: 720 };
function preferredOutputSize() {
  return window.innerWidth >= FULL_HD.width && window.innerHeight >= FULL_HD.height ? FULL_HD : HD;
}

const side = 0;
document.title = 'direct-painting · Output';
const initialSize = preferredOutputSize();
document.querySelector('#app').innerHTML = `<canvas id="output" width="${initialSize.width}" height="${initialSize.height}" aria-label="direct-painting ${initialSize.width} by ${initialSize.height} output"></canvas>`;
const scene = createPaintingRenderer(document.querySelector('#output'), initialSize);
const outputCanvas = scene.canvas;
outputCanvas.setAttribute('aria-label', `direct-painting ${scene.outputWidth} by ${scene.outputHeight} output`);
let requestedOutputSize = initialSize;
function resizeOutput() {
  const next = preferredOutputSize();
  if (next.width === requestedOutputSize.width && next.height === requestedOutputSize.height) return;
  requestedOutputSize = next;
  scene.setOutputSize(next.width, next.height);
  outputCanvas.setAttribute('aria-label', `direct-painting ${scene.outputWidth} by ${scene.outputHeight} output`);
}
window.addEventListener('resize', resizeOutput, { passive: true });
let snapshot = null, version = -1, liveVersion = -1, serverTime = 0, calibratedAt = performance.now(), renderedAt = -Infinity;
let cameraSnapshot=null;const cameraSampler=new CameraSampler();
let calibrated = false, connectedStream = false, polling = false, pollTimer;
scene.setProject({ clips: [], duration: LOOP_MS }); scene.draw(0, 0);
function apply(update, now) {
  if (!calibrated && Number.isFinite(update.serverNow)) { serverTime = update.serverNow; calibratedAt = now; }
  if (update.state && update.version >= version) { snapshot = update.state; scene.setProject(snapshot.project); version = update.version; renderedAt = -Infinity; }
  if (Object.hasOwn(update, 'live') && update.liveVersion >= liveVersion) { scene.receiveLive(update.live, now); liveVersion = update.liveVersion; renderedAt = -Infinity; }
  if(update.camera)applyCamera(update.camera);
  document.documentElement.dataset.connected = 'true';
}
function applyCamera(update){
 const next=mergeCamera(cameraSnapshot,update);if(next===cameraSnapshot)return;
 cameraSnapshot=next;
 if(snapshot&&next){snapshot.project.settings={...snapshot.project.settings,camera:next.config,...(next.baseView?{view:next.baseView}:{})};}
 renderedAt=-Infinity;
}
async function poll() {
  if (polling) return;
  polling = true; clearTimeout(pollTimer);
  const sent = performance.now();
  try {
    const response = await fetch(`/api/loop?since=${version}${connectedStream ? '&live=0' : ''}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Output unavailable');
    const update = await response.json(), received = performance.now();
    serverTime = update.serverNow + (received - sent) / 2; calibratedAt = received; calibrated = true;
    apply(update, received);
  } catch { if (!connectedStream) document.documentElement.dataset.connected = 'false'; }
  finally { polling = false; pollTimer = setTimeout(poll, connectedStream ? 2000 : 250); }
}
if (typeof EventSource === 'function') {
  const events = new EventSource('/api/stream');
  events.onopen = () => { connectedStream = true; version = -1; liveVersion = -1; };
  events.addEventListener('camera',event=>applyCamera(JSON.parse(event.data)));
  events.addEventListener('state', event => apply(JSON.parse(event.data), performance.now()));
  events.addEventListener('view', event => {
    const update = JSON.parse(event.data);
    if (snapshot && update.version >= version) { snapshot.project.settings = { ...snapshot.project.settings, view: update.view }; version = update.version; scene.setView(update.view); renderedAt = -Infinity; }
  });
  events.addEventListener('live', event => apply(JSON.parse(event.data), performance.now()));
  events.onerror = () => { connectedStream = false; clearTimeout(pollTimer); void poll(); };
  window.addEventListener('pagehide', () => events.close(), { once: true });
}
function animate(now) {
  requestAnimationFrame(animate);
  if ((snapshot || renderedAt === -Infinity) && frameNumber(now) !== renderedAt) {
    renderedAt = frameNumber(now);
    const time=serverTime+now-calibratedAt,phase=snapshot?outputPhase(snapshot,time):0,base=snapshot?.project.settings?.view??DEFAULT_VIEW;
    const frame=cameraSampler.frame(cameraSnapshot??{config:snapshot?.project.settings?.camera},base,phase,time,now);scene.setView(frame.view);
    scene.draw(side,phase,{now,cameraViews:frame.cameraViews,placementPreview:snapshot?!snapshot.playback.playing:false});
  }
}
poll(); requestAnimationFrame(animate);
