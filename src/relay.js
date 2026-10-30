import { frameNumber } from './timing.js';

// Playback positions travel as elapsed time, not the iPad's wall-clock time.
export function playbackSnapshot(clock, now) {
  return { playing: clock.playing, phase: clock.phase(now) };
}
export function outputPhase(state, serverNow) {
  const time = state.playback.playing ? serverNow - state.playback.anchor : state.playback.phase;
  return ((time % state.project.duration) + state.project.duration) % state.project.duration;
}

export function createPublisher(getSnapshot, onStatus) {
  let timer = null, pending = false, running = false;
  async function send() {
    clearTimeout(timer); timer = null;
    if (running) { pending = true; return; }
    running = true;
    try {
      const response = await fetch('/api/loop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getSnapshot()) });
      if (!response.ok) throw new Error(`Output sync ${response.status}`);
      onStatus(true);
    } catch { onStatus(false); }
    finally { running = false; if (pending) { pending = false; send(); } }
  }
  // Coalesce updates within a bounded interval. Restarting a debounce timer on
  // every completed tap starves the output while the Pencil keeps tapping.
  return { publish(immediate = false) { if (immediate) send(); else if (timer === null) timer = setTimeout(send, 100); } };
}

// One request in flight, incremental samples and a fixed 60Hz grid keep pencil
// traffic small even when the project contains many cached layers.
export function createLivePublisher(getFrame, onStatus) {
  let running = false, sentFrame = -1, id = null, next = 0;
  return { publish(now = performance.now()) {
    if (running || frameNumber(now) === sentFrame) return;
    let frame = getFrame(next);
    if (!frame) return;
    if (frame.id !== id) { id = frame.id; next = 0; frame = getFrame(0); }
    sentFrame = frameNumber(now); running = true;
    fetch('/api/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(frame) })
      .then(async response => {
        if (!response.ok) throw new Error('Live output unavailable');
        const update = await response.json();
        if (id === frame.id && Number.isInteger(update.next)) next = update.next;
        onStatus(true);
      }).catch(() => onStatus(false)).finally(() => { running = false; });
  } };
}

// Pinches send only a small view transform; never resend every stroke at 60Hz.
export function createViewPublisher(getView, onStatus) {
  let running = false, pending = false;
  const send = async () => {
    if (running) { pending = true; return; }
    running = true;
    try {
      const response = await fetch('/api/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getView()) });
      if (!response.ok) throw new Error('View sync unavailable');
      onStatus(true);
    } catch { onStatus(false); }
    finally { running = false; if (pending) { pending = false; void send(); } }
  };
  return { publish: send };
}

export function createCameraPublisher(session,onCamera,onStatus) {
 let revision=0,queue=Promise.resolve();
 return {send(kind,value={}){
  const body={session,revision:++revision,kind,...value};
  const request=queue.catch(()=>{}).then(async()=>{
   const response=await fetch('/api/camera',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json();
   if(!response.ok)throw new Error(data.error??'Camera sync unavailable');onCamera(data);onStatus(true);return data;
  });queue=request;return request;
 }};
}
