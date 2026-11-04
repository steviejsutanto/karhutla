import { drawForest, drawCloudRain } from './renderer.js';

const $ = selector => document.querySelector(selector);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const state = { progress:0, playing:false, last:0, rain:0, targetRain:false, holding:false, showerUntil:0, rainStop:-10, holdingSince:0, outroAt:0, time:0 };
const canvases = [...document.querySelectorAll('canvas')];
const contexts = new Map(canvases.map(canvas => [canvas.id,canvas.getContext('2d')]));
const stageName = p => p >= 1 ? 'out / burned remains' : p >= .5 ? 'embers' : 'surface fire';

function fit() {
  for (const canvas of canvases) {
    const {width,height}=canvas.getBoundingClientRect();
    const dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(width*dpr); canvas.height=Math.round(height*dpr);
    contexts.get(canvas.id).setTransform(dpr,0,0,dpr,0,0);
  }
  render();
}

function prepare(id) {
  const canvas=$(`#${id}`),ctx=contexts.get(id),{width,height}=canvas.getBoundingClientRect();
  ctx.clearRect(0,0,width,height);
  return {ctx,width,height};
}

function render() {
  const motionTime=reducedMotion.matches?0:state.time;
  const rain=prepare('rain-canvas');
  drawCloudRain(rain.ctx,{width:rain.width,height:rain.height,time:motionTime,amount:state.targetRain?state.rain:0,tail:Math.max(0,1-(performance.now()/1000-state.rainStop)/.8)});
  const forest=prepare('forest-canvas');
  drawForest(forest.ctx,{width:forest.width,height:forest.height,time:motionTime,progress:state.progress,smokeTail:state.progress>=1?Math.max(0,1-(state.time-state.outroAt)/3):0});
  for (const [id,progress] of [['state-fire',0],['state-embers',.62],['state-out',1]]) {
    const sample=prepare(id);
    drawForest(sample.ctx,{width:sample.width,height:sample.height,time:motionTime,progress});
  }
}

function updateUI() {
  $('#transition').value=Math.round(state.progress*1000);
  $('#transition').setAttribute('aria-valuetext',`${stageName(state.progress)}, ${Math.round(state.progress*100)} percent through the transition`);
  if($('#forest-state').textContent!==stageName(state.progress))$('#forest-state').textContent=stageName(state.progress);
  const playLabel=state.playing?'Pause <span aria-hidden="true">Ⅱ</span>':reducedMotion.matches?'Next state <span aria-hidden="true">→</span>':'Play transition <span aria-hidden="true">↗</span>';
  if($('#play-transition').innerHTML!==playLabel)$('#play-transition').innerHTML=playLabel;
  $('#forest-canvas').setAttribute('aria-label',`Schematic forest and land: ${stageName(state.progress)}. Charred trunks, fallen branches, and ash remain throughout.`);
}

function setProgress(progress) {
  const previous=state.progress;
  state.progress=Math.max(0,Math.min(1,progress));
  if (state.progress>=1 && previous<1) state.outroAt=state.time;
  updateUI(); render();
}

function startRain() {
  state.holding=true; state.holdingSince=performance.now()/1000;
  state.showerUntil=state.holdingSince+1.6;
  $('#rain-state').textContent='raining';
}
function releaseRain({cancel=false}={}) {
  state.holding=false;
  if(cancel) state.showerUntil=0;
  state.rainStop=performance.now()/1000;
}
$('#rain-trigger').addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  event.preventDefault(); $('#rain-trigger').focus({preventScroll:true});
  $('#rain-trigger').setPointerCapture(event.pointerId);startRain();
});
$('#rain-trigger').addEventListener('pointerup',()=>releaseRain());
$('#rain-trigger').addEventListener('pointercancel',()=>releaseRain({cancel:true}));
$('#rain-trigger').addEventListener('lostpointercapture',()=>{if(state.holding)releaseRain({cancel:true});});
$('#rain-trigger').addEventListener('click',event=>{if(event.detail===0){state.showerUntil=performance.now()/1000+1.6;$('#rain-state').textContent='raining';}});
$('#rain-trigger').addEventListener('keydown',event=>{if(event.key==='Escape')releaseRain({cancel:true});if(['Space','Enter'].includes(event.code)){event.preventDefault();if(!event.repeat)startRain();}});
$('#rain-trigger').addEventListener('keyup',event=>{if(['Space','Enter'].includes(event.code)){event.preventDefault();releaseRain();}});
$('#rain-trigger').addEventListener('blur',()=>releaseRain({cancel:true}));
$('#play-transition').addEventListener('click',()=>{
  if(state.progress>=1)setProgress(0);
  state.playing=!state.playing;updateUI();
});
$('#reset-transition').addEventListener('click',()=>{state.playing=false;setProgress(0);});
$('#transition').addEventListener('input',event=>{state.playing=false;setProgress(Number(event.target.value)/1000);});
for(const button of document.querySelectorAll('[data-progress]'))button.addEventListener('click',()=>{state.playing=false;setProgress(Number(button.dataset.progress));});
window.addEventListener('blur',()=>releaseRain({cancel:true}));
document.addEventListener('visibilitychange',()=>{releaseRain({cancel:true});state.last=0;});
function updateMotionNote(){ $('#motion-note').textContent=reducedMotion.matches?'Reduced motion: static rainfall and scrubbed forest states are available.':'Click a state below the preview to inspect it. Space or Enter also triggers the cloud.'; }
reducedMotion.addEventListener('change',()=>{state.playing=false;updateMotionNote();updateUI();render();});
updateMotionNote();

