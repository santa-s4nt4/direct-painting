// Export JSON stays on the same server as its videos. Import it directly rather
// than depending on a download having been saved on this particular device.
export function createImportPicker({ canImport, importProject, chooseFile }) {
  const dialog = document.createElement('dialog'); dialog.className = 'import-picker';
  dialog.setAttribute('aria-labelledby', 'import-picker-title');
  dialog.innerHTML = `
    <div class="import-picker-heading"><h2 id="import-picker-title">IMPORT JSON</h2><button type="button" class="icon-button" data-action="close" aria-label="Close import picker">×</button></div>
    <button type="button" class="secondary-button import-choose-file" data-action="file">CHOOSE JSON FILE…</button>
    <div class="import-picker-heading"><h3>RECENT EXPORTS</h3><button type="button" class="secondary-button" data-action="refresh">REFRESH</button></div>
    <p class="import-picker-status" role="status"></p>
    <p class="import-picker-error" role="alert" hidden></p>
    <ul class="import-picker-list" aria-label="Recent exported JSON projects"></ul>
    <p class="import-picker-note">Export snapshots are shared on this server for up to 1 hour. Import replaces the current scene and can be undone.</p>`;
  document.body.append(dialog);
  const list = dialog.querySelector('ul'), status = dialog.querySelector('[role="status"]'), error = dialog.querySelector('[role="alert"]');
  const fileButton = dialog.querySelector('[data-action="file"]'), refreshButton = dialog.querySelector('[data-action="refresh"]');
  let listRequest = null, importRequest = null;
  const busy = value => {
    dialog.setAttribute('aria-busy', String(value));
    fileButton.disabled = refreshButton.disabled = value;
    list.querySelectorAll('button').forEach(button => button.disabled = value);
  };
  const cancelRequests = () => {
    listRequest?.abort(); importRequest?.abort(); listRequest = importRequest = null; busy(false);
  };
  const close = () => { cancelRequests(); if (dialog.open) dialog.close(); };
  async function select(job) {
    if (importRequest || !canImport()) return;
    const controller = new AbortController(); importRequest = controller;
    error.hidden = true; status.textContent = 'Importing exported JSON…'; busy(true);
    try {
      const response = await fetch(`/api/export/${job.id}/project.json`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 404 || response.status === 405 ? 'Export no longer available. Refresh the list or choose a JSON file.' : 'Could not load this export. Try again or choose a JSON file.');
      const text = await response.text();
      if (controller.signal.aborted || !dialog.open) return;
      importProject(text); close();
    } catch (reason) {
      if (!controller.signal.aborted && dialog.open) { error.textContent = reason.message; error.hidden = false; status.textContent = 'The current scene has not been changed.'; }
    } finally {
      if (importRequest === controller) { importRequest = null; busy(false); }
    }
  }
  async function refresh() {
    listRequest?.abort();
    const controller = new AbortController(); listRequest = controller;
    status.textContent = 'Loading recent exports…'; error.hidden = true; list.replaceChildren();
    try {
      const response = await fetch('/api/export', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Recent exports are unavailable. You can still choose a JSON file.');
      const data = await response.json();
      if (!Array.isArray(data.exports)) throw new Error('Could not read recent exports. Choose a JSON file or refresh.');
      if (controller.signal.aborted || !dialog.open) return;
      const jobs = data.exports.filter(job => job?.state === 'ready' && /^[0-9a-f-]{36}$/.test(job.id) && (!Number.isFinite(job.expiresAt) || job.expiresAt > Date.now())).sort((a, b) => b.createdAt - a.createdAt);
      for (const [index, job] of jobs.entries()) {
        const item = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.className = 'import-export';
        button.dataset.exportId = job.id;
        const name = document.createElement('span'); name.className = 'import-export-name'; name.textContent = `direct-painting-${job.stamp}.json`;
        button.setAttribute('aria-label', `Import ${name.textContent}`);
        const details = document.createElement('span'); details.className = 'import-export-details';
        const date = Number.isFinite(job.createdAt) ? new Date(job.createdAt).toLocaleString('en-GB') : '';
        details.textContent = `${date} · ${Number((job.duration / 1000).toFixed(2))}s · ${job.format === 'rgba' ? 'RGBA' : 'RGB'}`;
        button.append(name, details);
        if (index === 0) { const latest = document.createElement('span'); latest.className = 'import-export-latest'; latest.textContent = 'LATEST'; button.append(latest); }
        button.addEventListener('click', () => void select(job)); item.append(button); list.append(item);
      }
      status.textContent = jobs.length ? 'Select a snapshot to import.' : 'No recent exports yet. Export a loop or choose a JSON file.';
    } catch (reason) {
      if (!controller.signal.aborted && dialog.open) status.textContent = reason.message;
    } finally { if (listRequest === controller) listRequest = null; }
  }
  dialog.querySelector('[data-action="close"]').addEventListener('click', close);
  fileButton.addEventListener('click', () => { close(); chooseFile(); });
  refreshButton.addEventListener('click', () => void refresh());
  dialog.addEventListener('cancel', cancelRequests);
  dialog.addEventListener('close', () => { if (!dialog.open) cancelRequests(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  return {
    open() { if (!canImport() || dialog.open) return; busy(false); dialog.showModal(); void refresh(); },
    close,
  };
}
