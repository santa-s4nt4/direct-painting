export function setupCameraControls({midi,bottom,effects,getCamera,onChange}) {
 let received=[];
 const panel=document.createElement('details');panel.className='camera-midi-controls sidebar-section';panel.open=true;
 panel.innerHTML=`
  <summary><span>Camera motion</span><span class="section-chevron" aria-hidden="true">⌄</span></summary>
  <div class="sidebar-content midi-content">
   <label class="checkbox-control"><input id="camera-midi-enabled" type="checkbox" aria-label="MIDI camera motion"><span>Camera motion ON / OFF</span></label>
   <div class="midi-field"><label for="camera-note">反応するMIDIノート</label><select id="camera-note" aria-label="Camera MIDI note" aria-describedby="camera-note-help"></select><p id="camera-note-help" class="control-hint">ノートを送ると候補に追加されます。<br>Note Onごとに次のランダムな位置へ移動します。</p></div>
   <fieldset class="camera-adsr"><legend class="section-label">Envelope · ADSR</legend><div class="camera-adsr-grid">${[['attack','Attack','s'],['decay','Decay','s'],['sustain','Sustain','%'],['release','Release','s']].map(([key,title,unit])=>`<label class="camera-adsr-field" for="camera-${key}"><span>${title}</span><span class="camera-adsr-value"><input id="camera-${key}" type="number" inputmode="decimal" min="0" max="${key==='sustain'?100:16}" step="${key==='sustain'?1:.05}" aria-label="Camera ${title}" aria-describedby="camera-adsr-help"><span aria-hidden="true">${unit}</span></span></label>`).join('')}</div></fieldset>
   <p id="camera-adsr-help" class="control-hint">SustainはDecayへ配分する移動量。Note OffではReleaseで目的地へ進み、戻りません。変更は次のNote Onから適用します。</p>
  </div>`;
 midi.append(panel);
 bottom.innerHTML='<span>Camera</span>'+[['normal','normal'],['midi-auto','midi auto']].map(([mode,label])=>`<button type="button" data-camera-mode="${mode}" aria-label="Camera mode ${label}" aria-pressed="${mode==='normal'}">${label}</button>`).join('')+'<output id="camera-mode-status" aria-live="polite"></output>';
 const change=patch=>onChange({...getCamera(),...patch});
 for(const button of bottom.querySelectorAll('[data-camera-mode]'))button.addEventListener('click',()=>change({mode:button.dataset.cameraMode}));
 panel.querySelector('#camera-midi-enabled').addEventListener('change',e=>change({mode:e.target.checked?'midi-auto':'normal'}));
 panel.querySelector('#camera-note').addEventListener('change',e=>change({note:Number(e.target.value)}));
 for(const key of ['attack','decay','sustain','release'])panel.querySelector(`#camera-${key}`).addEventListener('input',e=>{
  if(e.target.value===''||!Number.isFinite(Number(e.target.value)))return;
  const value=Math.max(0,Math.min(key==='sustain'?100:16,Number(e.target.value)));
  change({[key]:key==='sustain'?value/100:Math.round(value*1000)});
 });
 effects.innerHTML='<label class="checkbox-control"><input id="camera-motion-blur" type="checkbox" checked aria-label="Camera Motion Blur"><span>Camera Motion Blur</span></label><div class="effect-value"><label for="camera-blur-amount">Shutter</label><input id="camera-blur-amount" type="number" min="0" max="200" step="1" value="100" aria-label="Camera blur shutter percent"><span>%</span></div><p class="control-hint">Global camera effect · 100% = 16.7ms</p>';
 effects.querySelector('#camera-motion-blur').addEventListener('change',e=>change({blur:e.target.checked}));
 effects.querySelector('#camera-blur-amount').addEventListener('input',e=>{if(e.target.value!==''&&Number.isFinite(Number(e.target.value)))change({blurAmount:Math.max(0,Math.min(200,Math.round(Number(e.target.value))))});});
 function sync(){
  const config=getCamera();
  panel.querySelector('#camera-midi-enabled').checked=config.mode==='midi-auto';
  const notes=[...new Set([config.note,...received])].sort((a,b)=>a-b),select=panel.querySelector('#camera-note'),signature=JSON.stringify([notes,received]);
  if(select.dataset.notes!==signature){select.replaceChildren(...notes.map(note=>new Option(`${note}${received.includes(note)?' · 受信済み':''}`,String(note))));select.dataset.notes=signature;}
  select.value=String(config.note);
  for(const key of ['attack','decay','sustain','release']){const input=panel.querySelector(`#camera-${key}`);if(input!==document.activeElement)input.value=key==='sustain'?Math.round(config[key]*100):config[key]/1000;}
  for(const button of bottom.querySelectorAll('[data-camera-mode]'))button.setAttribute('aria-pressed',String(button.dataset.cameraMode===config.mode));
  effects.querySelector('#camera-motion-blur').checked=config.blur;const amount=effects.querySelector('#camera-blur-amount');if(amount!==document.activeElement)amount.value=config.blurAmount;amount.disabled=!config.blur;
  bottom.querySelector('#camera-mode-status').textContent=config.mode==='midi-auto'?`MIDI ${config.note} · 立方体ロック`:'';
 }
 sync();
 return {sync,setReceived(notes){received=notes;sync();}};
}
