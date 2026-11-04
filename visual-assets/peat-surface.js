// Material study only: this renderer reads heat/wetness and never advances or
// predicts the shared simulation. Images are decoded once; expensive texture
// extraction, feathering and filters happen only while preparing cached assets.
import { countryMapRect, countryPath, studyMapRect } from '../country-view.mjs';
import { RainFeedback, RainContactTransitions } from './rain-feedback.js';
import { OperatorForest } from './surface-heat.js';
import { ExtinctionFeedback } from './extinction-feedback.js';
const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const MAX_PATCH_MARKS = 512;
const MATERIAL_URL = new URL('./peat-material.webp', import.meta.url).href;

function canvas(width, height) {
  const element = document.createElement('canvas');
  element.width = Math.max(1, Math.round(width));
  element.height = Math.max(1, Math.round(height));
  return element;
}
function seedFor(key) {
  let seed = 2166136261;
  for (const letter of String(key)) seed = Math.imul(seed ^ letter.charCodeAt(0), 16777619);
  return seed >>> 0;
}
function random(seed, index) {
  let value = Math.imul((seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0, 0x85ebca6b);
  value = Math.imul(value ^ value >>> 16, 0xc2b2ae35);
  return ((value ^ value >>> 13) >>> 0) / 4294967296;
}
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = async () => {
      try { if (image.decode) await image.decode(); resolve(image); }
      catch { reject(new Error('The peat material could not be decoded. Reload the study.')); }
    };
    image.onerror = () => reject(new Error('The peat study textures could not be loaded. Reload the study.'));
    image.src = url;
  });
}
function cover(context, image, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  const cropWidth = width / scale, cropHeight = height / scale;
  context.drawImage(image, (image.width - cropWidth) / 2, (image.height - cropHeight) / 2,
    cropWidth, cropHeight, 0, 0, width, height);
}

/** Surface flare responds quickly to wetness; residual embers follow heat.
 * Explicit extinction is the only successful-state signal. No touch can alter it.
 */
export function derivePeatState({ heat = 0, surfaceWetness = 0, extinguished = false } = {}) {
  if (extinguished) return { heat: 0, surface: 0, ember: 0, smoke: 0, agitation: 0 };
  const residual = clamp(heat), wetness = clamp(surfaceWetness);
  const surface = residual * (1 - wetness) ** 1.7;
  return {
    heat: residual,
    surface,
    ember: residual > 0 ? Math.max(.035, residual ** .72 * (.48 + wetness * .23)) : 0,
    smoke: residual * (.28 + .72 * (1 - wetness * .7)),
    agitation: surface * residual,
  };
}

export class PeatSurface {
  constructor(element, { quality = 'auto', reducedMotion = false, maxPixels = 1920 * 1080, maxPixelRatio = 1.5, materialUrl = MATERIAL_URL, contactOverlay = true, mapHeat } = {}) {
    this.canvas = element;
    this.contactOverlay = contactOverlay !== false;
    this.mapHeat = mapHeat === undefined ? this.contactOverlay : Boolean(mapHeat);
    this.context = element.getContext('2d', { alpha: this.mapHeat });
    if (!this.context) throw new Error('The material study requires a 2D canvas.');
    this.contactCanvas = canvas(1, 1);
    this.contactCanvas.className = 'peat-contact-overlay';
    this.contactCanvas.setAttribute('aria-hidden', 'true');
    this.contactCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    // The main map reuses the operator's procedural burned-forest assets.
    // Phone maps keep their existing lightweight markers.
    this.surfaceHeat = this.mapHeat ? new OperatorForest() : null;
    if (this.contactOverlay) element.after(this.contactCanvas);
    this.maxPixels = Math.max(1, Number.isFinite(maxPixels) ? maxPixels : 1920 * 1080);
    this.maxPixelRatio = Math.max(.5, Number.isFinite(maxPixelRatio) ? maxPixelRatio : 1.5);
    this.selection = null;
    this.contactContext = this.contactCanvas.getContext('2d');
    this.rainFeedback = new RainFeedback();
    this.extinctionFeedback = new ExtinctionFeedback();
    this.contactTransitions = this.mapHeat ? new RainContactTransitions() : null;
    this.contactAnimationPending = false;
    this.geography = null;
    this.neighbors = null;
    this.wetCells = null;
    this.mapRect = countryMapRect(1, 1);
    this.quality = ['auto', 'high', 'economy'].includes(quality) ? quality : 'auto';
    this.reducedMotion = Boolean(reducedMotion);
    this.patches = [];
    this.contacts = [];
    this.atlasCount = 16;
    this.patchMemory = new Map();
    this.width = this.height = 1;
    this.scale = 1;
    this.loaded = false;
    this.destroyed = false;
    this.hazeLevel = 0;
    this.hazeAt = -Infinity;
    this.lastAdaptAt = 0;
    this.slowFrames = 0;
    this.fastFrames = 0;
    this.drawAverage = 0;
    this.lastDrawAt = null;
    this.cold = canvas(1, 1);
    this.haze = canvas(1, 1);
    this.stats = { drawMs: 0, contactDrawMs: 0, hazeUpdated: false, frames: 0, hazeFrames: 0,
      pixelWidth: 1, pixelHeight: 1, quality: this.quality, patchCount: 0, detailMarks: 0,
      smokeEmitters: 0, hazeWidth: 1, hazeHeight: 1, adapted: false,
      mapHeatEnabled: this.mapHeat, mapHeatSprites: 0, mapHeatAnchorDrift: 0, mapHeatMaxTipMotion: 0 };
    this._ready = Promise.all([this.mapHeat ? null : loadImage(materialUrl), this.rainFeedback.ready(), this.surfaceHeat?.ready()]).then(([material]) => {
      if (this.destroyed) return this;
      this.material = material;
      if (!this.mapHeat) this._prepareAtlas();
      this.loaded = true;
      this._prepareSurface();
      return this;
    });
  }

