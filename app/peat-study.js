import { SharedConnection } from '/shared-client.js';
import { PeatSurface } from '/visual-assets/peat-surface.js';
import { makeStudyLayout, studyGeoAt, studyPointForGeo, studyPatches, studyRegionSummary, studyCellKey } from '/study-state.mjs';
import { PeatSection, orderedSectionPatches, sectionPointAt, sectionXForGeo } from '/visual-assets/peat-section.js';
import { RainFeedback } from '/visual-assets/rain-feedback.js';
import { drawFinalSectionRain } from '/visual-assets/final-rain.js';
import { countryInputAt, countryPoint } from '/country-view.mjs';
import { mountSoundControls } from '/sound-controls.js';
import { WORK_TITLE, DEFAULT_PROGRAM_NOTES, sceneAllowsRain, sceneInstruction, scenePresentation, applySharedSound } from '/performance-view.js';
import { createParticipantSoundField, patchSoundVoices, activeSoundParticipantCount, nationalPhoneInteraction } from '/sound-participants.js';
import { participantRainIdentity } from '/visual-assets/participant-identity.js';
import { audienceRainStrength, DEFAULT_RAIN_STRENGTH } from '/scene-score.js';
import { mountAudienceInstructions } from '/audience-instructions.js';

const $ = id => document.getElementById(id);
mountAudienceInstructions($('projection-instructions').querySelector('ol'));
const operatorPreview = new URLSearchParams(location.search).get('operator-preview') === '1';
document.body.dataset.operatorPreview = String(operatorPreview);
let previewAllowed = false, currentScene = null;
const sound = mountSoundControls($('study-sound'), { mode: 'projection' });
$('study-sound').querySelector('button').disabled = true;
if (operatorPreview) {
  for (const node of [$('peat-canvas'), $('section-canvas')]) { node.tabIndex = 0; node.setAttribute('aria-label', 'Operator preview. Hold to rain and hear the touched patches.'); }
}
const soundCells = new Map();
let soundField = createParticipantSoundField(), localSoundGeo = null, localSoundHolding = false;
let localBellGestureAllowed = false, localSoundFocusKey = null;
const canvas = $('peat-canvas'), stage = $('study-stage'), sectionCanvas = $('section-canvas'), sectionContact = $('section-contact');
const sectionContext = sectionContact.getContext('2d');
const finalRainCanvas = $('final-rain-visual'), finalRainContext = finalRainCanvas.getContext('2d');
let finalRainMotionMs = 0, finalRainLastFrame = null, finalRainLastPaint = -Infinity;
const atmosphereCanvas = $('shared-atmosphere'), atmosphereContext = atmosphereCanvas.getContext('2d');
let atmosphereScale = 1, atmosphereWidth = 1, atmosphereHeight = 1, sectionTop = 1;
let atmosphereCalmAreas = [];
const sectionRain = new RainFeedback();
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const cells = new Map(), transitions = new Map();
let layout = null, connection = null, actors = [], snapshotVersion = null;
let pointer = null, pointerCanvas = null, lastPosition = [.5, .5], keyboardHold = false, hoverPosition = null;
let renderer = null, sectionRenderer = null, sectionPatches = [], sectionIndex = new Map(), sectionScale = 1, assetsReady = false, dirty = true, lastScene = -Infinity, lastReadout = -Infinity, lastContactFrame = -Infinity;
let layoutRequest = 0, requestedRegion = 'indonesia', gestureError = '', connectionLabel = 'Connecting…', rainStrength = DEFAULT_RAIN_STRENGTH;
let forceLayout = false, contactDirty = true;
const metrics = window.__peatStudyMetrics = { sceneDraws: 0, contactDraws: 0, sceneMs: [], sectionMs: [], atmosphereMs: [], combinedMs: [], contactMs: [], region: null, renderErrors: [], ready: false, lastContactEvent: null, lastContactDraw: null };

// One static tile covers both views, their shared haze and the rain layer.
// It is prepared once; resizing and animation do not regenerate the pixels.
function prepareStageGrain() {
  const tile = document.createElement('canvas'); tile.width = tile.height = 128;
  const context = tile.getContext('2d'), pixels = context.createImageData(128, 128);
  let seed = 0x53a9f;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const shade = (seed >>> 8) & 1 ? 255 : 0;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = shade;
    pixels.data[i + 3] = 18 + (seed & 31);
  }
  context.putImageData(pixels, 0, 0);
  stage.style.setProperty('--study-grain-image', `url("${tile.toDataURL('image/png')}")`);
  stage.dataset.grainCoverage = 'full-stage';
}
prepareStageGrain();

