import { RainSimulation, CELL_SIZE, BRUSH_RADIUS, DEFAULT_PARAMETERS, PARAMETER_LIMITS } from './simulation.js';
import { drawMapForest, forestPatchBounds } from '../visual-assets/map-forest.js';
import { drawBrushRain } from '../visual-assets/map-weather.js';
import { SharedConnection, operatorRequest } from './shared-client.js';
import { mountSoundControls } from './sound-controls.js';
import { createParticipantSoundField, patchSoundVoices, activeSoundParticipantCount, nationalPhoneInteraction, participantSoundPosition } from './sound-participants.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#map');
const context = canvas.getContext('2d');
// The instrument layer follows input at the display refresh rate without
// repainting the geography and forests. It never changes simulated water.
const rainCanvas = document.createElement('canvas');
rainCanvas.id = 'rain-overlay';
rainCanvas.setAttribute('aria-hidden', 'true');
rainCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
canvas.after(rainCanvas);
const rainContext = rainCanvas.getContext('2d');
const state = { snapshot: null, land: null, neighbors: null, selected: null, zoom: 1, panX: 0, panY: 0, width: 0, height: 0, points: [], mapPatches: [], fetching: false, mode: 'rain', strength: .5, hoverGeo: null, pointers: new Map(), ready: false };
const simulation = new RainSimulation();
const sound = mountSoundControls(document.getElementById('operator-sound'), { mode: 'operator' });
const soundSourceKeys = new Set();
let soundField = createParticipantSoundField(), soundActors = [], localSoundGeo = null, localSoundHolding = false;
let localBellGestureAllowed = false, localSoundFocusKey = null;
const isPhone = location.pathname.startsWith('/join');
const storageKey = 'indonesia-wildfire-performance-v1';
let lastReadout = 0, lastFrame = 0;
let connection = null, sessionInfo = null, legacyPerformance = null;
let sessionRefresh = null;
let sharedState = null;
const cellTransitions = new Map();
let hasCellBaseline = false;
let snapshotReload = null;
const formatDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
const formatTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const localDateTime = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
const numberFormat = new Intl.NumberFormat('en-GB');
let frameRequested = true, overlayRequested = true, readoutsRequested = true;
const viewCache = { key: null, land: null, neighbors: null, snapshot: null, geography: document.createElement('canvas'), terrain: document.createElement('canvas'), landPath: null, patches: [] };
const visualRainClouds = new Map();
const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const patchVisuals = new Map();

// A single 128px bitmap is repeated by CSS. No noise generation, filters, or
// large texture uploads compete with pointer input during the performance.
function prepareGrain() {
  const tile = document.createElement('canvas'); tile.width = tile.height = 128;
  const ctx = tile.getContext('2d'), pixels = ctx.createImageData(128, 128);
  let seed = 0x53a9f;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const shade = (seed >>> 8) & 1 ? 255 : 0;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = shade;
    pixels.data[i + 3] = 18 + (seed & 31);
  }
  ctx.putImageData(pixels, 0, 0);
  document.documentElement.style.setProperty('--grain-image', `url("${tile.toDataURL('image/png')}")`);
}
prepareGrain();

function rainCloudStop(id) {
  const cloud = visualRainClouds.get(id);
  if (cloud) { cloud.releasedAt = performance.now() / 1000; cloud.amount = state.strength; }
}

const cellKey = (longitude, latitude) => `${Math.floor(longitude / CELL_SIZE)},${Math.floor(latitude / CELL_SIZE)}`;

function mapScale() {
  return Math.min((state.width - 65) / 49, (state.height - 90) / 22) * state.zoom;
}

function buildMapPatches(records) {
  const patches = new Map();
  records.forEach((record, index) => {
    const cell = simulation.sample(record.longitude, record.latitude), key = cellKey(record.longitude, record.latitude);
    const gridX = Math.floor(record.longitude / CELL_SIZE), gridY = Math.floor(record.latitude / CELL_SIZE);
    const seed = (Math.imul(gridX, 73856093) ^ Math.imul(gridY, 19349663)) >>> 0;
    if (!patches.has(key)) patches.set(key, { key, longitude: cell.longitude, latitude: cell.latitude, indices: [], seed });
    patches.get(key).indices.push(index);
  });
  // North-to-south painting puts nearer tree trunks in front of rear ones.
  state.mapPatches = [...patches.values()].sort((a, b) => b.latitude - a.latitude || a.longitude - b.longitude);
  for (const key of patchVisuals.keys()) if (!patches.has(key)) patchVisuals.delete(key);
}

// Network and pointer events only mark work. One frame loop owns drawing.
function scheduleDraw() { frameRequested = true; overlayRequested = true; }
function scheduleReadouts() { readoutsRequested = true; }

function dimensions() {
  const rect = canvas.getBoundingClientRect();
  state.width = rect.width;
  state.height = rect.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  rainCanvas.width = canvas.width; rainCanvas.height = canvas.height;
  rainContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  scheduleDraw();
}

function project(longitude, latitude) {
  const scale = mapScale();
  return [state.width / 2 + (longitude - 118) * scale + state.panX, state.height / 2 - (latitude + 2.9) * scale + state.panY];
}

function unproject(x, y) {
  const scale = mapScale();
  return [(x - state.width / 2 - state.panX) / scale + 118, -(y - state.height / 2 - state.panY) / scale - 2.9];
}

function eventPosition(event) {
  const bounds = canvas.getBoundingClientRect();
  return [event.clientX - bounds.left, event.clientY - bounds.top];
}

function readLegacyPerformance() {
  if (isPhone) return;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved?.version === 1 && new RainSimulation().restore(saved.simulation)) legacyPerformance = saved;
  } catch { /* An unreadable browser backup never replaces the shared server state. */ }
}