  ready() { return this._ready; }

  setGeography(geojson, neighbors = null) { this.geography = geojson; this.neighbors = neighbors; this._prepareSurface(); }

  setWetCells(cells) { this.wetCells = cells; }

  resize(width, height) {
    this.width = Math.max(1, Number.isFinite(width) ? width : 1);
    this.height = Math.max(1, Number.isFinite(height) ? height : 1);
    const economy = this.quality === 'economy';
    const maxPixels = economy ? Math.min(1280 * 720, this.maxPixels) : this.maxPixels;
    const density = Math.min(globalThis.devicePixelRatio || 1, economy ? 1 : this.maxPixelRatio);
    this.scale = Math.min(density, Math.sqrt(maxPixels / (this.width * this.height)));
    const pixelWidth = Math.max(1, Math.floor(this.width * this.scale));
    const pixelHeight = Math.max(1, Math.floor(this.height * this.scale));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth; this.canvas.height = pixelHeight;
      if (this.contactOverlay) { this.contactCanvas.width = pixelWidth; this.contactCanvas.height = pixelHeight; }
    }
    Object.assign(this.stats, { pixelWidth, pixelHeight });
    this._prepareSurface();
  }

  setQuality(value) {
    const next = ['auto', 'high', 'economy'].includes(value) ? value : 'auto';
    if (next === this.quality) return;
    this.quality = next;
    this.hazeLevel = 0;
    this.slowFrames = this.fastFrames = 0;
    this.stats.quality = next;
    this.stats.adapted = false;
    this.resize(this.width, this.height);
  }

  setReducedMotion(value) {
    this.reducedMotion = Boolean(value);
    this.hazeAt = -Infinity;
  }

  setPatches(patches) {
    const retained = new Set();
    this.patches = (Array.isArray(patches) ? patches : []).filter(patch =>
      patch && [patch.x, patch.y, patch.width, patch.height].every(Number.isFinite) &&
      patch.width > 0 && patch.height > 0 && patch.x < 1 && patch.y < 1 &&
      patch.x + patch.width > 0 && patch.y + patch.height > 0).map(patch => {
      const key = String(patch.key);
      retained.add(key);
      let memory = this.patchMemory.get(key);
      if (!memory) {
        const seed = seedFor(key);
        memory = { seed, phase: random(seed, 1) * Math.PI * 2, atlas: seed % this.atlasCount,
          display: derivePeatState(patch) };
        this.patchMemory.set(key, memory);
      }
      return { ...patch, key, memory };
    });
    for (const key of this.patchMemory.keys()) if (!retained.has(key)) this.patchMemory.delete(key);
    this.stats.patchCount = this.patches.length;
    // This only chooses visual detail. Every participant's water remains in the
    // authoritative model, irrespective of rendering quality or atmosphere detail.
    this.markPatches = this.patches;
    if (this.reducedMotion) this.hazeAt = -Infinity;
  }

  setSelection(point) {
    this.selection = Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) ? point.map(clamp) : null;
  }

  setContacts(contacts, now = performance.now()) {
    // A few shared contact stamps carry collective presence without making
    // graphics cost proportional to an unbounded audience.
    this.contacts = (Array.isArray(contacts) ? contacts : []).filter(contact =>
      contact && Number.isFinite(contact.x) && Number.isFinite(contact.y) && contact.active !== false)
      .sort((a, b) => Number(Boolean(b.local)) - Number(Boolean(a.local))).slice(0, 256);
    this.contactTransitions?.update(this.contacts, now, { reducedMotion: this.reducedMotion });
  }

  getVisualContacts(now = performance.now()) {
    return this.contactTransitions?.sample(now, { reducedMotion: this.reducedMotion }) || this.contacts;
  }

  hasContactAnimation(now = performance.now()) {
    return Boolean(this.contactAnimationPending || this.contactTransitions?.hasAnimation(now) || this.extinctionFeedback.hasAnimation(now));
  }

  _prepareAtlas() {
    const size = 96;
    this.atlasSize = size;
    this.atlasCount = 16;
    this.atlas = canvas(size * this.atlasCount, size);
    const context = this.atlas.getContext('2d', { willReadFrequently: true });
    // The fissure shape comes from the generated image itself. Pixel work runs
    // once on this small atlas; animation later changes only placement/opacity.
    for (let index = 0; index < this.atlasCount; index++) {
      const crop = Math.min(this.material.width, this.material.height) * .42;
      const sourceX = random(index + 37, 2) * (this.material.width - crop);
      const sourceY = random(index + 37, 3) * (this.material.height - crop);
      context.drawImage(this.material, sourceX, sourceY, crop, crop, index * size, 0, size, size);
    }
    const pixels = context.getImageData(0, 0, this.atlas.width, size);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const x = (index / 4) % this.atlas.width, localX = (x % size) / size;
      const y = Math.floor(index / 4 / this.atlas.width) / size;
      const red = pixels.data[index], green = pixels.data[index + 1], blue = pixels.data[index + 2];
      const warmth = Math.max(0, red - Math.max(green, blue) * 1.02);
      const dx = (localX - .5) * 2, dy = (y - .5) * 2;
      const feather = Math.max(0, 1 - (dx * dx + dy * dy) ** .65) ** .75;
      // Preserve photographed fissure shapes while lifting their copper into
      // the projector's readable range. Scaling a dark source crack down to a
      // small patch otherwise makes it disappear against the ash texture.
      const warmthRatio = warmth / Math.max(1, red);
      const emberAlpha = clamp((warmth - 2) / 27) * clamp((warmthRatio - .08) / .32);
      const strength = clamp(warmth / 55);
      pixels.data[index] = Math.min(245, 130 + red * .85 + strength * 30);
      pixels.data[index + 1] = Math.min(145, 44 + green * .8 + strength * 24);
      pixels.data[index + 2] = Math.min(65, 18 + blue * .35);
      pixels.data[index + 3] *= emberAlpha * feather;
    }
    context.putImageData(pixels, 0, 0);

    // A single cached glow carries all geographic source markers. Per-frame
    // work stays at bounded image stamps and tiny cores, not new gradients.
    this.fireGlow = canvas(64, 64);
    const glow = this.fireGlow.getContext('2d');
    const gradient = glow.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, '#ffb94bd9'); gradient.addColorStop(.18, '#f65720bb');
    gradient.addColorStop(.48, '#cb2d1355'); gradient.addColorStop(1, '#9f150400');
    glow.fillStyle = gradient; glow.fillRect(0, 0, 64, 64);

    this.contactStamp = canvas(128, 128);
    const contact = this.contactStamp.getContext('2d', { willReadFrequently: true });
    contact.filter = 'grayscale(1) brightness(1.7)';
    cover(contact, this.material, 128, 128);
    contact.filter = 'none';
    const dust = contact.getImageData(0, 0, 128, 128);
    for (let index = 0; index < dust.data.length; index += 4) {
      const x = (index / 4 % 128 - 63.5) / 64, y = (Math.floor(index / 4 / 128) - 63.5) / 64;
      dust.data[index + 3] *= Math.max(0, 1 - (x * x + y * y) ** .65) ** 2;
    }
    contact.putImageData(dust, 0, 0);
  }

  _prepareSurface() {
    const width = this.canvas.width, height = this.canvas.height;
    this.cold.width = width; this.cold.height = height;
    const context = this.cold.getContext('2d', { alpha: this.mapHeat });
    this.mapRect = this.mapHeat ? studyMapRect(this.width, this.height) : countryMapRect(this.width, this.height, Math.min(34, this.width * .035));
    this.pixelMapRect = Object.fromEntries(Object.entries(this.mapRect).map(([key, value]) => [key, value * this.scale]));
    this.landPath = this.geography ? countryPath(this.geography, this.pixelMapRect) : null;
    if (this.mapHeat) {
      // The stage owns one continuous background and grain layer. Transparent
      // sea here prevents this half-canvas from creating a horizontal edge.
      context.clearRect(0, 0, width, height);
      for (const [geography, fill, stroke, lineWidth] of [[this.geography, '#806254', '#bc9380', .75]]) {
        if (!geography) continue;
        const features = geography.type === 'FeatureCollection' ? geography.features : [geography];
        for (const feature of features) {
          const path = countryPath(feature, this.pixelMapRect);
          context.fillStyle = fill; context.fill(path, 'evenodd');
          context.strokeStyle = stroke; context.lineWidth = lineWidth * this.scale; context.stroke(path);
        }
      }
      this._prepareHaze();
      return;
    }
    // The country is a navigation surface: quiet sea, readable burned land.
    // The fiery material belongs to known source positions, never to the sea.
    context.fillStyle = '#080b0c'; context.fillRect(0, 0, width, height);
    if (this.landPath) {
      context.save(); context.clip(this.landPath, 'evenodd');
      context.fillStyle = '#4c4840'; context.fillRect(0, 0, width, height);
      if (this.loaded) {
        context.globalAlpha = .52;
        context.filter = 'grayscale(1) brightness(.8) contrast(.75)';
        cover(context, this.material, width, height);
        context.filter = 'none'; context.globalAlpha = 1;
        context.fillStyle = '#4b3e3023'; context.fillRect(0, 0, width, height);
      }
      context.restore();
      context.strokeStyle = '#b9aa9185'; context.lineWidth = Math.max(.65, this.scale * .8); context.stroke(this.landPath);
    }
    this._prepareHaze();
  }

  _prepareHaze() {
    const economy = this.quality === 'economy';
    const longSide = economy ? 360 : this.hazeLevel === 0 ? 640 : this.hazeLevel === 1 ? 480 : 320;
    const scale = Math.min(1, longSide / Math.max(this.width, this.height));
    this.haze.width = Math.max(1, Math.round(this.width * scale));
    this.haze.height = Math.max(1, Math.round(this.height * scale));
    this.hazeAt = -Infinity;
    this._prepareGrain();
    Object.assign(this.stats, { hazeWidth: this.haze.width, hazeHeight: this.haze.height });
  }

  _prepareGrain() {
    // Grain is generated once at the small atmosphere resolution. It is a
    // continuous field, without image emitters, lifetime resets or puff edges.
    this.grain = canvas(this.haze.width, this.haze.height);
    const context = this.grain.getContext('2d');
    const pixels = context.createImageData(this.grain.width, this.grain.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const value = random(47271, index / 4);
      pixels.data[index] = value > .48 ? 255 : 57;
      pixels.data[index + 1] = value > .48 ? 119 : 11;
      pixels.data[index + 2] = value > .48 ? 35 : 5;
      pixels.data[index + 3] = Math.round(23 + Math.abs(value - .5) * 76);
    }
    context.putImageData(pixels, 0, 0);
  }

  _drawHaze(now) {
    const context = this.haze.getContext('2d');
    const width = this.haze.width, height = this.haze.height;
    context.clearRect(0, 0, width, height);
    const time = this.reducedMotion ? 0 : now / 1000;
    const cells = new Map();
    let total = 0;
    for (const patch of this.patches) {
      const state = patch.memory.display;
      const amount = state.ember * .35 + state.surface * .65;
      total += amount;
      if (amount < .008) continue;
      const x = (this.mapRect.x + clamp(patch.x + patch.width / 2) * this.mapRect.width) / this.width;
      const y = (this.mapRect.y + clamp(patch.y + patch.height / 2) * this.mapRect.height) / this.height;
      // Fine stable bins keep atmosphere close to the sources. There is no
      // country-wide ambient wash to imply that every island or sea is alight.
      const column = Math.min(23, Math.floor(x * 24)), row = Math.min(9, Math.floor(y * 10));
      const key = `${column},${row}`;
      let cell = cells.get(key);
      if (!cell) { cell = { x: 0, y: 0, weight: 0, amount: 0, count: 0 }; cells.set(key, cell); }
      cell.x += x * amount; cell.y += y * amount; cell.weight += amount;
      cell.amount += amount; cell.count++;
    }
    const mean = total / Math.max(1, this.patches.length);
    context.globalCompositeOperation = 'screen';
    for (const [key, cell] of cells) {
      const seed = seedFor(key), phase = random(seed, 3) * Math.PI * 2;
      const driftX = this.reducedMotion ? 0 : Math.sin(time * .08 + phase) * width * .0015;
      const driftY = this.reducedMotion ? 0 : Math.cos(time * .06 + phase) * height * .003;
      const x = cell.x / cell.weight * width + driftX, y = cell.y / cell.weight * height + driftY;
      const amount = cell.amount / Math.max(1, cell.count);
      const radius = Math.max(5, width * (.015 + random(seed, 4) * .008));
      const breath = this.reducedMotion ? 1 : .95 + Math.sin(time * .19 + phase) * .05;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(246,71,17,${amount * .19 * breath})`);
      gradient.addColorStop(.4, `rgba(204,35,8,${amount * .10 * breath})`);
      gradient.addColorStop(1, 'rgba(110,12,3,0)');
      context.fillStyle = gradient; context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    // Grain is masked by the local heat atmosphere, so the ocean stays quiet.
    context.globalCompositeOperation = 'source-atop';
    if (this.grain && mean > .001) {
      context.globalAlpha = .38; context.drawImage(this.grain, 0, 0);
      if (!this.reducedMotion) {
        context.globalAlpha = .12 + Math.sin(time * .37) * .04;
        context.drawImage(this.grain, -7, -5, width + 14, height + 10);
      }
    }
    context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
    this.hazeAt = now; this.stats.hazeFrames++;
    this.stats.smokeEmitters = 0; this.stats.hazeCells = cells.size; this.stats.hazeHeat = mean;
  }

  _smoothDisplay(now) {
    const dt = this.lastDrawAt === null ? 0 : Math.min(.2, Math.max(0, (now - this.lastDrawAt) / 1000));
    this.lastDrawAt = now;
    for (const patch of this.patches) {
      const target = derivePeatState(patch), display = patch.memory.display;
      for (const key of ['heat', 'surface', 'ember', 'smoke', 'agitation']) {
        // Surface darkens promptly under accepted rain. Deep glow and the wide
        // atmosphere retain a quiet tail, even after explicit extinction.
        const seconds = key === 'surface' ? .26 : key === 'smoke' ? 3.4 : 1.4;
        const amount = this.reducedMotion ? 1 : 1 - Math.exp(-dt / seconds);
        display[key] += (target[key] - display[key]) * amount;
        if (Math.abs(display[key] - target[key]) < .0001) display[key] = target[key];
      }
    }
  }

  _drawOperator(now = performance.now()) {
    const started = performance.now();
    if (this.destroyed || !this.loaded) return this.stats;
    const context = this.context, width = this.canvas.width, height = this.canvas.height;
    const rect = this.pixelMapRect, density = this.scale, operatorScale = rect.width / 48 / density;
    context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, width, height);
    context.drawImage(this.cold, 0, 0);
    let wetCells = 0;
    if (this.landPath) {
      context.save(); context.clip(this.landPath, 'evenodd');
      for (const cell of this.wetCells?.values?.() || this.patches) {
        const alpha = Math.max(clamp(cell.surfaceWetness) * .35, clamp(cell.moisture) * .55);
        if (alpha < .004) continue;
        const longitude = cell.longitude ?? cell.geo?.[0], latitude = cell.latitude ?? cell.geo?.[1];
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
        const x = rect.x + (longitude - .125 - 94) / 48 * rect.width;
        const y = rect.y + (7 - latitude - .125) / 19 * rect.height;
        const size = .25 * operatorScale * density;
        context.fillStyle = `rgba(126, 171, 182, ${alpha})`;
        context.fillRect(x, y, size + .2 * density, size + .2 * density); wetCells++;
      }
      context.restore();
    }
    let activeMarkers = 0, emberMarkers = 0, outMarkers = 0;
    const sites = this.patches.map(patch => {
      const [gridX, gridY] = patch.key.split(',').map(Number);
      const seed = Number.isFinite(gridX) && Number.isFinite(gridY) ?
        (Math.imul(gridX, 73856093) ^ Math.imul(gridY, 19349663)) >>> 0 : patch.memory.seed;
      const heat = clamp(patch.heat), wetness = clamp(patch.surfaceWetness);
      if (patch.extinguished) outMarkers++;
      else if (heat * (1 - .95 * wetness) > .1) activeMarkers++;
      else emberMarkers++;
      return { id: patch.key,
        x: rect.x + (patch.x + patch.width / 2) * rect.width,
        y: rect.y + (patch.y + patch.height / 2) * rect.height,
        heat, surfaceWetness: wetness, extinguished: Boolean(patch.extinguished), seed };
    });
    const forest = this.surfaceHeat.drawSites(context, { sites, now, reducedMotion: this.reducedMotion,
      scale: density, bounds: rect, operatorMapScale: operatorScale });
    if (this.selection) {
      context.save(); context.strokeStyle = '#f5e1bf'; context.globalAlpha = .7; context.lineWidth = density;
      context.beginPath(); context.arc(rect.x + this.selection[0] * rect.width, rect.y + this.selection[1] * rect.height,
        rect.width * .85 / 48, 0, Math.PI * 2); context.stroke(); context.restore();
    }
    Object.assign(this.stats, { drawMs: performance.now() - started, frames: this.stats.frames + 1,
      activeMarkers, emberMarkers, outMarkers, locatedMarkers: sites.length, detailMarks: 0, wetCells,
      quality: this.quality, mapHeatSprites: forest.visibleSites, mapHeatAnchorDrift: 0,
      mapHeatMaxTipMotion: 0, mapHeatPhaseAdvance: 0, mapHeatShapeChange: 0,
      mapHeatTextureDraws: forest.textureDraws, mapHeatSlots: forest.drawSlots,
      mapHeatRetiring: 0, mapHeatPending: 0, operatorTerrainSources: forest.terrainSourceCount,
      operatorTerrainBuilds: forest.terrainBuilds, operatorFireDraws: forest.fireDraws,
      operatorSmokeDraws: forest.smokeDraws, operatorTimeAdvance: forest.operatorTimeAdvance,
      mapHeatDrawMs: forest.drawMs });
    if (this.stats.frames === 1 || this.stats.frames % 30 === 0) {
      for (const key of ['drawMs', 'frames', 'activeMarkers', 'emberMarkers', 'outMarkers', 'locatedMarkers', 'wetCells', 'operatorTerrainSources', 'operatorTerrainBuilds', 'operatorFireDraws', 'operatorSmokeDraws', 'operatorTimeAdvance']) {
        this.canvas.dataset[key] = String(Math.round((this.stats[key] || 0) * 1000) / 1000);
      }
      this.canvas.dataset.mapAsset = 'original-operator'; this.canvas.dataset.mapMarkerShape = 'operator-forest';
      this.canvas.dataset.renderQuality = this.quality;
      this.canvas.dataset.operatorMapScale = operatorScale.toFixed(4);
    }
    return this.stats;
  }

  draw(now = performance.now()) {
    if (this.mapHeat) return this._drawOperator(now);
    const started = performance.now();
    if (this.destroyed || !this.loaded) return this.stats;
    const context = this.context;
    const width = this.canvas.width, height = this.canvas.height;
    const time = this.reducedMotion ? 0 : now / 1000;
    this._smoothDisplay(now);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.drawImage(this.cold, 0, 0);
    context.save();
    context.globalCompositeOperation = 'screen';
    let marks = 0, activeMarkers = 0, emberMarkers = 0, outMarkers = 0;
    const heatSites = this.surfaceHeat ? [] : null;
    const detailLimit = this.quality === 'economy' || this.hazeLevel > 1 ? 256 : MAX_PATCH_MARKS;
    for (const patch of this.markPatches || []) {
      const state = patch.memory.display;
      const { phase, seed, atlas } = patch.memory;
      const centerX = this.pixelMapRect.x + (patch.x + patch.width / 2) * this.pixelMapRect.width;
      const centerY = this.pixelMapRect.y + (patch.y + patch.height / 2) * this.pixelMapRect.height;
      if (heatSites) {
        const [gridX, gridY] = patch.key.split(',').map(Number);
        const operatorSeed = Number.isFinite(gridX) && Number.isFinite(gridY) ?
          (Math.imul(gridX, 73856093) ^ Math.imul(gridY, 19349663)) >>> 0 : seed;
        heatSites.push({ id: patch.key, x: centerX, y: centerY, activity: state.surface,
          heat: state.heat, surfaceWetness: patch.surfaceWetness,
          seed: operatorSeed, ember: state.ember, calm: patch.surfaceWetness, extinguished: patch.extinguished });
      }
      if (patch.extinguished && state.ember < .018) {
        // Extinguished sites remain legible as small ash scars, not hot dots.
        context.globalAlpha = .55; context.fillStyle = '#7f796c';
        context.fillRect(centerX - this.scale, centerY - this.scale, this.scale * 2, this.scale * 2);
        outMarkers++; continue;
      }
      const pulse = this.reducedMotion ? 1 : .94 + Math.sin(time * (1.5 + state.agitation * 2) + phase) * .06;
      const intensity = clamp(state.ember * .65 + state.surface * .65);
      if (intensity < .002) {
        // Rounded near-zero heat is not an extinction signal. Keep a dim
        // rust point until the authoritative out flag permits an ash scar.
        context.globalAlpha = .4; context.fillStyle = '#985032';
        context.fillRect(centerX - this.scale * .7, centerY - this.scale * .7, this.scale * 1.4, this.scale * 1.4);
        emberMarkers++; continue;
      }
      const cellSize = this.pixelMapRect.width * .25 / 48;
      const glowRadius = Math.max(6 * this.scale, cellSize * 2.2);
      const surfaceFire = state.surface > .25;
      if (marks < detailLimit && !this.mapHeat) {
        context.globalAlpha = intensity * .8 * pulse;
        context.drawImage(this.fireGlow, centerX - glowRadius, centerY - glowRadius, glowRadius * 2, glowRadius * 2);
        const markWidth = Math.max(11 * this.scale, cellSize * (2 + random(seed, 4) * .8));
        const markHeight = Math.max(10 * this.scale, cellSize * (1.7 + random(seed, 5) * .8));
        context.globalAlpha = intensity * .68;
        context.drawImage(this.atlas, atlas * this.atlasSize, 0, this.atlasSize, this.atlasSize,
          centerX - markWidth / 2, centerY - markHeight / 2, markWidth, markHeight);
        marks++;
      }
      // Every source stays marked, including sources outside the rich-texture
      // budget. Hot main-map sources use a small copper crack instead of a
      // circular glow; the moving ember fibres carry their visible fire.
      if (this.mapHeat) {
        context.globalAlpha = Math.max(.15, intensity * .7);
        context.strokeStyle = surfaceFire ? '#bb562b' : '#9c3e20'; context.lineWidth = .85 * this.scale;
        context.beginPath(); context.moveTo(centerX - 1.15 * this.scale, centerY + .35 * this.scale);
        context.lineTo(centerX, centerY); context.lineTo(centerX + .8 * this.scale, centerY - .6 * this.scale); context.stroke();
      } else {
        const radius = (surfaceFire ? 1.2 + state.surface * 1.25 : .9 + state.ember * .7) * this.scale;
        context.globalAlpha = Math.max(.22, intensity) * pulse;
        context.fillStyle = surfaceFire ? '#ffd085' : '#d65a29';
        context.beginPath(); context.arc(centerX, centerY, radius, 0, Math.PI * 2); context.fill();
      }
      if (surfaceFire) activeMarkers++; else emberMarkers++;
    }
    context.restore();
    context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1;
    const hazeInterval = this.quality === 'economy' || this.hazeLevel > 1 ? 1000 / 8 : 1000 / 12;
    const hazeUpdated = now - this.hazeAt >= hazeInterval && (!this.reducedMotion || this.hazeAt === -Infinity);
    if (hazeUpdated) this._drawHaze(now);
    context.drawImage(this.haze, 0, 0, width, height);
    // Operator forest terrain/fire share the original source coordinates.
    // The stage-owned overlapping atmosphere remains above this canvas.
    if (this.surfaceHeat) {
      const heatStats = this.surfaceHeat.drawSites(context, { sites: heatSites, now,
        reducedMotion: this.reducedMotion, scale: this.scale, bounds: this.pixelMapRect,
        maxSprites: this.quality === 'economy' || this.hazeLevel > 1 ? 128 : 192 });
      Object.assign(this.stats, { mapHeatSprites: heatStats.visibleSites,
        mapHeatAnchorDrift: heatStats.anchorDrift, mapHeatMaxTipMotion: heatStats.maxTipMotion,
        mapHeatPhaseAdvance: heatStats.phaseAdvance, mapHeatShapeChange: heatStats.shapeChange,
        mapHeatTextureDraws: heatStats.textureDraws, mapHeatSlots: heatStats.drawSlots,
        mapHeatRetiring: heatStats.retiringSites, mapHeatPending: heatStats.pendingSites,
        operatorTerrainSources: heatStats.terrainSourceCount || 0,
        operatorTerrainBuilds: heatStats.terrainBuilds || 0,
        operatorFireDraws: heatStats.fireDraws || 0,
        operatorTimeAdvance: heatStats.operatorTimeAdvance || 0,
        mapHeatDrawMs: heatStats.drawMs });
    }
    if (this.selection) {
      const x = this.pixelMapRect.x + this.selection[0] * this.pixelMapRect.width;
      const y = this.pixelMapRect.y + this.selection[1] * this.pixelMapRect.height;
      const radius = this.pixelMapRect.width * .85 / 48;
      context.strokeStyle = '#f5e1bf'; context.globalAlpha = .7; context.lineWidth = this.scale;
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.stroke();
      context.globalAlpha = 1;
    }
    Object.assign(this.stats, { activeMarkers, emberMarkers, outMarkers, locatedMarkers: activeMarkers + emberMarkers + outMarkers });
    const drawMs = performance.now() - started;
    Object.assign(this.stats, { drawMs, hazeUpdated, frames: this.stats.frames + 1,
      detailMarks: marks, quality: this.quality, adapted: this.hazeLevel > 0 });
    this._adapt(drawMs, now);
    if (this.stats.frames === 1 || this.stats.frames % 30 === 0) {
      for (const key of ['drawMs', 'contactDrawMs', 'frames', 'pixelWidth', 'pixelHeight', 'hazeWidth', 'hazeHeight', 'smokeEmitters', 'detailMarks', 'activeMarkers', 'emberMarkers', 'outMarkers', 'locatedMarkers', 'mapHeatSprites', 'mapHeatAnchorDrift', 'mapHeatMaxTipMotion', 'mapHeatPhaseAdvance', 'mapHeatShapeChange', 'mapHeatTextureDraws', 'mapHeatSlots', 'mapHeatRetiring', 'mapHeatPending', 'operatorTerrainSources', 'operatorTerrainBuilds', 'operatorFireDraws', 'operatorTimeAdvance']) {
        this.canvas.dataset[key] = String(Math.round(this.stats[key] * 1000) / 1000);
      }
      this.canvas.dataset.renderQuality = this.quality;
      this.canvas.dataset.hazeAdapted = String(this.hazeLevel > 0);
      this.canvas.dataset.mapMarkerShape = this.mapHeat ? 'operator-forest' : 'core';
      this.canvas.dataset.mapAsset = this.mapHeat ? 'operator-forest' : 'phone-material';
    }
    return this.stats;
  }

  drawContacts(now = performance.now()) {
    const started = performance.now();
    const context = this.contactContext, width = this.contactCanvas.width, height = this.contactCanvas.height;
    context.clearRect(0, 0, width, height);
    if (!this.loaded || this.destroyed) return 0;
    const visualContacts = this.getVisualContacts(now);
    this.contactAnimationPending = visualContacts.some(contact => contact.envelope &&
      (contact.envelope.releasing || contact.envelope.attackProgress < 1));
    context.save(); context.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    for (const [index, contact] of visualContacts.entries()) {
      if (index >= 64) {
        // All accepted users retain a precise footprint. Bound the expensive
        // animated cloud/rain layer independently of the room's connection cap.
        context.globalAlpha = contact.envelope?.footprintOpacity ?? 1;
        context.strokeStyle = contact.color || '#d8edf0'; context.lineWidth = 1.3;
        const x = this.mapRect.x + clamp(contact.x) * this.mapRect.width, y = this.mapRect.y + clamp(contact.y) * this.mapRect.height;
        const radius = this.mapRect.width * .85 / 48;
        context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.stroke();
        if (contact.label && context.fillText) {
          context.fillStyle = contact.color || '#d8edf0'; context.font = '600 9px ui-monospace, monospace';
          context.textAlign = x < this.width - radius - 30 ? 'left' : 'right'; context.textBaseline = 'middle';
          context.fillText(contact.label, x + (context.textAlign === 'left' ? 1 : -1) * (radius + 4), y);
        }
        continue;
      }
      this.rainFeedback.draw(context, {
        ...contact,
        x: this.mapRect.x + clamp(contact.x) * this.mapRect.width,
        y: this.mapRect.y + clamp(contact.y) * this.mapRect.height,
        radius: this.mapRect.width * .85 / 48, now,
        strength: contact.strength ?? .5, reducedMotion: this.reducedMotion,
        label: contact.label || '',
        local: contact.local, preview: Boolean(contact.preview),
        bold: this.mapHeat,
        bounds: { left: 0, top: 0, right: this.width, bottom: this.height },
      });
    }
    this.stats.extinctionCues = this.extinctionFeedback.draw(context, { rect: this.mapRect, now, reducedMotion: this.reducedMotion });
    context.restore();
    context.globalAlpha = 1;
    this.stats.contactDrawMs = performance.now() - started;
    this.stats.visibleClouds = Math.min(64, visualContacts.length);
    this.stats.contactMarkers = visualContacts.length;
    this.canvas.dataset.visibleClouds = String(this.stats.visibleClouds);
    this.canvas.dataset.contactMarkers = String(this.stats.contactMarkers);
    this.canvas.dataset.rainTransition = this.contactAnimationPending ? 'animating' : 'settled';
    this.canvas.dataset.extinctionCues = String(this.stats.extinctionCues);
    return this.stats.contactDrawMs;
  }

  _adapt(drawMs, now) {
    this.drawAverage = this.drawAverage ? this.drawAverage * .94 + drawMs * .06 : drawMs;
    if (this.quality !== 'auto') return;
    this.slowFrames = this.drawAverage > 9 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
    this.fastFrames = this.drawAverage < 4 ? this.fastFrames + 1 : 0;
    if (now - this.lastAdaptAt < 5000) return;
    if (this.slowFrames > 30 && this.hazeLevel < 2) {
      this.hazeLevel++; this.slowFrames = 0; this.lastAdaptAt = now; this._prepareHaze();
    } else if (this.fastFrames > 450 && this.hazeLevel > 0 && now - this.lastAdaptAt > 20000) {
      this.hazeLevel--; this.fastFrames = 0; this.lastAdaptAt = now; this._prepareHaze();
    }
  }

  destroy() {
    this.destroyed = true;
    this.contacts = []; this.patches = []; this.patchMemory.clear();
    this.contactTransitions?.clear();
    this.surfaceHeat?.destroy?.();
    this.surfaceHeat?.siteMemory?.clear();
    this.contactCanvas.remove();
    for (const bitmap of [this.cold, this.haze, this.grain, this.operatorGrain, this.atlas, this.contactStamp, this.fireGlow]) {
      if (bitmap) { bitmap.width = 1; bitmap.height = 1; }
    }
  }
}
