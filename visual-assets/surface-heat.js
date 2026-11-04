// A local transparent ember atlas carries the surface texture. Motion remains
// deterministic and caller-clocked; this renderer never changes model state.
const ATLAS_URL = new URL('./surface-heat-atlas.webp', import.meta.url).href;
const atlasCache = new Map();
const mapAtlasCache = new WeakMap();
export const SURFACE_HEAT_MAX_TIP_MOTION = 3.5;
export const MAP_HEAT_MAX_TIP_MOTION = 2;
const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
function random(index, salt = 0) {
  let n = Math.imul(index + 1, 0x45d9f3b) ^ Math.imul(salt + 3, 0x9e3779b9);
  n = Math.imul(n ^ n >>> 16, 0x45d9f3b);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
function sample(line, x) {
  if (!line?.length) return 0;
  return clamp(line[Math.min(line.length - 1, Math.floor(clamp(x) * line.length))]);
}

function seedFor(key) {
  let seed = 2166136261;
  for (const letter of String(key)) seed = Math.imul(seed ^ letter.charCodeAt(0), 16777619);
  return seed >>> 0;
}

// Shared band edges keep the curled texture continuous. Its .82 base edge and
// everything below it remain fixed; only the upper fibres breathe and bend.
function bandedHeatPose({ x = 0, y = 0, height = 1, phase = 0, restless = 0, calm = 0, reducedMotion = false, scale = 1 } = {}, profile) {
  const density = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const motion = reducedMotion ? 0 : clamp(restless) * (1 - clamp(calm) * profile.calm);
  const heightBreath = profile.breath * motion;
  const heightStretch = 1 + Math.sin(phase * .83) * heightBreath;
  const rows = [0, .45, .68, .82, 1];
  const offsets = [Math.sin(phase * 1.12) * profile.tip, Math.sin(phase * 1.12 + .95) * profile.upper,
    Math.sin(phase * 1.12 - .55) * profile.lower, 0, 0].map(value => value * motion * density);
  const positions = rows.map(row => (row - .82) * height * (row < .82 ? heightStretch : 1));
  const bands = rows.slice(0, -1).map((row, index) => ({ sourceTop: row, sourceBottom: rows[index + 1],
    topX: offsets[index], bottomX: offsets[index + 1], topY: positions[index], bottomY: positions[index + 1] }));
  const tipOffsetY = positions[0] + height * .82;
  return { anchorX: x, anchorY: y, anchorDrift: 0, tipOffsetX: offsets[0], tipOffsetY,
    shear: -offsets[0] / Math.max(.001, height * .82), stretch: heightStretch,
    heightStretch, heightBreath, maxTipMotion: profile.tip * motion,
    shapeMotion: (Math.max(...offsets.map(Math.abs)) + Math.abs(tipOffsetY)) / density, bands };
}

export function surfaceHeatPose(options = {}) {
  return bandedHeatPose(options, { tip: SURFACE_HEAT_MAX_TIP_MOTION, upper: 3, lower: 2.8, breath: .11, calm: .95 });
}

export function mapHeatPose(options = {}) {
  return bandedHeatPose(options, { tip: MAP_HEAT_MAX_TIP_MOTION, upper: 1.92, lower: 1.88, breath: .065, calm: .92 });
}

// Choose one strong source in each small geographic bin before adding detail
// within those bins. Source order never concentrates the sprite budget on the
// first island; every source still retains its precise lightweight core.
export function selectHeatSites(sites, limit = 192, bounds) {
  const maximum = Math.max(0, Math.min(192, Math.floor(limit)));
  if (!maximum) return [];
  const candidates = (Array.isArray(sites) ? sites : []).filter(site => site &&
    Number.isFinite(site.x) && Number.isFinite(site.y) && !site.extinguished &&
    clamp(site.activity ?? site.heat) > .012);
  if (candidates.length <= maximum) return candidates;
  const left = bounds?.x ?? Math.min(...candidates.map(site => site.x));
  const top = bounds?.y ?? Math.min(...candidates.map(site => site.y));
  const width = Math.max(1, bounds?.width ?? Math.max(...candidates.map(site => site.x)) - left);
  const height = Math.max(1, bounds?.height ?? Math.max(...candidates.map(site => site.y)) - top);
  const bins = new Map();
  for (const site of candidates) {
    const column = Math.min(23, Math.floor(clamp((site.x - left) / width) * 24));
    const row = Math.min(11, Math.floor(clamp((site.y - top) / height) * 12));
    const key = row * 24 + column;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(site);
  }
  const groups = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, group]) => group.sort((a, b) =>
    clamp(b.activity ?? b.heat) - clamp(a.activity ?? a.heat) || seedFor(a.id) - seedFor(b.id)));
  if (groups.length > maximum) return Array.from({ length: maximum }, (_, index) =>
    groups[Math.floor((index + .5) * groups.length / maximum)][0]);
  const selected = [];
  for (let rank = 0; selected.length < maximum; rank++) {
    let added = 0;
    for (const group of groups) {
      if (group[rank]) { selected.push(group[rank]); added++; }
      if (selected.length === maximum) break;
    }
    if (!added) break;
  }
  return selected;
}

