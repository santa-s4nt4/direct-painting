// History stores immutable source data, never raster frames or playback ticks.
// Input events from one control may be grouped into a single editable action.
export class EditHistory {
  constructor({ limit = 100, maxBytes = 64 * 1024 * 1024 } = {}) {
    this.limit = limit; this.maxBytes = maxBytes; this.reset(null);
  }
  reset(value) {
    this.past = []; this.future = []; this.group = null;
    this.current = this.entry(value);
  }
  entry(value) {
    const data = JSON.stringify(value);
    const settings = value?.settings;
    const source = JSON.stringify(value, function (key, item) { return key === 'editScope' || key === 'active' && this === settings ? undefined : item; });
    let a = 2166136261, b = 5381;
    for (let i = 0; i < source.length; i++) { const code = source.charCodeAt(i); a = Math.imul(a ^ code, 16777619); b = Math.imul(b, 33) ^ code; }
    return { data, signature: `${source.length}:${a >>> 0}:${b >>> 0}` };
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  endGroup() { this.group = null; }
  record(value, group = null) {
    const next = this.entry(value);
    if (next.signature === this.current.signature) return false;
    if (group === null || group !== this.group || !this.past.length) this.past.push(this.current);
    this.current = next; this.future = []; this.group = group; this.trim(); return true;
  }
  trim() {
    const bytes = item => (item.data.length + item.signature.length) * 2;
    let total = [...this.past, this.current, ...this.future].reduce((sum, item) => sum + bytes(item), 0);
    while (this.past.length && (this.past.length > this.limit || total > this.maxBytes)) total -= bytes(this.past.shift());
    while (this.future.length && total > this.maxBytes) total -= bytes(this.future.shift());
  }
  undo() {
    if (!this.canUndo) return null;
    this.future.push(this.current); this.current = this.past.pop(); this.endGroup(); return JSON.parse(this.current.data);
  }
  redo() {
    if (!this.canRedo) return null;
    this.past.push(this.current); this.current = this.future.pop(); this.endGroup(); return JSON.parse(this.current.data);
  }
}
