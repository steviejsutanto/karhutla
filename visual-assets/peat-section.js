// An abstract section through the shared source patches. Depth is a visual
// interpretation of model heat/wetness, never another physics simulation.
// Grain fields and the local surface-heat atlas are cached. The renderers use
// caller-owned clocks, without smoke sprites or independent animation loops.
import { SurfaceHeat } from './surface-heat.js';
const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const coordinate = patch => Array.isArray(patch?.geo) ? patch.geo : [patch?.longitude, patch?.latitude];
const cellKey = geo => `${Math.floor(geo[0] / .25)},${Math.floor(geo[1] / .25)}`;


// A depth profile for the artwork, derived entirely from confirmed model
// values. This is deliberately not a second water/heat simulation. Surface
// wetness stops the flare promptly; absorption and confirmed heat loss move
// a cooling front through the peat, leaving deep embers behind it.
function progression(patch = {}) {
  const heat = patch.extinguished ? 0 : clamp(patch.heat);
  const wet = clamp(patch.surfaceWetness), moisture = clamp(patch.moisture);
  const front = Math.min(1.18, moisture * (.06 + (1 - heat) * 1.32));
  const flame = heat * (1 - wet) ** 2.2;
  return { heat, wet, moisture, front, flame, residual: heat ** .28,
    surfaceEmber: heat ** .62 * (.22 + .55 * (1 - flame)) * (1 - wet * .58) };
}
function frontCooling(front, wet, depth) {
  const t = clamp((front - depth) / .20 + .5);
  const frontAmount = t * t * (3 - 2 * t) * clamp(front / .06);
  const skin = wet * Math.exp(-Math.max(0, depth) * 42);
  return Math.max(skin, frontAmount);
}
export function derivePeatDepthState(patch = {}, depth = 0) {
  const state = progression(patch), d = clamp(depth);
  const cooling = frontCooling(state.front, state.wet, d);
  const ember = state.residual * (1 - cooling * .97);
  return { heat: state.heat, depth: d, cooling, coolingFront: clamp(state.front),
    ember, flame: d === 0 ? state.flame : 0, surfaceEmber: d === 0 ? state.surfaceEmber : 0,
    stage: patch.extinguished ? 'out' : state.flame > .15 ? 'fire' : state.heat > .15 ? 'ember' : 'cooling' };
}

// Haze agitation is decorative. Contact can quiet the air immediately but
// never changes the authoritative heat, moisture or extinction state.
export function derivePeatAtmosphereState({ heat = 0, surfaceWetness = 0, extinguished = false, contact = 0, reducedMotion = false } = {}) {
  const warmth = extinguished ? 0 : clamp(heat);
  const calm = Math.max(clamp(surfaceWetness), clamp(contact));
  const activity = warmth * (1 - calm) ** 2;
  return { heat: warmth, calm, agitation: reducedMotion ? 0 : activity,
    density: warmth * (.22 + .78 * (1 - calm)),
    drift: reducedMotion ? 0 : warmth * (.08 + .92 * activity),
    turbulence: reducedMotion ? 0 : activity ** .75 };
}

export function orderedSectionPatches(patches = []) {
  return (Array.isArray(patches) ? patches : []).filter(patch => patch && coordinate(patch).length === 2 && coordinate(patch).every(Number.isFinite))
    .map(patch => ({ ...patch, geo: [...coordinate(patch)] }))
    .sort((a, b) => a.geo[0] - b.geo[0] || a.geo[1] - b.geo[1] || String(a.key || '').localeCompare(String(b.key || '')));
}

export function sectionPointAt(patches, normalizedX) {
  const ordered = orderedSectionPatches(patches);
  if (!ordered.length || !Number.isFinite(normalizedX)) return null;
  return [...ordered[Math.min(ordered.length - 1, Math.floor(clamp(normalizedX) * ordered.length))].geo];
}

export function sectionXForGeo(patches, geo) {
  if (!Array.isArray(geo) || geo.length !== 2 || !geo.every(Number.isFinite)) return null;
  const ordered = orderedSectionPatches(patches);
  if (!ordered.length) return null;
  const key = cellKey(geo);
  let selected = ordered.findIndex(patch => cellKey(patch.geo) === key);
  if (selected < 0) {
    let distance = Infinity;
    ordered.forEach((patch, index) => {
      const next = (patch.geo[0] - geo[0]) ** 2 + (patch.geo[1] - geo[1]) ** 2;
      if (next < distance) { distance = next; selected = index; }
    });
  }
  return (selected + .5) / ordered.length;
}