function frame(now) {
  const seconds=now/1000,dt=state.last?Math.min(.1,(now-state.last)/1000):0;state.last=now;
  if(!document.hidden){
    state.time+=dt;
    const target=state.holding||seconds<state.showerUntil?1:0;
    if(!target&&state.targetRain)state.rainStop=seconds;
    state.targetRain=Boolean(target);
    state.rain+=(target-state.rain)*(1-Math.exp(-dt*(target?12:5)));
    if(!target&&seconds-state.rainStop>=.8&&$('#rain-state').textContent!=='idle')$('#rain-state').textContent='idle';
    if(state.playing){
      if(reducedMotion.matches){setProgress(state.progress<.5?.62:1);state.playing=false;updateUI();}
      else {setProgress(state.progress+dt/18);if(state.progress>=1){state.playing=false;updateUI();}}
    }
    render();
  }
  requestAnimationFrame(frame);
}

function saveCanvas(canvas,name) {
  return new Promise(resolve=>canvas.toBlob(blob=>{
    if(!blob){resolve(false);return;}
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);resolve(true);
  }));
}

function makeFrame(kind,progress=0,time=1) {
  const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=720;
  const ctx=canvas.getContext('2d');
  if(kind==='rain')drawCloudRain(ctx,{width:1200,height:720,time,amount:1});
  else drawForest(ctx,{width:1200,height:720,time,progress});
  return canvas;
}

$('#download-frames').addEventListener('click',async()=>{
  const button=$('#download-frames');button.disabled=true;
  try{
    const results=[];
    for(const [kind,progress,name] of [['rain',0,'rainfall'],['forest',0,'surface-fire'],['forest',.62,'embers'],['forest',1,'out-burned-remains']])results.push(await saveCanvas(makeFrame(kind,progress),`${name}.png`));
    $('#export-status').textContent=results.every(Boolean)?'Four PNG downloads requested. Allow multiple downloads if prompted.':'Some frames could not be exported. Try again.';
  }finally{button.disabled=false;}
});

function makeSheet() {
  const canvas=document.createElement('canvas');canvas.width=1800;canvas.height=1120;const ctx=canvas.getContext('2d');
  ctx.fillStyle='#f6f5f0';ctx.fillRect(0,0,1800,1120);ctx.fillStyle='#292d2a';ctx.font='15px monospace';ctx.fillText('WLU / WILDFIRE     LO-FI ANIMATED ASSETS',72,65);
  ctx.font='54px Georgia';ctx.fillText('Rain & what remains.',72,145);
  ctx.strokeStyle='#d1d2c9';ctx.beginPath();ctx.moveTo(72,190);ctx.lineTo(1728,190);ctx.stroke();
  drawCloudRain(ctx,{x:72,y:230,width:500,height:420,time:1.4,amount:1});
  ctx.fillStyle='#797c75';ctx.font='16px monospace';ctx.fillText('01  RAINFALL / click or hold',88,690);
  drawForest(ctx,{x:660,y:210,width:1060,height:470,time:1.4,progress:0});
  ctx.fillStyle='#797c75';ctx.fillText('02  FOREST & LAND / surface fire',680,690);
  for(const [i,p,label] of [[0,0,'SURFACE FIRE'],[1,.62,'EMBERS'],[2,1,'OUT / BURNED REMAINS']]){
    const x=72+i*562;drawForest(ctx,{x,y:730,width:530,height:275,time:1.4,progress:p});ctx.fillStyle='#292d2a';ctx.font='14px monospace';ctx.fillText(label,x+12,1040);
  }
  return canvas;
}
$('#download-sheet').addEventListener('click',()=>saveCanvas(makeSheet(),'wildfire-lo-fi-asset-sheet.png'));

// A deterministic export interface for frame sequences and reusable transparent assets.
window.assetPreview={state,setProgress,render,makeFrame,makeSheet,drawForest,drawCloudRain};
new ResizeObserver(fit).observe(document.querySelector('.studies'));
fit();updateUI();requestAnimationFrame(frame);
