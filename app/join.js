import { SharedConnection } from './shared-client.js';
import { drawBrushRain } from '../visual-assets/map-weather.js';
import { CELL_SIZE } from './simulation.js';
import { mountSoundControls } from './sound-controls.js';
import { sceneAllowsRain, applySharedSound } from './performance-view.js';

// Heat already averages every source fire cell, including extinguished zeroes.
// Do not multiply it by the remaining fraction or infer progress from a gesture.
export function phoneAtmosphere(region) {
  if (!region || !Number.isFinite(region.heat) || region.heat < 0 || region.heat > 1 ||
      !Number.isSafeInteger(region.fireCells) || region.fireCells < 0 ||
      !Number.isSafeInteger(region.extinguishedCells) || region.extinguishedCells < 0 ||
      region.extinguishedCells > region.fireCells) return null;
  const { heat, fireCells, extinguishedCells } = region;
  if (!fireCells && heat > 0) return null;
  const empty = fireCells === 0;
  // Counts, not rounded near-zero heat, establish extinction. The heat check
  // also prevents a contradictory packet from claiming a region is all out.
  const out = !empty && extinguishedCells === fireCells && heat <= .0001;
  const quiet = empty || out;
  const warm = quiet ? 0 : Math.max(.12, Math.min(1, heat / .5));
  const t = Math.max(0, Math.min(1, (heat - .2) / .65));
  const hot = quiet ? 0 : t * t * (3 - 2 * t);
  const state = empty ? 'empty' : out ? 'out' : heat >= .65 ? 'hot' : heat >= .18 ? 'cooling' : 'low';
  const label = empty ? 'No fire patches in this snapshot' : out ? 'All fire patches out' :
    state === 'hot' ? 'High heat' : state === 'cooling' ? 'Moderate heat' : 'Low heat · patches remain';
  return { state, label, warm, hot };
}

// Integer row/column fractions are the inverse of the server's land-row
// control mapping. Only current source-fire patches are sent to the phone.
export function phoneSpatialPatches(field) {
  if (!field || field.format !== 'land-rows-v1' || !Number.isSafeInteger(field.rows) || field.rows < 1 || field.rows > 512 ||
      !Array.isArray(field.patches) || field.patches.length > 10000) return null;
  const seen = new Set(), patches = [];
  for (const entry of field.patches) {
    if (!Array.isArray(entry) || ![6, 8].includes(entry.length)) return null;
    const [key, row, column, columns, heat, extinguished, surfaceWetness = 0, moisture = 0] = entry;
    if (typeof key !== 'string' || seen.has(key) || !Number.isSafeInteger(row) || row < 0 || row >= field.rows ||
        !Number.isSafeInteger(columns) || columns < 1 || columns > 512 || !Number.isSafeInteger(column) || column < 0 || column >= columns ||
        typeof extinguished !== 'boolean' || ![surfaceWetness, moisture].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)) return null;
    const appearance = phoneAtmosphere({ heat, fireCells: 1, extinguishedCells: extinguished ? 1 : 0 });
    if (!appearance) return null;
    seen.add(key);
    patches.push({ key, left: column / columns, top: row / field.rows, width: 1 / columns, height: 1 / field.rows, heat, extinguished, surfaceWetness, moisture, ...appearance });
  }
  return patches;
}