function makeCanvas(width = 1, height = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width)); canvas.height = Math.max(1, Math.round(height));
  return canvas;
}
function random(index, salt = 0) {
  let n = Math.imul(index + 1, 0x45d9f3b) ^ Math.imul(salt + 3, 0x9e3779b9);
  n = Math.imul(n ^ n >>> 16, 0x45d9f3b);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
function smooth(value) { return value * value * (3 - 2 * value); }
function noise(x, y, salt = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const a = random(ix + iy * 419, salt), b = random(ix + 1 + iy * 419, salt);
  const c = random(ix + (iy + 1) * 419, salt), d = random(ix + 1 + (iy + 1) * 419, salt);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
function tiledNoise(x, y, columns, rows, salt) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const x0 = (ix % columns + columns) % columns, x1 = (x0 + 1) % columns;
  const y0 = (iy % rows + rows) % rows, y1 = (y0 + 1) % rows;
  const a = random(x0 + y0 * columns, salt), b = random(x1 + y0 * columns, salt);
  const c = random(x0 + y1 * columns, salt), d = random(x1 + y1 * columns, salt);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
function sampleLine(values, x) {
  if (!values?.length) return 0;
  const at = clamp(x) * (values.length - 1), left = Math.floor(at), t = at - left;
  return values[left] + (values[Math.min(values.length - 1, left + 1)] - values[left]) * t;
}
function profile(x) {
  return .285 + Math.sin(x * 29.1 + .5) * .012 + Math.sin(x * 83 + 2) * .007 + Math.sin(x * 241) * .003;
}

export class PeatSection {
  constructor(canvas, { quality = 'auto', reducedMotion = false, maxPixels = 1280 * 720, maxPixelRatio = 1.5 } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    if (!this.context) throw new Error('The peat section requires a 2D canvas.');
    this.width = this.height = this.scale = 1;
    this.maxPixels = Math.max(1, Number.isFinite(maxPixels) ? maxPixels : 1280 * 720);
    this.maxPixelRatio = Math.max(.5, Number.isFinite(maxPixelRatio) ? maxPixelRatio : 1.5);
    this.quality = quality === 'economy' ? 'economy' : 'auto';
    this.reducedMotion = Boolean(reducedMotion);
    this.patches = []; this.memory = new Map(); this.contacts = [];
    this.surfaceHeat = new SurfaceHeat({ emitterCount: 80 });
    this.motionBins = 96;
    this.contactTargets = new Float32Array(this.motionBins); this.contactCalm = new Float32Array(this.motionBins);
    this.sectionCalm = new Float32Array(this.motionBins); this.sectionDensity = new Float32Array(this.motionBins);
    this.sectionAgitation = new Float32Array(this.motionBins); this.sectionPhaseX = new Float64Array(this.motionBins);
    this.sectionPhaseY = new Float64Array(this.motionBins); this.sectionPhase = new Float64Array(this.motionBins);
    this.airGridWidth = 64; this.airGridHeight = 32; const airCells = this.airGridWidth * this.airGridHeight;
    this.airCalmTargets = new Float32Array(airCells); this.airCalm = new Float32Array(airCells);
    this.airPhaseX = new Float64Array(airCells); this.airPhaseY = new Float64Array(airCells); this.airPhase = new Float64Array(airCells);
    this.airSampleX = new Float64Array(airCells); this.airSampleY = new Float64Array(airCells);
    this.airMix = new Float32Array(airCells); this.airQuiet = new Float32Array(airCells);
    this.lastAtmosphereMotionAt = null;
    this.field = makeCanvas(); this.structure = makeCanvas(); this.grain = makeCanvas(192, 128);
    this.surfaceBand = makeCanvas(); this.atmosphere = makeCanvas(); this.atmosphereAt = -Infinity;
    this.stats = { drawMs: 0, frames: 0, fieldFrames: 0, patchCount: 0, pixelWidth: 1, pixelHeight: 1, fieldWidth: 1, fieldHeight: 1 };
    this.lastAt = null; this.fieldAt = -Infinity; this.fieldDirty = true; this.surfaceY = .285;
    this._prepareGrain();
    this.resize(canvas.clientWidth || 1, canvas.clientHeight || 1);
  }

  ready() { return this.surfaceHeat.ready().then(() => this); }
  surfaceYAt(normalizedX) { return profile(clamp(normalizedX)) * this.height; }
  surfaceAt(normalizedX) { return this.surfaceYAt(normalizedX); }
  setReducedMotion(value) { this.reducedMotion = Boolean(value); this.fieldAt = -Infinity; }
  setQuality(value) { this.quality = value === 'economy' ? 'economy' : 'auto'; this.resize(this.width, this.height); }
  setContacts(contacts = []) {
    this.contacts = (Array.isArray(contacts) ? contacts : []).filter(contact => contact && Number.isFinite(contact.x) && contact.active !== false && !contact.preview).slice(0, 256);
    this.fieldDirty = true;
  }

  resize(width, height) {
    this.width = Math.max(1, Number.isFinite(width) ? width : 1);
    this.height = Math.max(1, Number.isFinite(height) ? height : 1);
    const economy = this.quality === 'economy';
    this.scale = Math.min(globalThis.devicePixelRatio || 1, economy ? 1 : this.maxPixelRatio,
      Math.sqrt((economy ? Math.min(720 * 480, this.maxPixels) : this.maxPixels) / (this.width * this.height)));
    const w = Math.max(1, Math.round(this.width * this.scale)), h = Math.max(1, Math.round(this.height * this.scale));
    this.canvas.width = w; this.canvas.height = h;
    this.structure.width = w; this.structure.height = h;
    // This diffuse field is deliberately coarse. Grain and fibres are cached
    // separately, so phone cost does not scale with every projected pixel.
    this.field.width = Math.min(economy ? 240 : 360, Math.max(120, Math.round(this.width * .5)));
    this.field.height = Math.min(economy ? 112 : 160, Math.max(72, Math.round(this.height * .45)));
    this.fieldContext = this.field.getContext('2d', { alpha: false });
    this.fieldPixels = this.fieldContext.createImageData(this.field.width, this.field.height);
    this._prepareField(); this._prepareStructure(); this._prepareAtmosphere(); this.fieldAt = -Infinity;
    Object.assign(this.stats, { pixelWidth: w, pixelHeight: h, fieldWidth: this.field.width, fieldHeight: this.field.height, quality: this.quality });
  }

  setPatches(patches = []) {
    const ordered = orderedSectionPatches(patches);
    let changed = ordered.length !== this.patches.length;
    const previousPatches = new Map(this.patches.map(patch => [patch.key, patch]));
    const retain = new Set();
    this.patches = ordered.map(patch => {
      const key = String(patch.key || cellKey(patch.geo)); retain.add(key);
      let memory = this.memory.get(key);
      const targetHeat = patch.extinguished ? 0 : clamp(patch.heat), targetWet = clamp(patch.surfaceWetness), targetMoisture = clamp(patch.moisture);
      if (!memory) { memory = { heat: targetHeat, haze: targetHeat, wet: targetWet, moisture: targetMoisture }; this.memory.set(key, memory); }
      const previous = previousPatches.get(key);
      if (!previous || previous.heat !== targetHeat || previous.surfaceWetness !== targetWet || previous.moisture !== targetMoisture) changed = true;
      return { ...patch, key, heat: targetHeat, surfaceWetness: targetWet, moisture: targetMoisture, memory };
    });
    for (const key of this.memory.keys()) if (!retain.has(key)) this.memory.delete(key);
    this.stats.patchCount = this.patches.length;
    this.fieldDirty ||= changed;
  }

  _prepareGrain() {
    const context = this.grain.getContext('2d');
    const pixels = context.createImageData(this.grain.width, this.grain.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const value = random(index, 51);
      const brightness = value > .63 ? 255 : 0;
      pixels.data[index] = brightness; pixels.data[index + 1] = brightness * .76; pixels.data[index + 2] = brightness * .56;
      pixels.data[index + 3] = Math.round(12 + Math.abs(value - .5) * 95);
    }
    context.putImageData(pixels, 0, 0);
  }

  _prepareField() {
    const width = this.field.width, height = this.field.height;
    const count = width * height;
    this.fieldA = new Float32Array(count); this.fieldB = new Float32Array(count); this.fieldC = new Float32Array(count);
    this.fieldDelta = new Float32Array(count); this.fieldBelow = new Uint8Array(count);
    this.fieldDepth = new Float32Array(count); this.fieldDamp = new Float32Array(count);
    this.fieldFrontWarp = new Float32Array(count); this.fieldSkin = new Float32Array(count);
    this.fieldBody = new Float32Array(count); this.fieldAir = new Float32Array(count);
    this.fieldBloom = new Float32Array(count);
    this.heatLine = new Float32Array(width); this.burnLine = new Float32Array(width);
    this.hazeLine = new Float32Array(width); this.airHeatLine = new Float32Array(width); this.airBurnLine = new Float32Array(width);
    this.wetLine = new Float32Array(width); this.wetDepthLine = new Float32Array(width);
    this.moistureLine = new Float32Array(width); this.frontLine = new Float32Array(width);
    this.flameLine = new Float32Array(width); this.surfaceEmberLine = new Float32Array(width);
    this.sectionPixelDensity = new Float32Array(width); this.sectionPixelBurn = new Float32Array(width);
    this.sectionSampleX = new Float64Array(width); this.sectionSampleY = new Float64Array(width); this.sectionPixelMix = new Float32Array(width);
    this.surfaceBand.width = width; this.surfaceBand.height = this.quality === 'economy' ? 48 : 72;
    this.surfaceContext = this.surfaceBand.getContext('2d');
    this.surfacePixels = this.surfaceContext.createImageData(width, this.surfaceBand.height);
    const surfaceCount = width * this.surfaceBand.height;
    this.surfaceA = new Float32Array(surfaceCount); this.surfaceB = new Float32Array(surfaceCount);
    this.surfaceEnvelope = new Float32Array(surfaceCount);
    for (let y = 0; y < this.surfaceBand.height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, nx = (x + .5) / width;
      const ny = .17 + (y + .5) / this.surfaceBand.height * .19;
      const dist = (ny - profile(nx)) / (.025 + noise(nx * 32, 8, 141) * .047);
      this.surfaceEnvelope[i] = Math.max(0, 1 - Math.abs(dist)) ** 2;
      this.surfaceA[i] = noise(nx * 56, y * .21, 146) * .55 + random(i, 147) * .45;
      this.surfaceB[i] = noise(nx * 71 + 2, y * .18 + 3, 148) * .55 + random(i, 149) * .45;
    }
    const surfaceLine = new Float64Array(width);
    for (let x = 0; x < width; x++) surfaceLine[x] = profile((x + .5) / width);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x, nx = x / width, ny = y / height;
      this.fieldA[index] = noise(nx * 8, ny * 5, 3) * .62 + noise(nx * 35, ny * 19, 4) * .25 + random(index, 5) * .13;
      this.fieldB[index] = noise(nx * 9 + 11, ny * 5 + 13, 7) * .7 + noise(nx * 42, ny * 24, 8) * .3;
      this.fieldC[index] = noise(nx * 15 + 7, ny * 11 + 5, 13);
      this.fieldDelta[index] = (this.fieldB[index] - this.fieldA[index]) * .28;
      const surface = surfaceLine[x], pixelY = (y + .5) / height;
      const below = pixelY >= surface, depth = Math.max(0, (pixelY - surface) / (1 - surface));
      this.fieldBelow[index] = Number(below);
      this.fieldDepth[index] = depth;
      this.fieldSkin[index] = Math.exp(-depth * 42);
      // The front follows fibres instead of forming a straight chart edge.
      this.fieldFrontWarp[index] = (this.fieldC[index] - .5) * .055 + Math.sin(nx * 61 + depth * 11) * .012;
      this.fieldDamp[index] = below ? .28 + depth * .42 : 0;
      this.fieldBody[index] = below ? .64 + Math.sin(depth * Math.PI) * .24 : Math.exp(-(surface - pixelY) * 9) * .65;
      this.fieldAir[index] = below ? 0 : .13 + this.fieldB[index] * .08;
      this.fieldBloom[index] = 1.2 + this.fieldC[index] * .8;
    }
  }

  _groundPath(context, width, height) {
    context.beginPath(); context.moveTo(0, height);
    for (let index = 0; index <= 220; index++) {
      const x = index / 220;
      context.lineTo(x * width, profile(x) * height);
    }
    context.lineTo(width, height); context.closePath();
  }

  _prepareStructure() {
    const context = this.structure.getContext('2d'), width = this.structure.width, height = this.structure.height;
    context.clearRect(0, 0, width, height);
    context.save(); this._groundPath(context, width, height); context.clip();
    // Compressed strata and broken fibres give the glowing volume a material
    // body. Each stroke is unique and cached instead of a repeated sprite.
    for (let row = 0; row < 42; row++) {
      const depth = row / 42;
      context.beginPath();
      for (let step = 0; step <= 130; step++) {
        const x = step / 130;
        const warp = Math.sin(x * (18 + row * .31) + row * 1.7) * .009 + noise(x * 17, row * .47, 62) * .017;
        const y = profile(x) + .027 + depth * .77 + warp;
        if (!step) context.moveTo(0, y * height); else context.lineTo(x * width, y * height);
      }
      context.strokeStyle = row % 4 === 0 ? '#13070885' : '#240b0860';
      context.lineWidth = Math.max(.55, height * (.0014 + random(row, 75) * .0027)); context.stroke();
    }
    const fibres = Math.min(1800, Math.round(width * height / 380));
    for (let index = 0; index < fibres; index++) {
      const x = random(index, 81), depth = random(index, 82);
      const y = profile(x) + .018 + depth * .73;
      const length = (.003 + random(index, 83) ** 3 * .045) * width;
      const slope = (random(index, 84) - .54) * height * .014;
      context.beginPath(); context.moveTo(x * width, y * height);
      context.quadraticCurveTo(x * width + length * .4, y * height + slope * 2, x * width + length, y * height + slope);
      context.strokeStyle = index % 5 === 0 ? '#ed8a3c35' : index % 3 === 0 ? '#100605a0' : '#320d0870';
      context.lineWidth = Math.max(.45, random(index, 85) * height * .0023); context.stroke();
    }
    // A broken ash skin with occasional copper edges, never a neat soil chart.
    for (let index = 0; index < 520; index++) {
      const x = random(index, 90), y = profile(x) + random(index, 91) * .025;
      context.fillStyle = index % 5 ? '#100d0bd9' : '#ad735035';
      context.fillRect(x * width, y * height, (.001 + random(index, 92) * .009) * width, (.002 + random(index, 93) * .009) * height);
    }
    context.restore();
  }

  _prepareAtmosphere() {
    const width = this.atmosphere.width = this.quality === 'economy' ? 320 : 480;
    const height = this.atmosphere.height = this.quality === 'economy' ? 128 : 192;
    this.atmosphereContext = this.atmosphere.getContext('2d');
    this.atmospherePixels = this.atmosphereContext.createImageData(width, height);
    const count = width * height;
    this.atmosphereA = new Float32Array(count); this.atmosphereB = new Float32Array(count);
    this.atmosphereEnvelope = new Float32Array(count);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, nx = (x + .5) / width, ny = (y + .5) / height;
      this.atmosphereA[i] = tiledNoise(nx * 7, ny * 4, 7, 4, 161) * .64 + tiledNoise(nx * 27, ny * 18, 27, 18, 162) * .22 + random(i, 163) * .14;
      this.atmosphereB[i] = tiledNoise(nx * 9 + 3, ny * 4 + 2, 9, 4, 164) * .64 + tiledNoise(nx * 34, ny * 19, 34, 19, 165) * .22 + random(i, 166) * .14;
      const edge = Math.min(1, nx * 12, (1 - nx) * 12);
      const top = smooth(clamp(ny / .6));
      const bottom = smooth(clamp((1 - ny) / .13));
      this.atmosphereEnvelope[i] = edge * top * bottom;
    }
    this.atmosphereGridLeft = new Uint16Array(width); this.atmosphereGridFX = new Float32Array(width);
    this.atmosphereGridTop = new Uint16Array(height); this.atmosphereGridFY = new Float32Array(height);
    this.atmosphereHeat = new Float32Array(width);
    for (let x = 0; x < width; x++) { const gx = x / (width - 1) * (this.airGridWidth - 1); this.atmosphereGridLeft[x] = Math.floor(gx); this.atmosphereGridFX[x] = gx - Math.floor(gx); }
    for (let y = 0; y < height; y++) { const gy = y / (height - 1) * (this.airGridHeight - 1); this.atmosphereGridTop[y] = Math.floor(gy); this.atmosphereGridFY[y] = gy - Math.floor(gy); }
    this.atmosphereAt = -Infinity;
  }

  _updateSectionMotion(elapsed) {
    const bins = this.motionBins, targets = this.contactTargets;
    targets.fill(0);
    for (const contact of this.contacts) {
      const radius = Math.max(1 / bins, Math.min(.2, Number.isFinite(contact.radius) ? contact.radius : .035));
      const strength = Number.isFinite(contact.strength) ? clamp(contact.strength) : 1;
      const first = Math.max(0, Math.floor((contact.x - radius) * bins));
      const last = Math.min(bins - 1, Math.ceil((contact.x + radius) * bins));
      for (let bin = first; bin <= last; bin++) {
        const distance = Math.abs((bin + .5) / bins - contact.x) / radius;
        const amount = smooth(clamp(1 - distance)) * strength;
        targets[bin] = Math.max(targets[bin], amount);
      }
    }
    let sumAgitation = 0, sumDrift = 0, calmed = 0;
    for (let bin = 0; bin < bins; bin++) {
      const x = (bin + .5) / bins, target = x * this.patches.length - .5;
      let heat = 0, wet = 0, weight = 0;
      for (let offset = -2; offset <= 2; offset++) {
        const patch = this.patches[Math.max(0, Math.min(this.patches.length - 1, Math.round(target) + offset))];
        const w = 3 - Math.abs(offset);
        // Extinction already drives the retained haze target to zero. Keep
        // that existing tail across the finale boundary, under the stage fade.
        heat += (patch?.memory.haze || 0) * w;
        wet += (patch?.memory.wet || 0) * w; weight += w;
      }
      const before = this.contactCalm[bin], wanted = targets[bin];
      const blend = this.reducedMotion ? 1 : 1 - Math.exp(-elapsed / (wanted > before ? .25 : 1));
      this.contactCalm[bin] += (wanted - before) * blend;
      const state = derivePeatAtmosphereState({ heat: heat / weight, surfaceWetness: wet / weight, contact: this.contactCalm[bin], reducedMotion: this.reducedMotion });
      this.sectionCalm[bin] = state.calm; this.sectionDensity[bin] = state.density; this.sectionAgitation[bin] = state.agitation;
      if (!this.reducedMotion) {
        this.sectionPhase[bin] += elapsed * (.07 + state.agitation * .78);
        this.sectionPhaseX[bin] += elapsed * state.drift * (.004 + Math.sin(this.sectionPhase[bin] * .71 + x * 3) * .005);
        this.sectionPhaseY[bin] += elapsed * state.drift * (.009 + state.turbulence * .023);
      }
      sumAgitation += state.agitation; sumDrift += state.drift; if (state.calm > .2) calmed++;
    }
    this.stats.hazeAgitation = sumAgitation / bins; this.stats.hazeDrift = sumDrift / bins; this.stats.calmedColumns = calmed;
  }

  _updateSharedMotion(calmAreas, now) {
    const gw = this.airGridWidth, gh = this.airGridHeight, target = this.airCalmTargets;
    target.fill(0);
    for (const area of (Array.isArray(calmAreas) ? calmAreas : []).slice(0, 1024)) {
      if (!area || area.preview || ![area.x, area.y, area.radiusX, area.radiusY].every(Number.isFinite)) continue;
      const rx = Math.max(1 / gw, Math.min(1, area.radiusX)), ry = Math.max(1 / gh, Math.min(1, area.radiusY));
      const strength = Number.isFinite(area.strength) ? clamp(area.strength) : 1;
      const firstX = Math.max(0, Math.floor((area.x - rx) * gw)), lastX = Math.min(gw - 1, Math.ceil((area.x + rx) * gw));
      const firstY = Math.max(0, Math.floor((area.y - ry) * gh)), lastY = Math.min(gh - 1, Math.ceil((area.y + ry) * gh));
      for (let row = firstY; row <= lastY; row++) for (let column = firstX; column <= lastX; column++) {
        const dx = ((column + .5) / gw - area.x) / rx, dy = ((row + .5) / gh - area.y) / ry;
        const amount = smooth(clamp(1 - dx * dx - dy * dy)) * strength, index = row * gw + column;
        target[index] = Math.max(target[index], amount);
      }
    }
    const dt = this.lastAtmosphereMotionAt === null ? 0 : Math.min(.25, Math.max(0, (now - this.lastAtmosphereMotionAt) / 1000));
    this.lastAtmosphereMotionAt = now;
    let calmed = 0, agitation = 0;
    for (let row = 0; row < gh; row++) for (let column = 0; column < gw; column++) {
      const index = row * gw + column, old = this.airCalm[index], wanted = target[index];
      const blend = this.reducedMotion ? 1 : 1 - Math.exp(-dt / (wanted > old ? .25 : 1));
      this.airCalm[index] += (wanted - old) * blend;
      const heat = sampleLine(this.airHeatLine, (column + .5) / gw);
      const state = derivePeatAtmosphereState({ heat, contact: this.airCalm[index], reducedMotion: this.reducedMotion });
      if (!this.reducedMotion) {
        this.airPhase[index] += dt * (.07 + state.agitation * .68);
        this.airPhaseX[index] += dt * state.drift * (.0035 + Math.sin(this.airPhase[index] * .71 + column / gw * 3 + row / gh) * .0045);
        this.airPhaseY[index] += dt * state.drift * (.009 + state.turbulence * .023);
      }
      this.airSampleX[index] = this.airPhaseX[index] * this.atmosphere.width;
      this.airSampleY[index] = this.airPhaseY[index] * this.atmosphere.height;
      this.airMix[index] = this.reducedMotion ? .4 : .35 + Math.sin(this.airPhase[index]) * .28;
      this.airQuiet[index] = .22 + .78 * (1 - this.airCalm[index]);
      if (this.airCalm[index] > .2) calmed++; agitation += state.agitation;
    }
    this.stats.sharedCalmedCells = calmed; this.stats.sharedAgitation = agitation / (gw * gh);
  }

  // The shared field receives real map/section-space calm ellipses from its
  // caller. It must not mistake source-strip x for geographic map x.
  drawAtmosphere(context, { x = 0, y = 0, width = this.width, height = this.height, now = performance.now(), alpha = .55, calmAreas = [] } = {}) {
    if (this.destroyed || !context || width <= 0 || height <= 0) return 0;
    const start = performance.now();
    this._updateSharedMotion(calmAreas, now);
    const interval = 1000 / (this.quality === 'economy' ? 8 : 12);
    if (this.atmosphereAt === -Infinity || (!this.reducedMotion && now - this.atmosphereAt >= interval) || (this.reducedMotion && this.fieldAt > this.atmosphereAt)) {
      const w = this.atmosphere.width, h = this.atmosphere.height, pixels = this.atmospherePixels.data;
      const gw = this.airGridWidth, gh = this.airGridHeight;
      const sx = this.airSampleX, sy = this.airSampleY, mx = this.airMix, quietGrid = this.airQuiet;
      const texA = this.atmosphereA, texB = this.atmosphereB;
      for (let column = 0; column < w; column++) this.atmosphereHeat[column] = sampleLine(this.airHeatLine, column / (w - 1));
      for (let row = 0; row < h; row++) {
        const gy = this.atmosphereGridTop[row], fy = this.atmosphereGridFY[row], gy1 = Math.min(gh - 1, gy + 1);
        const top = gy * gw, bottom = gy1 * gw;
        for (let column = 0; column < w; column++) {
          const i = row * w + column, p = i * 4;
          const gx = this.atmosphereGridLeft[column], fx = this.atmosphereGridFX[column], gx1 = Math.min(gw - 1, gx + 1);
          const tl = top + gx, tr = top + gx1, bl = bottom + gx, br = bottom + gx1;
          const dx = (sx[tl] + (sx[tr] - sx[tl]) * fx) * (1 - fy) + (sx[bl] + (sx[br] - sx[bl]) * fx) * fy;
          const dy = (sy[tl] + (sy[tr] - sy[tl]) * fx) * (1 - fy) + (sy[bl] + (sy[br] - sy[bl]) * fx) * fy;
          const mix = (mx[tl] + (mx[tr] - mx[tl]) * fx) * (1 - fy) + (mx[bl] + (mx[br] - mx[bl]) * fx) * fy;
          const quiet = (quietGrid[tl] + (quietGrid[tr] - quietGrid[tl]) * fx) * (1 - fy) + (quietGrid[bl] + (quietGrid[br] - quietGrid[bl]) * fx) * fy;
          const sampleX = column - dx, sampleY = row + dy;
          let x0 = Math.floor(sampleX), y0 = Math.floor(sampleY);
          const tx = sampleX - x0, ty = sampleY - y0;
          if (x0 < 0 || x0 >= w) x0 = (x0 % w + w) % w;
          if (y0 < 0 || y0 >= h) y0 = (y0 % h + h) % h;
          const x1 = x0 + 1 === w ? 0 : x0 + 1, y1 = y0 + 1 === h ? 0 : y0 + 1;
          const a0 = y0 * w + x0, a1 = y0 * w + x1, b0 = y1 * w + x0, b1 = y1 * w + x1;
          const v00 = texA[a0] + (texB[a0] - texA[a0]) * mix, v10 = texA[a1] + (texB[a1] - texA[a1]) * mix;
          const v01 = texA[b0] + (texB[b0] - texA[b0]) * mix, v11 = texA[b1] + (texB[b1] - texA[b1]) * mix;
          const grain = (v00 + (v10 - v00) * tx) * (1 - ty) + (v01 + (v11 - v01) * tx) * ty;
          const density = Math.max(0, grain - .25) * 1.9;
          // The shared veil crosses above the map plumes, so it uses the
          // same orange family rather than desaturating them into gray.
          pixels[p] = 188 + density * 58; pixels[p + 1] = 68 + density * 45; pixels[p + 2] = 19 + density * 23;
          pixels[p + 3] = Math.round(Math.min(1, density * this.atmosphereEnvelope[i] * this.atmosphereHeat[column] * quiet) * 190);
        }
      }
      this.atmosphereContext.putImageData(this.atmospherePixels, 0, 0);
      this.atmosphereAt = now; this.stats.atmosphereFrames = (this.stats.atmosphereFrames || 0) + 1;
    }
    context.save(); context.globalAlpha *= clamp(alpha);
    context.drawImage(this.atmosphere, x, y, width, height);
    context.restore();
    this.stats.atmosphereDrawMs = performance.now() - start;
    return this.stats.atmosphereDrawMs;
  }

  _updateField(now) {
    const width = this.field.width, height = this.field.height, data = this.fieldPixels.data;
    const phase = this.reducedMotion ? .38 : (.5 + Math.sin(now / 8400) * .5);
    const phase2 = this.reducedMotion ? .5 : (.5 + Math.sin(now / 13700 + 2.1) * .5);
    const count = this.patches.length;
    const heatLine = this.heatLine, burnLine = this.burnLine, hazeLine = this.hazeLine,
      airHeatLine = this.airHeatLine, airBurnLine = this.airBurnLine, wetLine = this.wetLine,
      wetDepthLine = this.wetDepthLine, moistureLine = this.moistureLine;
    const frontLine = this.frontLine, flameLine = this.flameLine, surfaceEmberLine = this.surfaceEmberLine;
    for (let x = 0; x < width; x++) {
      const target = (x + .5) / width * count - .5;
      let sum = 0, heat = 0, haze = 0, wet = 0, moisture = 0;
      for (let offset = -2; offset <= 2; offset++) {
        const index = Math.max(0, Math.min(count - 1, Math.round(target) + offset));
        const patch = this.patches[index], weight = 3 - Math.abs(offset);
        heat += (patch?.memory.heat || 0) * weight; wet += (patch?.memory.wet || 0) * weight;
        haze += (patch?.memory.haze || 0) * weight;
        moisture += (patch?.memory.moisture || 0) * weight; sum += weight;
      }
      heatLine[x] = heat / sum; wetLine[x] = wet / sum; moistureLine[x] = moisture / sum;
      hazeLine[x] = haze / sum;
      const state = progression({ heat: heatLine[x], surfaceWetness: wetLine[x], moisture: moistureLine[x] });
      burnLine[x] = state.residual; frontLine[x] = state.front;
      flameLine[x] = state.flame; surfaceEmberLine[x] = state.surfaceEmber;
      wetDepthLine[x] = clamp(state.front / .06);
    }
    // The air mixes across neighbouring ground instead of inheriting each
    // narrow cooled strip. Its independent thermal memory fades over seconds.
    for (let x = 0; x < width; x++) {
      let mixedHeat = 0, totalWeight = 0;
      for (let offset = -8; offset <= 8; offset++) {
        const sample = Math.max(0, Math.min(width - 1, x + offset));
        const weight = 9 - Math.abs(offset);
        mixedHeat += hazeLine[sample] * weight; totalWeight += weight;
      }
      airHeatLine[x] = mixedHeat / totalWeight;
      airBurnLine[x] = airHeatLine[x] ** .74;
    }
    const textureWidth = this.atmosphere.width, textureHeight = this.atmosphere.height;
    const texA = this.atmosphereA, texB = this.atmosphereB;
    for (let x = 0; x < width; x++) {
      const nx = (x + .5) / width, density = sampleLine(this.sectionDensity, nx);
      this.sectionPixelDensity[x] = density; this.sectionPixelBurn[x] = density ** .74;
      this.sectionSampleX[x] = nx * textureWidth - sampleLine(this.sectionPhaseX, nx) * textureWidth;
      this.sectionSampleY[x] = sampleLine(this.sectionPhaseY, nx) * textureHeight;
      this.sectionPixelMix[x] = this.reducedMotion ? .4 : .35 + Math.sin(sampleLine(this.sectionPhase, nx)) * .28;
    }
    const airPhase = 120 * (.65 + phase2 * .35);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, p = i * 4;
      const below = this.fieldBelow[i];
      let grain = this.fieldA[i] + this.fieldDelta[i] * phase;
      const atmosphericHeat = this.sectionPixelDensity[x];
      if (!below) {
        const xx = this.sectionSampleX[x], yy = y / height * textureHeight + this.sectionSampleY[x];
        let x0 = Math.floor(xx), y0 = Math.floor(yy);
        const tx = xx - x0, ty = yy - y0;
        if (x0 < 0 || x0 >= textureWidth) x0 = (x0 % textureWidth + textureWidth) % textureWidth;
        if (y0 < 0 || y0 >= textureHeight) y0 = (y0 % textureHeight + textureHeight) % textureHeight;
        const x1 = x0 + 1 === textureWidth ? 0 : x0 + 1, y1 = y0 + 1 === textureHeight ? 0 : y0 + 1;
        const a0 = y0 * textureWidth + x0, a1 = y0 * textureWidth + x1, b0 = y1 * textureWidth + x0, b1 = y1 * textureWidth + x1;
        const mix = this.sectionPixelMix[x];
        const v00 = texA[a0] + (texB[a0] - texA[a0]) * mix, v10 = texA[a1] + (texB[a1] - texA[a1]) * mix;
        const v01 = texA[b0] + (texB[b0] - texA[b0]) * mix, v11 = texA[b1] + (texB[b1] - texA[b1]) * mix;
        grain = (v00 + (v10 - v00) * tx) * (1 - ty) + (v01 + (v11 - v01) * tx) * ty;
      }
      const heat = below ? heatLine[x] : atmosphericHeat, wet = wetLine[x];
      let cooling = 0;
      if (below) {
        const depth = this.fieldDepth[i];
        const front = frontLine[x] + this.fieldFrontWarp[i] * clamp(frontLine[x] * 7);
        const t = Math.max(0, Math.min(1, (front - depth) * 5 + .5));
        const frontAmount = t * t * (3 - 2 * t) * wetDepthLine[x];
        cooling = Math.max(wet * this.fieldSkin[i], frontAmount);
      }
      // Only the portion reached from above darkens. Deep residual heat is
      // intentionally retained until the front reaches that depth.
      const burn = below ? burnLine[x] * (1 - cooling * .97) : this.sectionPixelBurn[x];
      const bloom = Math.max(0, grain - .29) * this.fieldBloom[i];
      const burnBody = burn * this.fieldBody[i];
      const glow = burnBody * (.34 + bloom * 1.23);
      const ember = Math.max(0, grain - .62) * 4 * burnBody;
      // Low hot red remains under the skin; wet columns lose their surface
      // blaze first while residual heat can remain deeper inside.
      data[p] = Math.min(255, 16 + glow * 194 + ember * 46);
      data[p + 1] = Math.min(180, 8 + glow * 38 + ember * 54 + (below ? 0 : glow * 4));
      data[p + 2] = Math.min(75, 7 + glow * 7 + ember * 7);
      if (!below) {
        const air = this.fieldAir[i] * heat;
        data[p] += air * airPhase;
        data[p + 1] += air * 14;
      }
      data[p + 3] = 255;
    }
    const surface = this.surfacePixels.data, surfaceWidth = this.surfaceBand.width;
    for (let i = 0; i < this.surfaceA.length; i++) {
      const p = i * 4, column = i % surfaceWidth;
      const activity = (flameLine[column] * .85 + surfaceEmberLine[column] * .32) * (1 - sampleLine(this.sectionCalm, column / surfaceWidth) * .72);
      const grain = this.surfaceA[i] + (this.surfaceB[i] - this.surfaceA[i]) * phase;
      const density = Math.max(0, grain - .31) * 2.3;
      surface[p] = 208 + density * 35; surface[p + 1] = 41 + density * 57; surface[p + 2] = 10 + density * 18;
      surface[p + 3] = Math.round(clamp(density * this.surfaceEnvelope[i] * activity) * 235);
    }
    this.surfaceContext.putImageData(this.surfacePixels, 0, 0);
    this.fieldContext.putImageData(this.fieldPixels, 0, 0);
    this.fieldAt = now; this.fieldDirty = false; this.stats.fieldFrames++;
  }

  _drawSurface(now) {
    const context = this.context, width = this.canvas.width, height = this.canvas.height;
    context.save(); context.globalCompositeOperation = 'screen';
    // A soft incandescent grain band and irregular ash fissures replace every
    // pointed tongue. Heat can be restless without drawing flame silhouettes.
    context.globalAlpha = .38;
    context.drawImage(this.surfaceBand, 0, height * .17, width, height * .19);
    context.restore();
    this.surfaceHeat.draw(context, { width, height, now, activity: this.flameLine, embers: this.surfaceEmberLine,
      calm: this.sectionCalm, surfaceAt: x => this.surfaceYAt(x) * this.scale,
      reducedMotion: this.reducedMotion, scale: this.scale, motionStrength: 1.7 });
    this.stats.surfaceFlares = 0; this.stats.surfaceGrains = this.surfaceHeat.stats.visibleEmitters;
    this.stats.surfaceEmbers = 0; this.stats.surfaceMotionPixels = this.surfaceHeat.stats.motionPixels;
    this.stats.surfaceShapeChange = this.surfaceHeat.stats.shapeChange || 0;
    this.stats.surfaceTextureDraws = this.surfaceHeat.stats.textureDraws || 0;
    this.stats.surfaceAssetLoaded = this.surfaceHeat.stats.assetLoaded;
  }

  draw(now = performance.now()) {
    const start = performance.now();
    if (this.destroyed) return this.stats;
    const elapsed = this.lastAt === null ? 1 : Math.min(.25, Math.max(0, (now - this.lastAt) / 1000)); this.lastAt = now;
    let changing = false;
    const heatRiseBlend = this.reducedMotion ? 1 : 1 - Math.exp(-elapsed / .4);
    const heatFallBlend = this.reducedMotion ? 1 : 1 - Math.exp(-elapsed / 1.4);
    const hazeRiseBlend = this.reducedMotion ? 1 : 1 - Math.exp(-elapsed / .7);
    const hazeFallBlend = this.reducedMotion ? 1 : 1 - Math.exp(-elapsed / 3.4);
    const wetBlend = this.reducedMotion ? 1 : 1 - Math.exp(-elapsed / .3);
    const moistureBlend = this.reducedMotion ? 1 : 1 - Math.exp(-elapsed);
    for (const patch of this.patches) {
      const m = patch.memory;
      const dh = patch.heat - m.heat, dz = patch.heat - m.haze,
        dw = patch.surfaceWetness - m.wet, dm = patch.moisture - m.moisture;
      m.heat += dh * (dh > 0 ? heatRiseBlend : heatFallBlend);
      m.haze += dz * (dz > 0 ? hazeRiseBlend : hazeFallBlend);
      m.wet += dw * wetBlend; m.moisture += dm * moistureBlend;
      if (Math.abs(dh) + Math.abs(dz) + Math.abs(dw) + Math.abs(dm) > .001) changing = true;
    }
    this._updateSectionMotion(elapsed);
    const refresh = this.reducedMotion ? changing || this.fieldDirty || this.fieldAt === -Infinity : now - this.fieldAt >= 1000 / (this.quality === 'economy' ? 8 : 12);
    if (refresh) this._updateField(now);
    const context = this.context, width = this.canvas.width, height = this.canvas.height;
    context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
    context.imageSmoothingEnabled = true; context.drawImage(this.field, 0, 0, width, height);
    context.drawImage(this.structure, 0, 0, width, height);
    this._drawSurface(now);
    // Fine visible grain stretches only slightly. A single cached texture is
    // enough; nothing blinks or suddenly spawns as moisture changes.
    context.save(); context.globalAlpha = .44; context.globalCompositeOperation = 'soft-light';
    const grainScale = Math.max(1, this.scale * .9), tileW = this.grain.width * grainScale, tileH = this.grain.height * grainScale;
    for (let y = 0; y < height; y += tileH) for (let x = 0; x < width; x += tileW) context.drawImage(this.grain, x, y, tileW, tileH);
    context.restore();
    const vignette = context.createLinearGradient(0, 0, 0, height);
    vignette.addColorStop(0, '#080504a6'); vignette.addColorStop(.17, '#08050408'); vignette.addColorStop(.72, '#08050400'); vignette.addColorStop(1, '#080504a3');
    context.fillStyle = vignette; context.fillRect(0, 0, width, height);
    this.stats.frames++; this.stats.drawMs = performance.now() - start;
    this.canvas.dataset.patchCount = String(this.patches.length);
    this.canvas.dataset.section = 'peat';
    this.canvas.dataset.drawMsLast = this.stats.drawMs.toFixed(2);
    this.canvas.dataset.fieldFrames = String(this.stats.fieldFrames);
    this.canvas.dataset.pixelRatio = this.scale.toFixed(3);
    this.canvas.dataset.surfaceFlares = '0';
    this.canvas.dataset.surfaceMode = 'grain';
    this.canvas.dataset.literalFlames = '0';
    this.canvas.dataset.surfaceGrains = String(this.stats.surfaceGrains || 0);
    this.canvas.dataset.surfaceEmbers = String(this.stats.surfaceEmbers || 0);
    this.canvas.dataset.depthProfile = 'surface-first';
    this.canvas.dataset.hazeMotion = 'advected';
    this.canvas.dataset.hazeAgitation = this.stats.hazeAgitation.toFixed(4);
    this.canvas.dataset.hazeDrift = this.stats.hazeDrift.toFixed(4);
    this.canvas.dataset.calmedColumns = String(this.stats.calmedColumns);
    this.canvas.dataset.sharedCalmedCells = String(this.stats.sharedCalmedCells || 0);
    this.canvas.dataset.surfaceMotionPixels = this.stats.surfaceMotionPixels.toFixed(3);
    this.canvas.dataset.surfaceShapeChange = this.stats.surfaceShapeChange.toFixed(3);
    this.canvas.dataset.surfaceTextureDraws = String(this.stats.surfaceTextureDraws);
    this.canvas.dataset.surfaceAssetLoaded = String(this.stats.surfaceAssetLoaded);
    return { ...this.stats };
  }

  destroy() { this.destroyed = true; this.memory.clear(); }
}
