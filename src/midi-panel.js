// Receive MIDI on the host, so iPad Safari and HTTP Ethernet connections work.
export function setupMidiPanel(parent, onTransport) {
  const panel = document.createElement('section'); panel.className = 'midi-panel';
  panel.innerHTML = `<h2>MIDI sync</h2><p>Connect the MIDI interface to the Mac running this app.</p><label for="midi-device">Input device · Mac</label><select id="midi-device" aria-label="MIDI input device"><option value="">Off</option></select><label for="midi-note">C1 note number</label><select id="midi-note" aria-label="C1 MIDI note number"><option value="24">24 · C1 (C4 = 60)</option><option value="36">36 · C1 (C3 = 60)</option></select><p class="midi-status" role="status">Starting MIDI input…</p><p class="midi-last" aria-live="polite"></p><p>Note On → restart & play<br>120 BPM · 4/4 · 8 bars · 16s</p>`;
  parent.append(panel);
  const device = panel.querySelector('#midi-device'), note = panel.querySelector('#midi-note'), status = panel.querySelector('.midi-status'), last = panel.querySelector('.midi-last');
  let busy = false, stopped = false, timer, latency = 0;
  const transport = data => {
    if (data.transport) onTransport(data.transport, data.playback ?? data.state?.playback, data.serverNow, latency);
  };
  const update = data => {
    if (busy) return;
    const inputs = [{id:'',name:'Off'}, ...(data.devices ?? [])];
    if (data.selected && !inputs.some(d => d.id === data.selected)) inputs.push({id:data.selected,name:'Selected input · disconnected'});
    const signature = JSON.stringify(inputs);
    if (device.dataset.inputs !== signature) { device.replaceChildren(...inputs.map(d => new Option(d.name,d.id))); device.dataset.inputs = signature; }
    device.value = data.selected ?? ''; note.value = String(data.note ?? 24);
    device.disabled = !data.available || data.starting; note.disabled = !!data.starting;
    status.textContent = data.error || (data.starting ? 'Starting MIDI input…' : data.connected ? 'MIDI connected · waiting for C1' : data.selected ? 'Input disconnected · reconnect to resume' : data.devices?.length ? 'Choose an input device' : 'No MIDI inputs · connect an interface to the Mac');
    last.textContent = data.lastNote ? `Last note ${data.lastNote.number} · Ch ${data.lastNote.channel} · Restarts ${data.triggers}` : '';
    transport(data);
  };
  const poll = async () => {
    try { const start = performance.now(), response = await fetch('/api/midi', { cache:'no-store' }); const data = await response.json(); latency = Math.min(100, (performance.now()-start)/2); if (!response.ok) throw new Error(data.error || 'MIDI unavailable'); update(data); }
    catch (error) { status.textContent = error.message; }
    finally { if (!stopped) timer = setTimeout(poll,1000); }
  };
  const configure = async () => {
    busy = true; device.disabled = note.disabled = true;
    try { const response = await fetch('/api/midi', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selected:device.value,note:Number(note.value)})}); const data = await response.json(); if (!response.ok) throw new Error(data.error); busy = false; update(data); }
    catch (error) { status.textContent = error.message; }
    finally { busy = false; device.disabled = note.disabled = false; }
  };
  device.addEventListener('change',configure); note.addEventListener('change',configure);
  const stream = new EventSource('/api/stream');
  stream.addEventListener('transport',event => transport(JSON.parse(event.data)));
  stream.addEventListener('state',event => transport(JSON.parse(event.data)));
  void poll();
  window.addEventListener('pagehide',() => { stopped = true; clearTimeout(timer); stream.close(); },{once:true});
}
