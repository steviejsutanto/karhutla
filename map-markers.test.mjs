import test from 'node:test';
import assert from 'node:assert/strict';
import { PeatSurface, derivePeatState } from './visual-assets/peat-surface.js';
import { studyMapRect, countryMapRect } from './country-view.mjs';

function patch(key, x, y, { heat = 1, surfaceWetness = 0, extinguished = false } = {}) {
  return Object.freeze({ key, x, y, width: .02, height: .04, heat, surfaceWetness, extinguished,
    memory: Object.freeze({ phase: .3, seed: 17, atlas: 2,
      display: Object.freeze(derivePeatState({ heat, surfaceWetness, extinguished })) }) });
}

function renderer(patches, { mapHeat = true, quality = 'high' } = {}) {
  const events = [], strokes = [], circles = [], rectangles = [], images = [], heatCalls = [], labels = [], clears = [];
  const width = 1000, height = 450, density = 1.5;
  const mapRect = mapHeat ? studyMapRect(width,height) : countryMapRect(width,height);
  let path = [];
  const context = {
    clearRect(...values) { clears.push(values); events.push('frame clear'); },
    save() {}, restore() {}, clip() { events.push('wet clip'); },
    fillText(...values) { labels.push(values); },
    beginPath() { path = []; },
    moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); },
    stroke() { strokes.push({ points: path.map(point => [...point]), color: this.strokeStyle }); },
    arc(...values) { circles.push(values); }, fill() {},
    fillRect(...values) { rectangles.push({ values, color: this.fillStyle }); events.push('wet wash'); },
    drawImage(source, ...values) { images.push({ source, values }); events.push(source); },
  };
  const surface = Object.create(PeatSurface.prototype);
  Object.assign(surface, {
    canvas: { width: width*density, height: height*density, dataset: {} }, context, width, height,
    loaded: true, destroyed: false, scale: 1.5, reducedMotion: false,
    mapHeat, quality, hazeLevel: 0, hazeAt: -Infinity, selection: null,
    mapRect, pixelMapRect: Object.fromEntries(Object.entries(mapRect).map(([key,value])=>[key,value*density])),
    patches, markPatches: patches, atlasSize: 96,
    cold: { kind: 'cold' }, haze: { kind: 'haze' }, atlas: { kind: 'static fissures' }, fireGlow: { kind: 'radial glow' },
    stats: { frames: 0 },
    _smoothDisplay() { events.push('smoothing'); }, _drawHaze(now) { this.hazeAt = now; }, _adapt() {},
    surfaceHeat: mapHeat ? {
      drawSites(_context, options) {
        heatCalls.push(options); events.push('operator forest');
        return { visibleSites: options.sites.filter(site => !site.extinguished && site.heat > 0).length,
          anchorDrift:0, maxTipMotion:0, drawMs:.1, terrainSourceCount:options.sites.length,
          terrainBuilds:1, fireDraws:options.sites.length, smokeDraws:options.sites.length,
          textureDraws:options.sites.length, drawSlots:0, operatorTimeAdvance:1/24 };

      },
    } : null,
  });
  return { surface, events, strokes, circles, rectangles, images, heatCalls, labels, clears };
}

function center(surface, source) {
  const rect = surface.pixelMapRect;
  return [rect.x + (source.x + source.width / 2) * rect.width,
    rect.y + (source.y + source.height / 2) * rect.height];
}

const mixedPatches = () => [
  patch('hot', .12, .3),
  patch('wet ember', .4, .55, { heat: .8, surfaceWetness: 1 }),
  patch('out', .7, .15, { heat: 0, extinguished: true }),
  patch('not declared out', .85, .7, { heat: 0 }),
];

function geographicPatch(key,state={}) {
  const [gridX,gridY]=key.split(',').map(Number),longitude=gridX*.25+.125,latitude=gridY*.25+.125;
  const source=patch(key,(longitude-.125-94)/48,(7-latitude-.125)/19,state);
  return Object.freeze({...source,width:.25/48,height:.25/19,geo:Object.freeze([longitude,latitude])});
}
function studyProject(surface,longitude,latitude) {
  const rect=studyMapRect(surface.width,surface.height);
  return [(rect.x+(longitude-94)/48*rect.width)*surface.scale,
    (rect.y+(7-latitude)/19*rect.height)*surface.scale];
}

