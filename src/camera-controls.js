export function setupCameraControls({midi,bottom,effects,getCamera,onChange}) {
 let received=[];
 const panel=document.createElement('details');panel.className='camera-midi-controls sidebar-section';panel.open=true;
 panel.innerHTML=`
  <summary><span>Camera motion</span><span class="section-chevron" aria-hidden="true">⌄</span></summary>
  <div class="sidebar-content midi-content">
   <label class="checkbox-control"><input id="camera-midi-enabled" type="checkbox" aria-label="MIDI camera motion"><span>Camera motion ON / OFF</span></label>
   <div class="midi-field"><label for="camera-note">反応するMIDIノート</label><select id="camera-note" aria-label="Camera MIDI note" aria-describedby="camera-note-help"></select><p id="camera-note-help" class="control-hint">選択したNote Onごとに、現在の状態から次の目標へ移動します。</p></div>
   <div class="midi-field"><label for="camera-motion">変化させる項目</label><select id="camera-motion" aria-label="Camera motion target"><option value="position">座標のみ</option><option value="zoom">拡大のみ</option><option value="both">座標と拡大</option></select></div>
   <div class="camera-transition-grid">
    <label class="camera-transition-field" for="camera-duration"><span>移動時間</span><span class="camera-transition-value"><input id="camera-duration" type="number" inputmode="decimal" min="0.05" max="16" step="0.05" aria-label="Camera transition duration"><span aria-hidden="true">秒</span></span></label>
    <label class="camera-transition-field" for="camera-easing"><span>イージング</span><select id="camera-easing" aria-label="Camera easing"><option value="smooth">Smooth</option><option value="ease-in-out">Ease in-out</option><option value="ease-out">Ease out</option><option value="linear">Linear</option></select></label>
   </div>
   <div class="camera-zoom-range"><span class="section-label">ランダム拡大の範囲</span><div class="camera-transition-grid">
    <label class="camera-transition-field" for="camera-zoom-min"><span>最小</span><span class="camera-transition-value"><input id="camera-zoom-min" type="number" inputmode="decimal" min="50" max="500" step="1" aria-label="Minimum random camera zoom"><span aria-hidden="true">%</span></span></label>
    <label class="camera-transition-field" for="camera-zoom-max"><span>最大</span><span class="camera-transition-value"><input id="camera-zoom-max" type="number" inputmode="decimal" min="50" max="500" step="1" aria-label="Maximum random camera zoom"><span aria-hidden="true">%</span></span></label>
   </div></div>
   <p class="control-hint">到着後はその状態を保持します。次のNote Onから新しい目標へ移ります。</p>
  </div>`;
 midi.append(panel);
 bottom.innerHTML='<span>Camera</span>'+[['normal','normal'],['midi-auto','midi auto']].map(([mode,label])=>`<button type="button" data-camera-mode="${mode}" aria-label="Camera mode ${label}" aria-pressed="${mode==='normal'}">${label}</button>`).join('')+'<output id="camera-mode-status" aria-live="polite"></output>';
 const change=patch=>{onChange({...getCamera(),...patch});sync();};
 for(const button of bottom.querySelectorAll('[data-camera-mode]'))button.addEventListener('click',()=>change({mode:button.dataset.cameraMode}));
 panel.querySelector('#camera-midi-enabled').addEventListener('change',e=>change({mode:e.target.checked?'midi-auto':'normal'}));
 panel.querySelector('#camera-note').addEventListener('change',e=>change({note:Number(e.target.value)}));
 panel.querySelector('#camera-motion').addEventListener('change',e=>change({motion:e.target.value}));
 panel.querySelector('#camera-easing').addEventListener('change',e=>change({easing:e.target.value}));
 panel.querySelector('#camera-duration').addEventListener('input',e=>{
  if(e.target.value===''||!Number.isFinite(Number(e.target.value)))return;
  change({duration:Math.max(50,Math.min(16000,Math.round(Number(e.target.value)*1000)))});
 });
 const setZoomRange=key=>{
  const min=panel.querySelector('#camera-zoom-min'),max=panel.querySelector('#camera-zoom-max'),current=getCamera();
  if(min.value===''||max.value===''||!Number.isFinite(Number(min.value))||!Number.isFinite(Number(max.value)))return;
  if(key==='zoomMin'&&Number(min.value)>current.zoomMax)max.value=min.value;
  if(key==='zoomMax'&&Number(max.value)<current.zoomMin)min.value=max.value;
  const zoomMin=Math.max(.5,Math.min(5,Number(min.value)/100)),zoomMax=Math.max(zoomMin,Math.min(5,Number(max.value)/100));
  change({zoomMin,zoomMax});
 };
 panel.querySelector('#camera-zoom-min').addEventListener('input',()=>setZoomRange('zoomMin'));
 panel.querySelector('#camera-zoom-max').addEventListener('input',()=>setZoomRange('zoomMax'));
 effects.innerHTML='<label class="checkbox-control"><input id="camera-motion-blur" type="checkbox" checked aria-label="Camera Motion Blur"><span>Camera Motion Blur</span></label><div class="effect-value"><label for="camera-blur-amount">Shutter</label><input id="camera-blur-amount" type="number" min="0" max="200" step="1" value="100" aria-label="Camera blur shutter percent"><span>%</span></div><p class="control-hint">Global camera effect · 100% = 16.7ms</p>';
 effects.querySelector('#camera-motion-blur').addEventListener('change',e=>change({blur:e.target.checked}));
 effects.querySelector('#camera-blur-amount').addEventListener('input',e=>{if(e.target.value!==''&&Number.isFinite(Number(e.target.value)))change({blurAmount:Math.max(0,Math.min(200,Math.round(Number(e.target.value))))});});
 function sync(){
  const config=getCamera();
  panel.querySelector('#camera-midi-enabled').checked=config.mode==='midi-auto';
  const notes=[...new Set([config.note,...received])].sort((a,b)=>a-b),select=panel.querySelector('#camera-note'),signature=JSON.stringify([notes,received]);
  if(select.dataset.notes!==signature){select.replaceChildren(...notes.map(note=>new Option(`${note}${received.includes(note)?' · 受信済み':''}`,String(note))));select.dataset.notes=signature;}
  select.value=String(config.note);panel.querySelector('#camera-motion').value=config.motion;panel.querySelector('#camera-easing').value=config.easing;
  const duration=panel.querySelector('#camera-duration');if(duration!==document.activeElement)duration.value=(config.duration/1000).toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
  const min=panel.querySelector('#camera-zoom-min'),max=panel.querySelector('#camera-zoom-max');if(min!==document.activeElement)min.value=Math.round(config.zoomMin*100);if(max!==document.activeElement)max.value=Math.round(config.zoomMax*100);
  const rangeDisabled=config.motion==='position';min.disabled=max.disabled=rangeDisabled;panel.querySelector('.camera-zoom-range').classList.toggle('is-disabled',rangeDisabled);
  for(const button of bottom.querySelectorAll('[data-camera-mode]'))button.setAttribute('aria-pressed',String(button.dataset.cameraMode===config.mode));
  effects.querySelector('#camera-motion-blur').checked=config.blur;const amount=effects.querySelector('#camera-blur-amount');if(amount!==document.activeElement)amount.value=config.blurAmount;amount.disabled=!config.blur;
  bottom.querySelector('#camera-mode-status').textContent=config.mode==='midi-auto'?`MIDI ${config.note} · 立方体ロック`:'';
 }
 sync();
 return {sync,setReceived(notes){received=notes;sync();}};
}