function syncTimingControls() {
  for (const input of document.querySelectorAll('[data-parameter]')) {
    const key = input.dataset.parameter, value = simulation.parameters[key], limits = PARAMETER_LIMITS[key];
    input.min = limits.min; input.max = limits.max; input.step = limits.step;
    if (document.activeElement === input) continue;
    input.value = value;
    input.setAttribute('aria-valuetext', `${value} seconds`);
    const output = $(`#${input.id}-value`), text = `${value} s`;
    if (output.textContent !== text) output.textContent = text;
  }
  $('#extinction-hold-info').textContent = `${simulation.parameters.extinctionHoldSeconds} seconds`;
}

function interpolateSharedDisplay(now) {
  for (const [key, transition] of cellTransitions) {
    const cell = simulation.cells.get(key);
    if (!cell) { cellTransitions.delete(key); continue; }
    const mix = Math.min(1, Math.max(0, (now - transition.at) / 100));
    cell.surfaceWetness = mix === 1 ? transition.surfaceTo : transition.surfaceFrom + (transition.surfaceTo - transition.surfaceFrom) * mix;
    cell.moisture = mix === 1 ? transition.moistureTo : transition.moistureFrom + (transition.moistureTo - transition.moistureFrom) * mix;
    cell.heat = mix === 1 ? transition.heatTo : transition.heatFrom + (transition.heatTo - transition.heatFrom) * mix;
    if (mix === 1) cellTransitions.delete(key);
  }
}

function applyCellUpdate(wire, reset) {
  const now = performance.now(), immediate = reset || !hasCellBaseline;
  interpolateSharedDisplay(now);
  const present = wire.delta ? null : new Set();
  if (reset) cellTransitions.clear();
  for (const [longitude, latitude, surfaceWetness, moisture, heat, extinguished, settledFor, hasFire] of wire.cells) {
    const key = cellKey(longitude, latitude);
    present?.add(key);
    let cell = simulation.cells.get(key);
    if (!cell) {
      cell = { longitude, latitude, surfaceWetness, moisture, heat, extinguished, settledFor, hasFire };
      simulation.cells.set(key, cell);
    } else if (immediate) {
      cell.surfaceWetness = surfaceWetness; cell.moisture = moisture; cell.heat = heat;
    } else if (cell.surfaceWetness !== surfaceWetness || cell.moisture !== moisture || cell.heat !== heat) {
      let transition = cellTransitions.get(key);
      if (!transition) { transition = {}; cellTransitions.set(key, transition); }
      transition.at = now;
      transition.surfaceFrom = cell.surfaceWetness; transition.surfaceTo = surfaceWetness;
      transition.moistureFrom = cell.moisture; transition.moistureTo = moisture;
      transition.heatFrom = cell.heat; transition.heatTo = heat;
    } else cellTransitions.delete(key);
    cell.extinguished = extinguished; cell.settledFor = settledFor; cell.hasFire = hasFire;
  }
  const removed = wire.delta ? wire.removed || [] : [...simulation.cells.keys()].filter(key => !present.has(key));
  for (const key of removed) { simulation.cells.delete(key); cellTransitions.delete(key); }
  simulation.totalWater = wire.totalWater;
  if (wire.parameters && Object.keys(wire.parameters).some(key => simulation.parameters[key] !== wire.parameters[key])) {
    simulation.setParameters(wire.parameters); syncTimingControls();
  }
  hasCellBaseline = true;
}

function syncSoundPatches() {
  const patches = [];
  soundSourceKeys.clear();
  for (const source of simulation.sourceRecords) {
    const key = cellKey(source.longitude, source.latitude);
    if (soundSourceKeys.has(key)) continue;
    soundSourceKeys.add(key);
    const cell = simulation.cells.get(key), target = cellTransitions.get(key);
    // Display interpolation changes cell values between packets. Its target
    // values are the venue state; sound never follows the decorative frames.
    patches.push({
      key,
      longitude: cell?.longitude ?? (Math.floor(source.longitude / CELL_SIZE) + .5) * CELL_SIZE,
      latitude: cell?.latitude ?? (Math.floor(source.latitude / CELL_SIZE) + .5) * CELL_SIZE,
      heat: target?.heatTo ?? cell?.heat ?? 1,
      extinguished: cell?.extinguished ?? false,
      surfaceWetness: target?.surfaceTo ?? cell?.surfaceWetness ?? 0,
      moisture: target?.moistureTo ?? cell?.moisture ?? 0,
    });
  }
  sound.setPatches(patches);
  soundField = createParticipantSoundField(patches);
  syncSoundParticipants();
}

function syncSoundParticipants() {
  const options = {
    excludeId: connection?.clientId, localPosition: localSoundGeo, localHolding: localSoundHolding,
  };
  sound.setAudienceParticipationCount(activeSoundParticipantCount(soundActors, soundField, options));
  sound.setPatchVoices(patchSoundVoices(soundActors, soundField, options));
  if (isPhone) return;
  const eligible = localBellGestureAllowed && sound.enabled && !sound.muted && !sound.hidden;
  if (!eligible) localBellGestureAllowed = false;
  const interaction = nationalPhoneInteraction(soundField.patches, participantSoundPosition(localSoundGeo), {
    holding: localSoundHolding && eligible, eligible, preferredKey: localSoundFocusKey,
  });
  localSoundFocusKey = interaction.patchKey;
  sound.setLocalInteraction?.(interaction);
}

function touchSoundAt(geo) {
  if (!localSoundHolding) localBellGestureAllowed = sound.state === 'ready' && sound.enabled && !sound.muted && !sound.hidden;
  localSoundGeo = geo ? [...geo] : null;
  localSoundHolding = true;
  syncSoundParticipants();
}

function releaseLocalSound() {
  localSoundHolding = false; localBellGestureAllowed = false;
  syncSoundParticipants();
}

function text(selector, value) {
  const element = $(selector);
  if (element && element.textContent !== String(value)) element.textContent = value;
}