function text(id, value) { const element = $(id); if (element && element.textContent !== value) element.textContent = value; }
let audienceAddress = null;
let audienceRequest = 0;
async function refreshAudienceAddress() {
  const request = ++audienceRequest;
  try {
    const response = await fetch('/api/session', { cache: 'no-store' });
    if (!response.ok) throw new Error('Join address unavailable.');
    const session = await response.json();
    if (request !== audienceRequest) return;
    const join = new URL(session.audienceUrl || session.joinUrl); join.pathname = '/audience';
    $('study-join-link').href = join.href; text('study-join-link', join.href);
    if (audienceAddress !== join.href) {
      audienceAddress = join.href;
      $('study-qr').src = `/api/qr.svg?view=audience&address=${encodeURIComponent(join.host)}`;
    }
    text('study-lan-note', session.lanEnabled ? 'Phone and laptop must use the same Wi-Fi.' : 'LAN access is off. Start the server in LAN mode for real phones.');
  } catch { if (request === audienceRequest) text('study-lan-note', 'Join address unavailable. Open the operator controls to check the network.'); }
}
for (const name of ['focus', 'online']) window.addEventListener(name, refreshAudienceAddress);
function showError(error) {
  $('study-loading').hidden = false; $('study-loading').classList.add('error');
  text('study-loading', error.message || 'The material study could not load.');
  metrics.renderErrors.push(String(error.message || error));
}
function point(event) {
  const target = event.currentTarget;
  const box = target.getBoundingClientRect();
  if (target === sectionCanvas) {
    const geo = sectionPointAt(sectionPatches, Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)));
    return studyPointForGeo(layout, geo) || lastPosition;
  }
  return countryInputAt(renderer.mapRect, event.clientX - box.left, event.clientY - box.top);
}
function syncScene(scene) {
  if (!scene) return;
  currentScene = scene;
  const view = scenePresentation(scene);
  if (scene.id !== 'final-rain' && scene.id !== 'afterglow') finalRainMotionMs = 0;
  document.body.dataset.scene = scene.id;
  document.body.dataset.phase = view.phase;
  document.body.dataset.blackout = String(view.blackout);
  document.documentElement.dataset.blackout = String(view.blackout);
  document.documentElement.style.setProperty('--projection-gain', String(view.gain));
  stage.dataset.scene = scene.id;
  stage.dataset.phase = view.phase;
  // The hidden opening never suspends the landscape. Both canvases keep their
  // geographic layout and motion phase while the shared score unveils them.
  const landscapeGain = operatorPreview ? 1 : view.landscapeEntranceGain;
  const joinGain = operatorPreview ? 0 : view.openingOverlayGain;
  document.documentElement.style.setProperty('--landscape-gain', String(landscapeGain));
  document.documentElement.style.setProperty('--join-gain', String(joinGain));
  $('arrival-screen').hidden = joinGain <= 0;
  $('arrival-screen').inert = !view.opening;
  metrics.openingCrossfade = { landscapeGain, joinGain, durationMs: view.soundTransitionDurationMs };
  stage.dataset.landscapeGain = landscapeGain.toFixed(4);
  stage.dataset.joinGain = joinGain.toFixed(4);
  const openingInstructions = view.showOpeningInstructions;
  document.body.dataset.openingCopy = openingInstructions ? 'instructions' : 'program';
  $('projection-program-notes').hidden = openingInstructions || !view.showProgramNotes;
  $('projection-instructions').hidden = !openingInstructions;
  text('projection-opening-title', openingInstructions ? 'Instructions' : WORK_TITLE);
  $('projection-caption').textContent = '';
  const settings = scene.settings || {};
  text('projection-program-notes', settings.programNotes || DEFAULT_PROGRAM_NOTES);
  $('projection-wifi').hidden = !view.showWifiJoin;
  $('projection-join-code').hidden = !view.showJoinCode;
  text('projection-wifi-name', settings.wifiName || 'See the venue Wi-Fi details');
  $('projection-password-row').hidden = !settings.wifiPassword;
  text('projection-wifi-password', settings.wifiPassword || '');
  sound.setSceneState?.(scene);
  if (!sceneAllowsRain(scene) && (connection?.holding || localSoundHolding || pointer !== null || keyboardHold)) endGesture();
  metrics.sceneScore = view;
}
function syncStatus() {
  const holding = Boolean(connection?.holding);
  canvas.classList.toggle('holding', holding); sectionCanvas.classList.toggle('holding', holding);
  stage.dataset.holding = String(holding);
  text('contact-status', gestureError || (holding ? connection.acknowledged ? 'Raining.' : 'Rain sent.' : connection?.canPour ? 'Ready.' : 'Waiting.'));
  text('study-connection', connectionLabel);
  contactDirty = true;
}
function updateRegionalReadings() {
  const summary = studyRegionSummary(layout, cells);
  text('study-heat', `${Math.round(summary.heat * 100)}%`);
  text('study-wetness', `${Math.round(summary.wetness * 100)}%`);
  text('study-out', `${summary.out} / ${summary.total}`);
}
function endGesture({ stopConnection = true } = {}) {
  localSoundHolding = false; localBellGestureAllowed = false;
  syncSoundParticipants();
  const previousPointer = pointer;
  pointer = null; keyboardHold = false;
  if (stopConnection) connection?.stop();
  if (previousPointer !== null && pointerCanvas?.hasPointerCapture(previousPointer)) pointerCanvas.releasePointerCapture(previousPointer);
  pointerCanvas = null;
  contactDirty = true; syncStatus();
  drawFeedback();
}
function applyCells(wire, reset) {
  if (!wire) return;
  const now = performance.now();
  interpolate(now);
  if (reset || !wire.delta) { cells.clear(); transitions.clear(); soundCells.clear(); }
  if (reset) renderer?.extinctionFeedback.clear();
  for (const row of wire.cells || []) {
    const [longitude, latitude, surfaceWetness, moisture, heat, extinguished, , hasFire] = row;
    const key = studyCellKey(longitude, latitude), previous = cells.get(key);
    const next = { longitude, latitude, surfaceWetness, moisture, heat, extinguished, hasFire };
    // Audio receives packet endpoints before the drawing interpolates them.
    soundCells.set(key, { key, ...next });
    if (previous && !extinguished && !reset) {
      transitions.set(key, { at: now, fromHeat: previous.heat, fromWet: previous.surfaceWetness, heat, surfaceWetness });
      next.heat = previous.heat; next.surfaceWetness = previous.surfaceWetness;
    } else transitions.delete(key);
    cells.set(key, next);
  }
  for (const key of wire.removed || []) { cells.delete(key); transitions.delete(key); soundCells.delete(key); }
  syncStudySound();
  dirty = true;
}
function receiveBellFeedback(message) {
  const event = renderer?.extinctionFeedback.triggerBell(message);
  if (!event) return;
  contactDirty = true;
  metrics.extinctionFeedback = { total: renderer.extinctionFeedback.total, last: event };
}
// Main's preview emits this only after an audible bell is admitted. Every
// display paints the server echo, so Main cannot flash twice for one bell.
window.addEventListener('wildfire-bell', event => {
  if (operatorPreview && previewAllowed) connection?.sendBellFeedback(event.detail);
});
function syncStudySound() {
  const patches = layout ? [...layout.fireKeys].map(key => soundCells.get(key)).filter(Boolean) : [];
  sound.setPatches(patches);
  soundField = createParticipantSoundField(patches);
  syncSoundParticipants();
}
function syncSoundParticipants() {
  const options = { excludeId: connection?.clientId, localPosition: localSoundGeo, localHolding: localSoundHolding };
  const rainAreas = actors.filter(actor => actor.role === 'participant' && actor.id !== connection?.clientId && actor.holding)
    .map(actor => ({ id: actor.id, holding: true, position: actor.position }));
  if (operatorPreview && localSoundHolding && localSoundGeo) rainAreas.push({ id: '__local-rain', holding: true, position: localSoundGeo });
  sound.setRainAreaContacts(soundField, rainAreas);
  sound.setAudienceParticipationCount(activeSoundParticipantCount(actors, soundField, options));
  sound.setPatchVoices(patchSoundVoices(actors, soundField, options));
  // The local tester shares the Main extinction and cooled-ground tap route.
  if (!operatorPreview) return;
  const eligible = previewAllowed && localBellGestureAllowed && sound.enabled && !sound.muted && !sound.hidden && sceneAllowsRain(currentScene);
  if (!eligible) localBellGestureAllowed = false;
  const interaction = nationalPhoneInteraction(soundField.patches, localSoundGeo ? countryPoint(localSoundGeo) : null, {
    holding: localSoundHolding && eligible, eligible, preferredKey: localSoundFocusKey,
  });
  localSoundFocusKey = interaction.patchKey;
  sound.setLocalInteraction?.(interaction);
}
function touchSoundAt(geo) {
  if (!localSoundHolding) localBellGestureAllowed = sound.state === 'ready' && sound.enabled && !sound.muted && !sound.hidden;
  localSoundGeo = [...geo]; localSoundHolding = true;
  syncSoundParticipants();
}
function interpolate(now) {
  for (const [key, transition] of transitions) {
    const cell = cells.get(key);
    if (!cell) { transitions.delete(key); continue; }
    const t = reduced.matches ? 1 : Math.min(1, Math.max(0, (now - transition.at) / 100));
    cell.heat = transition.fromHeat + (transition.heat - transition.fromHeat) * t;
    cell.surfaceWetness = transition.fromWet + (transition.surfaceWetness - transition.fromWet) * t;
    if (t === 1) transitions.delete(key);
  }
}
async function loadRegion(id, { refresh = false } = {}) {
  if (!refresh && requestedRegion === id && layout?.id === id) return;
  if (connection?.holding) endGesture();
  requestedRegion = id;
  const request = ++layoutRequest;
  try {
    const response = await fetch(`/api/study-region?region=${encodeURIComponent(id)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The regional layout is unavailable.');
    if (request !== layoutRequest) return;
    layout = makeStudyLayout(data); snapshotVersion = data.snapshotVersion;
    syncStudySound();
    metrics.region = layout.id;
    sectionPatches = orderedSectionPatches(studyPatches(layout, cells));
    sectionRenderer?.setPatches(sectionPatches);
    updateRegionalReadings();
    $('empty-region').hidden = layout.fireKeys.size > 0;
    dirty = true; contactDirty = true;
    if (assetsReady) $('study-loading').hidden = true;
  } catch (error) { if (request === layoutRequest) showError(error); }
}
function receiveActors(message) {
  actors = message.participants || [];
  syncSoundParticipants();
  text('study-audience-count', `${message.joinedCount || 0} · ${message.activeCount || 0} raining`);
  contactDirty = true;
}
function contactPoints() {
  const contacts = [];
  if (!layout) return contacts;
  const strength = audienceRainStrength(currentScene, rainStrength);
  // Every participant keeps its water contribution. Visual marks are bounded
  // separately so crowd size cannot create hundreds of decorative emitters.
  for (const actor of actors) {
    if (!actor.holding || actor.id === connection?.clientId) continue;
    const p = studyPointForGeo(layout, actor.position);
    if (p) {
      const identity = participantRainIdentity(actor.number);
      contacts.push({ id: actor.id, x: p[0], y: p[1], active: true, local: false, strength,
        color: identity?.color, label: identity?.label });
    }
  }
  if (connection?.holding) contacts.push({ id: 'local', x: lastPosition[0], y: lastPosition[1], active: true, local: true, strength });
  else if (hoverPosition) contacts.push({ id: 'local', x: hoverPosition[0], y: hoverPosition[1], active: true, local: true, preview: true });
  return contacts;
}
function drawFeedback(now = performance.now()) {
  if (!assetsReady || !layout) return;
  const start = performance.now(), contacts = contactPoints();
  renderer.setContacts(contacts, now);
  updateCalming(contacts);
  renderer.drawContacts(now);
  drawSectionContacts(renderer.getVisualContacts(now), now); metrics.contactDraws++; metrics.lastContactDraw = performance.now();
  lastContactFrame = now;
  record(metrics.contactMs, metrics.lastContactDraw - start);
  if (metrics.lastContactEvent !== null) {
    canvas.dataset.contactFeedbackMs = (metrics.lastContactDraw - metrics.lastContactEvent).toFixed(2);
    metrics.lastContactEvent = null;
  }
  canvas.dataset.contactCount = String(contacts.length);
  canvas.dataset.visibleClouds = String(renderer.stats.visibleClouds || 0);
  canvas.dataset.localCloud = connection?.holding ? 'raining' : hoverPosition ? 'preview' : 'idle';
  contactDirty = false;
}
// A source-cell lookup keeps geographic rain aligned with both views without
// doing a contact-by-pixel pass. These masks affect visual motion only.
function updateCalming(contacts) {
  if (!sectionRenderer || !sectionPatches.length) return;
  const binCount = 120, bins = new Float32Array(binCount), areas = new Map();
  const map = renderer.mapRect, airY = atmosphereHeight * .14, airH = atmosphereHeight * .56;
  const addArea = (x, y, radiusX, radiusY, strength) => {
    if (!(strength > .02) || !(airH > 0)) return;
    const area = { x: x / atmosphereWidth, y: (y - airY) / airH, radiusX: radiusX / atmosphereWidth, radiusY: radiusY / airH, strength: Math.min(1, strength) };
    if (area.x + area.radiusX < 0 || area.x - area.radiusX > 1 || area.y + area.radiusY < 0 || area.y - area.radiusY > 1) return;
    const key = `${Math.floor(area.x * 64)},${Math.floor(area.y * 32)}`;
    const previous = areas.get(key);
    if (!previous || previous.strength < area.strength) areas.set(key, area);
  };
  const brush = map.width * .85 / 48;
  // Contact calming follows the same real audience cooling in both scenes;
  // in takeover the returning heat competes with this local rain.
  const coolingContacts = contacts;
  for (const contact of coolingContacts) {
    if (contact.preview || contact.active === false) continue;
    const geo = studyGeoAt(layout, [contact.x, contact.y]);
    const strength = .35 + .65 * Math.min(1, contact.strength ?? .5);
    addArea(map.x + contact.x * map.width, map.y + contact.y * map.height - 10, Math.max(28, brush * 1.65), Math.max(36, brush * 2.7), strength);
    for (let cx = Math.floor((geo[0] - .975) / .25); cx <= Math.floor((geo[0] + .975) / .25); cx++) {
      for (let cy = Math.floor((geo[1] - .975) / .25); cy <= Math.floor((geo[1] + .975) / .25); cy++) {
        const x = sectionIndex.get(`${cx},${cy}`);
        if (x === undefined) continue;
        const dx = Math.max(0, Math.abs((cx + .5) * .25 - geo[0]) - .125);
        const dy = Math.max(0, Math.abs((cy + .5) * .25 - geo[1]) - .125);
        if (dx * dx + dy * dy <= .85 * .85) {
          const bin = Math.min(binCount - 1, Math.floor(x * binCount));
          bins[bin] = Math.max(bins[bin], strength);
        }
      }
    }
  }
  for (const patch of sectionPatches) {
    if (patch.surfaceWetness < .04) continue;
    const point = countryPoint(patch.geo), x = sectionIndex.get(patch.key);
    addArea(map.x + point[0] * map.width, map.y + point[1] * map.height - 8, Math.max(18, brush * 1.4), Math.max(28, brush * 2), patch.surfaceWetness);
    if (x !== undefined) addArea(x * sectionRenderer.width, sectionTop + sectionRenderer.surfaceYAt(x) - 22, 22, 46, patch.surfaceWetness);
  }
  const stripContacts = [];
  for (let index = 0; index < binCount; index++) if (bins[index] > 0) {
    const x = (index + .5) / binCount;
    stripContacts.push({ x, radius: 1.5 / binCount, active: true, strength: bins[index] });
    addArea(x * sectionRenderer.width, sectionTop + sectionRenderer.surfaceYAt(x) - 22, 26, 48, bins[index]);
  }
  sectionRenderer.setContacts(stripContacts);
  atmosphereCalmAreas = [...areas.values()];
  atmosphereCanvas.dataset.calmAreas = String(atmosphereCalmAreas.length);
  sectionCanvas.dataset.rainingBins = String(stripContacts.length);
  sectionCanvas.dataset.contactCoolingEnabled = 'true';
}
function drawSectionContacts(contacts, now) {
  if (!sectionRenderer) return;
  const w = sectionRenderer.width, h = sectionRenderer.height;
  sectionContext.setTransform(sectionScale, 0, 0, sectionScale, 0, 0);
  sectionContext.clearRect(0, 0, w, h);
  let detailed = 0;
  for (const contact of [...contacts].sort((a,b) => Number(Boolean(b.local)) - Number(Boolean(a.local)))) {
    const geo = studyGeoAt(layout, [contact.x, contact.y]);
    const normalized = sectionIndex.get(studyCellKey(...geo)) ?? sectionXForGeo(sectionPatches, geo);
    if (!Number.isFinite(normalized)) continue;
    const patch = sectionPatches[Math.min(sectionPatches.length - 1, Math.floor(normalized * sectionPatches.length))];
    // The section contains source patches only: sea rain must not appear to
    // land on a remote fire merely because it is the nearest source column.
    const dx = Math.max(0, Math.abs(patch.geo[0] - geo[0]) - .125);
    const dy = Math.max(0, Math.abs(patch.geo[1] - geo[1]) - .125);
    if (dx * dx + dy * dy > .85 * .85) continue;
    const x = normalized * w, y = sectionRenderer.surfaceYAt(normalized);
    if (detailed++ < 64) sectionRain.draw(sectionContext, { ...contact, x, y, now, radius: 12, cloud: false, footprint: false, impact: false, reducedMotion: reduced.matches, bounds: { left:0, top:0, right:w, bottom:h } });
    else { sectionContext.globalAlpha = contact.envelope?.opacity ?? 1; sectionContext.strokeStyle = '#f0c49d'; sectionContext.beginPath(); sectionContext.moveTo(x, y-10); sectionContext.lineTo(x,y); sectionContext.stroke(); sectionContext.globalAlpha = 1; }
  }
  sectionCanvas.dataset.contactCount = String(contacts.length);
  sectionCanvas.dataset.rainImpactLine = 'false';
}
function resize() {
  endGesture();
  const whole = stage.getBoundingClientRect(), side = $('side-view').getBoundingClientRect();
  sectionRenderer?.resize(side.width, side.height);
  sectionTop = side.top - whole.top;
  // Use the same sampled profile as the section outline, leaving the map's
  // own safe margin above the highest ground rather than the old half split.
  const groundTop = sectionTop + (sectionRenderer
    ? Math.min(...Array.from({ length: 221 }, (_, index) => sectionRenderer.surfaceYAt(index / 220))) : 0);
  $('top-view').style.height = `${Math.max(1, groundTop)}px`;
  const box = $('top-view').getBoundingClientRect();
  renderer?.resize(box.width, box.height);
  metrics.layout = { mapRect: renderer ? { ...renderer.mapRect } : null, groundTop, sectionTop, sectionHeight: side.height };
  sectionScale = Math.min(window.devicePixelRatio || 1, 1.25, Math.sqrt(1280 * 720 / Math.max(1, side.width * side.height)));
  sectionContact.width = Math.max(1, Math.round(side.width * sectionScale));
  sectionContact.height = Math.max(1, Math.round(side.height * sectionScale));
  finalRainCanvas.width = sectionContact.width; finalRainCanvas.height = sectionContact.height;
  finalRainLastPaint = -Infinity;
  atmosphereWidth = whole.width; atmosphereHeight = whole.height;
  atmosphereScale = Math.min(1, Math.sqrt(1280 * 720 / Math.max(1, whole.width * whole.height)));
  atmosphereCanvas.width = Math.max(1, Math.round(whole.width * atmosphereScale));
  atmosphereCanvas.height = Math.max(1, Math.round(whole.height * atmosphereScale));
  dirty = true; contactDirty = true;
}
function record(list, value) { if (Number.isFinite(value)) { list.push(value); if (list.length > 180) list.shift(); } }
function percentile(list, fraction) { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] : 0; }
function frame(now) {
  if (!document.hidden && assetsReady && layout) {
    const active = Boolean(connection?.holding || actors.some(actor => actor.holding));
    if ((contactDirty || (active && !reduced.matches) || renderer?.hasContactAnimation(now)) && now - lastContactFrame >= 1000 / 30) {
      drawFeedback(now);
    }
    if (now - lastScene >= 1000 / 24 && (dirty || transitions.size || !reduced.matches)) {
      interpolate(now);
      const patches = studyPatches(layout, cells);
      renderer.setPatches(patches);
      renderer.setWetCells(cells);
      sectionPatches = orderedSectionPatches(patches);
      sectionIndex = new Map(sectionPatches.map((patch,i) => [patch.key, (i+.5)/sectionPatches.length]));
      sectionRenderer.setPatches(sectionPatches);
      updateCalming(contactPoints());
      const result = renderer.draw(now), sectionResult = sectionRenderer.draw(now);
      const atmosphereAt = performance.now();
      atmosphereContext.setTransform(atmosphereScale, 0, 0, atmosphereScale, 0, 0);
      atmosphereContext.clearRect(0, 0, atmosphereWidth, atmosphereHeight);
      sectionRenderer.drawAtmosphere(atmosphereContext, { x: 0, y: atmosphereHeight * .14, width: atmosphereWidth, height: atmosphereHeight * .56, now, alpha: .53, calmAreas: atmosphereCalmAreas });
      const atmosphereMs = performance.now() - atmosphereAt;
      record(metrics.atmosphereMs, atmosphereMs);
      atmosphereCanvas.dataset.drawMs = atmosphereMs.toFixed(2);
      atmosphereCanvas.dataset.crossesViews = 'true';
      metrics.section = sectionResult;
      record(metrics.sectionMs, sectionResult?.drawMs);
      record(metrics.combinedMs, result.drawMs + sectionResult.drawMs + atmosphereMs);
      sectionCanvas.dataset.drawMs = (sectionResult?.drawMs || 0).toFixed(2);
      sectionCanvas.dataset.patchCount = String(sectionPatches.length);
      metrics.sceneDraws++; record(metrics.sceneMs, result?.drawMs);
      metrics.renderer = result; dirty = false; lastScene = now;
    }
    if (now - lastReadout >= 250) {
      updateRegionalReadings();
      const target = cells.get(studyCellKey(...studyGeoAt(layout, lastPosition)));
      if (target) {
        sectionCanvas.dataset.targetHeat = target.heat.toFixed(4);
        sectionCanvas.dataset.targetWetness = target.surfaceWetness.toFixed(4);
        sectionCanvas.dataset.targetMoisture = target.moisture.toFixed(4);
        sectionCanvas.dataset.targetOut = String(target.extinguished);
      }
      canvas.dataset.sceneP95Ms = percentile(metrics.sceneMs, .95).toFixed(2);
      canvas.dataset.contactP95Ms = percentile(metrics.contactMs, .95).toFixed(2);
      sectionCanvas.dataset.sceneP95Ms = percentile(metrics.sectionMs, .95).toFixed(2);
      atmosphereCanvas.dataset.sceneP95Ms = percentile(metrics.atmosphereMs, .95).toFixed(2);
      sectionCanvas.dataset.combinedP95Ms = percentile(metrics.combinedMs, .95).toFixed(2);
      canvas.dataset.sceneSamples = String(metrics.sceneMs.length);
      lastReadout = now;
    }
  }
  drawFinalRain(now);
  requestAnimationFrame(frame);
}
function drawFinalRain(now) {
  const elapsed = finalRainLastFrame === null ? 0 : Math.min(100, Math.max(0, now - finalRainLastFrame));
  finalRainLastFrame = now;
  if (!document.hidden && !currentScene?.paused) finalRainMotionMs += elapsed;
  if (!sectionRenderer || document.hidden || now - finalRainLastPaint < 1000 / 24) return;
  const w = sectionRenderer.width, h = sectionRenderer.height;
  finalRainContext.setTransform(sectionScale, 0, 0, sectionScale, 0, 0);
  finalRainContext.clearRect(0, 0, w, h);
  const result = drawFinalSectionRain(finalRainContext, { width: w, height: h,
    surfaceYAt: x => sectionRenderer.surfaceYAt(x), intensity: currentScene?.rainIntensity ?? 0,
    now: finalRainMotionMs, reducedMotion: reduced.matches });
  finalRainCanvas.dataset.intensity = result.intensity.toFixed(4);
  finalRainCanvas.dataset.visualGain = result.visualGain.toFixed(4);
  finalRainCanvas.dataset.dropCount = String(result.drops);
  finalRainCanvas.dataset.material = 'continuous-native-rain';
  finalRainLastPaint = now;
}
function begin(position) {
  if (!operatorPreview || !previewAllowed || !layout || !assetsReady || !connection?.canPour || !sceneAllowsRain(currentScene)) return;
  lastPosition = position;
  gestureError = '';
  if (connection.begin(studyGeoAt(layout, position))) {
    touchSoundAt(studyGeoAt(layout, position));
    contactDirty = true; metrics.lastContactEvent = performance.now(); syncStatus(); drawFeedback();
  }
}
if (operatorPreview) for (const inputCanvas of [canvas, sectionCanvas]) {
inputCanvas.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || pointer !== null || !connection?.canPour || !sceneAllowsRain(currentScene) || !assetsReady) return;
  event.preventDefault(); inputCanvas.focus({ preventScroll: true });
  begin(point(event));
  if (connection?.holding || localSoundHolding) { pointer = event.pointerId; pointerCanvas = inputCanvas; inputCanvas.setPointerCapture(pointer); }
});
inputCanvas.addEventListener('pointermove', event => {
  if (pointer === null && event.pointerType !== 'touch' && assetsReady && layout) { hoverPosition = point(event); metrics.lastContactEvent = performance.now(); contactDirty = true; drawFeedback(); }
  if (event.pointerId !== pointer || (!connection?.holding && !localSoundHolding) || !layout) return;
  event.preventDefault(); lastPosition = point(event);
  const geo = studyGeoAt(layout, lastPosition);
  if (connection.holding) connection.move(geo); touchSoundAt(geo); contactDirty = true;
  metrics.lastContactEvent = performance.now();
  drawFeedback();
});
inputCanvas.addEventListener('pointerleave', () => { hoverPosition = null; contactDirty = true; if (!connection?.holding) drawFeedback(); });
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) inputCanvas.addEventListener(name, event => { if (event.pointerId === pointer) endGesture(); });
inputCanvas.addEventListener('contextmenu', event => event.preventDefault());
inputCanvas.addEventListener('keydown', event => {
  if (event.code === 'Space') { event.preventDefault(); if (!event.repeat && pointer === null && !connection?.holding) { keyboardHold = true; begin(lastPosition); } }
  if (event.key === 'Escape') { event.preventDefault(); endGesture(); }
});
}
window.addEventListener('keyup', event => { if (event.code === 'Space' && keyboardHold) endGesture(); });
window.addEventListener('blur', endGesture);
window.addEventListener('pagehide', endGesture);
document.addEventListener('visibilitychange', () => { if (document.hidden) endGesture(); else { dirty = true; contactDirty = true; } });
reduced.addEventListener('change', () => { renderer?.setReducedMotion(reduced.matches); sectionRenderer?.setReducedMotion(reduced.matches); dirty = true; contactDirty = true; });
$('project-study').addEventListener('click', async () => {
  endGesture();
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await stage.requestFullscreen(); }
  catch { text('contact-status', 'Fullscreen unavailable. Use the browser fullscreen command.'); }
});
document.addEventListener('fullscreenchange', () => { stage.dataset.fullscreen = String(document.fullscreenElement === stage); resize(); });
new ResizeObserver(resize).observe(stage);

async function initialize() {
  renderer = new PeatSurface(canvas, { quality: 'auto', reducedMotion: reduced.matches });
  sectionRenderer = new PeatSection(sectionCanvas, { quality: 'auto', reducedMotion: reduced.matches });
  const assetLoad = Promise.all([renderer.ready(), fetch('/data/indonesia.geojson').then(response => { if (!response.ok) throw new Error('The Indonesia outline could not load.'); return response.json(); })]).then(([, geography]) => {
    renderer.setGeography(geography);
    assetsReady = true; metrics.ready = true; resize();
    if (layout) $('study-loading').hidden = true;
  });
  await loadRegion('indonesia');
  const session = await fetch('/api/session', { cache: 'no-store' }).then(response => response.json());
  previewAllowed = operatorPreview && session.operatorAllowed === true;
  syncScene(session.scene);
  if (operatorPreview && !previewAllowed) text('projection-caption', 'Operator preview is available on the venue laptop.');
  connection = new SharedConnection({
    role: previewAllowed ? 'operator' : 'projection',
    onBell: receiveBellFeedback,
    onState(message, { reset } = {}) {
      if (reset) { sound.reset(message.epoch); soundField = createParticipantSoundField(); localSoundGeo = null; actors = []; endGesture(); }
      sound.setMacroCondition(message.soundCondition);
      if (sound.applySharedSettings) sound.applySharedSettings(message.soundSettings); else applySharedSound(sound, message.soundSettings);
      syncScene(message.scene);
      $('study-sound').querySelector('button').disabled = $('study-sound').dataset.soundState === 'starting';
      if (operatorPreview && window.parent !== window) window.parent.postMessage({ type: 'wildfire-preview-state', state: message }, location.origin);
      applyCells(message.simulation, reset);
      rainStrength = Number.isFinite(message.strength) ? message.strength : DEFAULT_RAIN_STRENGTH;
      $('study-bootstrap').hidden = !message.bootstrapAvailable;
      if (message.snapshotVersion !== snapshotVersion && !forceLayout) {
        forceLayout = true;
        loadRegion(requestedRegion, { refresh: true }).finally(() => { forceLayout = false; });
      }
      receiveActors(message); syncStatus();
    },
    onActors(message) { receiveActors(message); if (operatorPreview && window.parent !== window) window.parent.postMessage({ type: 'wildfire-preview-actors', state: message }, location.origin); },
    onConnection(status) {
      if (operatorPreview && window.parent !== window) window.parent.postMessage({ type: 'wildfire-preview-connection', status }, location.origin);
      connectionLabel = status === 'connected' ? 'Connected to the laptop server.' : status === 'connecting' ? 'Connecting to the laptop server…' : 'Disconnected · showing the last received state.';
      if (status !== 'connected') { localSoundGeo = null; endGesture({ stopConnection: false }); actors = []; renderer?.extinctionFeedback.clear(); syncSoundParticipants(); contactDirty = true; }
      syncStatus();
    },
    onError(message) { gestureError = message; endGesture(); },
  });
  await refreshAudienceAddress();
  try {
    // Read the cached file, not /api/snapshot: a visual study should never
    // reconcile/refresh source data merely because the page was opened.
    const response = await fetch('/data/fire-snapshot.json');
    const snapshot = await response.json();
    if (snapshot.observationStart && snapshot.observationEnd) text('study-observed', `Satellite snapshot observed ${snapshot.observationStart.slice(0, 10)} · NASA FIRMS / NOAA-20.`);
  } catch { /* The live server state remains usable without this provenance label. */ }
  await assetLoad;
  requestAnimationFrame(frame);
}
initialize().catch(showError);