export class SurfaceHeat {
  constructor({ imageUrl = ATLAS_URL, emitterCount = 80, loadImage = true } = {}) {
    const count = Math.max(1, Math.min(96, Math.round(Number.isFinite(emitterCount) ? emitterCount : 80)));
    this.emitters = Array.from({ length: count }, (_, index) => ({
      x: (index + .18 + random(index, 201) * .64) / count,
      variant: index % 8, initialPhase: random(index, 202) * Math.PI * 2,
      phase: random(index, 202) * Math.PI * 2, calm: 0,
      size: random(index, 203), bend: random(index, 204) - .5,
    }));
    this.image = null; this.lastAt = null; this.lastSitesAt = null;
    this.siteMemory = new Map();
    this.stats = { draws: 0, visibleEmitters: 0, assetLoaded: false, agitation: 0, calm: 0, motionPixels: 0,
      phaseAdvance: 0, anchorDrift: 0, maxTipMotion: 0, shapeMotion: 0, shapeChange: 0,
      textureDraws: 0, maxHeightBreath: 0, drawMs: 0 };
    this.siteStats = { draws: 0, visibleSites: 0, locatedSites: 0, spriteLimit: 192, anchorDrift: 0,
      maxTipMotion: 0, phaseAdvance: 0, shapeMotion: 0, shapeChange: 0, textureDraws: 0,
      drawSlots: 0, retiringSites: 0, pendingSites: 0, maxHeightBreath: 0, drawMs: 0 };
    if (!loadImage || typeof Image === 'undefined') { this.loading = Promise.resolve(this); return; }
    if (!atlasCache.has(imageUrl)) atlasCache.set(imageUrl, new Promise(resolve => {
      const image = new Image(); image.decoding = 'async';
      image.onload = async () => {
        try { if (image.decode) await image.decode(); resolve(this._prepareImage(image)); }
        catch { resolve(null); }
      };
      // Keep the procedural grain while a local asset is unavailable. A lost
      // decorative image must never disable rain or the shared landscape.
      image.onerror = () => resolve(null);
      image.src = imageUrl;
    }));
    this.loading = atlasCache.get(imageUrl).then(image => {
      this.image = image; this.stats.assetLoaded = Boolean(image);
      this.stats.assetError = !image; this.stats.emissiveAtlas = Boolean(image);
      return this;
    });
  }
  ready() { return this.loading; }