async function refreshSessionInfo() {
  if (sessionRefresh) return sessionRefresh;
  sessionRefresh = fetch('/api/session', { cache: 'no-store' }).then(async response => {
    if (!response.ok) throw new Error('The venue session could not be loaded.');
    const next = await response.json(), previousJoinUrl = sessionInfo?.joinUrl;
    sessionInfo = next;
    const link = $('#join-url'), qr = $('#join-qr');
    if (link && next.joinUrl) { link.href = next.joinUrl; text('#join-url', next.joinUrl); }
    if (qr) {
      qr.hidden = !next.joinUrl;
      if (next.joinUrl && next.joinUrl !== previousJoinUrl) qr.src = `/api/qr.svg?network=${encodeURIComponent(next.joinUrl)}`;
    }
    text('#lan-note', next.lanEnabled ? 'Phone and laptop must use the same Wi-Fi.' : 'Start the server with npm run start:lan to enable phones on your Wi-Fi.');
    text('#storage-status', 'Shared performance saves on the laptop and continues when this display is hidden.');
    return next;
  }).finally(() => { sessionRefresh = null; });
  return sessionRefresh;
}

function refreshAudienceSession() {
  if ($('#audience-panel')?.open) refreshSessionInfo().catch(() => {});
}

function connectionStatus(status) {
  if (status === 'disconnected' || status === 'connecting') {
    soundActors = []; localSoundGeo = null; localSoundHolding = false;
    syncSoundParticipants();
    if (state.pointers.size) stopAllPointers();
    for (const [id, cloud] of visualRainClouds) if (cloud.releasedAt === null) rainCloudStop(id);
    text('#connection-state', status === 'connecting' ? 'Connecting to venue…' : 'Reconnecting — not contributing.');
    text('#local-input-state', 'Not contributing. Reconnect, then press again.');
  } else {
    text('#connection-state', connection?.ready ? 'Connected to shared landscape.' : 'Connected — waiting for operator to start.');
    text('#local-input-state', connection?.holding ? (connection.acknowledged ? 'Pouring · acknowledged by venue.' : 'Touch received locally · awaiting acknowledgment.') : (connection?.ready ? 'Ready. Hold on the map to pour.' : 'Waiting for operator.'));
  }
  scheduleReadouts();
}

function receiveSharedState(packet, { reset }) {
  if (reset) { soundActors = []; localSoundGeo = null; stopAllPointers(); sound.reset(packet.epoch); patchVisuals.clear(); visualRainClouds.clear(); }
  sharedState = packet;
  state.strength = packet.strength;
  if (document.activeElement !== $('#rain-strength')) {
    $('#rain-strength').value = state.strength;
    text('#strength-value', `${Math.round(state.strength * 100)}%`);
  }
  const wire = packet.simulation;
  if (wire?.wireFormat === 'compact-v1') { applyCellUpdate(wire, reset); syncSoundPatches(); }
  receiveActors(packet);
  const bootstrap = $('#bootstrap-panel');
  if (bootstrap) bootstrap.hidden = !packet.bootstrapAvailable;
  const restore = $('#restore-browser');
  if (restore) restore.hidden = !legacyPerformance;
  if (packet.snapshotVersion && state.snapshot?.fetchedAt !== packet.snapshotVersion && !snapshotReload) {
    snapshotReload = fetch('/api/snapshot', { cache: 'no-store' }).then(response => response.json()).then(showSnapshot).catch(error => notify(error.message, true)).finally(() => { snapshotReload = null; });
  }
  scheduleReadouts(); scheduleDraw();
}

function receiveActors(packet) {
  soundActors = packet.participants || [];
  syncSoundParticipants();
  if (sharedState) {
    sharedState.participants = packet.participants;
    sharedState.joinedCount = packet.joinedCount;
    sharedState.activeCount = packet.activeCount;
  }
  const active = new Set();
  for (const actor of packet.participants || []) {
    // Our gesture is drawn directly from input, including while its server
    // acknowledgment is pending. A delayed echo must never create a second
    // brush or resurrect a gesture that was already released locally.
    if (actor.id === connection?.clientId) { visualRainClouds.delete(actor.id); continue; }
    if (!actor.holding || !actor.position) continue;
    const id = actor.id, now = performance.now() / 1000;
    active.add(id);
    const previous = visualRainClouds.get(id);
    if (previous?.releasedAt === null && previous.geo[0] === actor.position[0] && previous.geo[1] === actor.position[1]) continue;
    const from = previous ? cloudPosition(previous, now) : actor.position;
    visualRainClouds.set(id, { geo: [...actor.position], from: [...from], updatedAt: now, releasedAt: null, number: actor.number, role: actor.role, amount: state.strength });
  }
  for (const [id, cloud] of visualRainClouds) if (!active.has(id) && cloud.releasedAt === null) rainCloudStop(id);
  text('#audience-count', packet.joinedCount);
  text('#active-count', packet.activeCount);
  scheduleReadouts(); overlayRequested = true;
}

function fitActiveRain() {
  stopAllPointers();
  const points = (sharedState?.participants || []).filter(actor => actor.holding).map(actor => actor.position);
  if (!points.length) return;
  const west = Math.min(...points.map(point => point[0])) - BRUSH_RADIUS * 2, east = Math.max(...points.map(point => point[0])) + BRUSH_RADIUS * 2;
  const south = Math.min(...points.map(point => point[1])) - BRUSH_RADIUS * 2, north = Math.max(...points.map(point => point[1])) + BRUSH_RADIUS * 3;
  const base = Math.min((state.width - 65) / 49, (state.height - 90) / 22);
  state.zoom = Math.max(1, Math.min(10, Math.min((state.width - 50) / (east - west), (state.height - 50) / (north - south)) / base));
  const scale = mapScale();
  state.panX = -(0.5 * (west + east) - 118) * scale;
  state.panY = (0.5 * (south + north) + 2.9) * scale;
  state.hoverGeo = null; scheduleDraw();
}

const percent = value => `${Math.round(value * 100)}%`;

