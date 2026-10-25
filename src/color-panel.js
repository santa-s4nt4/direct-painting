export function hsvToHex(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + rgb.map(value => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('');
}
export function hexToHSV(hex) {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
export function wheelColor(x, y, radius) { return { h: (Math.atan2(-y, x) * 180 / Math.PI + 360) % 360, s: Math.min(1, Math.hypot(x, y) / radius) }; }

export function setupColorPanel(container, { onChange, onVisibility }) {
  const root = document.createElement('div'); root.className = 'floating-color';
  root.innerHTML = `<button id="toggle-color-panel" class="color-panel-toggle" aria-label="Toggle color panel" aria-expanded="true" aria-controls="floating-color-panel"><span class="current-color-swatch"></span><span>Color</span><span aria-hidden="true">◉</span></button>
    <section id="floating-color-panel" aria-label="Color panel"><header><strong>Color</strong><span id="color-context">Brush</span><button class="icon-button" id="close-color-panel" aria-label="Hide color panel">×</button></header>
    <div class="color-wheel-wrap"><canvas class="color-wheel" width="360" height="360" role="slider" tabindex="0" aria-label="Color wheel" aria-valuemin="0" aria-valuemax="360"></canvas><span class="color-wheel-marker" aria-hidden="true"></span></div>
    <div class="color-brightness-row"><label for="color-brightness">Brightness</label><output id="color-brightness-value">100%</output></div><input id="color-brightness" type="range" min="0" max="100" step="1" value="0" aria-label="Color brightness">
    <div class="color-hex-row"><label for="floating-color-hex">Hex</label><input id="floating-color-hex" type="text" value="#ffffff" maxlength="7" spellcheck="false" autocapitalize="off" aria-label="Color hex"></div>
    <div class="color-opacity-row"><label for="floating-opacity">Opacity</label><input id="floating-opacity" type="number" min="0" max="100" step="1" value="100" aria-label="Color opacity percent"><span>%</span></div><input id="floating-opacity-range" type="range" min="0" max="100" value="100" aria-label="Color opacity">
    </section>`;
  container.append(root);
  const $ = selector => root.querySelector(selector), panel = $('#floating-color-panel'), toggle = $('#toggle-color-panel'), canvas = $('.color-wheel'), marker = $('.color-wheel-marker');
  let hsv = { h: 0, s: 0, v: 1 }, hex = '#ffffff', opacity = 1, visible = true;
  const wheel = canvas.getContext('2d'), data = wheel.createImageData(360, 360);
  for (let y = 0; y < 360; y++) for (let x = 0; x < 360; x++) {
    const dx = x + .5 - 180, dy = y + .5 - 180, radius = Math.hypot(dx, dy);
    if (radius > 180) continue;
    const value = wheelColor(dx, dy, 180), rgb = hsvToHex(value.h, value.s, 1);
    data.data.set([1, 3, 5].map(i => Number.parseInt(rgb.slice(i, i + 2), 16)).concat(Math.min(255, (180 - radius) * 255)), (y * 360 + x) * 4);
  }
  wheel.putImageData(data, 0, 0);
  const render = () => {
    marker.style.left = `${50 + Math.cos(hsv.h * Math.PI / 180) * hsv.s * 50}%`; marker.style.top = `${50 - Math.sin(hsv.h * Math.PI / 180) * hsv.s * 50}%`;
    canvas.setAttribute('aria-valuenow', Math.round(hsv.h)); canvas.setAttribute('aria-valuetext', `${hex}, saturation ${Math.round(hsv.s * 100)}%`);
    $('#color-brightness').value = Math.round((1 - hsv.v) * 100); $('#color-brightness-value').textContent = `${Math.round(hsv.v * 100)}%`;
    $('#color-brightness').style.background = `linear-gradient(to right, ${hsvToHex(hsv.h, hsv.s, 1)}, #000)`;
    $('#floating-color-hex').value = hex.toUpperCase(); $('#floating-opacity').value = $('#floating-opacity-range').value = Math.round(opacity * 100);
    toggle.style.setProperty('--current-color', hex); $('#floating-opacity-range').style.setProperty('--current-color', hex);
  };
  const change = () => { hex = hsvToHex(hsv.h, hsv.s, hsv.v); render(); onChange(hex, opacity); };
  const setVisible = value => { visible = value; panel.hidden = !visible; toggle.setAttribute('aria-expanded', String(visible)); };
  const visibility = value => { setVisible(value); onVisibility(value); };
  toggle.addEventListener('click', () => visibility(!visible)); $('#close-color-panel').addEventListener('click', () => visibility(false));
  // Close before the target handles the touch, without swallowing drawing or UI input.
  document.addEventListener('pointerdown', event => {
    if (visible && !root.contains(event.target)) visibility(false);
  }, { capture: true });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { visibility(false); toggle.focus(); } });
  const point = event => {
    const rect = canvas.getBoundingClientRect(), c = wheelColor((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1, 1);
    hsv.h = c.h; hsv.s = c.s; change();
  };
  canvas.addEventListener('pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); canvas.setPointerCapture(event.pointerId); point(event); });
  canvas.addEventListener('pointermove', event => { if (canvas.hasPointerCapture(event.pointerId)) point(event); });
  canvas.addEventListener('pointerup', event => { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); });
  canvas.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') hsv.h = (hsv.h + (event.key === 'ArrowLeft' ? -2 : 2) + 360) % 360;
    else hsv.s = Math.max(0, Math.min(1, hsv.s + (event.key === 'ArrowUp' ? .02 : -.02)));
    change();
  });
  $('#color-brightness').addEventListener('input', event => { hsv.v = 1 - Number(event.target.value) / 100; change(); });
  const alpha = event => { if (event.target.value === '') return; opacity = Math.max(0, Math.min(1, Number(event.target.value) / 100)); render(); onChange(hex, opacity); };
  $('#floating-opacity').addEventListener('input', alpha); $('#floating-opacity-range').addEventListener('input', alpha);
  $('#floating-color-hex').addEventListener('input', event => { const value = event.target.value.startsWith('#') ? event.target.value : '#' + event.target.value; if (!/^#[0-9a-f]{6}$/i.test(value)) return; hex = value.toLowerCase(); hsv = hexToHSV(hex); render(); onChange(hex, opacity); });
  $('#floating-color-hex').addEventListener('change', render);
  render();
  return {
    setColor(color, alpha = 1, label = 'Brush') { if (color.toLowerCase() !== hex) { hex = color.toLowerCase(); hsv = hexToHSV(hex); } opacity = alpha; $('#color-context').textContent = label; render(); },
    setVisible,
    open() { visibility(true); },
  };
}
