import './output.css';
import { frameNumber } from './timing.js';
import { VIEWPORT_WIDTH, VIEWPORT_HEIGHT } from './canvas.js';
import { createPaintingRenderer } from './render/index.js';
import { outputPhase } from './relay.js';

const side = 0;
document.title = 'direct-painting · Output';
document.querySelector('#app').innerHTML = `<canvas id="output" width="${VIEWPORT_WIDTH}" height="${VIEWPORT_HEIGHT}" aria-label="direct-painting 1920 by 1080 output"></canvas>`;
const scene = createPaintingRenderer(document.querySelector('#output'));
let snapshot = null, version = -1, liveVersion = -1, serverTime = 0, calibratedAt = performance.now(), renderedAt = -Infinity;
let calibrated = false, connectedStream = false, polling = false, pollTimer;
scene.setProject({ clips: [], duration: 10000 }); scene.draw(0, 0);
function apply(update, now) {
  if (!calibrated && Number.isFinite(update.serverNow)) { serverTime = update.serverNow; calibratedAt = now; }
  if (update.state && update.version >= version) { snapshot = update.state; scene.setProject(snapshot.project); version = update.version; renderedAt = -Infinity; }
  if (Object.hasOwn(update, 'live') && update.liveVersion >= liveVersion) { scene.receiveLive(update.live, now); liveVersion = update.liveVersion; renderedAt = -Infinity; }
  document.documentElement.dataset.connected = 'true';
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
  if ((snapshot || renderedAt === -Infinity) && frameNumber(now) !== renderedAt) {
    renderedAt = frameNumber(now);
    scene.draw(side, snapshot ? outputPhase(snapshot, serverTime + now - calibratedAt) : 0, { now, placementPreview: snapshot ? !snapshot.playback.playing : false });
  }
  requestAnimationFrame(animate);
}
poll(); requestAnimationFrame(animate);