function updateReadouts() {
  const stats = simulation.stats();
  $('#simulation-status').textContent = `Wet patches: ${stats.wetCells}. Out: ${stats.extinguishedCells} / ${stats.fireCells} fire patches.`;
  const raining = [...state.pointers.values()].filter(pointer => pointer.mode === 'rain').length;
  canvas.classList.toggle('pouring', state.mode === 'rain' && raining > 0);
  const rainText = raining ? (connection?.acknowledged ? 'Your rain acknowledged.' : 'Touch received; waiting for venue.') : 'Rain idle.';
  if ($('#rain-status').textContent !== rainText) $('#rain-status').textContent = rainText;
  const offscreen = (sharedState?.participants || []).filter(actor => {
    if (!actor.holding || !actor.position) return false;
    const [x, y] = project(...actor.position);
    return x < 0 || x > state.width || y < 0 || y > state.height;
  }).length;
  text('#offscreen-active', offscreen ? `${offscreen} active rain ${offscreen === 1 ? 'area is' : 'areas are'} offscreen.` : '');
  if ($('#fit-active')) $('#fit-active').disabled = !(sharedState?.participants || []).some(actor => actor.holding);
  if (state.hoverGeo && state.mode === 'rain') {
    const area = simulation.sampleArea(...state.hoverGeo);
    $('#brush-readout').textContent = area.coveredFraction > 0
      ? `Brush area average: surface ${percent(area.surfaceWetness)}, moisture ${percent(area.moisture)}, heat ${percent(area.heat)}.${area.coveredFraction < .999 ? ` (${percent(area.coveredFraction)} of circle modeled.)` : ''}`
      : 'Brush area: outside the modeled area.';
  } else $('#brush-readout').textContent = state.mode === 'rain' ? 'Brush: move over the map.' : 'Move map: drag to pan.';
  const record = state.snapshot?.records[state.selected];
  $('#point-performance').hidden = !record;
  if (record) {
    const cell = simulation.sample(record.longitude, record.latitude);
    $('#point-performance').textContent = `Performance patch: surface wetness ${percent(cell.surfaceWetness)} · moisture ${percent(cell.moisture)} · residual heat ${percent(cell.heat)} · ${cell.extinguished ? 'out' : cell.surfaceWetness > .6 || cell.heat < .3 ? 'surface quiet / embers' : 'active'}.`;
  }
}

function traceGeometry(geometry, target) {
  if (!geometry) return;
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : geometry.type === 'Polygon' ? [geometry.coordinates] : [];
  for (const polygon of polygons) for (const ring of polygon) {
    ring.forEach((coordinate, i) => { const point = project(coordinate[0], coordinate[1]); i === 0 ? target.moveTo(...point) : target.lineTo(...point); });
    target.closePath();
  }
}

function landFeatures(data) {
  if (!data) return [];
  return data.type === 'FeatureCollection' ? data.features : data.type === 'Feature' ? [data] : [{ geometry: data }];
}

// Geography, projected hit targets and unchanging forest terrain are rebuilt
// only when the view or source snapshot changes. Animation uses these bitmaps.
function prepareView() {
  const key = `${canvas.width},${canvas.height},${state.width},${state.height},${state.zoom},${state.panX},${state.panY}`;
  if (viewCache.key === key && viewCache.land === state.land && viewCache.neighbors === state.neighbors && viewCache.snapshot === state.snapshot) return;
  viewCache.key = key; viewCache.land = state.land; viewCache.neighbors = state.neighbors; viewCache.snapshot = state.snapshot;
  const dpr = canvas.width / state.width || 1;
  for (const layer of [viewCache.geography, viewCache.terrain]) { layer.width = canvas.width; layer.height = canvas.height; layer.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); }
  const base = viewCache.geography.getContext('2d');
  viewCache.landPath = new Path2D();
  for (const [data, fill, stroke, lineWidth] of [[state.neighbors, '#39302d', '#59463e', .65], [state.land, '#806254', '#bc9380', .75]]) {
    for (const feature of landFeatures(data)) {
      const path = new Path2D(); traceGeometry(feature.geometry, path);
      base.fillStyle = fill; base.fill(path, 'evenodd');
      base.strokeStyle = stroke; base.lineWidth = lineWidth; base.stroke(path);
      if (data === state.land) viewCache.landPath.addPath(path);
    }
  }
  const records = state.snapshot?.records || [], scale = mapScale();
  state.points = records.map((record, index) => {
    const [x, y] = project(record.longitude, record.latitude);
    return { x, y, index, key: cellKey(record.longitude, record.latitude) };
  });
  viewCache.patches = [];
  const terrain = viewCache.terrain.getContext('2d');
  for (const patch of state.mapPatches) {
    const [x, y] = project(patch.longitude, patch.latitude);
    patch.x = x; patch.y = y; patch.bounds = forestPatchBounds({ x, y, scale, seed: patch.seed, layer: 'terrain' });
    const bounds = forestPatchBounds({ x, y, scale, seed: patch.seed });
    if (bounds.right < 0 || bounds.left > state.width || bounds.bottom < 0 || bounds.top > state.height) continue;
    const visible = { key: patch.key, x, y, scale, time: 0, heat: 0, surfaceWetness: 0, extinguished: false, smokeTail: 0, tailHeat: 0, seed: patch.seed, layer: 'terrain' };
    viewCache.patches.push(visible);
    drawMapForest(terrain, visible);
  }
}

