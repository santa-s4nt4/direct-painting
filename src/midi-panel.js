import { RESTART_NOTE } from './transport.js';

// Receive MIDI on the host, so iPad Safari and HTTP Ethernet connections work.
export function setupMidiPanel(parent, onTransport, options = {}) {
  const panel = document.createElement('section'); panel.className = 'midi-panel';
  panel.innerHTML = `<h2>MIDI入力</h2><p>インターフェースを、このアプリを起動したMacへ接続してください。</p><label for="midi-device">入力デバイス（Mac）</label><select id="midi-device" aria-label="MIDI input device"><option value="">OFF（入力なし）</option></select><label for="midi-note">頭出しするノート番号</label><output id="midi-note" aria-label="Timeline restart MIDI note">${RESTART_NOTE}（固定）</output><p class="midi-status" role="status">MIDI入力を準備中…</p><p class="midi-last" aria-live="polite"></p><p>ノート${RESTART_NOTE}のNote On → 0秒から再生<br>120 BPM · 4/4 · 8小節 · 16秒</p>`;
  parent.append(panel);
  const device = panel.querySelector('#midi-device'), status = panel.querySelector('.midi-status'), last = panel.querySelector('.midi-last');
  let busy = false, stopped = false, timer, latency = 0;
  const transport = data => {
    if(data.camera)options.onCamera?.(data.camera);
    if(Number.isFinite(data.serverNow))options.onClock?.(data.serverNow,latency);
    if (data.transport) onTransport(data.transport, data.playback ?? data.state?.playback, data.serverNow, latency);
  };
  const update = data => {
    if (busy) return;
    const inputs = [{id:'',name:'OFF（入力なし）'}, ...(data.devices ?? [])];
    if (data.selected && !inputs.some(d => d.id === data.selected)) inputs.push({id:data.selected,name:'選択したデバイス（未接続）'});
    const signature = JSON.stringify(inputs);
    if (device.dataset.inputs !== signature) { device.replaceChildren(...inputs.map(d => new Option(d.name,d.id))); device.dataset.inputs = signature; }
    device.value = data.selected ?? '';
    device.disabled = !data.available || data.starting;
    status.textContent = data.error || (data.starting ? 'MIDI入力を準備中…' : data.connected ? `MIDI接続済み · ノート${RESTART_NOTE}受信待ち` : data.selected ? (data.devices?.some(d => d.id === data.selected) ? 'MIDI入力に接続しています…' : 'デバイス未接続 · 再接続すると再開します') : data.devices?.length ? '上の一覧から入力デバイスを選んでください' : 'MIDI入力がありません · Macに接続してください');
    last.textContent = data.lastNote ? `受信ノート ${data.lastNote.number} · Ch ${data.lastNote.channel} · 頭出し ${data.triggers}回` : '';
    options.onNotes?.(data.receivedNotes??[]);transport(data);
  };
  const poll = async () => {
    try { const start = performance.now(), response = await fetch('/api/midi', { cache:'no-store' }); const data = await response.json(); latency = Math.min(100, (performance.now()-start)/2); if (!response.ok) throw new Error(data.error || 'MIDI unavailable'); update(data); }
    catch (error) { status.textContent = error.message; }
    finally { if (!stopped) timer = setTimeout(poll,1000); }
  };
  const configure = async () => {
    busy = true; device.disabled = true;
    try { const response = await fetch('/api/midi', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selected:device.value})}); const data = await response.json(); if (!response.ok) throw new Error(data.error); busy = false; update(data); }
    catch (error) { status.textContent = error.message; }
    finally { busy = false; device.disabled = false; }
  };
  device.addEventListener('change',configure);
  const stream = new EventSource('/api/stream');
  stream.addEventListener('camera',event=>options.onCamera?.(JSON.parse(event.data)));
  stream.addEventListener('transport',event => transport(JSON.parse(event.data)));
  stream.addEventListener('state',event => transport(JSON.parse(event.data)));
  void poll();
  window.addEventListener('pagehide',() => { stopped = true; clearTimeout(timer); stream.close(); },{once:true});
}
