import { FPS } from './timing.js';

const $ = selector => document.querySelector(selector);

export function setupEditorShell({ icon, modes, modeHints, onMode }) {
  const main = $('main'), studio = $('.studio'), toolbar = $('.toolbar'), workspace = $('.workspace');
  const layers = $('.layers-panel'), history = $('.history-actions');
  const clear = $('#clear'), save = $('#save-project'), importButton = $('#import-project'), importFile = $('#import-file');
  const format = $('#export-format'), exportButton = $('#export-loop'), exportStatus = $('#export-status');
  const cacheStatus = $('#cache-status'), outputStatus = $('#output-status'), recordings = $('#recordings');
  let selected = null;
  main.className = 'editor';
  studio.setAttribute('aria-label', 'direct-painting studio');

  const sidebar = document.createElement('aside'); sidebar.className = 'inspector sidebar'; sidebar.setAttribute('aria-label', 'Editor controls');
  sidebar.innerHTML = `<div class="inspector-tabs" role="tablist" aria-label="Editor panels">${['draw', 'layer', 'files'].map((tab, i) => `<button id="tab-${tab}" role="tab" aria-selected="${i === 0}" aria-controls="${tab}-panel" tabindex="${i === 0 ? 0 : -1}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join('')}</div><div class="sidebar-scroll"></div><footer class="sidebar-footer"></footer>`;
  studio.append(sidebar);
  const scroll = sidebar.querySelector('.sidebar-scroll'), footer = sidebar.querySelector('.sidebar-footer');
  const panels = {};
  for (const tab of ['draw', 'layer', 'files']) {
    const panel = document.createElement('section'); panel.id = `${tab}-panel`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `tab-${tab}`); panel.hidden = tab !== 'draw';
    panels[tab] = panel; scroll.append(panel);
  }
  panels.draw.append(toolbar);
  const tabs = tab => {
    for (const [name, panel] of Object.entries(panels)) {
      panel.hidden = name !== tab;
      $(`#tab-${name}`).setAttribute('aria-selected', String(name === tab));
      $(`#tab-${name}`).tabIndex = name === tab ? 0 : -1;
    }
    scroll.scrollTop = 0;
  };
  const tabNames = Object.keys(panels);
  for (const [index, name] of tabNames.entries()) {
    const button = $(`#tab-${name}`);
    button.addEventListener('click', () => tabs(name));
    button.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabNames.length : event.key === 'ArrowLeft' ? (index + tabNames.length - 1) % tabNames.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabNames.length - 1 : null;
      if (next === null) return;
      event.preventDefault(); tabs(tabNames[next]); $(`#tab-${tabNames[next]}`).focus();
    });
  }
  const section = (title, nodes, open = true, hint = '') => {
    const details = document.createElement('details'); details.className = 'sidebar-section'; details.open = open;
    const summary = document.createElement('summary'); summary.innerHTML = `<span>${title}</span><span class="section-chevron" aria-hidden="true">⌄</span>`;
    const content = document.createElement('div'); content.className = 'sidebar-content'; content.append(...nodes);
    if (hint) { const note = document.createElement('p'); note.className = 'control-hint'; note.textContent = hint; content.append(note); }
    details.append(summary, content); toolbar.append(details); return details;
  };
  const shape = section('Shape', [$('#shape'), $('#circle-controls'), $('#rectangle-controls')]);
  const color = section('Fill', [$('.color-picker')]);
  const input = section('Input', [$('.input-controls')]);
  const fades = section('Timing', [$('#fade-seconds').closest('.effect-value'), $('#fade-range')]);
  const preview = section('Preview', [$('#show-blur-preview').closest('label'), $('#blur-radius').previousElementSibling, $('#blur-radius')], false, 'Blur the canvas preview. Output stays sharp.');
  $('#shape').innerHTML = '<option value="circle">Ellipse</option><option value="rect">Rectangle</option>';
  toolbar.replaceChildren(shape, color, input, fades, preview);
  for (const label of toolbar.querySelectorAll('label > span')) {
    const names = { PRESSURE: 'Apple Pencil pressure', TOUCH: 'Draw with touch', 'SHOW PREVIEW': 'Show blur preview' };
    if (names[label.textContent]) label.textContent = names[label.textContent];
  }
  for (const label of toolbar.querySelectorAll('.size-bound label')) label.textContent = label.textContent === 'MIN' ? 'Min' : 'Max';
  for (const label of toolbar.querySelectorAll('.effect-value label')) label.textContent = { RADIUS: 'Radius', TIME: 'Release fade', ANGLE: 'Rotation' }[label.textContent] ?? label.textContent;
  $('#circle-controls > .section-label').textContent = 'Pressure size';

  layers.querySelector('.layer-heading').innerHTML = '<span>Layers <span id="layer-count">0</span></span><button id="fold-layers" hidden></button>';
  const empty = document.createElement('div'); empty.id = 'layer-empty'; empty.className = 'layer-empty';
  empty.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></svg><p>Make your first mark</p><span>Each stroke becomes an<br>editable motion layer.</span>';
  $('#layer-list').after(empty);
  const properties = document.createElement('section'); properties.id = 'selection-properties'; properties.className = 'selection-properties'; properties.setAttribute('aria-label', 'Selected layer properties');
  const noSelection = () => { properties.innerHTML = '<div class="selection-empty"><span>Layer properties</span><p>Select a layer above to edit its fill, shape and timing.</p></div>'; };
  noSelection(); panels.layer.append(layers, properties);

  panels.files.className = 'files-panel';
  const projectFiles = document.createElement('section'); projectFiles.className = 'file-project-actions';
  projectFiles.innerHTML = '<h2>Project</h2><p>Save or open an editable canvas.</p>';
  save.textContent = 'Save project'; importButton.textContent = 'Import project'; save.title = 'Download an editable JSON project';
  projectFiles.append(save, importButton, importFile);
  const exportPanel = document.createElement('section'); exportPanel.className = 'export-panel'; exportPanel.setAttribute('aria-label', 'Export');
  exportPanel.innerHTML = `<div class="export-panel-heading"><strong>Export</strong><span>1920 × 1080 · ${FPS}fps</span></div>`;
  exportPanel.append(format, exportButton, exportStatus);
  format.options[0].textContent = 'MOV · ProRes 4444 + Alpha'; format.options[1].textContent = 'MP4 · H.264'; exportButton.querySelector('#export-label').textContent = 'Export loop';
  const connection = document.createElement('div'); connection.className = 'connection-status'; connection.append(outputStatus);
  panels.files.append(projectFiles, exportPanel, recordings, connection);

  history.className = 'history-actions';
  clear.innerHTML = `${icon('trash')}<span>Clear canvas</span>`;
  footer.append(history, clear, cacheStatus);
  const stage = document.createElement('div'); stage.className = 'canvas-stage';
  stage.append($('.canvas-pair'));
  const controls = document.createElement('div'); controls.className = 'canvas-controls';
  controls.innerHTML = '<button id="toggle-sidebar" class="icon-button" title="Toggle left panel" aria-label="Toggle left panel" aria-expanded="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg></button>';
  const floating = document.createElement('div'); floating.className = 'canvas-tools'; floating.setAttribute('role', 'group'); floating.setAttribute('aria-label', 'Motion mode');
  floating.innerHTML = modes.map(mode => `<button data-paint-mode="${mode}" aria-label="${mode[0].toUpperCase() + mode.slice(1)} mode" aria-pressed="${mode === 'trail'}" title="${modeHints[mode]}">${icon(mode)}<span>${mode[0].toUpperCase() + mode.slice(1)}</span></button>`).join('');
  for (const button of floating.querySelectorAll('button')) button.addEventListener('click', () => onMode(button.dataset.paintMode));
  const fps = document.createElement('span'); fps.className = 'fps-label'; fps.textContent = `${FPS} fps`;
  controls.append(floating, fps);
  const timeline = $('.loop-controls'); timeline.querySelector('.section-label').remove(); timeline.querySelector('.loop-duration label').textContent = 'Duration';
  workspace.replaceChildren(stage, controls, timeline);
  studio.replaceChildren(sidebar, workspace);
  const toggle = $('#toggle-sidebar');
  const syncSidebar = () => toggle.setAttribute('aria-expanded', String(matchMedia('(max-width: 600px)').matches ? studio.classList.contains('sidebar-open') : !studio.classList.contains('sidebar-hidden')));
  toggle.addEventListener('click', () => { studio.classList.toggle(matchMedia('(max-width: 600px)').matches ? 'sidebar-open' : 'sidebar-hidden'); syncSidebar(); });
  window.addEventListener('resize', syncSidebar); syncSidebar();

  return {
    setMode(mode) { for (const button of floating.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.paintMode === mode)); },
    clearSelectionProperties() { selected = null; noSelection(); },
    showLayer(id, body, activate = true) {
      if (selected) { const previous = properties.querySelector('.layer-body'); const owner = [...document.querySelectorAll('.cached-layer')].find(row => row.dataset.layerId === selected); if (previous && owner) owner.append(previous); }
      selected = id; properties.replaceChildren(body);
      for (const row of document.querySelectorAll('.cached-layer')) { row.classList.toggle('selected-layer', row.dataset.layerId === id); row.querySelector('summary').setAttribute('aria-current', String(row.dataset.layerId === id)); }
      if (activate) tabs('layer');
    },
  };
}