function draw() {
  const { width, height } = state;
  if (!width || !height) return;
  const time = performance.now() / 1000;
  prepareView();
  context.clearRect(0, 0, width, height);
  context.save();
  context.drawImage(viewCache.geography, 0, 0, width, height);
  const scale = mapScale();
  if (state.land) {
    context.save(); context.clip(viewCache.landPath, 'evenodd');
    const size = CELL_SIZE * scale;
    for (const cell of simulation.cells.values()) {
      const alpha = Math.max(cell.surfaceWetness * .35, cell.moisture * .55);
      if (alpha < .004) continue;
      const [x, y] = project(cell.longitude - CELL_SIZE / 2, cell.latitude + CELL_SIZE / 2);
      if (x + size < 0 || x > width || y + size < 0 || y > height) continue;
      context.fillStyle = `rgba(126, 171, 182, ${alpha})`;
      context.fillRect(x, y, size + .2, size + .2);
    }
    context.restore();
  }
  context.drawImage(viewCache.terrain, 0, 0, width, height);
  for (const patch of viewCache.patches) {
    const cell = simulation.cells.get(patch.key);
    const heat = cell?.heat || 0, extinguished = cell?.extinguished || false;
    let visual = patchVisuals.get(patch.key);
    if (!visual) { visual = { wasOut: extinguished, outAt: null, tailHeat: heat }; patchVisuals.set(patch.key, visual); }
    if (extinguished && !visual.wasOut) visual.outAt = time;
    if (!extinguished) visual.tailHeat = heat;
    visual.wasOut = extinguished;
    patch.time = prefersReducedMotion.matches ? 0 : time;
    patch.heat = heat; patch.surfaceWetness = cell?.surfaceWetness || 0; patch.extinguished = extinguished;
    patch.smokeTail = visual.outAt === null ? 0 : Math.max(0, 1 - (time - visual.outAt) / 3);
    patch.tailHeat = visual.tailHeat;
  }
  // Terrain is cached; wet marks, flames, embers and smoke remain responsive.
  for (const layer of ['fire', 'smoke']) for (const patch of viewCache.patches) { patch.layer = layer; drawMapForest(context, patch); }
  if (state.zoom < 2.5) {
    context.textAlign = 'center'; context.font = '10px monospace'; context.fillStyle = '#e2cabb';
    const labels = [['Sumatra', 100.7, -.8], ['Java', 110.4, -8.6], ['Kalimantan', 114.5, .3], ['Sulawesi', 121.7, -1.9], ['Papua', 136.3, -4.4], ['Maluku', 128.4, -3], ['Nusa Tenggara', 120.5, -10.4]];
    for (const [text, lon, lat] of labels) { const [x, y] = project(lon, lat); context.fillText(text, x, y + 10); }
  }
  context.restore();
}

// Remote actors retain a short visual ease. Local rain has no network wait or
// interpolation: its only delay is the next browser animation frame.
function cloudPosition(cloud, time) {
  const mix = Math.min(1, Math.max(0, (time - cloud.updatedAt) / .03));
  return cloud.from ? [cloud.from[0] + (cloud.geo[0] - cloud.from[0]) * mix, cloud.from[1] + (cloud.geo[1] - cloud.from[1]) * mix] : cloud.geo;
}

function drawRainCloud(cloud, geo, time, age = 0) {
  const [cx, cy] = project(...geo), radius = BRUSH_RADIUS * mapScale();
  const active = cloud.releasedAt === null;
  rainContext.save(); rainContext.globalAlpha = active ? .95 : Math.max(0, 1 - age / .8);
  drawBrushRain(rainContext, { x: cx, y: cy, radius, time: prefersReducedMotion.matches ? 0 : time, amount: active ? state.strength : 0, tail: active ? 0 : 1 - age / .8, tailAmount: cloud.amount ?? state.strength, rainColor: '#b5d6e1' });
  const label = cloud.role === 'operator' ? 'Local' : `#${cloud.number}`;
  rainContext.strokeStyle = cloud.role === 'operator' ? '#ead4be' : `hsl(${((cloud.number || 1) * 137) % 360} 28% 78%)`;
  rainContext.lineWidth = 1.5; rainContext.beginPath(); rainContext.arc(cx, cy, radius, 0, Math.PI * 2); rainContext.stroke();
  rainContext.font = '11px monospace'; rainContext.textAlign = 'center';
  const labelWidth = rainContext.measureText(label).width + 8;
  const labelX = cx + (cloud.role === 'operator' ? 0 : ((cloud.number % 3) - 1) * (radius * .8 + 10));
  const labelY = cy - radius * 2.15 - 5 - (cloud.role === 'operator' ? 0 : (Math.floor(cloud.number / 3) % 2) * 15);
  rainContext.fillStyle = '#281f1def'; rainContext.fillRect(labelX - labelWidth / 2, labelY - 11, labelWidth, 15);
  rainContext.fillStyle = '#f4e5d7'; rainContext.fillText(label, labelX, labelY);
  rainContext.restore();
}

function drawRainOverlay(now) {
  const time = now / 1000;
  rainContext.clearRect(0, 0, state.width, state.height);
  for (const [id, cloud] of visualRainClouds) {
    if (id === connection?.clientId) { visualRainClouds.delete(id); continue; }
    const age = cloud.releasedAt === null ? 0 : time - cloud.releasedAt;
    if (age >= .8) { visualRainClouds.delete(id); continue; }
    drawRainCloud(cloud, cloudPosition(cloud, time), time, age);
  }
  const pointer = connection?.holding ? [...state.pointers.values()].find(pointer => pointer.mode === 'rain') : null;
  if (pointer) {
    drawRainCloud({ role: connection.role, number: connection.participantNumber, releasedAt: null }, pointer.path.at(-1), time);
  } else if (state.mode === 'rain' && state.hoverGeo) {
    const [x, y] = project(...state.hoverGeo);
    rainContext.strokeStyle = '#bad2db'; rainContext.lineWidth = 1;
    rainContext.beginPath(); rainContext.arc(x, y, BRUSH_RADIUS * mapScale(), 0, Math.PI * 2); rainContext.stroke();
  }
  overlayRequested = false;
}

function notify(message, isError = false) {
  const box = $('#status-message'); box.hidden = !message; box.textContent = message; box.classList.toggle('error', isError);
}

