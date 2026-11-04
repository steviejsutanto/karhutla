import { SharedConnection } from './shared-client.js';
import { COUNTRY_BOUNDS, countryGeo, countryInputAt } from './country-view.mjs';
import { RainFeedback, RainContactTransitions } from '../visual-assets/rain-feedback.js';
import { PeatSurface } from '../visual-assets/peat-surface.js';
import { mountSoundControls } from './sound-controls.js';
import { phoneMacroCondition } from './join.js';
import { WORK_TITLE, DEFAULT_PROGRAM_NOTES, sceneAllowsRain, sceneInstruction, scenePresentation, applySharedSound } from './performance-view.js';
import { nationalPhoneInteraction } from './sound-participants.js';
import { participantRainIdentity } from '../visual-assets/participant-identity.js';
import { ExtinctionFeedback } from '../visual-assets/extinction-feedback.js';
import { audienceRainStrength } from './scene-score.js';
export { nationalPhoneSoundPatchAt, nationalPhoneInteraction } from './sound-participants.js';

const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const clamp = value => Math.max(0, Math.min(1, value));

// Persistent ember intensity follows received heat/out only. Local rain is
// feedback about contact, never a prediction of shared cooling or extinction.
export function peatPhoneAppearance(heat, extinguished = false) {
  if (!unit(heat) || typeof extinguished !== 'boolean' || (extinguished && heat > .0001)) return null;
  return { heat, extinguished, opacity: extinguished ? 0 : .12 + .88 * heat,
    state: extinguished ? 'out' : heat >= .65 ? 'hot' : heat >= .18 ? 'cooling' : 'low' };
}

export function peatPhonePatches(field) {
  if (!field || !Array.isArray(field.patches) || field.patches.length > 10000) return null;
  const national = field.format === 'country-v1';
  const legacy = field.format === 'land-rows-v1';
  if (!national && !legacy) return null;
  if (national && (!field.bounds || Object.keys(COUNTRY_BOUNDS).some(key => field.bounds[key] !== COUNTRY_BOUNDS[key]) || field.cellSize !== .25)) return null;
  if (legacy && (!Number.isSafeInteger(field.rows) || field.rows < 1 || field.rows > 512)) return null;
  const keys = new Set(), patches = [];
  for (const entry of field.patches) {
    if (!Array.isArray(entry) || (national ? ![5, 7].includes(entry.length) : ![6, 8].includes(entry.length))) return null;
    const key = entry[0];
    if (typeof key !== 'string' || !key || keys.has(key)) return null;
    let box, heat, out, surfaceWetness = 0, moisture = 0;
    if (national) {
      const [, longitude, latitude] = entry;
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < 94 || longitude >= 142 || latitude <= -12 || latitude > 7) return null;
      const expectedKey = `${Math.floor(longitude / .25)},${Math.floor(latitude / .25)}`;
      if (key !== expectedKey || Math.abs(longitude / .25 - Math.floor(longitude / .25) - .5) > 1e-6 || Math.abs(latitude / .25 - Math.floor(latitude / .25) - .5) > 1e-6) return null;
      box = { left: (longitude - .125 - 94) / 48, top: (7 - latitude - .125) / 19, width: .25 / 48, height: .25 / 19, longitude, latitude };
      heat = entry[3]; out = entry[4];
      if (entry.length === 7) {
        surfaceWetness = entry[5]; moisture = entry[6];
        if (!unit(surfaceWetness) || !unit(moisture)) return null;
      }
      box.geo = [longitude, latitude];
    } else {
      const [, row, column, columns] = entry;
      if (!Number.isSafeInteger(row) || row < 0 || row >= field.rows || !Number.isSafeInteger(columns) || columns < 1 || columns > 512 || !Number.isSafeInteger(column) || column < 0 || column >= columns) return null;
      box = { left: column / columns, top: row / field.rows, width: 1 / columns, height: 1 / field.rows };
      heat = entry[4]; out = entry[5];
      if (entry.length === 8) {
        surfaceWetness = entry[6]; moisture = entry[7];
        if (!unit(surfaceWetness) || !unit(moisture)) return null;
      }
    }
    const appearance = peatPhoneAppearance(heat, out);
    if (!appearance) return null;
    keys.add(key); patches.push({ key, ...box, ...appearance, surfaceWetness, moisture });
  }
  return patches;
}

