export const MIDI_FLASH_MS = 80;
export const MIDI_INDICATOR_LIMIT = 10;

// Note numbers identify rows; a repeat flashes its existing row without moving it.
export function setupMidiIndicators(parent) {
  const list = document.createElement('ol'); list.className = 'midi-indicators'; list.setAttribute('aria-label', 'Received MIDI notes');
  parent.append(list);
  const entries = new Map();
  let epoch, revision = -1;
  const receive = message => {
    if (Number.isInteger(message.revision) && message.epoch) {
      if (epoch === message.epoch && message.revision <= revision) return;
      epoch = message.epoch; revision = message.revision;
    }
    if (message.type !== 'on' || !Number.isInteger(message.note) || message.note < 0 || message.note > 127 || !(message.velocity > 0)) return;
    let entry = entries.get(message.note);
    if (!entry) {
      if (entries.size === MIDI_INDICATOR_LIMIT) {
        const oldest = entries.keys().next().value, previous = entries.get(oldest);
        clearTimeout(previous.timer); previous.element.remove(); entries.delete(oldest);
      }
      const element = document.createElement('li'); element.textContent = message.note; element.dataset.note = message.note;
      element.setAttribute('aria-label', `MIDI note ${message.note}`); list.append(element);
      entry = { element, timer: null }; entries.set(message.note, entry);
    }
    clearTimeout(entry.timer);
    entry.element.title = `MIDI note ${message.note} · Ch ${message.channel}`;
    entry.element.classList.add('is-active');
    entry.timer = setTimeout(() => { entry.element.classList.remove('is-active'); entry.timer = null; }, MIDI_FLASH_MS);
  };
  const dispose = () => { for (const entry of entries.values()) clearTimeout(entry.timer); entries.clear(); list.remove(); };
  window.addEventListener('pagehide', dispose, { once: true });
  return { receive, dispose };
}