function period(start, end, compact = false) {
  if (!start || !end) return 'No observations in this snapshot';
  const first = new Date(start), last = new Date(end);
  if (formatDate.format(first) === formatDate.format(last)) return `${formatDate.format(first)}${compact ? ' · ' : '\n'}${formatTime.format(first)}–${formatTime.format(last)}${compact ? ' UTC' : ' UTC'}`;
  return `${formatDate.format(first)} ${formatTime.format(first)} – ${formatDate.format(last)} ${formatTime.format(last)} UTC`;
}

function showSnapshot(snapshot) {
  if (!Array.isArray(snapshot.records)) throw new Error('The server returned an invalid snapshot.');
  state.snapshot = snapshot; state.selected = null;
  simulation.sourceRecords = snapshot.records.map(({ longitude, latitude }) => ({ longitude, latitude }));
  buildMapPatches(snapshot.records);
  if (hasCellBaseline) syncSoundPatches();
  $('#detection-count').textContent = numberFormat.format(snapshot.records.length);
  $('#map-period').textContent = period(snapshot.observationStart, snapshot.observationEnd, true);
  $('#observation-period').textContent = period(snapshot.observationStart, snapshot.observationEnd);
  $('#observation-period').style.whiteSpace = 'pre-line';
  $('#fetched-at').textContent = localDateTime.format(new Date(snapshot.fetchedAt));
  $('#sensor-value').textContent = 'VIIRS / NOAA-20';
  $('#inspection-hint').hidden = false; $('#observation-details').hidden = true; $('#browse-previous').hidden = true;
  $('#browse-next').disabled = !snapshot.records.length; $('#browse-next').textContent = 'Next point';
  $('#source-link').href = snapshot.source.documentationUrl || 'https://firms.modaps.eosdis.nasa.gov/';
  $('#raw-source-link').href = snapshot.source.url;
  $('#source-extra').textContent = `Snapshot fetched ${new Date(snapshot.fetchedAt).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}. ${snapshot.records.length.toLocaleString()} detections retained after country filtering. Source: ${snapshot.source.name}.`;
  $('#map-empty').hidden = snapshot.records.length > 0;
  $('#map-empty').textContent = 'No detections inside Indonesia in this feed. Fetch again later to check for a new snapshot.';
  canvas.setAttribute('aria-label', `Indonesia performance map. ${state.mapPatches.length} forest and land patches represent ${snapshot.records.length} satellite thermal detections. ${period(snapshot.observationStart, snapshot.observationEnd, true)}. Hold and drag to pour rain. Local flames fade to embers and burned remains as patches cool. Move map mode: drag to pan. Use Next point to inspect original observations.`);
  const ageHours = snapshot.observationEnd ? Math.max(0, (Date.now() - new Date(snapshot.observationEnd)) / 3_600_000) : null;
  $('#fetch-note').textContent = ageHours !== null ? `Latest observation: ${Math.floor(ageHours)}h ago · refreshes on request.` : 'Downloads the latest available NASA 24-hour feed.';
  scheduleReadouts(); scheduleDraw();
}

async function fetchLatest() {
  if (isPhone) return;
  if (state.fetching) return;
  state.fetching = true;
  const button = $('#fetch-button'); button.disabled = true; button.classList.add('fetching'); button.querySelector('span').textContent = 'Fetching from NASA…';
  notify('Fetching NASA snapshot…');
  try {
    const response = await fetch('/api/snapshot/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Snapshot download failed.');
    showSnapshot(data);
    notify(`Fetched ${numberFormat.format(data.records.length)} detections.`);
  } catch (error) {
    notify(`${error.message} ${state.snapshot ? 'The previous successful snapshot is still shown.' : 'No snapshot is loaded yet.'}`, true);
  } finally {
    state.fetching = false; button.disabled = false; button.classList.remove('fetching'); button.querySelector('span').textContent = 'Fetch latest snapshot';
  }
}

function inspect(index) {
  const records = state.snapshot?.records;
  if (!records?.length) return;
  state.selected = (index + records.length) % records.length;
  const record = records[state.selected];
  $('#inspection-hint').hidden = true; $('#observation-details').hidden = false; $('#browse-previous').hidden = false;
  const values = [
    ['Observation', `${state.selected + 1} / ${numberFormat.format(records.length)}`],
    ['Date · UTC', formatDate.format(new Date(record.observedAt))],
    ['Time · UTC', formatTime.format(new Date(record.observedAt))],
    ['Latitude', `${Number(record.latitude).toFixed(4)}°`],
    ['Longitude', `${Number(record.longitude).toFixed(4)}°`],
    ['Radiative power', record.frp == null ? 'Unavailable' : `${Number(record.frp).toFixed(1)} MW`],
    ['Confidence', ({ n: 'Nominal', h: 'High', l: 'Low' })[String(record.confidence).toLowerCase()] || record.confidence || 'Unavailable'],
    ['Day / night', ({ D: 'Day', N: 'Night' })[record.dayNight] || record.dayNight || 'Unavailable'],
  ];
  $('#observation-details').replaceChildren(...values.flatMap(([label, value]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; return [dt, dd]; }));
  $('#browse-next').textContent = 'Next point';
  scheduleReadouts();
  scheduleDraw();
}

function closest(x, y) {
  let found = null, distance = Infinity;
  for (const patch of state.mapPatches) {
    const b = patch.bounds;
    if (!b || x < b.left - 3 || x > b.right + 3 || y < b.top - 3 || y > b.bottom + 3) continue;
    const d = (patch.x - x) ** 2 + (patch.y - y) ** 2;
    if (d >= distance) continue;
    distance = d;
    found = patch.indices.map(index => state.points[index]).reduce((nearest, point) => !nearest || (point.x - x) ** 2 + (point.y - y) ** 2 < (nearest.x - x) ** 2 + (nearest.y - y) ** 2 ? point : nearest, null);
  }
  return found;
}

