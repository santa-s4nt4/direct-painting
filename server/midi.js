import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, access, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { MidiDecoder, isRestartNote, RESTART_NOTE } from '../src/transport.js';

export async function createMidiInput({ configFile, onRestart, platform = process.platform, launch = spawn, autoStart = true } = {}) {
  const state = { available: false, starting: true, devices: [], selected: '', connected: false, note: RESTART_NOTE, lastNote: null, triggers: 0, error: '' };
  let child, disposed = false, writes = Promise.resolve();
  try { const saved = JSON.parse(await readFile(configFile, 'utf8')); if (typeof saved.selected === 'string') state.selected = saved.selected; } catch { /* First use. */ }
  const decoder = new MidiDecoder(message => {
    if ((message[0] & 0xf0) !== 0x90 || message[2] === 0) return;
    state.lastNote = { number: message[1], channel: (message[0] & 15) + 1, at: Date.now() };
    if (isRestartNote(message)) { state.triggers++; onRestart?.(Date.now()); }
  });
  const receive = value => {
    if (value.type === 'devices') {
      state.devices = value.devices.filter(d => typeof d.id === 'string' && typeof d.name === 'string');
      state.available = true; state.starting = false; state.connected = value.selected === state.selected && value.connected; state.error = '';
      if (!state.connected) decoder.reset();
    } else if (value.type === 'data' && value.id === state.selected && state.connected && Array.isArray(value.bytes)) decoder.push(value.bytes);
    else if (value.type === 'error') { state.error = value.message; state.starting = false; state.connected = false; }
  };
  const configure = async value => {
    if (!value || typeof value.selected !== 'string' || (value.note !== undefined && value.note !== RESTART_NOTE)) throw new Error(`Select a MIDI input; the restart note is fixed at ${RESTART_NOTE}`);
    if (value.selected && value.selected !== state.selected && !state.devices.some(d => d.id === value.selected)) throw new Error('MIDI input is no longer available');
    const changed = state.selected !== value.selected;
    state.selected = value.selected; state.note = RESTART_NOTE; if (changed) { state.connected = false; state.lastNote = null; } decoder.reset();
    if (changed) child?.stdin.write(`${JSON.stringify({ id: state.selected })}\n`);
    if (configFile) {
      const saved = JSON.stringify({ selected: state.selected, note: state.note });
      writes = writes.catch(() => {}).then(async () => { await mkdir(dirname(configFile), { recursive: true }); await writeFile(configFile, saved); });
      await writes;
    }
  };
  const start = async () => {
    if (platform !== 'darwin') throw new Error('Host MIDI input currently requires macOS. Connect the MIDI interface to the Mac running npm run dev.');
    const source = fileURLToPath(new URL('./midi-input.swift', import.meta.url));
    const hash = createHash('sha256').update(await readFile(source)).digest('hex').slice(0, 16);
    const folder = join(tmpdir(), `direct-painting-midi-${process.getuid?.() ?? 'host'}-${hash}`), binary = join(folder, 'midi-input');
    await mkdir(folder, { recursive: true, mode: 0o700 });
    try { await access(binary); } catch {
      await new Promise((resolve, reject) => {
        const temporary = `${binary}.${process.pid}.${Date.now()}`;
        const compiler = launch('/usr/bin/swiftc', [source, '-o', temporary], { stdio: ['ignore', 'ignore', 'pipe'] });
        child = compiler; let error = '';
        compiler.stderr.on('data', data => { error += data.toString().slice(0, 2000); });
        compiler.on('error', reject); compiler.on('exit', code => {
          if (code === 0) rename(temporary, binary).then(resolve,reject);
          else reject(new Error(`CoreMIDI helper could not compile. Install Xcode Command Line Tools. ${error}`));
        });
      });
    }
    if (disposed) return;
    child = launch(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: child.stdout }).on('line', line => { try { receive(JSON.parse(line)); } catch { /* Ignore malformed helper messages. */ } });
    child.stdin.on('error', () => {});
    child.stderr.on('data', () => {});
    child.on('error', error => { state.error = error.message; state.starting = false; });
    child.on('exit', () => { state.connected = false; state.available = false; state.starting = false; if (!disposed) state.error = 'MIDI helper stopped. Restart npm run dev.'; });
    child.stdin.write(`${JSON.stringify({ id: state.selected })}\n`);
  };
  if (autoStart) void start().catch(error => { state.starting = false; state.error = error.message; });
  return { snapshot: () => structuredClone(state), configure, receive, dispose: () => { disposed = true; child?.kill(); } };
}
