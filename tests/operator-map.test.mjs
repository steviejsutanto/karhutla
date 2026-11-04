import test from 'node:test';
import assert from 'node:assert/strict';
import { OperatorForest } from '../visual-assets/surface-heat.js';
import { drawMapForest, forestPatchBounds } from '../visual-assets/map-forest.js';

const bounds = Object.freeze({ x: 0, y: 0, width: 960, height: 380 });

function context() {
  const stack = [];
  const ctx = { calls: [], matrix: [1, 0, 0, 1, 0, 0], globalAlpha: 1, globalCompositeOperation: 'source-over', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    reset() { this.matrix = [1, 0, 0, 1, 0, 0]; this.globalAlpha = 1; stack.length = 0; },
    record(name, args = []) { this.calls.push({ name, args, matrix: [...this.matrix], alpha: this.globalAlpha,
      fill: this.fillStyle, stroke: this.strokeStyle, composite: this.globalCompositeOperation, lineWidth: this.lineWidth, lineCap: this.lineCap, lineJoin: this.lineJoin }); },
    save() { stack.push({ matrix: [...this.matrix], globalAlpha: this.globalAlpha,
      globalCompositeOperation: this.globalCompositeOperation, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, lineCap: this.lineCap, lineJoin: this.lineJoin }); },
    restore() { Object.assign(this, stack.pop()); },
    transform(a, b, c, d, e, f) {
      const [ma, mb, mc, md, me, mf] = this.matrix;
      this.matrix = [ma*a+mc*b, mb*a+md*b, ma*c+mc*d, mb*c+md*d, ma*e+mc*f+me, mb*e+md*f+mf];
    },
    setTransform(...values) { this.matrix = [...values]; this.record('setTransform', values); },
    translate(x, y) { this.transform(1, 0, 0, 1, x, y); this.record('translate', [x, y]); },
    scale(x, y) { this.transform(x, 0, 0, y, 0, 0); this.record('scale', [x, y]); },
    rotate(angle) { this.transform(Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0); this.record('rotate', [angle]); },
  };
  for (const method of ['beginPath', 'closePath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo',
    'rect', 'clip', 'fill', 'stroke', 'fillRect', 'clearRect', 'drawImage', 'ellipse', 'arc']) {
    ctx[method] = function (...args) { this.record(method, args); };
  }
  return ctx;
}

async function fixture() {
  const canvases = [];
  const canvasFactory = (width = 1, height = 1) => {
    const drawing = context();
    const canvas = { _width: width, _height: height, context: drawing,
      get width() { return this._width; }, set width(value) { this._width = value; drawing.reset(); },
      get height() { return this._height; }, set height(value) { this._height = value; drawing.reset(); },
      getContext() { return drawing; } };
    canvases.push(canvas); return canvas;
  };
  const renderer = new OperatorForest({ canvasFactory }); await renderer.ready();
  return { renderer, canvases, drawing: context() };
}

function site(overrides = {}) {
  return Object.freeze({ id: '460,-4', gridX: 460, gridY: -4, x: 250.25, y: 180.75,
    heat: 1, activity: 1, ember: .4, surfaceWetness: 0, calm: 0, extinguished: false, ...overrides });
}

function frame(fixture, sites, now, options = {}) {
  fixture.drawing.calls.length = 0;
  return { stats: { ...fixture.renderer.drawSites(fixture.drawing, { sites, now, bounds, ...options }) },
    calls: [...fixture.drawing.calls] };
}