  _prepareImage(source) {
    if (typeof document === 'undefined') return source;
    const atlas = document.createElement('canvas'); atlas.width = source.width; atlas.height = source.height;
    const context = atlas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, 0, 0);
    const image = context.getImageData(0, 0, atlas.width, atlas.height), pixels = image.data;
    // One decode-time extraction keeps the generated carbon fibres while
    // suppressing diffuse peach smoke. Runtime painting uses this cached red
    // emissive atlas; there is no per-frame image processing.
    for (let i = 0; i < pixels.length; i += 4) {
      const red = pixels[i], other = Math.max(pixels[i + 1], pixels[i + 2]);
      const emission = clamp((red - other * 1.45 - 8) / 90);
      const chroma = clamp(((red - other) / Math.max(1, red) - .28) / .45);
      const selection = chroma * chroma * (3 - 2 * chroma);
      pixels[i] = 172 + emission * 70;
      pixels[i + 1] = 24 + emission * 60;
      pixels[i + 2] = 6 + emission * 15;
      pixels[i + 3] *= (.10 + emission * .90) * selection;
    }
    context.putImageData(image, 0, 0); this.stats.emissiveAtlas = true;
    mapAtlasCache.set(atlas, { source, image: null });
    return atlas;
  }

  _mapTexture() {
    if (!this.image) return null;
    const cached = mapAtlasCache.get(this.image);
    if (!cached) return this.image;
    if (cached.image) return cached.image;
    const source = cached.source;
    const atlas = document.createElement('canvas'); atlas.width = source.width; atlas.height = source.height;
    const context = atlas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, 0, 0);
    const image = context.getImageData(0, 0, atlas.width, atlas.height), pixels = image.data;
    const tileHeight = atlas.height / 2;
    // The section keeps its original emissive extraction. This map-only tone
    // retains more copper fibres in the lower curl, while suppressing the pale
    // upper smoke. It is prepared once from the same already-decoded bitmap.
    for (let i = 0; i < pixels.length; i += 4) {
      const red = pixels[i], other = Math.max(pixels[i + 1], pixels[i + 2]);
      const emission = clamp((red - other * 1.22 - 6) / 85);
      const chroma = clamp(((red - other) / Math.max(1, red) - .16) / .48);
      const selection = chroma * chroma * (3 - 2 * chroma);
      const row = Math.floor(i / 4 / atlas.width) % tileHeight / tileHeight;
      const upperFade = Math.max(.15, Math.min(1, (row - .15) / .45));
      pixels[i] = 184 + emission * 66;
      pixels[i + 1] = 48 + emission * 74;
      pixels[i + 2] = 18 + emission * 23;
      pixels[i + 3] *= (.14 + emission * .64) * selection * upperFade;
    }
    context.putImageData(image, 0, 0);
    cached.image = atlas;
    return atlas;
  }

  draw(context, { width = 1, height = 1, now = performance.now(), activity = [], embers = [], calm = [], surfaceAt = () => height * .285, reducedMotion = false, scale = 1, motionStrength = 1 } = {}) {
    const start = performance.now();
    if (!context || width <= 0 || height <= 0) return this.stats;
    const density = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const movement = Math.max(1, Math.min(2, Number.isFinite(motionStrength) ? motionStrength : 1));
    const firstDraw = this.lastAt === null;
    const dt = firstDraw ? 0 : Math.min(.15, Math.max(0, (now - this.lastAt) / 1000));
    this.lastAt = now;
    let visible = 0, meanAgitation = 0, meanCalm = 0, meanMotion = 0, maxTipMotion = 0, phaseAdvance = 0;
    let shapeMotion = 0, shapeChange = 0, textureDraws = 0, maxHeightBreath = 0;
    const aspect = this.image ? this.image.width / 4 / (this.image.height / 2) : .95;
    context.save(); context.globalCompositeOperation = 'screen'; context.lineCap = 'round';
    for (const emitter of this.emitters) {
      const active = sample(activity, emitter.x), ember = sample(embers, emitter.x);
      const targetCalm = sample(calm, emitter.x);
      const calmBlend = reducedMotion || firstDraw ? 1 : 1 - Math.exp(-dt / (targetCalm > emitter.calm ? .16 : .8));
      emitter.calm += (targetCalm - emitter.calm) * calmBlend;
      const quiet = clamp(emitter.calm);
      const restless = Math.max(active, ember * .16) * (1 - quiet) ** 1.4;
      const speed = .1 + restless * (1.4 + emitter.size * .4) * movement;
      const advance = reducedMotion ? 0 : dt * speed;
      emitter.phase += advance; phaseAdvance += advance;
      const phase = reducedMotion ? emitter.initialPhase : emitter.phase;
      const intensity = clamp((active * .58 + ember * .20) * (1 - quiet * .84));
      meanAgitation += restless; meanCalm += quiet;
      if (intensity <= .004) continue;
      const h = (24 + emitter.size * 20) * 1.12 * (.42 + active * .58) * density;
      const w = h * aspect;
      const pose = surfaceHeatPose({ x: emitter.x * width, y: surfaceAt(emitter.x), height: h,
        phase, restless: clamp(restless * Math.sqrt(movement)), calm: quiet, reducedMotion, scale: density });
      const shape = pose.bands.flatMap(band => [band.topX, band.bottomX, band.topY, band.bottomY]);
      if (emitter.shape) shapeChange += shape.reduce((sum, value, index) => sum + Math.abs(value - emitter.shape[index]), 0) / density;
      emitter.shape = shape;
      shapeMotion += pose.shapeMotion; maxHeightBreath = Math.max(maxHeightBreath, pose.heightBreath);
      meanMotion += pose.maxTipMotion; maxTipMotion = Math.max(maxTipMotion, pose.maxTipMotion);
      const breath = reducedMotion ? .9 : .9 + Math.sin(phase * .84 + emitter.initialPhase) * .08 * restless;
      context.globalAlpha = intensity * breath;
      textureDraws += this._drawEmitter(context, emitter.variant, pose, w, h, density);
      visible++;
    }
    context.restore();
    const count = this.emitters.length;
    Object.assign(this.stats, { draws: this.stats.draws + 1, visibleEmitters: visible,
      agitation: meanAgitation / count, calm: meanCalm / count,
      motionPixels: meanMotion / count, phaseAdvance, anchorDrift: 0, maxTipMotion,
      shapeMotion: shapeMotion / Math.max(1, visible), shapeChange: shapeChange / Math.max(1, visible),
      textureDraws, maxHeightBreath, drawMs: performance.now() - start });
    return this.stats;
  }

  _drawEmitter(context, variant, pose, width, height, density) {
    if (this.image) {
      return this._drawBands(context, this.image, variant, pose, width);
    } else {
      // The fallback starts exactly at the source too; only its tiny upper end
      // ripples. It never substitutes pointed flame geometry.
      context.strokeStyle = variant % 3 ? '#e45f25' : '#f09a50';
      context.lineWidth = Math.max(.65, density * .9);
      context.beginPath(); context.moveTo(pose.anchorX, pose.anchorY);
      context.lineTo(pose.anchorX + width * .22 + pose.tipOffsetX * .06,
        pose.anchorY - height * .05 + pose.tipOffsetY * .06); context.stroke();
      return 0;
    }
  }

  _drawMapEmitter(context, texture, variant, pose, width, height, density) {
    if (!texture) {
      this._drawEmitter(context, variant, pose, width, height, density);
      return 0;
    }
    return this._drawBands(context, texture, variant, pose, width);
  }

  _drawBands(context, texture, variant, pose, width) {
    const sw = texture.width / 4, sh = texture.height / 2;
    const sx = (variant % 4) * sw, sy = Math.floor(variant / 4) * sh;
    context.save(); context.translate(pose.anchorX, pose.anchorY);
    for (const band of pose.bands) {
      const bandHeight = band.bottomY - band.topY;
      const shear = (band.bottomX - band.topX) / bandHeight;
      context.save(); context.transform(1, 0, shear, 1, band.topX - shear * band.topY, 0);
      context.drawImage(texture, sx, sy + band.sourceTop * sh, sw, (band.sourceBottom - band.sourceTop) * sh,
        -width / 2, band.topY, width, bandHeight);
      context.restore();
    }
    context.restore();
    return pose.bands.length;
  }

  drawSites(context, { sites = [], now = performance.now(), reducedMotion = false, scale = 1, maxSprites = 192, bounds } = {}) {
    const started = performance.now();
    if (!context) return this.siteStats;
    const firstDraw = this.lastSitesAt === null;
    const dt = firstDraw ? 0 : Math.min(.15, Math.max(0, (now - this.lastSitesAt) / 1000));
    this.lastSitesAt = now;
    const density = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const spriteLimit = Math.max(0, Math.min(192, Math.floor(maxSprites)));
    const sourceSites = (Array.isArray(sites) ? sites : []).filter(site => site && Number.isFinite(site.x) && Number.isFinite(site.y));
    const sources = new Map(sourceSites.map(site => [String(site.id), site]));
    // A small incumbent bias prevents slight heat-ranking changes from swapping
    // a visible source. Retiring slots remain in the same bounded budget until
    // their opacity reaches zero; replacements then enter with a soft attack.
    const selectionSites = sourceSites.map(site => this.siteMemory.has(String(site.id)) && clamp(site.activity ?? site.heat) > .012 ?
      { ...site, activity: clamp((site.activity ?? site.heat) + .08) } : site);
    const selected = selectHeatSites(selectionSites, spriteLimit, bounds);
    const desired = new Set(selected.map(site => String(site.id)));
    if (this.siteMemory.size > spriteLimit) {
      const excess = [...this.siteMemory].sort((a, b) => a[1].opacity - b[1].opacity);
      for (const [key] of excess.slice(0, this.siteMemory.size - spriteLimit)) this.siteMemory.delete(key);
    }
    for (const candidate of selected) {
      const key = String(candidate.id), site = sources.get(key);
      if (this.siteMemory.has(key) || this.siteMemory.size >= spriteLimit || !site || site.extinguished) continue;
      const seed = seedFor(key), phase = random(seed, 202) * Math.PI * 2;
      const activity = clamp(site.activity ?? site.heat), ember = clamp(site.ember), calm = clamp(site.calm);
      const initialOpacity = clamp((activity * .9 + ember * .12) * (1 - calm * .9)) * .72;
      this.siteMemory.set(key, { phase, initialPhase: phase, calm, activity, ember,
        opacity: firstDraw || reducedMotion ? initialOpacity : 0,
        size: random(seed, 203), site, shape: null });
    }
    const texture = this._mapTexture();
    const aspect = texture ? texture.width / 4 / (texture.height / 2) : .95;
    let visible = 0, maxTipMotion = 0, phaseAdvance = 0, shapeMotion = 0, shapeChange = 0;
    let textureDraws = 0, maxHeightBreath = 0, retiringSites = 0;
    context.save(); context.globalCompositeOperation = 'screen'; context.lineCap = 'round';
    for (const [key, memory] of this.siteMemory) {
      const source = sources.get(key);
      if (source) memory.site = source;
      const site = memory.site, out = !source || Boolean(source.extinguished);
      const selectedNow = desired.has(key) && !out;
      const active = out ? 0 : clamp(site.activity ?? site.heat), ember = out ? 0 : clamp(site.ember);
      const targetCalm = out ? 1 : clamp(site.calm);
      const opacityTarget = selectedNow ? clamp((active * .9 + ember * .12) * (1 - targetCalm * .9)) * .72 : 0;
      const opacityBlend = reducedMotion ? 1 : 1 - Math.exp(-dt / (opacityTarget > memory.opacity ? .30 : .75));
      memory.opacity += (opacityTarget - memory.opacity) * opacityBlend;
      const activityBlend = reducedMotion ? 1 : 1 - Math.exp(-dt / (active < memory.activity ? .18 : .35));
      const calmBlend = reducedMotion ? 1 : 1 - Math.exp(-dt / (targetCalm > memory.calm ? .18 : .5));
      memory.activity += (active - memory.activity) * activityBlend;
      memory.calm += (targetCalm - memory.calm) * calmBlend;
      memory.ember = ember;
      if (!selectedNow) retiringSites++;
      if (memory.opacity <= .004) {
        if (!selectedNow || opacityTarget <= .004) this.siteMemory.delete(key);
        continue;
      }
      const quiet = clamp(memory.calm), restless = clamp(memory.activity) * (1 - quiet) ** 1.4;
      const advance = reducedMotion ? 0 : dt * (.1 + restless * (.9 + memory.size * .3));
      memory.phase += advance; phaseAdvance += advance;
      const phase = reducedMotion ? memory.initialPhase : memory.phase;
      const siteScale = Number.isFinite(site.scale) && site.scale > 0 ? site.scale : 1;
      // Country-wide viewing needs enough pixels to resolve the curled grain.
      // Heat controls opacity instead of shrinking the texture into a bright
      // point. Translucent 24–36px wisps retain the exact geographic base.
      const h = (24 + memory.size * 12) * density * siteScale;
      const pose = mapHeatPose({ x: site.x, y: site.y, height: h, phase, restless,
        calm: quiet, reducedMotion, scale: density });
      const shape = pose.bands.flatMap(band => [band.topX, band.bottomX, band.topY, band.bottomY]);
      if (memory.shape) shapeChange += shape.reduce((sum, value, index) => sum + Math.abs(value - memory.shape[index]), 0) / density;
      memory.shape = shape;
      context.globalAlpha = memory.opacity;
      textureDraws += this._drawMapEmitter(context, texture, seedFor(key) % 8, pose, h * aspect, h, density,
        { key, site, memory, out });
      shapeMotion += pose.shapeMotion; maxHeightBreath = Math.max(maxHeightBreath, pose.heightBreath);
      maxTipMotion = Math.max(maxTipMotion, pose.maxTipMotion); visible++;
    }
    context.restore();
    Object.assign(this.siteStats, { draws: this.siteStats.draws + 1, visibleSites: visible,
      locatedSites: sourceSites.length, spriteLimit, drawSlots: this.siteMemory.size, retiringSites,
      pendingSites: selected.filter(site => !this.siteMemory.has(String(site.id))).length,
      anchorDrift: 0, maxTipMotion, phaseAdvance, shapeMotion: shapeMotion / Math.max(1, visible),
      shapeChange: shapeChange / Math.max(1, visible), textureDraws, maxHeightBreath,
      drawMs: performance.now() - started });
    return this.siteStats;
  }
}