test('main operator map forwards raw authoritative fields and study projection without added graphic markers',()=>{
  const first=geographicPatch('400,0');
  const sources=[Object.freeze({...first,memory:Object.freeze({...first.memory,display:Object.freeze(derivePeatState({heat:0}))})}),
    geographicPatch('460,-4',{heat:.8,surfaceWetness:1}),geographicPatch('540,-8',{heat:0,extinguished:true}),
    geographicPatch('500,-20',{heat:0})];
  const before=structuredClone(sources);
  const {surface,events,strokes,circles,rectangles,images,heatCalls,labels,clears}=renderer(sources);
  surface.operatorGrain={kind:'stale map-only grain'};
  const stats=surface.draw(1000), options=heatCalls[0];
  assert.equal(circles.length,0);assert.equal(strokes.length,0);assert.equal(rectangles.length,0);
  assert.deepEqual(images.map(image=>image.source),[surface.cold],
    'Operator artwork must not receive old ash pixels, copper cracks, glow cores, fissures or map haze stamps.');
  assert.deepEqual(events,['frame clear',surface.cold,'operator forest']);
  assert.deepEqual(clears,[[0,0,surface.canvas.width,surface.canvas.height]],'Transparent geography requires erasing all old fire and smoke before the cached land is drawn.');
  assert.equal(labels.length,0,'The projection map has no visible place labels.');assert.equal(heatCalls.length,1);
  assert.equal(Object.hasOwn(options,'maxSprites'),false);
  assert.ok(Math.abs(options.operatorMapScale-studyMapRect(surface.width,surface.height).width/48)<1e-10);
  for(const [index,source] of sources.entries()) {
    const forwarded=options.sites[index],expected=studyProject(surface,...source.geo);
    assert.ok(Math.hypot(forwarded.x-expected[0],forwarded.y-expected[1])<1e-8);
    const [gridX,gridY]=source.key.split(',').map(Number);
    assert.deepEqual({...forwarded,x:0,y:0},{id:source.key,x:0,y:0,heat:source.heat,surfaceWetness:source.surfaceWetness,
      extinguished:source.extinguished,seed:(Math.imul(gridX,73856093)^Math.imul(gridY,19349663))>>>0});
  }
  assert.deepEqual([stats.activeMarkers,stats.emberMarkers,stats.outMarkers,stats.locatedMarkers],[1,2,1,4]);
  assert.equal(stats.mapHeatSprites,2);assert.deepEqual(sources,before);
  surface.draw(1100);
  assert.deepEqual(events.slice(3),['frame clear',surface.cold,'operator forest'],'Every following frame also clears before painting transparent land.');
  assert.deepEqual(clears[1],[0,0,surface.canvas.width,surface.canvas.height]);
});

test('main operator source forwarding remains complete in both quality modes without old sprite limits',()=>{
  const sources=Array.from({length:600},(_,index)=>geographicPatch(`${400+index%30},${-20+Math.floor(index/30)}`));
  for(const quality of ['high','economy']) {
    const {surface,strokes,circles,images,heatCalls}=renderer(sources,{quality});
    const stats=surface.draw(1000);
    assert.equal(heatCalls[0].sites.length,sources.length);
    assert.equal(Object.hasOwn(heatCalls[0],'maxSprites'),false);
    assert.equal(stats.operatorFireDraws,sources.length);assert.equal(stats.operatorSmokeDraws,sources.length);
    assert.equal(stats.mapHeatSprites,sources.length);
    assert.equal(strokes.length,0);assert.equal(circles.length,0);
    assert.deepEqual(images.map(image=>image.source),[surface.cold]);
    assert.equal(stats.detailMarks,0);
  }
});

test('main operator wet-cell wash matches original strength, footprint and ordering',()=>{
  const source=geographicPatch('460,-4'),{surface,events,rectangles}=renderer([source]);
  surface.landPath={kind:'land clip'};
  const cells=new Map([['surface',{longitude:110.125,latitude:-.125,surfaceWetness:.8,moisture:.1}],
    ['deep',{longitude:112.125,latitude:-1.125,surfaceWetness:0,moisture:.6}],
    ['dry',{longitude:114.125,latitude:-2.125,surfaceWetness:0,moisture:0}]]);
  surface.setWetCells(cells);const stats=surface.draw(1000);
  assert.equal(rectangles.length,2);assert.equal(stats.wetCells,2);
  for(const [index,cell] of [...cells.values()].slice(0,2).entries()) {
    const alpha=Math.max(cell.surfaceWetness*.35,cell.moisture*.55);
    const expected=studyProject(surface,cell.longitude-.125,cell.latitude+.125);
    const scale=studyMapRect(surface.width,surface.height).width/48,size=(.25*scale+.2)*surface.scale;
    assert.equal(rectangles[index].color,`rgba(126, 171, 182, ${alpha})`);
    assert.ok(Math.hypot(rectangles[index].values[0]-expected[0],rectangles[index].values[1]-expected[1])<1e-8);
    assert.ok(Math.abs(rectangles[index].values[2]-size)<1e-8);assert.ok(Math.abs(rectangles[index].values[3]-size)<1e-8);
  }
  assert.ok(events.indexOf('wet clip')<events.indexOf('wet wash'));
  assert.ok(events.lastIndexOf('wet wash')<events.indexOf('operator forest'));
});