// Compare path commands, paint colors, alpha, line style and device-space
// transforms. Cached terrain is translated back into the final map frame.
const round = value => typeof value === 'number' ? Math.round(value * 1e8) / 1e8 : value;
function trace(calls, offsetX = 0, offsetY = 0) {
  const methods = new Set(['beginPath', 'closePath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo',
    'rect', 'clip', 'fill', 'stroke', 'fillRect', 'ellipse', 'arc']);
  return calls.filter(call => methods.has(call.name)).map(call => {
    const [a,b,c,d,e,f] = call.matrix;
    const point=(x,y)=>[round(a*x+c*y+e+offsetX),round(b*x+d*y+f+offsetY)];
    let args=[];
    if(['moveTo','lineTo','bezierCurveTo','quadraticCurveTo'].includes(call.name)) {
      for(let i=0;i<call.args.length;i+=2)args.push(...point(call.args[i],call.args[i+1]));
    } else if(['rect','fillRect'].includes(call.name)) {
      const [x,y,w,h]=call.args;args=[...point(x,y),...point(x+w,y),...point(x+w,y+h),...point(x,y+h)];
    } else if(['ellipse','arc'].includes(call.name)) {
      args=[...point(call.args[0],call.args[1]),...call.args.slice(2).map(round),...[a,b,c,d].map(round)];
    }
    const command={name:call.name,args};
    if(['fill','stroke','fillRect'].includes(call.name)) {
      command.alpha=round(call.alpha);command.composite=call.composite;
      if(call.name==='stroke')Object.assign(command,{color:call.stroke,width:round(call.lineWidth),
        cap:call.lineCap,join:call.lineJoin,linear:[a,b,c,d].map(round)});
      else command.color=call.fill;
    }
    return command;
  });
}
function sameTrace(actual,expected,message) {
  assert.equal(actual.length,expected.length,`${message}: command count`);
  for(let i=0;i<actual.length;i++)assert.deepEqual(actual[i],expected[i],`${message}: command ${i}`);
}
const sourceSeed = source => source.seed ?? ((Math.imul(source.gridX, 73856093) ^ Math.imul(source.gridY, 19349663)) >>> 0);
const ordered = sources => [...sources].sort((a,b) => a.y-b.y || a.x-b.x || a.id.localeCompare(b.id));
function reference(sources, { now, scale = 1, operatorMapScale, reducedMotion = false, smoke = true }, visuals = new Map()) {
  const terrain = context(), dynamic = context(), time = now / 1000;
  terrain.scale(scale, scale); dynamic.scale(scale, scale);
  const patches = ordered(sources).map(source => {
    const heat = source.heat, extinguished = Boolean(source.extinguished);
    let visual = visuals.get(source.id);
    if (!visual) { visual = { wasOut: extinguished, outAt: null, tailHeat: heat }; visuals.set(source.id, visual); }
    if (extinguished && !visual.wasOut) visual.outAt = time;
    if (!extinguished) visual.tailHeat = heat;
    visual.wasOut = extinguished;
    const options = { x: source.x/scale, y: source.y/scale, scale: operatorMapScale, seed: sourceSeed(source) };
    drawMapForest(terrain, { ...options, layer:'terrain', heat:0, surfaceWetness:0, extinguished:false, time:0 });
    return { ...options, time:reducedMotion ? 0 : time, heat, surfaceWetness:source.surfaceWetness, extinguished,
      smokeTail:source.smokeTail ?? (visual.outAt === null ? 0 : Math.max(0,1-(time-visual.outAt)/3)),
      tailHeat:source.tailHeat ?? visual.tailHeat };
  });
  for (const layer of smoke ? ['fire','smoke'] : ['fire']) for (const patch of patches) drawMapForest(dynamic, { ...patch,layer });
  return { terrain:trace(terrain.calls), dynamic:trace(dynamic.calls) };
}
function terrainTrace(example) {
  const { bitmap,left,top } = example.renderer.terrainCache;
  return trace(bitmap.context.calls,left,top);
}
function paritySources() {
  return [
    site({ id:'460,-4', gridX:460, gridY:-4, x:250.25,y:180.75,activity:.02,ember:0 }),
    site({ id:'408,2', gridX:408,gridY:2,x:100.5,y:80.25,heat:.8,activity:0,surfaceWetness:.7 }),
    site({ id:'488,-20',gridX:488,gridY:-20,x:650.75,y:210.5,heat:.08,activity:1,seed:45 }),
    site({ id:'560,-24',gridX:560,gridY:-24,x:850,y:180,heat:1,activity:1,extinguished:true }),
  ];
}