export function peatPhoneRegion(region) {
  if (!region || !unit(region.heat) || !unit(region.surfaceWetness) || !unit(region.moisture) ||
      !Number.isSafeInteger(region.fireCells) || region.fireCells < 0 || !Number.isSafeInteger(region.extinguishedCells) ||
      region.extinguishedCells < 0 || region.extinguishedCells > region.fireCells ||
      !Number.isSafeInteger(region.activeCount) || region.activeCount < 0 || (!region.fireCells && region.heat > 0)) return null;
  const empty = region.fireCells === 0;
  const out = !empty && region.extinguishedCells === region.fireCells && region.heat <= .0001;
  return { ...region, empty, out,
    label: empty ? 'No fire patches in this snapshot.' : out ? 'All modeled fire patches are out.' :
      region.heat >= .65 ? 'Residual heat is high.' : region.heat >= .18 ? 'Heat remains in the ground.' : 'Low heat. Embers remain.' };
}

if (typeof document !== 'undefined' && document.getElementById('peat-instrument')) initializePeatPhone();

function initializePeatPhone() {
  const $ = id => document.getElementById(id);
  const instrument = $('peat-instrument'), stage = $('phone-map-stage'), material = $('phone-material');
  const sound = mountSoundControls($('phone-sound'), { mode: 'phone' });
  $('phone-sound').querySelector('button').disabled = true;
  let currentScene = null, notesOpen = false;
  function renderScene(scene) {
    if (!scene) return;
    const sceneChanged = currentScene?.id !== scene.id;
    if (sceneChanged) notesOpen = false;
    if (gestureError && (sceneChanged || !sceneAllowsRain(scene))) { inputError = ''; gestureError = false; }
    const view = scenePresentation(scene, { phone: true });
    currentScene = scene; document.body.dataset.scene = scene.id;
    document.body.dataset.paused = String(Boolean(scene.paused));
    document.body.dataset.phase = view.phase;
    document.body.dataset.blackout = String(view.blackout);
    document.documentElement.dataset.blackout = String(view.blackout);
    document.documentElement.style.setProperty('--phone-visual-gain', String(view.gain));
    sound.setSceneState?.(scene);
    $('phone-sound').querySelector('button').disabled = $('phone-sound').dataset.soundState === 'starting';
    const entrance = view.landscapeEntranceGain;
    const welcomeGain = view.openingOverlayGain;
    document.body.dataset.opening = String(view.opening || welcomeGain > 0);
    document.documentElement.style.setProperty('--phone-landscape-gain', String(entrance));
    document.documentElement.style.setProperty('--phone-welcome-gain', String(welcomeGain));
    $('phone-welcome').hidden = welcomeGain <= 0 || notesOpen;
    metrics.openingCrossfade = { landscapeGain: entrance, welcomeGain, durationMs: view.soundTransitionDurationMs };
    $('phone-notes').hidden = !notesOpen;
    $('phone-notes-close').hidden = false;
    $('phone-program-notes').hidden = false;
    $('phone-instructions').hidden = false;
    text('phone-title', WORK_TITLE);
    $('phone-about').setAttribute('aria-expanded', String(!$('phone-notes').hidden));
    text('phone-program-notes', scene.settings?.programNotes || DEFAULT_PROGRAM_NOTES);
    text('phone-scene-instruction', '');
    text('phone-scene-caption', view.opening ? 'Sound begins shortly.' : sceneInstruction(scene));
    $('phone-sound-guidance').hidden = !view.opening;
    if (!sceneAllowsRain(scene) && (connection?.holding || pointer !== null || toggleActive || keyboardHold || contact.active)) stop({ tail: false });
    metrics.sceneScore = view;
  }
  $('phone-about').addEventListener('click', () => { notesOpen = !notesOpen; if (notesOpen) stop({ tail: false }); renderScene(currentScene); });
  $('phone-notes-close').addEventListener('click', () => { notesOpen = false; renderScene(currentScene); });
  const overlay = $('phone-contact'), rainContext = overlay.getContext('2d'), toggle = $('rain-toggle');
  const loading = $('phone-map-loading'), reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const map = new PeatSurface(material, { reducedMotion: reducedMotion.matches, maxPixels: 1280 * 720, maxPixelRatio: 1.5,
    materialUrl: new URL('../visual-assets/peat-material-phone.webp', import.meta.url).href, contactOverlay: false });
  const rain = new RainFeedback();
  const extinctionFeedback = new ExtinctionFeedback({ maxEvents: 4 });
  let rainIdentity = null;
  const rainTransitions = new RainContactTransitions({ maxContacts: 4, reducedMotion: reducedMotion.matches });
  const tailLayers = new Map();
  const metrics = window.__peatPhoneMetrics = { contactFrames: 0, rafCallbacks: 0, drawSamples: [], sceneSamples: [], localFeedbackSamples: [], materialDraws: 0, packetCount: 0, patchCount: 0, state: 'idle', pixelRatio: 1 };
  const contact = { active: false, position: [.4, .48], released: null, frame: 0, lastDraw: 0 };
  const OVERLAY_WIDTH = 320, OVERLAY_HEIGHT = 240, FRAME_MS = 1000 / 24, SCENE_MS = 1000 / 20;
  let connection = null, pointer = null, toggleActive = false, keyboardHold = false, connectionState = 'connecting';
  let patches = [], summaryCurrent = false, lastPosition = [.4, .48], soundFocusKey = null;
  let inputError = '', gestureError = false, assetError = '', ready = false, width = 1, height = 1, rainStrength = .5, overlayRatio = 1;
  let sceneFrame = 0, sceneDirty = true, lastScene = -Infinity, lastDiagnostic = -Infinity;
  const text = (id, value) => { const node = $(id); if (node && node.textContent !== String(value)) node.textContent = value; };
  const sample = (list, value) => { if (Number.isFinite(value)) { list.push(value); if (list.length > 120) list.shift(); } };
  const percentile = list => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] : 0; };
  function setRainIdentity(number) {
    rainIdentity = participantRainIdentity(number);
    const badge = $('participant-identity');
    badge.hidden = !rainIdentity;
    if (!rainIdentity) return;
    text('participant-number', rainIdentity.label);
    badge.style.setProperty('--rain-color', rainIdentity.color);
    badge.setAttribute('aria-label', `Your rain: ${rainIdentity.label}`);
    material.dataset.rainIdentity = rainIdentity.label;
    material.dataset.rainColor = rainIdentity.color;
  }
  function receiveBellFeedback(message) {
    const now = performance.now();
    const cue = extinctionFeedback.triggerBell(message, { now });
    if (!cue) return;
    metrics.extinctionFeedback = { total: extinctionFeedback.total, last: cue };
    requestScene(); drawMaterial(now);
  }

  function drawMaterial(now = performance.now()) {
    if (!ready) return;
    const at = performance.now();
    map.draw(now);
    map.context.save(); map.context.setTransform(map.scale, 0, 0, map.scale, 0, 0);
    material.dataset.extinctionCues = String(extinctionFeedback.draw(map.context, { rect: map.mapRect, now, reducedMotion: reducedMotion.matches }));
    map.context.restore();
    metrics.materialDraws++; metrics.patchCount = patches.length;
    const duration = performance.now() - at; sample(metrics.sceneSamples, duration);
    material.dataset.redrawCount = String(metrics.materialDraws);
    material.dataset.patchCount = String(patches.length);
    material.dataset.outCount = String(patches.filter(p => p.extinguished).length);
    material.dataset.drawMsLast = duration.toFixed(3);
    material.dataset.spatial = summaryCurrent ? 'country-map' : 'waiting';
    material.dataset.view = 'map';
    material.dataset.mapRect = JSON.stringify(map.mapRect);
    if (now - lastDiagnostic > 500) {
      material.dataset.sceneP95Ms = percentile(metrics.sceneSamples).toFixed(3);
      material.dataset.pixelRatio = String(map.scale || material.width / width);
      lastDiagnostic = now;
    }
    sceneDirty = false; lastScene = now;
  }
  function animateScene(now) {
    sceneFrame = 0;
    if (document.hidden || !ready) return;
    if (now - lastScene >= SCENE_MS && (sceneDirty || !reducedMotion.matches || material.dataset.extinctionCues !== '0')) drawMaterial(now);
    const simmering = patches.some(patch => !patch.extinguished && patch.heat > .0001);
    if (sceneDirty || extinctionFeedback.hasAnimation(now) || (!reducedMotion.matches && simmering)) sceneFrame = requestAnimationFrame(animateScene);
  }
  function requestScene() { sceneDirty = true; if (!sceneFrame && !document.hidden && ready) sceneFrame = requestAnimationFrame(animateScene); }
  function resize() {
    const box = stage.getBoundingClientRect(); width = Math.max(1, box.width); height = Math.max(1, box.height);
    map.resize(width, height);
    overlayRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    overlay.width = Math.round(OVERLAY_WIDTH * overlayRatio); overlay.height = Math.round(OVERLAY_HEIGHT * overlayRatio);
    rainContext.setTransform(overlayRatio, 0, 0, overlayRatio, 0, 0);
    material.dataset.mapRect = JSON.stringify(map.mapRect);
    if (ready) { drawMaterial(); requestScene(); }
    if (contact.active || contact.released !== null) drawContact(performance.now());
  }
  function renderField(region) {
    const next = peatPhoneRegion(region);
    const field = region?.spatial?.format === 'country-v1' ? peatPhonePatches(region.spatial) : null;
    summaryCurrent = Boolean(next && field);
    if (!summaryCurrent) return;
    patches = field;
    sound.setPatches(patches);
    syncPhoneSound();
    map.setPatches(patches.map(patch => ({ ...patch, x: patch.left, y: patch.top })));
    document.body.dataset.thermalState = next.empty ? 'empty' : next.out ? 'out' : next.heat >= .65 ? 'hot' : 'cooling';
    requestScene();
  }

  function clearContact() {
    if (contact.frame) cancelAnimationFrame(contact.frame);
    contact.frame = 0; contact.active = false; contact.released = null;
    rainTransitions.clear();
    for (const layer of tailLayers.values()) layer.canvas.remove();
    tailLayers.clear();
    rainContext.clearRect(0, 0, OVERLAY_WIDTH, OVERLAY_HEIGHT);
    overlay.dataset.state = 'idle'; metrics.state = 'idle';
    overlay.dataset.dropCount = '0'; overlay.dataset.visualContacts = '0';
    overlay.dataset.rafCount = String(metrics.rafCallbacks);
    document.body.dataset.touching = 'false';
  }
  function contactCoordinates(position = contact.position) {
    const box = stage.getBoundingClientRect(), rect = map.mapRect;
    return { x: box.left + rect.x + position[0] * rect.width, y: box.top + rect.y + position[1] * rect.height };
  }
  function moveOverlay(position = contact.position) {
    const { x, y } = contactCoordinates(position);
    const left = x - OVERLAY_WIDTH / 2, top = y - 170;
    overlay.style.transform = `translate(${left}px, ${top}px)`;
    return { left, top };
  }
  function drawContact(now = performance.now()) {
    const at = performance.now();
    const visuals = rainTransitions.sample(now, { reducedMotion: reducedMotion.matches });
    if (!visuals.length || document.hidden || !ready) { clearContact(); return; }
    const primary = visuals[0];
    const primaryPosition = moveOverlay([primary.x, primary.y]);
    rainContext.clearRect(0, 0, OVERLAY_WIDTH, OVERLAY_HEIGHT);
    let dropCount = 0;
    const usedLayers = new Set();
    for (const [index, visual] of visuals.entries()) {
      let targetContext = rainContext, position = primaryPosition;
      if (index > 0) {
        // A rapid press elsewhere must not crop the previous rain tail. Keep
        // each short tail on its own small surface instead of clearing a
        // viewport-sized bitmap on the phone every frame.
        let layer = tailLayers.get(visual.id);
        if (!layer) {
          const canvas = document.createElement('canvas');
          canvas.className = 'phone-contact-tail'; canvas.setAttribute('aria-hidden', 'true');
          canvas.width = overlay.width; canvas.height = overlay.height;
          canvas.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:240px;z-index:5;pointer-events:none';
          const context = canvas.getContext('2d'); context.setTransform(overlayRatio, 0, 0, overlayRatio, 0, 0);
          layer = { canvas, context }; tailLayers.set(visual.id, layer); instrument.append(canvas);
        }
        usedLayers.add(visual.id); targetContext = layer.context;
        const point = contactCoordinates([visual.x, visual.y]);
        position = { left: point.x - OVERLAY_WIDTH / 2, top: point.y - 170 };
        layer.canvas.style.transform = `translate(${position.left}px, ${position.top}px)`;
        targetContext.clearRect(0, 0, OVERLAY_WIDTH, OVERLAY_HEIGHT);
      }
      const { left, top } = position;
      const result = rain.draw(targetContext, { ...visual, x: OVERLAY_WIDTH / 2, y: 170,
        radius: map.mapRect.width * .85 / 48, now, strength: audienceRainStrength(currentScene, rainStrength),
        reducedMotion: reducedMotion.matches, local: true, cloud: false, footprint: true, color: rainIdentity?.color,
        bounds: { left: -left, top: -top, right: innerWidth - left, bottom: innerHeight - top } });
      dropCount += result?.dropCount || 0;
    }
    for (const [id, layer] of tailLayers) if (!usedLayers.has(id)) { layer.canvas.remove(); tailLayers.delete(id); }
    contact.lastDraw = now; metrics.contactFrames++;
    const duration = performance.now() - at; sample(metrics.drawSamples, duration);
    overlay.dataset.drawCount = String(metrics.contactFrames);
    overlay.dataset.rafCount = String(metrics.rafCallbacks);
    overlay.dataset.drawMsLast = duration.toFixed(3);
    overlay.dataset.normalizedPosition = JSON.stringify(contact.position);
    overlay.dataset.geo = JSON.stringify(countryGeo(contact.position));
    overlay.dataset.cloud = 'false';
    overlay.dataset.dropCount = String(dropCount);
    overlay.dataset.visualContacts = String(visuals.length);
  }
  function animateContact(now) {
    contact.frame = 0; metrics.rafCallbacks++;
    if (document.hidden || (!contact.active && !rainTransitions.hasAnimation(now))) { clearContact(); return; }
    if (now - contact.lastDraw >= FRAME_MS) drawContact(now);
    if (!reducedMotion.matches && (contact.active || rainTransitions.hasAnimation(now))) contact.frame = requestAnimationFrame(animateContact);
  }
  function updateContactTransition(now = performance.now()) {
    rainTransitions.update(contact.active ? [{ id: 'phone-local', x: contact.position[0], y: contact.position[1],
      active: true, local: true }] : [], now, { reducedMotion: reducedMotion.matches });
  }
  function startContact(position, at = performance.now()) {
    contact.position = [...position]; contact.active = true; contact.released = null;
    updateContactTransition();
    overlay.dataset.state = 'holding'; metrics.state = 'holding'; document.body.dataset.touching = 'true'; document.body.dataset.used = 'true';
    drawContact(performance.now());
    const feedback = performance.now() - at; sample(metrics.localFeedbackSamples, feedback); overlay.dataset.feedbackMsLast = feedback.toFixed(3);
    if (!reducedMotion.matches && !contact.frame) contact.frame = requestAnimationFrame(animateContact);
  }
  function moveContact(position) {
    contact.position = [...position]; updateContactTransition(); moveOverlay();
    if (reducedMotion.matches || performance.now() - contact.lastDraw >= FRAME_MS) drawContact(performance.now());
  }
  function releaseContact(tail = true) {
    document.body.dataset.touching = 'false';
    if (!contact.active || !tail || reducedMotion.matches || document.hidden) { clearContact(); return; }
    contact.active = false; contact.released = performance.now(); overlay.dataset.state = 'tail'; metrics.state = 'tail';
    updateContactTransition(contact.released);
    if (!contact.frame) contact.frame = requestAnimationFrame(animateContact);
  }
  function clearGesture() {
    const previous = pointer; pointer = null; toggleActive = false; keyboardHold = false;
    if (previous !== null && material.hasPointerCapture(previous)) material.releasePointerCapture(previous);
  }
  function stop({ tail = true } = {}) { clearGesture(); releaseContact(tail); connection?.stop(); renderStatus(); }
  function syncPhoneSound() {
    const interaction = nationalPhoneInteraction(patches, lastPosition, {
      holding: Boolean(connection?.holding),
      eligible: Boolean(ready && summaryCurrent && sceneAllowsRain(currentScene)),
      preferredKey: soundFocusKey,
    });
    soundFocusKey = interaction.patchKey;
    sound.setPhoneInteraction?.(interaction);
  }
  function renderStatus() {
    const holding = Boolean(connection?.holding), canRain = Boolean(connection?.canPour && ready && summaryCurrent && sceneAllowsRain(currentScene));
    if (!holding && (pointer !== null || toggleActive || keyboardHold)) clearGesture();
    if (!holding && contact.active) clearContact();
    const error = assetError || inputError;
    document.body.dataset.pouring = String(holding && connection.acknowledged);
    document.body.dataset.stale = String(!summaryCurrent || !connection?.connected);
    document.body.dataset.ready = String(canRain || holding);
    document.body.dataset.error = String(Boolean(error));
    toggle.disabled = !canRain && !holding;
    toggle.setAttribute('aria-pressed', String(holding));
    toggle.setAttribute('aria-label', holding ? 'Stop rain' : 'Start rain without holding');
    text('toggle-label', holding ? 'Stop' : 'Rain');
    document.body.dataset.connected = String(Boolean(connection?.connected));
    const state = error || (connection?.connected ? currentScene?.paused ? 'Paused' : 'Connected' : connectionState === 'connecting' ? 'Connecting…' : 'Reconnecting…');
    text('connection-state', state);
    $('connection-dot').dataset.status = error ? 'error' : holding ? 'holding' : connection?.connected && ready && summaryCurrent ? 'ready' : 'connecting';
    text('local-input-state', error || (!ready ? 'Preparing the map…' : holding ? connection.acknowledged ? 'Rain confirmed' : 'Rain received; waiting for venue' : canRain ? 'Ready. Hold to rain.' : connection?.connected && currentScene ? sceneInstruction(currentScene) : 'Reconnect, then press again.'));
    syncPhoneSound();
  }
  const position = event => { const box = material.getBoundingClientRect(); return countryInputAt(map.mapRect, event.clientX - box.left, event.clientY - box.top); };
  function selectPosition(position) { lastPosition = [...position]; map.setSelection(lastPosition); syncPhoneSound(); requestScene(); }
  function begin(position, at = performance.now()) {
    if (!ready || !summaryCurrent || !connection?.canPour || !sceneAllowsRain(currentScene) || notesOpen) return false;
    inputError = ''; gestureError = false; selectPosition(position);
    if (!connection.begin(position)) return false;
    startContact(position, at); renderStatus(); return true;
  }

  map.setSelection(lastPosition);
  connection = new SharedConnection({ role: 'participant', scope: 'indonesia',
    onBell: receiveBellFeedback,
    onWelcome(message) { clearGesture(); clearContact(); extinctionFeedback.clear(); summaryCurrent = false; inputError = ''; gestureError = false; setRainIdentity(message.participantNumber); },
    onState(message, { reset } = {}) {
      metrics.packetCount++;
      if (reset) { sound.reset(message.epoch); clearGesture(); clearContact(); extinctionFeedback.clear(); inputError = 'Reset. Press again.'; gestureError = true; }
      if (message.participantNumber !== undefined) setRainIdentity(message.participantNumber);
      if (unit(message.strength)) rainStrength = message.strength;
      sound.setMacroCondition(phoneMacroCondition(message));
      if (sound.applySharedSettings) sound.applySharedSettings(message.soundSettings); else applySharedSound(sound, message.soundSettings, { phone: true });
      renderScene(message.scene);
      renderField(message.region); renderStatus();
    },
    onConnection(status) { connectionState = status; if (status !== 'connected') { clearGesture(); clearContact(); summaryCurrent = false; } renderStatus(); },
    onError(message) { clearGesture(); clearContact(); inputError = message; gestureError = true; renderStatus(); },
  });
  material.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || pointer !== null || !ready || !summaryCurrent || !connection.canPour) return;
    event.preventDefault(); material.focus({ preventScroll: true });
    if (toggleActive) stop({ tail: false });
    if (begin(position(event))) { pointer = event.pointerId; material.setPointerCapture(pointer); }
  });
  material.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer || !connection.holding) return;
    event.preventDefault(); selectPosition(position(event));
    connection.move(lastPosition); moveContact(lastPosition);
  });
  material.addEventListener('pointerup', event => {
    if (event.pointerId !== pointer) return;
    selectPosition(position(event)); connection.move(lastPosition); moveContact(lastPosition); stop();
  });
  for (const name of ['pointercancel', 'lostpointercapture']) material.addEventListener(name, event => { if (event.pointerId === pointer) stop({ tail: false }); });
  material.addEventListener('contextmenu', event => event.preventDefault());
  material.addEventListener('keydown', event => {
    if (event.code === 'Space') { event.preventDefault(); if (!event.repeat && !connection.holding) { keyboardHold = begin(lastPosition); } }
    const directions = { ArrowLeft: [-.02,0], ArrowRight: [.02,0], ArrowUp: [0,-.02], ArrowDown: [0,.02] };
    if (directions[event.code]) {
      event.preventDefault(); const movement = directions[event.code];
      selectPosition(lastPosition.map((value,index) => clamp(value + movement[index])));
      if (connection.holding) { connection.move(lastPosition); moveContact(lastPosition); }
    }
  });
  window.addEventListener('keyup', event => { if (event.code === 'Space' && keyboardHold) stop(); });
  toggle.addEventListener('click', () => { if (connection.holding) stop(); else toggleActive = begin(lastPosition); });
  window.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); stop({ tail: false }); } });
  window.addEventListener('blur', () => stop({ tail: false }));
  window.addEventListener('pagehide', () => stop({ tail: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stop({ tail: false }); if (sceneFrame) cancelAnimationFrame(sceneFrame); sceneFrame = 0; }
    else requestScene();
  });
  // Mobile browser chrome can resize the viewport during a sustained touch.
  // Resize its visual surfaces without cancelling the audience's held rain.
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => stop({ tail: false }));
  reducedMotion.addEventListener('change', () => {
    map.setReducedMotion(reducedMotion.matches); requestScene();
    if (contact.frame) cancelAnimationFrame(contact.frame); contact.frame = 0;
    if (contact.active) { updateContactTransition(); drawContact(); if (!reducedMotion.matches) contact.frame = requestAnimationFrame(animateContact); } else clearContact();
  });
  $('phone-fullscreen').addEventListener('click', async () => {
    stop({ tail: false });
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await instrument.requestFullscreen(); }
    catch { inputError = 'Fullscreen unavailable.'; gestureError = false; renderStatus(); }
  });
  document.addEventListener('fullscreenchange', () => {
    const active = Boolean(document.fullscreenElement);
    $('phone-fullscreen').setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    $('phone-fullscreen').title = active ? 'Exit fullscreen' : 'Fullscreen';
    stop({ tail: false }); resize();
  });
  new ResizeObserver(resize).observe(stage);
  Promise.all([map.ready(), rain.ready(), fetch('/data/indonesia-overview.geojson').then(response => {
    if (!response.ok) throw new Error('The Indonesia map could not load.');
    return response.json();
  })]).then(([, , geography]) => {
    map.setGeography(geography); ready = true; resize(); loading.hidden = true; renderStatus(); requestScene();
  }).catch(error => { assetError = error.message; loading.classList.add('error'); loading.textContent = assetError; stop({ tail: false }); });
  resize();
}