test('the lightweight phone map keeps its previous glow and core markers without an animated fire renderer', () => {
  const patches = mixedPatches();
  const { surface, circles, images, heatCalls } = renderer(patches, { mapHeat: false });
  const stats = surface.draw(1000);
  assert.equal(surface.surfaceHeat, null);
  assert.equal(heatCalls.length, 0);
  assert.equal(images.filter(image => image.source === surface.fireGlow).length, 2);
  assert.equal(images.filter(image => image.source === surface.atlas).length, 2, 'The existing prepared phone fissure atlas remains in use.');
  assert.deepEqual(circles.map(circle => circle.slice(0, 2)), patches.slice(0, 2).map(source => center(surface, source)));
  assert.ok(circles.every(circle => circle[2] > 0));
  assert.deepEqual([stats.activeMarkers, stats.emberMarkers, stats.outMarkers, stats.locatedMarkers], [1, 2, 1, 4]);
  assert.equal(stats.detailMarks, 2);
});

test('main and cached land canvases select transparency on their first context request while phones remain opaque', async () => {
  const previousDocument=globalThis.document,previousImage=globalThis.Image;
  function fakeCanvas() {
    const requests=[];
    return {width:1,height:1,style:{},dataset:{},requests,setAttribute(){},after(){},
      getContext(type,options) {requests.push({type,options});return {clearRect(){},fillRect(){}};}};
  }
  globalThis.document={createElement:()=>fakeCanvas()};
  globalThis.Image=class {set src(_value){queueMicrotask(()=>this.onload?.());}};
  try {
    const mainCanvas=fakeCanvas(),phoneCanvas=fakeCanvas();
    const main=new PeatSurface(mainCanvas),phone=new PeatSurface(phoneCanvas,{contactOverlay:false});
    // Skip loading and texture preparation; exercise actual first-context
    // selection and cached-surface preparation without decoding any images.
    for(const surface of [main,phone]) {
      surface.destroyed=true;
      surface._prepareHaze=()=>{};
      surface._prepareSurface();
    }
    await Promise.all([main.ready(),phone.ready()]);
    assert.deepEqual(mainCanvas.requests[0],{type:'2d',options:{alpha:true}});
    assert.deepEqual(main.cold.requests[0],{type:'2d',options:{alpha:true}});
    assert.deepEqual(phoneCanvas.requests[0],{type:'2d',options:{alpha:false}});
    assert.deepEqual(phone.cold.requests[0],{type:'2d',options:{alpha:false}});
  } finally {
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
    if(previousImage===undefined)delete globalThis.Image;else globalThis.Image=previousImage;
  }
});

test('cached main geography paints only Indonesia over transparent sea without a separate background or grain',()=>{
  const previousPath=globalThis.Path2D;
  globalThis.Path2D=class {
    constructor(){this.points=[];}
    moveTo(x,y){this.points.push([x,y]);}lineTo(x,y){this.points.push([x,y]);}closePath(){}
  };
  try {
    const requests=[],clears=[],fills=[],strokes=[],rectangles=[],images=[];
    let gradients=0;
    const context={
      clearRect(...values){clears.push(values);},fill(path,rule){fills.push({path,rule});},stroke(path){strokes.push(path);},
      fillRect(...values){rectangles.push(values);},drawImage(...values){images.push(values);},
      createLinearGradient(){gradients++;return {addColorStop(){}};},
    };
    const island=[[100,1],[101,1],[101,0],[100,0],[100,1]];
    const polygon=ring=>({type:'Feature',geometry:{type:'Polygon',coordinates:[ring]}});
    const surface=Object.create(PeatSurface.prototype);
    Object.assign(surface,{width:1000,height:450,scale:1.5,mapHeat:true,
      canvas:{width:1500,height:675},
      cold:{getContext(type,options){requests.push({type,options});return context;}},
      geography:{type:'FeatureCollection',features:[polygon(island)]},
      neighbors:{type:'FeatureCollection',features:[polygon([[143,0],[144,0],[144,-1],[143,-1],[143,0]])]},
      _prepareHaze(){},
    });
    surface._prepareSurface();
    assert.deepEqual(requests,[{type:'2d',options:{alpha:true}}]);
    assert.deepEqual(clears,[[0,0,1500,675]]);
    assert.deepEqual(surface.mapRect,studyMapRect(surface.width,surface.height));
    assert.equal(fills.length,1,'Neighboring countries must not be painted into the Indonesian display.');
    assert.equal(strokes.length,1);
    const expected=island.map(([longitude,latitude])=>studyProject(surface,longitude,latitude));
    assert.equal(fills[0].path.points.length,expected.length);
    assert.ok(fills[0].path.points.every((point,index)=>Math.hypot(point[0]-expected[index][0],point[1]-expected[index][1])<1e-8));
    assert.deepEqual(strokes[0].points,fills[0].path.points);
    assert.equal(rectangles.length,0,'The cache cannot paint an opaque rectangular sea or background.');
    assert.equal(gradients,0);assert.equal(images.length,0,'Stage-wide grain is not stamped into this half of the scene.');
    assert.equal(surface.operatorGrain,undefined);
  } finally {
    if(previousPath===undefined)delete globalThis.Path2D;else globalThis.Path2D=previousPath;
  }
});