test('terrain and fire traces match the original operator at raw source states and unrestricted scales',async()=>{
  const sources=paritySources(), before=structuredClone(sources);
  for (const operatorMapScale of [5,10.45454545,24,45]) for (const scale of [1,1.5]) {
    const example=await fixture();
    const visuals=new Map();
    for (const now of [0,350,1000]) {
      const options={now,operatorMapScale,scale,smoke:false};
      const actual=frame(example,sources,now,options), expected=reference(sources,options,visuals);
      const terrainStamp=actual.calls.filter(call=>call.name==='drawImage');
      assert.equal(terrainStamp.length,1,'The static terrain cache is composited once.');
      assert.equal(terrainStamp[0].args[0],example.renderer.terrainCache.bitmap);
      assert.deepEqual(terrainStamp[0].args.slice(1),[example.renderer.terrainCache.left,example.renderer.terrainCache.top]);
      assert.equal(terrainStamp[0].alpha,1);assert.equal(terrainStamp[0].composite,'source-over');
      assert.deepEqual(terrainStamp[0].matrix,[1,0,0,1,0,0],'The cached terrain keeps its original physical pixel scale.');
      sameTrace(terrainTrace(example),expected.terrain,'Cached trees and ash must preserve original seed offsets, colors and scale.');
      sameTrace(trace(actual.calls),expected.dynamic,'Every fire path, color, alpha and position must match direct drawMapForest calls.');
      assert.equal(actual.stats.glyphCss,operatorMapScale);
      assert.equal(actual.stats.terrainBuilds,1);
    }
  }
  assert.deepEqual(sources,before);
});

test('raw heat, wetness and extinction changes match the original immediately without an added visual transition',async()=>{
  const example=await fixture(), visuals=new Map();
  const options={now:1000,operatorMapScale:14.25,scale:1.5,smoke:false};
  const states=[site(),site({heat:.42,activity:0,surfaceWetness:1}),site({heat:.08,activity:1}),site({extinguished:true})];
  for (const source of states) {
    const actual=frame(example,[source],options.now,options), expected=reference([source],options,visuals);
    sameTrace(trace(actual.calls),expected.dynamic,'The operator uses the current state even when no clock time has elapsed.');
    assert.equal(actual.stats.terrainBuilds,1);
  }
});

test('default smoke matches original ordering and the three-second extinction tail',async()=>{
  const example=await fixture(), visuals=new Map();
  const live=site({heat:.8}), out=site({heat:0,extinguished:true});
  for (const [now,source] of [[1000,live],[1400,out],[2400,out],[4500,out]]) {
    const options={now,operatorMapScale:13,scale:1.5};
    const actual=frame(example,[source],now,options), expected=reference([source],options,visuals);
    sameTrace(trace(actual.calls),expected.dynamic,'Fire precedes smoke, using the original clock and extinction tail.');
    const ellipses=actual.calls.filter(call=>call.name==='ellipse');
    if(now<4500)assert.ok(ellipses.length>0); else assert.equal(ellipses.length,0);
    assert.equal(actual.stats.terrainBuilds,1);
  }
});

test('reduced motion matches original time-zero geometry and smoke can be explicitly omitted',async()=>{
  const example=await fixture(), visuals=new Map(), sources=paritySources();
  for (const now of [0,500,2000]) {
    const options={now,operatorMapScale:16.5,reducedMotion:true};
    const actual=frame(example,sources,now,options), expected=reference(sources,options,visuals);
    sameTrace(trace(actual.calls),expected.dynamic,'Original operator trace parity');
    assert.equal(actual.stats.operatorTime,0);
  }
  const options={now:2500,operatorMapScale:16.5,smoke:false};
  const actual=frame(example,sources,options.now,options), expected=reference(sources,options,visuals);
  sameTrace(trace(actual.calls),expected.dynamic,'Original operator trace parity');
  assert.equal(actual.calls.some(call=>call.name==='ellipse'),false);
});

test('all original operator sources are rendered rather than restricted by former sprite budgets',async()=>{
  const example=await fixture();
  const sources=Array.from({length:193},(_,index)=>site({id:String(index),seed:index+10,
    x:index%25*35+20,y:Math.floor(index/25)*25+50,heat:.8,surfaceWetness:.15}));
  const options={now:800,operatorMapScale:9.25,smoke:false,maxSprites:1};
  const actual=frame(example,sources,options.now,options), expected=reference(sources,options);
  sameTrace(trace(actual.calls),expected.dynamic,'All actual source paths must survive, including the 193rd source.');
  assert.equal(actual.stats.fireDraws,sources.length); assert.equal(actual.stats.terrainSourceCount,sources.length);
});