export function phonePatchAt(patches, position) {
  if (!Array.isArray(patches) || !Array.isArray(position) || position.length !== 2 ||
      !position.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return null;
  const [x, y] = position;
  return patches.find(patch => {
    // Recover the protocol's integer bins rather than adding fractions: e.g.
    // .4 + .2 is slightly above .6 and could otherwise select the wrong fire.
    const columns = Math.round(1 / patch.width), rows = Math.round(1 / patch.height);
    return Math.min(columns - 1, Math.floor(x * columns)) === Math.round(patch.left * columns) &&
      Math.min(rows - 1, Math.floor(y * rows)) === Math.round(patch.top * rows);
  })?.key ?? null;
}

export function phoneFireProgress(message) {
  // Explicit global values stay authoritative, including malformed packets:
  // the sound engine validates them and retains its last valid progression.
  if (message && Object.hasOwn(message, 'fireProgress')) return message.fireProgress;
  const region = message?.region;
  // Older servers omit the global field. The national view's region already
  // covers Indonesia; legacy island views can still use their available scope.
  if (!region || !Object.hasOwn(region, 'fireCells') || !Object.hasOwn(region, 'extinguishedCells')) return undefined;
  return { sourceCount: region.fireCells, outCount: region.extinguishedCells };
}

export function phoneMacroCondition(message) {
  // Preserve explicit invalid data for the engine to reject. Falling back to
  // a locally extinguished island could otherwise announce false completion.
  if (message && Object.hasOwn(message, 'soundCondition')) return message.soundCondition;
  return phoneFireProgress(message);
}

// Keeping the pure mapping in this already-served module avoids another phone
// download and lets the state contract be tested without a browser or map.
if (typeof document !== 'undefined' && document.getElementById('rain-instrument')) initializePhone();

function initializePhone() {
  // This input surface receives an assigned-island summary and a compact fire
  // field. The laptop still owns geography, water, heat, and simulation time.
  const instrument = document.querySelector('#rain-instrument');
  const toggle = document.querySelector('#rain-toggle');
  const sound = mountSoundControls(document.getElementById('phone-sound'), { mode: 'phone' });
  const elements = new Map();
  const atmosphere = document.querySelector('#phone-atmosphere');
  let atmosphereState = null;
  let regionSummary = null;
  let latestPatches = [];
  let currentScene = null;
  const patchElements = new Map();
  let summaryCurrent = false;
  let connection = null;
  let activePointer = null;
  let toggleActive = false;
  let lastPosition = [.5, .5];
  let connectionState = 'connecting';
  let inputError = '';
  let rainStrength = .45;

  const rainCanvas = document.querySelector('#phone-rain');
  const rainContext = rainCanvas.getContext('2d');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const visualRain = { active: false, position: [.5, .5], releasedAt: null, frame: 0, lastDraw: 0, width: 0, height: 0 };
  const RAIN_FRAME_MS = 1000 / 24;
  const RAIN_TAIL_MS = 650;

  // Bake the grain only once. The browser repeats this tiny static bitmap over
  // the CSS haze, so neither the grain nor background uses an animation loop.
  function makeGrain() {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 128;
    const ctx = tile.getContext('2d');
    const pixels = ctx.createImageData(128, 128);
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

  function sizeRainCanvas() {
    visualRain.width = Math.max(1, window.innerWidth);
    visualRain.height = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    rainCanvas.width = Math.round(visualRain.width * dpr);
    rainCanvas.height = Math.round(visualRain.height * dpr);
    rainContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function clearRain() {
    visualRain.active = false;
    visualRain.releasedAt = null;
    if (visualRain.frame) cancelAnimationFrame(visualRain.frame);
    visualRain.frame = 0;
    rainContext.clearRect(0, 0, visualRain.width, visualRain.height);
    rainCanvas.dataset.state = 'idle';
  }

  function drawRain(now) {
    rainContext.clearRect(0, 0, visualRain.width, visualRain.height);
    const tail = visualRain.releasedAt === null ? 0 : Math.max(0, 1 - (now - visualRain.releasedAt) / RAIN_TAIL_MS);
    if (!visualRain.active && !tail) { clearRain(); return; }
    const radius = Math.max(58, Math.min(100, visualRain.width * .21));
    drawBrushRain(rainContext, {
      x: visualRain.position[0] * visualRain.width,
      y: visualRain.position[1] * visualRain.height,
      radius,
      time: reducedMotion.matches ? 0 : now / 1000,
      amount: visualRain.active ? rainStrength : 0,
      tail, tailAmount: rainStrength,
      rainColor: '#c9e9ff',
    });
    visualRain.lastDraw = now;
  }

  function animateRain(now) {
    visualRain.frame = 0;
    if (document.hidden) { clearRain(); return; }
    if (now - visualRain.lastDraw >= RAIN_FRAME_MS) drawRain(now);
    if (!reducedMotion.matches && (visualRain.active || visualRain.releasedAt !== null)) visualRain.frame = requestAnimationFrame(animateRain);
  }

  function startRain(position) {
    visualRain.position = [...position];
    visualRain.active = true;
    visualRain.releasedAt = null;
    rainCanvas.dataset.state = 'raining';
    drawRain(performance.now()); // Immediate local feedback; server ack stays separate.
    if (!reducedMotion.matches && !visualRain.frame) visualRain.frame = requestAnimationFrame(animateRain);
  }

  function moveRain(position) {
    visualRain.position = [...position];
    if (reducedMotion.matches && visualRain.active) drawRain(performance.now());
  }

  function releaseRain() {
    if (!visualRain.active) return;
    if (reducedMotion.matches || document.hidden) { clearRain(); return; }
    visualRain.active = false;
    visualRain.releasedAt = performance.now();
    rainCanvas.dataset.state = 'tail';
    if (!visualRain.frame) visualRain.frame = requestAnimationFrame(animateRain);
  }

  makeGrain();
  sizeRainCanvas();
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) {
      if (visualRain.frame) cancelAnimationFrame(visualRain.frame);
      visualRain.frame = 0;
      if (visualRain.active) drawRain(0); else clearRain();
    } else if (visualRain.active && !visualRain.frame) visualRain.frame = requestAnimationFrame(animateRain);
  });
  window.addEventListener('resize', () => {
    sizeRainCanvas();
    if (visualRain.active || visualRain.releasedAt !== null) drawRain(performance.now());
  });

  function text(id, value) {
    let element = elements.get(id);
    if (!element) { element = document.getElementById(id); elements.set(id, element); }
    if (element && element.textContent !== String(value)) element.textContent = value;
  }

  const percent = value => Number.isFinite(value) ? `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` : '—';
  const count = value => Number.isFinite(value) ? String(value) : '—';
  const clamp = value => Math.max(0, Math.min(1, value));

  function screenPosition(event) {
    // The whole visible screen is useful, including its edges. The server maps
    // this normalized position onto the assigned region and clips the brush.
    return [clamp(event.clientX / Math.max(1, window.innerWidth)), clamp(event.clientY / Math.max(1, window.innerHeight))];
  }

  function clearGesture() {
    const pointer = activePointer;
    activePointer = null;
    toggleActive = false;
    if (pointer !== null && instrument.hasPointerCapture(pointer)) instrument.releasePointerCapture(pointer);
  }

  function stop({ tail = true } = {}) {
    clearGesture();
    if (tail) releaseRain(); else clearRain();
    connection?.stop();
    renderStatus();
  }

  function updatePhoneInteraction() {
    const patchKey = phonePatchAt(latestPatches, lastPosition);
    const patch = latestPatches.find(candidate => candidate.key === patchKey);
    sound.setPhoneInteraction?.({ holding: Boolean(connection?.holding), patchKey,
      extinguished: patch?.extinguished === true,
      eligible: Boolean(connection?.canPour && sceneAllowsRain(currentScene)) });
  }

  function renderStatus() {
    if (!connection?.holding && (activePointer !== null || toggleActive)) clearGesture();
    const ready = Boolean(connection?.canPour && sceneAllowsRain(currentScene));
    const holding = Boolean(connection?.holding);
    const acknowledged = holding && connection.acknowledged;
    if (!holding && visualRain.active) clearRain();
    document.body.dataset.pouring = String(acknowledged);
    toggle.disabled = !ready;
    toggle.setAttribute('aria-pressed', String(toggleActive && holding));
    toggle.textContent = holding ? 'Stop rain' : 'Start rain without holding';
    text('hold-instruction', holding ? (toggleActive ? 'Rain is on.' : 'Lift to stop.') : 'Hold anywhere to pour.');
    renderStats();
    text('region-condition', atmosphereState
      ? `Island · ${atmosphereState.label}${summaryCurrent && connection?.connected ? '' : ' · last update'}`
      : 'Waiting for regional heat…');
    text('connection-state', connection?.connected ? (ready ? 'Connected to venue' : 'Waiting for the operator') : connectionState === 'connecting' ? 'Connecting to venue…' : 'Connection closed');
    text('local-input-state', inputError || (holding
      ? acknowledged ? 'Pouring · venue confirmed' : 'Touch received · waiting for venue'
      : ready ? 'Ready for your rain.' : 'Not contributing. Connect, then press again.'));
    updatePhoneInteraction();
  }

  function renderStats() {
    text('region-wetness', percent(regionSummary?.surfaceWetness));
    text('region-moisture', percent(regionSummary?.moisture));
    text('region-heat', percent(regionSummary?.heat));
  }

  function renderAtmosphere(region) {
    const next = phoneAtmosphere(region);
    const patches = phoneSpatialPatches(region?.spatial);
    summaryCurrent = Boolean(next && patches);
    if (next) atmosphereState = next;
    if (!patches) return; // Keep the last valid geographic field, never paint a guessed island average.
    latestPatches = patches;
    sound.setPatches(patches.map(patch => {
      const [x, y] = patch.key.split(',').map(Number);
      return {
        key: patch.key,
        longitude: (x + .5) * CELL_SIZE,
        latitude: (y + .5) * CELL_SIZE,
        heat: patch.heat,
        extinguished: patch.extinguished,
        surfaceWetness: patch.surfaceWetness,
        moisture: patch.moisture,
      };
    }));
    updatePhoneInteraction();
    document.body.dataset.thermalState = next?.state || 'unknown';
    atmosphere.dataset.spatial = 'ready';
    const retained = new Set(), updates = [];
    const added = document.createDocumentFragment();
    for (const patch of patches) {
      retained.add(patch.key);
      let tile = patchElements.get(patch.key);
      if (!tile) {
        tile = document.createElement('div');
        tile.className = 'heat-patch';
        tile.dataset.patch = patch.key;
        added.append(tile);
        patchElements.set(patch.key, tile);
      }
      tile.style.left = `${patch.left * 100}%`;
      tile.style.top = `${patch.top * 100}%`;
      tile.style.width = `${patch.width * 100}%`;
      tile.style.height = `${patch.height * 100}%`;
      updates.push([tile, patch]);
    }
    if (added.childElementCount) {
      atmosphere.append(added);
      // Establish all new patches at zero opacity in one layout pass so a
      // new source snapshot fades in without per-patch layout work or RAF.
      atmosphere.getBoundingClientRect();
    }
    for (const [tile, patch] of updates) {
      tile.style.setProperty('--warm-opacity', patch.warm.toFixed(4));
      tile.style.setProperty('--hot-opacity', patch.hot.toFixed(4));
      tile.dataset.thermalState = patch.state;
    }
    for (const [key, tile] of patchElements) {
      if (!retained.has(key)) { tile.remove(); patchElements.delete(key); }
    }
  }

  function setAssignment(assignment) {
    if (!assignment) return;
    text('region-name', assignment.name || 'Your region');
  }

  connection = new SharedConnection({
    role: 'participant',
    onWelcome(message) {
      clearGesture(); clearRain();
      summaryCurrent = false; latestPatches = [];
      inputError = '';
      text('participant-number', message.participantNumber);
      setAssignment(message.assignment);
    },
    onState(message, { reset } = {}) {
      if (reset) { clearGesture(); clearRain(); latestPatches = []; sound.reset(message.epoch); inputError = 'Performance reset. Press again when ready.'; }
      currentScene = message.scene || null;
      sound.setSceneState?.(currentScene);
      applySharedSound(sound, message.soundSettings, { phone: true });
      if (!sceneAllowsRain(currentScene) && (connection?.holding || activePointer !== null || toggleActive)) stop({ tail: false });
      setAssignment(message.assignment);
      if (message.participantNumber !== undefined) text('participant-number', message.participantNumber);
      if (Number.isFinite(message.strength)) rainStrength = clamp(message.strength);
      const region = message.region || {};
      regionSummary = region;
      sound.setMacroCondition(phoneMacroCondition(message));
      renderAtmosphere(region);
      text('region-out', `${count(region.extinguishedCells)} / ${count(region.fireCells)}`);
      text('region-active', count(region.activeCount));
      renderStatus();
    },
    onConnection(status) {
      connectionState = status;
      if (status !== 'connected') { clearGesture(); clearRain(); summaryCurrent = false; }
      renderStatus();
    },
    onError(message) {
      clearGesture(); clearRain();
      inputError = message;
      renderStatus();
    },
  });

  instrument.addEventListener('pointerdown', event => {
    if (event.target.closest('button, a') || !event.isPrimary || event.button !== 0 || activePointer !== null) return;
    if (!connection.canPour || !sceneAllowsRain(currentScene)) return;
    event.preventDefault();
    if (toggleActive) stop();
    inputError = '';
    lastPosition = screenPosition(event);
    if (!connection.begin(lastPosition)) return;
    startRain(lastPosition);
    activePointer = event.pointerId;
    instrument.setPointerCapture(event.pointerId);
    renderStatus();
  });

  instrument.addEventListener('pointermove', event => {
    if (event.pointerId !== activePointer || !connection.holding) return;
    event.preventDefault();
    lastPosition = screenPosition(event);
    connection.move(lastPosition);
    moveRain(lastPosition);
    updatePhoneInteraction();
  });

  instrument.addEventListener('pointerup', event => {
    if (event.pointerId !== activePointer) return;
    lastPosition = screenPosition(event);
    connection.move(lastPosition);
    moveRain(lastPosition);
    stop();
  });
  for (const name of ['pointercancel', 'lostpointercapture']) {
    instrument.addEventListener(name, event => { if (event.pointerId === activePointer) stop({ tail: false }); });
  }
  instrument.addEventListener('contextmenu', event => event.preventDefault());

  toggle.addEventListener('click', () => {
    if (connection.holding) { stop(); return; }
    if (!connection.canPour || !sceneAllowsRain(currentScene)) return;
    inputError = '';
    if (connection.begin(lastPosition)) { toggleActive = true; startRain(lastPosition); }
    renderStatus();
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); stop({ tail: false }); }
  });
  window.addEventListener('blur', () => stop({ tail: false }));
  window.addEventListener('pagehide', () => stop({ tail: false }));
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop({ tail: false }); });
}