// The operator's vector forest is an optional map-only renderer. Dynamic import
// keeps both these assets and their palette out of phone/section-only startup.
// The original SurfaceHeat section and atlas map remain available unchanged.
export class OperatorForest {
  constructor({ canvasFactory, smoke = true } = {}) {
    this.canvasFactory = canvasFactory || (() => typeof document === 'undefined' ? null : document.createElement('canvas'));
    this.forest = null;
    this.smoke = smoke !== false;
    this.patchVisuals = new Map();
    this.siteMemory = this.patchVisuals;
    this.operatorAt = null;
    this.terrainCache = null;
    this.terrainKey = null;
    this.siteStats = { style: 'operator', draws: 0, visibleSites: 0, locatedSites: 0,
      terrainSourceCount: 0, terrainBuilds: 0, terrainDraws: 0, fireDraws: 0, smokeDraws: 0,
      textureDraws: 0, glyphCss: 1, operatorTimeAdvance: 0, operatorTime: 0, reducedMotion: false,
      anchorDrift: 0, maxTipMotion: 0, shapeMotion: 0, shapeChange: 0, maxHeightBreath: 0,
      phaseAdvance: 0, drawSlots: 0, retiringSites: 0, pendingSites: 0, drawMs: 0 };
    this.loading = import('./map-forest.js').then(forest => { this.forest = forest; return this; });
  }