function zoomBy(factor, x = state.width / 2, y = state.height / 2) {
  stopAllPointers();
  const previous = state.zoom;
  state.zoom = Math.max(1, Math.min(10, state.zoom * factor));
  const ratio = state.zoom / previous;
  state.panX = (state.panX + state.width / 2 - x) * ratio - state.width / 2 + x;
  state.panY = (state.panY + state.height / 2 - y) * ratio - state.height / 2 + y;
  if (state.zoom === 1) { state.panX = 0; state.panY = 0; }
  $('#map-tooltip').hidden = true; scheduleDraw();
}

function stopAllPointers() {
  const pointerIds = [...state.pointers.keys()];
  state.pointers.clear();
  connection?.stop();
  releaseLocalSound();
  for (const id of pointerIds) if (typeof id === 'number' && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  canvas.classList.remove('dragging', 'pouring');
  scheduleReadouts(); scheduleDraw();
}

function setMode(mode) {
  stopAllPointers(); state.mode = mode;
  canvas.classList.toggle('rain-mode', mode === 'rain'); canvas.style.cursor = '';
  $('#mode-rain').setAttribute('aria-pressed', String(mode === 'rain'));
  $('#mode-move').setAttribute('aria-pressed', String(mode === 'move'));
  $('#mode-hint').textContent = mode === 'rain'
    ? (isPhone ? 'Rain: touch and hold to pour; drag to spread. Use + / − to zoom.' : 'Rain: hold to pour; drag to spread. Scroll to zoom. Space pours at the selected patch.')
    : (isPhone ? 'Move map: drag to pan; tap a forest patch to inspect.' : 'Move map: drag to pan; click a forest patch to inspect. Scroll to zoom.');
  $('#map-tooltip').hidden = true; scheduleReadouts(); scheduleDraw();
}

canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !state.ready) return;
  if (state.pointers.size) return;
  event.preventDefault();
  const [x, y] = eventPosition(event), geo = unproject(x, y);
  state.hoverGeo = geo;
  if (state.mode === 'rain' && !connection?.begin(geo)) {
    text('#local-input-state', connection?.connected ? 'Waiting for the operator to start.' : 'Touch received locally; reconnect, then press again.');
    scheduleDraw(); return;
  }
  state.pointers.set(event.pointerId, { mode: state.mode, path: [geo], x: event.clientX, y: event.clientY, startX: state.panX, startY: state.panY, moved: false });
  if (state.mode === 'rain') touchSoundAt(geo);
  canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true });
  if (state.mode === 'move') canvas.classList.add('dragging');
  else { canvas.classList.add('pouring'); const point = closest(x, y); if (point) inspect(point.index); }
  $('#map-tooltip').hidden = true; scheduleReadouts(); scheduleDraw();
});
canvas.addEventListener('pointermove', event => {
  const [x, y] = eventPosition(event), geo = unproject(x, y);
  state.hoverGeo = geo;
  const pointer = state.pointers.get(event.pointerId);
  if (pointer) {
    if (pointer.mode === 'rain') {
      const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
      for (const sample of events.length ? events : [event]) connection?.move(unproject(...eventPosition(sample)));
      pointer.path = [geo];
      touchSoundAt(geo);
    } else {
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      if (Math.hypot(dx, dy) > 4) pointer.moved = true;
      if (pointer.moved) { state.panX = pointer.startX + dx; state.panY = pointer.startY + dy; }
    }
    $('#map-tooltip').hidden = true;
  } else if (state.mode === 'move') {
    const point = closest(x, y), tooltip = $('#map-tooltip');
    tooltip.hidden = !point; canvas.style.cursor = point ? 'pointer' : 'grab';
    if (point) {
      const record = state.snapshot.records[point.index];
      tooltip.textContent = `${record.frp == null ? 'FRP unavailable' : `${Number(record.frp).toFixed(1)} MW`} · ${formatTime.format(new Date(record.observedAt))} UTC`;
      tooltip.style.left = `${Math.max(8, Math.min(x + 14, state.width - 180))}px`; tooltip.style.top = `${Math.max(8, y - 38)}px`;
    }
  }
  scheduleDraw();
});

function stopPointer(event) {
  const pointer = state.pointers.get(event.pointerId);
  if (!pointer) return;
  if (event.type === 'pointerup' && pointer.mode === 'rain') { state.hoverGeo = unproject(...eventPosition(event)); connection?.move(state.hoverGeo); localSoundGeo = [...state.hoverGeo]; }
  state.pointers.delete(event.pointerId);
  if (pointer.mode === 'rain') { connection?.stop(); releaseLocalSound(); }
  if (event.type === 'pointerup' && pointer.mode === 'move' && !pointer.moved) {
    const point = closest(...eventPosition(event)); if (point) inspect(point.index);
  }
  canvas.classList.remove('dragging', 'pouring'); scheduleReadouts(); scheduleDraw();
}
canvas.addEventListener('pointerup', stopPointer);
canvas.addEventListener('pointercancel', stopPointer);
canvas.addEventListener('lostpointercapture', stopPointer);
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('pointerleave', () => { $('#map-tooltip').hidden = true; if (!state.pointers.size) state.hoverGeo = null; scheduleDraw(); });
canvas.addEventListener('wheel', event => { event.preventDefault(); const rect = canvas.getBoundingClientRect(); zoomBy(event.deltaY < 0 ? 1.14 : 1 / 1.14, event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });
canvas.addEventListener('keydown', event => {
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); inspect((state.selected ?? -1) + (event.key === 'ArrowRight' ? 1 : -1)); }
  if (event.key === '+' || event.key === '=') zoomBy(1.4);
  if (event.key === '-') zoomBy(1 / 1.4);
  if (event.code === 'Space' && state.mode === 'rain') {
    event.preventDefault();
    if (event.repeat || state.pointers.size) return;
    const record = state.snapshot?.records[state.selected];
    const geo = record ? [record.longitude, record.latitude] : state.hoverGeo;
    if (geo && connection?.begin(geo)) { state.pointers.set('keyboard', { mode: 'rain', path: [geo] }); state.hoverGeo = geo; touchSoundAt(geo); canvas.classList.add('pouring'); scheduleReadouts(); scheduleDraw(); }
  }
  if (event.key === 'Escape') stopAllPointers();
});
document.addEventListener('keyup', event => { if (event.code === 'Space' && state.pointers.has('keyboard')) stopAllPointers(); });

