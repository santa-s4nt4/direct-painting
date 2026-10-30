import { canvasView, viewRotation } from './view.js';
import { matchesPointer, capturePointer, releasePointer, ignoreCaptureLoss } from './pointer-input.js';

const faces = [
  { label: '前', normal: [0,0,1], points: [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]], pose: {} },
  { label: '後', normal: [0,0,-1], points: [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]], pose: {} },
  { label: '右', normal: [1,0,0], points: [[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]], pose: { yaw: -60 } },
  { label: '左', normal: [-1,0,0], points: [[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]], pose: { yaw: 60 } },
  { label: '上', normal: [0,-1,0], points: [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]], pose: { pitch: -60 } },
  { label: '下', normal: [0,1,0], points: [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]], pose: { pitch: 60 } },
];
export function setupOrientationCube(parent, { getView, onChange, onStart, onFinish }) {
  const root = document.createElement('div'); root.className = 'orientation-control'; root.setAttribute('aria-label', '3D view orientation');
  root.innerHTML = '<svg viewBox="0 0 132 122" class="orientation-cube" tabindex="0" role="button" aria-label="Rotate 3D view" aria-describedby="cube-help"></svg><div class="orientation-details"><div class="orientation-front"><button type="button" aria-label="Front view">Front</button><output class="orientation-readout"></output></div></div><span id="cube-help" class="sr-only">Drag with one finger. Arrow keys orbit; Shift and arrows rotate. Home returns to front.</span>';
  parent.append(root);
  const svg = root.querySelector('svg'); let drag = null, disabled = false;
  const pose = updates => { if(disabled)return; onStart(); onChange(canvasView({ ...getView(), pitch: 0, yaw: 0, rotation: 0, ...updates })); onFinish(); };
  const front=root.querySelector('[aria-label="Front view"]');front.addEventListener('click', () => pose({}));
  svg.addEventListener('pointerdown', event => {
    if (disabled || drag || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); onStart();
    drag = { pointerId: event.pointerId, pointerType: event.pointerType, pointerStartedAt: event.timeStamp, x: event.clientX, y: event.clientY, view: { ...getView() }, moved: false, face: event.target.closest('[data-face]')?.dataset.face };
    capturePointer(svg, event.pointerId);
  });
  const move = event => {
    if (!matchesPointer(drag, event)) return;
    event.preventDefault(); const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    onChange(canvasView({ ...drag.view, yaw: (drag.view.yaw ?? 0) + dx * .65, pitch: (drag.view.pitch ?? 0) - dy * .65 }));
  };
  svg.addEventListener('pointermove', move);
  document.addEventListener('pointermove', event => { if (!svg.contains(event.target)) move(event); }, true);
  const finish = event => {
    if (!matchesPointer(drag, event) || ignoreCaptureLoss(svg, event)) return;
    drag = null;
    releasePointer(svg, event.pointerId);
    onFinish();
  };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) svg.addEventListener(name, finish);
  for (const name of ['pointerup', 'pointercancel']) document.addEventListener(name, finish, true);
  svg.addEventListener('keydown', event => {
    if(disabled)return;
    const view = getView(), updates = {};
    if (event.key === 'Home') { event.preventDefault(); pose({}); return; }
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const direction = ['ArrowLeft','ArrowUp'].includes(event.key) ? -5 : 5;
    const key = event.shiftKey ? 'rotation' : ['ArrowLeft','ArrowRight'].includes(event.key) ? 'yaw' : 'pitch';
    updates[key] = (view[key] ?? 0) + direction; onStart(); onChange(canvasView({ ...view, ...updates })); onFinish();
  });
  function update(view) {
    const r = viewRotation(view), rotate = ([x,y,z]) => [r[0]*x+r[1]*y+r[2]*z,r[3]*x+r[4]*y+r[5]*z,r[6]*x+r[7]*y+r[8]*z];
    const project = p => { const [x,y,z] = rotate(p), k = 31 / (1-z*.1); return [66+x*k,56+y*k,z]; };
    const visible = faces.map((face,i) => ({ ...face, i, n: rotate(face.normal), p: face.points.map(project) })).filter(face => face.n[2] > .001).sort((a,b) => a.n[2]-b.n[2]);
    svg.innerHTML = visible.map(face => { const x=face.p.reduce((a,p)=>a+p[0],0)/4, y=face.p.reduce((a,p)=>a+p[1],0)/4, shade=Math.round(48+face.n[2]*25); return `<g data-face="${face.i}"><polygon points="${face.p.map(p=>p.slice(0,2).join(',')).join(' ')}" fill="rgb(${shade},${shade},${shade})" stroke="#a3a3a3" stroke-width="1"/><text x="${x}" y="${y+4}" text-anchor="middle" fill="#ddd" font-size="13">${face.label}</text></g>`; }).join('');
    for (const [axis, vector, color] of [['X',[1.65,0,0],'#ff6f72'],['Y',[0,-1.65,0],'#6ee58c'],['Z',[0,0,1.65],'#8f9dff']]) {
      const end=project(vector); if (Math.hypot(end[0]-66,end[1]-56)<10) { end[0]+=14; end[1]+=16; } svg.insertAdjacentHTML('beforeend',`<line x1="66" y1="56" x2="${end[0]}" y2="${end[1]}" stroke="${color}" stroke-width="1" pointer-events="none"/><text x="${end[0]}" y="${end[1]-3}" fill="${color}" text-anchor="middle" font-size="10" pointer-events="none">${axis}</text>`);
    }
    root.querySelector('.orientation-readout').textContent = `X ${Math.round(view.pitch ?? 0)}° Y ${Math.round(view.yaw ?? 0)}° Z ${Math.round(view.rotation ?? 0)}°`;
    svg.setAttribute('aria-description', `X ${Math.round(view.pitch ?? 0)}°, Y ${Math.round(view.yaw ?? 0)}°, Z ${Math.round(view.rotation ?? 0)}°`);
  }
  update(getView()); return { update, setDisabled(value){
    disabled=value;root.classList.toggle('camera-locked',value);svg.setAttribute('aria-disabled',String(value));svg.tabIndex=value?-1:0;front.disabled=value;
    if(value&&drag){const id=drag.pointerId;drag=null;releasePointer(svg,id);onFinish();}
  } };
}