  ready() { return this.loading; }

  _forestSeed(site) {
    if (Number.isFinite(site.seed)) return site.seed >>> 0;
    if (Number.isFinite(site.gridX) && Number.isFinite(site.gridY)) {
      return (Math.imul(site.gridX, 73856093) ^ Math.imul(site.gridY, 19349663)) >>> 0;
    }
    return seedFor(site.id);
  }

  _forestOptions(site, glyphCss, density, offsetX = 0, offsetY = 0) {
    return { x: (site.x - offsetX) / density, y: (site.y - offsetY) / density,
      scale: glyphCss, seed: this._forestSeed(site) };
  }

  _prepareForestTerrain(sites, glyphCss, density) {
    const ordered = [...sites].sort((a, b) => a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id)));
    const key = JSON.stringify([glyphCss, density, ordered.map(site => [site.id, site.x, site.y, this._forestSeed(site)])]);
    if (key === this.terrainKey) return;
    this.terrainKey = key;
    const patchBounds = ordered.map(site => this.forest.forestPatchBounds({ x: site.x, y: site.y,
      scale: glyphCss * density, seed: this._forestSeed(site), layer: 'terrain' }));
    const left = patchBounds.length ? Math.floor(Math.min(...patchBounds.map(patch => patch.left))) : 0;
    const top = patchBounds.length ? Math.floor(Math.min(...patchBounds.map(patch => patch.top))) : 0;
    const right = patchBounds.length ? Math.ceil(Math.max(...patchBounds.map(patch => patch.right))) : 1;
    const bottom = patchBounds.length ? Math.ceil(Math.max(...patchBounds.map(patch => patch.bottom))) : 1;
    const bitmap = this.canvasFactory(Math.max(1, right - left), Math.max(1, bottom - top));
    if (!bitmap) { this.terrainCache = null; this.siteStats.terrainSourceCount = ordered.length; return; }
    bitmap.width = Math.max(1, right - left); bitmap.height = Math.max(1, bottom - top);
    const context = bitmap.getContext('2d');
    context.save(); context.scale(density, density);
    for (const site of ordered) {
      this.forest.drawMapForest(context, { ...this._forestOptions(site, glyphCss, density, left, top),
        layer: 'terrain', heat: 0, surfaceWetness: 0, extinguished: false, time: 0 });
    }
    context.restore();
    if (this.terrainCache?.bitmap) { this.terrainCache.bitmap.width = 1; this.terrainCache.bitmap.height = 1; }
    this.terrainCache = { bitmap, left, top };
    this.siteStats.terrainSourceCount = ordered.length;
    this.siteStats.terrainBuilds++;
  }

  drawSites(context, options = {}) {
    if (!context || !this.forest) return this.siteStats;
    const started = performance.now();
    const { sites = [], now = performance.now(), reducedMotion = false, scale = 1, bounds,
      operatorMapScale, glyphScale, smoke = this.smoke } = options;
    const density = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const dt = this.operatorAt === null ? 0 : Math.max(0, (now - this.operatorAt) / 1000);
    this.operatorAt = now;
    const sources = (Array.isArray(sites) ? sites : []).filter(site => site && Number.isFinite(site.x) && Number.isFinite(site.y))
      .sort((a, b) => a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id)));
    const requestedScale = operatorMapScale ?? glyphScale ?? (bounds?.width / density / 48);
    const glyphCss = Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : 1;
    const time = now / 1000;
    const animationTime = reducedMotion ? 0 : time;
    const retained = new Set();
    const patches = sources.map(site => {
      const key = String(site.id), heat = site.heat ?? site.activity ?? 0;
      const extinguished = Boolean(site.extinguished);
      retained.add(key);
      let visual = this.patchVisuals.get(key);
      if (!visual) {
        visual = { wasOut: extinguished, outAt: null, tailHeat: heat };
        this.patchVisuals.set(key, visual);
      }
      if (extinguished && !visual.wasOut) visual.outAt = time;
      if (!extinguished) visual.tailHeat = heat;
      visual.wasOut = extinguished;
      return { ...this._forestOptions(site, glyphCss, density), time: animationTime, heat,
        surfaceWetness: site.surfaceWetness ?? site.calm ?? 0, extinguished,
        smokeTail: site.smokeTail ?? (visual.outAt === null ? 0 : Math.max(0, 1 - (time - visual.outAt) / 3)),
        tailHeat: site.tailHeat ?? visual.tailHeat };
    });
    for (const key of this.patchVisuals.keys()) if (!retained.has(key)) this.patchVisuals.delete(key);
    this._prepareForestTerrain(sources, glyphCss, density);
    context.save(); context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1;
    if (this.terrainCache) context.drawImage(this.terrainCache.bitmap, this.terrainCache.left, this.terrainCache.top);
    context.scale(density, density);
    for (const layer of smoke ? ['fire', 'smoke'] : ['fire']) {
      for (const patch of patches) this.forest.drawMapForest(context, { ...patch, layer });
    }
    context.restore();
    Object.assign(this.siteStats, { style: 'operator', glyphCss, draws: this.siteStats.draws + 1,
      locatedSites: sources.length, visibleSites: patches.filter(patch => !patch.extinguished && patch.heat > 0).length,
      terrainDraws: this.terrainCache ? 1 : 0, fireDraws: patches.length, smokeDraws: smoke ? patches.length : 0,
      textureDraws: patches.length, spriteLimit: patches.length,
      operatorTimeAdvance: reducedMotion ? 0 : dt, operatorTime: reducedMotion ? 0 : now / 1000,
      reducedMotion: Boolean(reducedMotion), drawMs: performance.now() - started });
    return this.siteStats;
  }

  destroy() {
    this.patchVisuals.clear();
    if (this.terrainCache?.bitmap) { this.terrainCache.bitmap.width = 1; this.terrainCache.bitmap.height = 1; }
    this.terrainCache = null; this.terrainKey = null;
  }
}
