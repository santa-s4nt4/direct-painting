export const BPM = 120;
export const BEATS_PER_BAR = 4;
export const BARS = 8;
export const LOOP_MS = 60000 / BPM * BEATS_PER_BAR * BARS;

// MIDI note numbers are unambiguous; manufacturers disagree on octave names.
export function isRestartNote(message, note = 24) {
  return message.length === 3 && (message[0] & 0xf0) === 0x90 && message[1] === note && message[2] > 0;
}

// MIDI 1.0 byte stream, including running status and interleaved clock bytes.
export class MidiDecoder {
  constructor(onMessage) { this.onMessage = onMessage; this.reset(); }
  reset() { this.status = 0; this.data = []; this.sysex = false; }
  push(bytes) {
    for (const byte of bytes) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) continue;
      if (byte >= 0xf8) continue;
      if (byte >= 0x80) {
        this.data = [];
        if (byte >= 0xf0) { this.status = 0; this.sysex = byte === 0xf0; continue; }
        this.sysex = false; this.status = byte; continue;
      }
      if (this.sysex || !this.status) continue;
      this.data.push(byte);
      const length = [0xc0, 0xd0].includes(this.status & 0xf0) ? 1 : 2;
      if (this.data.length === length) { this.onMessage([this.status, ...this.data]); this.data = []; }
    }
  }
}