canvas.addEventListener('blur', stopAllPointers);
window.addEventListener('blur', stopAllPointers);
window.addEventListener('pagehide', stopAllPointers);
$('#audience-panel')?.addEventListener('toggle', refreshAudienceSession);
window.addEventListener('focus', refreshAudienceSession);
window.addEventListener('online', refreshAudienceSession);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopAllPointers(); });
$('#zoom-in').addEventListener('click', () => zoomBy(1.45));
$('#zoom-out').addEventListener('click', () => zoomBy(1 / 1.45));
$('#zoom-reset').addEventListener('click', () => { stopAllPointers(); state.zoom = 1; state.panX = 0; state.panY = 0; state.hoverGeo = null; scheduleDraw(); });
$('#mode-rain').addEventListener('click', () => setMode('rain'));
$('#mode-move').addEventListener('click', () => setMode('move'));
let strengthTimer, timingTimer;
$('#rain-strength').addEventListener('input', () => {
  const strength = Number($('#rain-strength').value);
  text('#strength-value', `${Math.round(strength * 100)}%`);
  clearTimeout(strengthTimer);
  strengthTimer = setTimeout(() => operatorRequest('/api/strength', { strength }).catch(error => notify(error.message, true)), 150);
});
for (const input of document.querySelectorAll('[data-parameter]')) input.addEventListener('input', () => {
  if (isPhone) return;
  text(`#${input.id}-value`, `${input.value} s`);
  clearTimeout(timingTimer);
  const parameters = Object.fromEntries([...document.querySelectorAll('[data-parameter]')].map(control => [control.dataset.parameter, Number(control.value)]));
  timingTimer = setTimeout(() => {
    operatorRequest('/api/parameters', { parameters }).catch(error => notify(error.message, true));
  }, 150);
});
$('#timing-reset').addEventListener('click', () => {
  if (!isPhone) operatorRequest('/api/parameters', { parameters: DEFAULT_PARAMETERS }).catch(error => notify(error.message, true));
});
$('#simulation-reset').addEventListener('click', () => {
  if (isPhone) return;
  stopAllPointers(); operatorRequest('/api/reset').then(() => notify('Shared performance reset. Source snapshot unchanged.')).catch(error => notify(error.message, true));
});
$('#fit-active')?.addEventListener('click', fitActiveRain);
$('#restore-browser')?.addEventListener('click', () => {
  if (legacyPerformance) operatorRequest('/api/bootstrap', { state: legacyPerformance.simulation, strength: legacyPerformance.strength }).catch(error => notify(error.message, true));
});
$('#start-fresh')?.addEventListener('click', () => operatorRequest('/api/bootstrap', { state: null, strength: state.strength }).catch(error => notify(error.message, true)));
$('#browse-next').addEventListener('click', () => inspect((state.selected ?? -1) + 1));
$('#browse-previous').addEventListener('click', () => inspect((state.selected ?? 0) - 1));
$('#fetch-button').addEventListener('click', fetchLatest);
$('#about-open').addEventListener('click', () => $('#about-dialog').showModal());
$('#about-close').addEventListener('click', () => $('#about-dialog').close());
$('#about-dialog').addEventListener('click', event => { if (event.target === $('#about-dialog')) { const bounds = event.target.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.target.close(); } });
new ResizeObserver(() => { stopAllPointers(); dimensions(); }).observe($('#map-container'));

function frame(now) {
  if (state.ready && !document.hidden) {
    if (overlayRequested || connection?.holding || visualRainClouds.size) drawRainOverlay(now);
    if (now - lastFrame >= 1000 / 30) {
      const interpolating = cellTransitions.size > 0;
      interpolateSharedDisplay(now);
      if (frameRequested || interpolating || !prefersReducedMotion.matches) { draw(); frameRequested = false; }
      lastFrame = now;
    }
    if (now - lastReadout >= 250 && (readoutsRequested || cellTransitions.size || sharedState)) {
      updateReadouts(); readoutsRequested = false; lastReadout = now;
    }
  }
  requestAnimationFrame(frame);
}

async function initialize() {
  readLegacyPerformance();
  syncTimingControls();
  const results = await Promise.allSettled([
    fetch('/data/indonesia.geojson').then(response => { if (!response.ok) throw new Error('Country outline could not be loaded.'); return response.json(); }),
    fetch('/data/surrounding-land.geojson').then(response => { if (!response.ok) return null; return response.json(); }),
    fetch('/api/snapshot', { cache: 'no-store' }).then(async response => { if (response.status === 404) return null; if (!response.ok) throw new Error('Saved snapshot could not be loaded.'); return response.json(); }),
  ]);
  if (results[0].status === 'fulfilled') state.land = results[0].value;
  else notify(results[0].reason.message, true);
  if (results[1].status === 'fulfilled') state.neighbors = results[1].value;
  if (results[2].status === 'fulfilled' && results[2].value) showSnapshot(results[2].value);
  else if (results[2].status === 'rejected') notify(results[2].reason.message, true);
  else if (!isPhone) await fetchLatest();
  state.ready = true;
  setMode('rain'); scheduleDraw();
  try {
    await refreshSessionInfo();
  } catch (error) { notify(`Could not read the venue session: ${error.message}`, true); }
  connection = new SharedConnection({
    role: isPhone ? 'participant' : 'operator',
    onState: receiveSharedState,
    onActors: receiveActors,
    onConnection: connectionStatus,
    onWelcome: welcome => { text('#participant-number', welcome.participantNumber); },
    onError: message => { stopAllPointers(); notify(message, true); },
  });
  requestAnimationFrame(frame);
}
initialize();