test('terrain cache follows geography and original scale while heat, source order and out flags do not rebuild it',async()=>{
  const example=await fixture(), sources=paritySources();
  const first=frame(example,sources,0,{operatorMapScale:14});
  const builds=first.stats.terrainBuilds;
  const changed=[...sources].reverse().map(source=>({...source,heat:0,surfaceWetness:1,extinguished:true}));
  assert.equal(frame(example,changed,100,{operatorMapScale:14}).stats.terrainBuilds,builds);
  assert.ok(frame(example,changed,200,{operatorMapScale:20}).stats.terrainBuilds>builds);
  const moved=changed.map((source,index)=>index?source:{...source,x:source.x+1});
  const prior=example.renderer.siteStats.terrainBuilds;
  assert.ok(frame(example,moved,300,{operatorMapScale:20}).stats.terrainBuilds>prior);
});

test('operator parity mode uses vector assets without image downloads',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'Image');let downloads=0;
  Object.defineProperty(globalThis,'Image',{configurable:true,value:class{constructor(){downloads++;throw new Error('No bitmap expected');}}});
  try {const example=await fixture();frame(example,paritySources(),1000,{operatorMapScale:14});assert.equal(downloads,0);}
  finally {if(descriptor)Object.defineProperty(globalThis,'Image',descriptor);else delete globalThis.Image;}
});

test('patch smoke is visibly orange with a dark body while retaining its country-scale puffs and terrain bounds',()=>{
  const drawing=context(), scale=12;
  drawMapForest(drawing,{x:100,y:120,scale,seed:17,time:2.3,heat:1,layer:'smoke'});
  const ellipses=drawing.calls.filter(call=>call.name==='ellipse');
  const fills=drawing.calls.filter(call=>call.name==='fill');
  assert.equal(ellipses.length,6,'Three existing emitters retain two cached-cost lobes each.');
  assert.ok(Math.max(...ellipses.map(call=>call.args[2]))>6,'Plumes expand well beyond the former small pale wisps.');
  const maxOpacity = Math.max(...fills.map(call=>call.alpha));
  assert.ok(maxOpacity > .25 && maxOpacity < .4, 'The orange body remains visible with more transparency.');
  assert.ok(fills.every(call=>['#ba501b','#df772c'].includes(call.fill)));
  assert.ok(fills.every(call=>{const hex=call.fill.slice(1),red=parseInt(hex.slice(0,2),16),green=parseInt(hex.slice(2,4),16),blue=parseInt(hex.slice(4,6),16);return red>green*1.7&&green>blue*2;}),'Both body lobes retain a clearly orange, saturated hue.');
  const terrain=forestPatchBounds({x:100,y:120,scale,seed:17,layer:'terrain'});
  assert.ok(Math.abs(terrain.width-.92*scale)<1e-9);
  assert.ok(Math.abs(terrain.height-.82*scale)<1e-9,'Geographic terrain hit areas are unchanged.');
});

test('expanded smoke remains inside its effect bounds throughout complete plume lifetimes',()=>{
  for(const scale of [5,12,24,45])for(const seed of [1,17,45,413])for(let time=0;time<10;time+=.37){
    const drawing=context(), bounds=forestPatchBounds({x:100,y:120,scale,seed,layer:'smoke'});
    drawMapForest(drawing,{x:100,y:120,scale,seed,time,heat:1,layer:'smoke'});
    for(const call of drawing.calls.filter(call=>call.name==='ellipse')){
      const [x,y,rx,ry,angle]=call.args, [, , , ,tx,ty]=call.matrix;
      const dx=Math.hypot(rx*Math.cos(angle),ry*Math.sin(angle));
      const dy=Math.hypot(rx*Math.sin(angle),ry*Math.cos(angle));
      assert.ok(x+tx-dx>=bounds.left && x+tx+dx<=bounds.right);
      assert.ok(y+ty-dy>=bounds.top && y+ty+dy<=bounds.bottom);
    }
    assert.equal(drawing.globalAlpha,1);
  }
});
