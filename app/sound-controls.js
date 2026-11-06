import { WildfireSound, SOUND_MACRO_DEFAULTS, SOUND_MIXER_DEFAULTS, PHONE_MIXER_DEFAULTS } from './sound-engine.js';
import { loadSoundLibrary, soundAssetUrl, ambianceSources } from './sound-library.js';

export const SOUND_DEFAULTS = SOUND_MACRO_DEFAULTS;
const MACROS = [
  ['haze', 'Haze', 'Light veil → drifting air'],
  ['forest', 'Burning forest', 'Ground embers → wind through flames'],
  ['ash', 'Ash', 'Fine flutter → scattered fragments'],
  ['rain', 'Rain', 'Fine patter → steady rain'],
  ['moisture', 'Moisture', 'Soft seepage → gentle trickles; damps the fire'],
];
const MIXER_CHANNELS = [
  ['chimes', 'Soft tones'],
  ['bells', 'Bells'],
  ['quench', 'Woodfire quench'],
  ['blob', 'Extinction blobs'],
  ['outDrone', 'After-extinction textures'],
  ['dragAsh', 'Ash grains · dragging'],
  ['lowDrone', 'Participation low drone'],
  ['haze', 'Haze'],
  ['forest', 'Burning forest'],
  ['ash', 'Ash'],
  ['rain', 'Rain'],
  ['moisture', 'Moisture'],
  ['crickets', 'Crickets'],
  ['orangutan', 'Orangutan voice'],
  ['orangutanTail', 'Orangutan tail'],
];
const MIXER_GROUPS = [
  ['Interaction', ['chimes', 'bells', 'quench', 'blob', 'outDrone', 'dragAsh']],
  ['Atmosphere', ['lowDrone', 'haze', 'forest', 'ash', 'rain', 'moisture', 'crickets']],
  ['Wildlife', ['orangutan', 'orangutanTail']],
];
const PHONE_MIXER_CHANNELS = [
  ['crackle', 'Crackle'],
  ['rain', 'Rain'],
  ['crickets', 'Crickets'],
  ['birds', 'Bird calls'],
  ['drone', 'Distorted drone'],
];
let soundStatusSequence = 0;
const SPEAKER_ICON = `<svg class="sound-speaker" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g class="sound-speaker-body"><path d="m11 5-5 4H3v6h3l5 4V5Z"/><path class="sound-waves" d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/><path class="sound-slash" d="m3 3 18 18"/><path class="sound-pause" d="M16 8v8M20 8v8"/></g><circle class="sound-spinner" cx="12" cy="12" r="8"/></svg>`;

// Audio permission stays local. The dedicated operator publishes shared sound
// settings through its supplied callback; no sound control sends water.
export function mountSoundControls(host, { mode = 'phone', engine: suppliedEngine, shared = false, remoteControl = false, onSettings = () => {} } = {}) {
  const operator = mode === 'operator', projection = mode === 'projection', fullAudio = operator || projection, storageKey = `wildfire-sound-${mode}-v1`;
  const statusId = `wildfire-sound-status-${++soundStatusSequence}`;
  const soundName = operator ? 'main sound' : projection ? 'projection sound' : 'sound';
  const enableButton = `<button class="sound-enable" type="button" aria-label="Enable ${soundName}" title="Enable ${soundName}" aria-describedby="${statusId}">${SPEAKER_ICON}</button>`;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { /* Defaults also work with storage disabled. */ }
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  const validMixer = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2;
  let level = valid(saved.level) ? saved.level : .55;
  let forestSource = typeof saved.forestSource === 'string' ? saved.forestSource : null;
  let paletteVersion = saved.paletteVersion ?? null;
  const storedMacros = { ...saved.macros, forest: saved.macros?.forest ?? saved.macros?.charcoal };
  const macros = Object.fromEntries(Object.entries(SOUND_DEFAULTS).map(([key, value]) => [key, valid(storedMacros[key]) ? storedMacros[key] : value]));
  const mixer = Object.fromEntries(Object.entries(SOUND_MIXER_DEFAULTS).map(([key, value]) => [key, !shared && validMixer(saved.mixer?.[key]) ? saved.mixer[key] : value]));
  const phoneMixer = { ...PHONE_MIXER_DEFAULTS }, phoneMixerAvailable = operator && shared;
  const confirmedPhoneMixer = { ...PHONE_MIXER_DEFAULTS };
  const engine = suppliedEngine || new WildfireSound({ mode: fullAudio ? 'operator' : 'phone', onStatus: renderStatus });
  if (operator) engine.setLocalBellAudition?.(!remoteControl);
  if (suppliedEngine) engine.onStatus = renderStatus;
  // Kept intentionally inspectable for local rehearsal and browser checks.
  window.__wildfireSound = engine;
  if (!host) return engine;
  host.classList.add('sound-controls', operator ? 'sound-operator' : projection ? 'sound-projection' : 'sound-phone');
  host.dataset.remoteControl = String(remoteControl);
  host.innerHTML = operator ? `
    <section class="sound-main-controls" aria-label="Main sound">
      <h2>Main sound</h2>
      <div class="sound-top">${enableButton}<span id="${statusId}" class="sound-status" role="status" aria-live="polite" aria-atomic="true">Main sound disabled</span></div>
      <p class="sound-local-hint">${remoteControl ? 'Main audio plays on the host computer. Mixer changes apply there.' : 'Audio from this computer.'}</p>
      <label class="sound-level">${shared ? 'Main output' : 'Output'} <input class="sound-volume" type="range" min="0" max="100" step="1" aria-label="${shared ? 'Main output' : 'Sound output'}"><output class="sound-volume-value"></output></label>
    </section>
    <div class="sound-mixer-details" data-mixer-details>
    <section class="sound-mixer" aria-label="Layer levels">
      <div class="sound-mixer-heading"><h2>Layer levels</h2><button class="sound-mixer-reset" type="button">Reset mixer</button></div>
      <p class="sound-mixer-hint">100% is each layer’s balanced level.</p>
      ${MIXER_GROUPS.map(([group, keys]) => `<fieldset class="sound-channel-group"><legend>${group}</legend><div class="sound-mixer-channels">${keys.map(key => {
        const label = MIXER_CHANNELS.find(([id]) => id === key)[1];
        return `<label class="sound-mixer-channel"><span>${label}</span><output data-mixer-value="${key}"></output><input type="range" min="0" max="200" step="1" data-mixer="${key}" aria-label="${label} volume"></label>`;
      }).join('')}</div></fieldset>`).join('')}
    </section>
    ${phoneMixerAvailable ? `<section class="sound-mixer sound-phone-mixer" aria-label="Phone sound">
      <div class="sound-mixer-heading"><h2>Phone sound</h2><button class="sound-phone-mixer-reset" type="button">Reset phone mixer</button></div>
      <p class="sound-mixer-hint">Changes reach connected phones live. 100% keeps the current balanced level. Participants still enable sound on their own phones.</p>
      <label class="sound-mixer-channel sound-phone-overall"><span>Overall phone level</span><output data-phone-mixer-value="overall"></output><input type="range" min="0" max="200" step="1" data-phone-mixer="overall" aria-label="Overall phone volume"></label>
      <div class="sound-mixer-channels">${PHONE_MIXER_CHANNELS.map(([key, label]) => `<label class="sound-mixer-channel"><span>${label}</span><output data-phone-mixer-value="${key}"></output><input type="range" min="0" max="200" step="1" data-phone-mixer="${key}" aria-label="Phone ${label.toLowerCase()} volume"></label>`).join('')}</div>
    </section>` : ''}
    <details class="sound-panel">
      <summary>Texture shaping <span class="sound-summary-state">Automatic</span></summary>
      <div class="sound-body">
        <p class="sound-local-hint sound-test-hint" hidden>Hold a burning patch in the preview to audition its tone. Cooling a full rain area triggers one bell, quench and material transition.</p>
        <label class="sound-automation"><input class="sound-auto" type="checkbox" checked> Follow scenes and landscape automatically</label>
        <p class="sound-local-hint">These controls shape the sound, separately from layer volume. Moving one switches texture shaping to Manual. Rain on the map changes the landscape.</p>
        <label class="sound-choice" ${shared ? 'hidden' : ''}>Fire sound <select class="sound-forest-source" aria-label="Fire sound" disabled><option>Opening sound choices…</option></select></label>
        <p class="sound-source-status" role="status" ${shared ? 'hidden' : ''}></p>
        <div class="sound-macros">${MACROS.map(([key, label, hint]) => `<label class="sound-macro"><span class="sound-macro-name">${label}</span><output data-value="${key}"></output><input type="range" min="0" max="100" step="1" data-macro="${key}" aria-label="${label}"><span class="sound-hint">${hint}</span></label>`).join('')}</div>
        <div class="sound-footer"><button class="sound-reset" type="button">Reset texture</button><a href="/sound-lab" ${remoteControl ? 'hidden' : ''}>Compare sounds ↗</a><a href="/audio-assets/ATTRIBUTION.md" target="_blank" rel="noopener">Sound sources ↗</a></div>
      </div>
    </details>
    </div>` : `
    ${enableButton}
    <span id="${statusId}" class="sound-status" role="status" aria-live="polite" aria-atomic="true">Sound disabled</span>`;
  const button = host.querySelector('.sound-enable');
  button.hidden = remoteControl;
  let lastStatus = engine.getMetrics?.() || { state: 'off' }, busy = false;

  function renderStatus(next) {
    // An engine may announce its initial state inside its constructor.
    if (!host?.querySelector('.sound-enable')) return;
    lastStatus = next;
    if (remoteControl) {
      host.dataset.soundState = 'remote';
      const control = host.querySelector('.sound-enable');
      control.hidden = true; control.disabled = true;
      host.querySelector('.sound-status').textContent = 'Main sound on host computer';
      renderAutomationState();
      return;
    }
    const starting = busy || next.state === 'starting', active = !starting && next.state === 'ready';
    const muted = next.state === 'muted', paused = next.state === 'suspended';
    host.dataset.soundState = starting ? 'starting' : next.state;
    const control = host.querySelector('.sound-enable');
    const action = `${starting ? 'Starting' : active ? 'Mute' : muted ? 'Unmute' : paused ? 'Resume' : 'Enable'} ${soundName}`;
    control.setAttribute('aria-label', action);
    control.title = action;
    control.disabled = busy || starting;
    control.setAttribute('aria-busy', String(busy || starting));
    const label = operator ? 'Main sound' : projection ? 'Projection sound' : 'Sound';
    let status = starting ? 'Starting…' : active ? `${label} enabled` : muted ? operator ? 'Main sound muted' : 'Muted' : paused ? operator ? 'Main sound paused' : 'Paused' : next.state === 'error' ? `${label} could not start` : `${label} disabled`;
    // Enabling permission does not promise audible output: scenes, the device's
    // media volume and Silent Mode can all keep an enabled device quiet.
    if (active) {
      if (next.degraded || next.failedSamples?.length) status += ' · recording unavailable';
      else if (next.samplePending?.length) status += ' · loading recordings';
    }
    host.querySelector('.sound-status').textContent = status;
    renderAutomationState();
    const testHint = host.querySelector('.sound-test-hint');
    if (testHint) testHint.hidden = !active;
  }
  function renderAutomationState() {
    const stateLabel = host.querySelector('.sound-summary-state');
    if (stateLabel) {
      const automatic = host.querySelector('.sound-auto').checked;
      stateLabel.textContent = automatic ? 'Automatic' : 'Manual';
      stateLabel.dataset.mode = automatic ? 'automatic' : 'manual';
    }
  }
  const persist = () => { try { localStorage.setItem(storageKey, JSON.stringify({ level, macros, mixer: shared ? saved.mixer : mixer, forestSource, paletteVersion })); } catch { /* Sound is still playable. */ } };
  engine.setMacros(macros);
  if (fullAudio) engine.setMixer(mixer);
  else engine.setPhoneMixer?.(phoneMixer);
  engine.setAutomation?.(true);
  engine.setLevel(level);
  if (projection) { host.dataset.projection = 'true'; host.hidden = true; }
  renderStatus(lastStatus);
  button.addEventListener('click', async () => {
    if (busy || remoteControl) return;
    if (lastStatus.state === 'ready') { engine.setMuted(true); return; }
    busy = true;
    renderStatus({ state: 'starting' });
    try {
      // enable resumes AudioContext before its first await, within this gesture.
      await engine.enable();
    } catch { renderStatus({ state: 'error', message: 'Sound could not start. Tap to try again.' }); }
    finally { busy = false; renderStatus(lastStatus); }
  });
  const publish = patch => shared ? onSettings(patch) : undefined;
  // The preview and operator share an engine. Its own state stream can echo
  // an older mix while the desk is still dragging or saving a new value.
  const editingMixer = new Set(), pendingMixer = new Map();
  const editingPhoneMixer = new Set(), pendingPhoneMixer = new Map();
  const editingControls = new Set(), pendingControls = new Map();
  const confirmedControls = new Map([['level', level], ['automation', true], ...Object.entries(macros).map(([key, value]) => [`macro:${key}`, value])]);
  let mixerRevision = 0;
  let phoneMixerRevision = 0;
  let controlsRevision = 0;
  let appliedAutomation = true;
  function renderMainControls() {
    if (!operator) return;
    host.querySelector('.sound-auto').checked = appliedAutomation;
    renderAutomationState();
    host.querySelector('.sound-volume').value = String(Math.round(level * 100));
    host.querySelector('.sound-volume-value').textContent = `${Math.round(level * 100)}%`;
    for (const input of host.querySelectorAll('[data-macro]')) {
      input.value = String(Math.round(macros[input.dataset.macro] * 100));
      host.querySelector(`[data-value="${input.dataset.macro}"]`).textContent = `${input.value}%`;
    }
  }
  function sharedControlValue(key, next, current) {
    confirmedControls.set(key, next);
    const pending = pendingControls.get(key);
    if (next === pending?.value) pendingControls.delete(key);
    return (pending || editingControls.has(key)) && next !== current ? current : next;
  }
  function reconcileConfirmedControls(keys = [...confirmedControls.keys()], force = false) {
    if (!shared) return;
    let macroChanged = false, levelChanged = false, automatic = appliedAutomation;
    for (const key of keys) {
      if (pendingControls.has(key) || !force && editingControls.has(key)) continue;
      const confirmed = confirmedControls.get(key);
      if (key === 'level' && confirmed !== level) { level = confirmed; levelChanged = true; }
      else if (key === 'automation') automatic = confirmed;
      else if (key.startsWith('macro:') && macros[key.slice(6)] !== confirmed) { macros[key.slice(6)] = confirmed; macroChanged = true; }
    }
    if (macroChanged) { engine.setMacros(macros); appliedAutomation = false; }
    const currentAutomatic = typeof engine.automationEnabled === 'boolean' ? engine.automationEnabled : appliedAutomation;
    if (automatic !== currentAutomatic) engine.setAutomation?.(automatic);
    appliedAutomation = automatic;
    if (levelChanged) engine.setLevel(level);
    renderMainControls();
    if (macroChanged || levelChanged) persist();
  }
  function publishControls(patch) {
    const revision = ++controlsRevision, fields = [];
    if (patch.level !== undefined) fields.push(['level', patch.level]);
    if (patch.automation !== undefined) fields.push(['automation', patch.automation]);
    if (patch.macros) for (const [key, value] of Object.entries(patch.macros)) fields.push([`macro:${key}`, value]);
    if (shared) for (const [key, value] of fields) pendingControls.set(key, { value, revision });
    const saving = publish(patch);
    const settled = () => {
      for (const [key] of fields) if (pendingControls.get(key)?.revision === revision) {
        confirmedControls.set(key, pendingControls.get(key).value); pendingControls.delete(key);
      }
      appliedSignature = ''; reconcileConfirmedControls();
    };
    const failed = () => {
      const restore = [];
      for (const [key] of fields) if (pendingControls.get(key)?.revision === revision) {
        pendingControls.delete(key); restore.push(key);
      }
      appliedSignature = ''; reconcileConfirmedControls(restore, true);
    };
    if (saving?.then) Promise.resolve(saving).then(result => result === false ? failed() : settled(), failed);
  }
  function renderMixer() {
    if (!operator) return;
    for (const input of host.querySelectorAll('[data-mixer]')) {
      const value = Math.round(mixer[input.dataset.mixer] * 100);
      input.value = String(value);
      host.querySelector(`[data-mixer-value="${input.dataset.mixer}"]`).textContent = `${value}%`;
    }
  }
  function publishMixer(patch) {
    const revision = ++mixerRevision;
    if (shared) for (const [key, value] of Object.entries(patch)) pendingMixer.set(key, { value, revision });
    const saving = publish({ mixer: patch });
    const settled = () => { for (const key of Object.keys(patch)) if (pendingMixer.get(key)?.revision === revision) pendingMixer.delete(key); };
    // A connected desk can acknowledge its save. Other shared integrations
    // release pending values when the matching state arrives below.
    if (saving?.then) Promise.resolve(saving).then(settled, settled);
  }
  function renderPhoneMixer() {
    if (!phoneMixerAvailable) return;
    for (const input of host.querySelectorAll('[data-phone-mixer]')) {
      const value = Math.round(phoneMixer[input.dataset.phoneMixer] * 100);
      input.value = String(value);
      host.querySelector(`[data-phone-mixer-value="${input.dataset.phoneMixer}"]`).textContent = `${value}%`;
    }
  }
  function publishPhoneMixer(patch) {
    const revision = ++phoneMixerRevision;
    for (const [key, value] of Object.entries(patch)) pendingPhoneMixer.set(key, { value, revision });
    const saving = publish({ phoneMixer: patch });
    const settled = () => { for (const key of Object.keys(patch)) if (pendingPhoneMixer.get(key)?.revision === revision) pendingPhoneMixer.delete(key); };
    const failed = () => {
      for (const key of Object.keys(patch)) if (pendingPhoneMixer.get(key)?.revision === revision) {
        pendingPhoneMixer.delete(key); phoneMixer[key] = confirmedPhoneMixer[key];
      }
      appliedSignature = ''; renderPhoneMixer();
    };
    if (saving?.then) Promise.resolve(saving).then(result => result === false ? failed() : settled(), failed);
  }
  let appliedSignature = '';
  engine.applySharedSettings = settings => {
    if (!settings) return;
    const signature = JSON.stringify(settings);
    if (signature === appliedSignature) return;
    appliedSignature = signature;
    const intendedAutomatic = appliedAutomation;
    if (settings.macros) {
      let changed = false;
      for (const key of Object.keys(SOUND_DEFAULTS)) if (valid(settings.macros[key])) {
        const next = sharedControlValue(`macro:${key}`, settings.macros[key], macros[key]);
        if (next !== macros[key]) { macros[key] = next; changed = true; }
      }
      if (changed) { engine.setMacros(macros); appliedAutomation = false; }
    }
    if (fullAudio && settings.mixer) {
      let changed = false;
      for (const key of Object.keys(SOUND_MIXER_DEFAULTS)) {
        const next = settings.mixer[key], pending = pendingMixer.get(key);
        if (!validMixer(next)) continue;
        if (next === pending?.value) pendingMixer.delete(key);
        if ((pending || editingMixer.has(key)) && next !== mixer[key]) continue;
        if (next !== mixer[key]) { mixer[key] = next; changed = true; }
      }
      if (changed) engine.setMixer(mixer);
      renderMixer();
    }
    if (settings.phoneMixer) {
      let changed = false;
      for (const key of Object.keys(PHONE_MIXER_DEFAULTS)) {
        const next = settings.phoneMixer[key], pending = pendingPhoneMixer.get(key);
        if (!validMixer(next)) continue;
        confirmedPhoneMixer[key] = next;
        if (next === pending?.value) pendingPhoneMixer.delete(key);
        if ((pending || editingPhoneMixer.has(key)) && next !== phoneMixer[key]) continue;
        if (next !== phoneMixer[key]) { phoneMixer[key] = next; changed = true; }
      }
      if (!fullAudio && changed) engine.setPhoneMixer?.(phoneMixer);
      renderPhoneMixer();
    }
    const automatic = fullAudio ? sharedControlValue('automation', settings.automation !== false, intendedAutomatic) : true;
    const currentAutomatic = typeof engine.automationEnabled === 'boolean' ? engine.automationEnabled : appliedAutomation;
    if (automatic !== currentAutomatic) engine.setAutomation?.(automatic);
    appliedAutomation = automatic;
    if (fullAudio && valid(settings.level)) {
      const next = sharedControlValue('level', settings.level, level);
      if (level !== next) { level = next; engine.setLevel(level); }
    }
    renderMainControls();
  };
  if (operator) {
    renderMixer();
    renderPhoneMixer();
    for (const input of host.querySelectorAll('[data-phone-mixer]')) {
      const key = input.dataset.phoneMixer;
      input.addEventListener('pointerdown', () => editingPhoneMixer.add(key));
      input.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) editingPhoneMixer.add(key); });
      for (const event of ['change', 'keyup', 'blur']) input.addEventListener(event, () => editingPhoneMixer.delete(key));
      input.addEventListener('input', () => {
        phoneMixer[key] = Number(input.value) / 100;
        host.querySelector(`[data-phone-mixer-value="${key}"]`).textContent = `${input.value}%`;
        publishPhoneMixer({ [key]: phoneMixer[key] });
      });
    }
    for (const event of ['pointerup', 'pointercancel']) window.addEventListener(event, () => editingPhoneMixer.clear());
    host.querySelector('.sound-phone-mixer-reset')?.addEventListener('click', () => {
      Object.assign(phoneMixer, PHONE_MIXER_DEFAULTS); renderPhoneMixer(); publishPhoneMixer({ ...phoneMixer });
    });
    for (const input of host.querySelectorAll('[data-mixer]')) {
      const key = input.dataset.mixer;
      input.addEventListener('pointerdown', () => editingMixer.add(key));
      input.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) editingMixer.add(key); });
      for (const event of ['change', 'keyup', 'blur']) input.addEventListener(event, () => editingMixer.delete(key));
      input.addEventListener('input', () => {
        mixer[key] = Number(input.value) / 100;
        engine.setMixer({ [key]: mixer[key] });
        host.querySelector(`[data-mixer-value="${key}"]`).textContent = `${input.value}%`;
        publishMixer({ [key]: mixer[key] }); persist();
      });
    }
    for (const event of ['pointerup', 'pointercancel']) window.addEventListener(event, () => editingMixer.clear());
    host.querySelector('.sound-mixer-reset').addEventListener('click', () => {
      Object.assign(mixer, SOUND_MIXER_DEFAULTS); engine.setMixer(mixer); renderMixer(); publishMixer({ ...mixer }); persist();
    });
    host.querySelector('.sound-auto').addEventListener('change', event => { appliedAutomation = event.target.checked; engine.setAutomation?.(appliedAutomation); renderAutomationState(); publishControls({ automation: appliedAutomation }); });
    const sourceChoice = host.querySelector('.sound-forest-source'), sourceStatus = host.querySelector('.sound-source-status');
    let sources = [], sourceRequest = 0, followsSlider = false;
    async function selectSource(id) {
      const asset = sources.find(source => source.id === id);
      if (!asset && !(id === 'morph' && followsSlider)) return;
      const request = ++sourceRequest;
      sourceStatus.textContent = engine.enabled ? 'Changing the fire sound…' : '';
      const success = id === 'morph' ? await engine.clearLayerSource('forest') : await engine.setForestSource(soundAssetUrl(asset));
      if (request !== sourceRequest) return;
      if (success) {
        forestSource = id; persist();
        sourceStatus.textContent = id === 'morph' ? 'The Burning forest slider blends embers into wind-driven flames.' : 'A fixed fire take. Choose “Follow slider” to blend fire variations.';
      }
      else sourceStatus.textContent = 'That sound could not load. The previous fire sound is still available.';
    }
    sourceChoice.addEventListener('change', () => selectSource(sourceChoice.value));
    if (!remoteControl) loadSoundLibrary().then(async library => {
      const palette = ambianceSources(library);
      engine.setWildlifeSources(palette.mainWildlife ?? null);
      await engine.setMainQuenchSources(palette.mainQuench);
      await engine.setMainBlobSources(palette.mainBlob);
      followsSlider = Boolean(palette.variations.forest);
      // Only the first adoption of the paired palette resets the old fixed
      // default. Later asset revisions preserve an explicit fire choice.
      const migrate = !Number.isFinite(paletteVersion) || paletteVersion < 4;
      paletteVersion = library.version;
      await Promise.all(Object.entries(palette.variations).filter(([id]) => id !== 'crickets' || !palette.cricketLayers?.length).map(([id, entries]) => engine.setLayerVariations(id, entries)));
      if (palette.cricketLayers?.length) await engine.setCricketLayers(palette.cricketLayers);
      await engine.setResidueSources(palette.residueSources);
      sources = library.assets.filter(asset => asset.kind === 'forest');
      sourceChoice.replaceChildren();
      if (!sources.length) throw new Error('No alternatives yet.');
      if (followsSlider) { const option = document.createElement('option'); option.value = 'morph'; option.textContent = 'Follow slider · embers → flames'; sourceChoice.append(option); }
      for (const asset of sources) { const option = document.createElement('option'); option.value = asset.id; option.textContent = asset.title; sourceChoice.append(option); }
      const selected = followsSlider && (shared || migrate || forestSource === 'morph' || !sources.some(asset => asset.id === forestSource)) ? 'morph' : sources.some(asset => asset.id === forestSource) ? forestSource : library.defaultForest;
      sourceChoice.value = selected; sourceChoice.disabled = false; selectSource(selected);
    }).catch(() => { const option = document.createElement('option'); option.textContent = 'Current forest sound'; sourceChoice.replaceChildren(option); sourceChoice.disabled = true; });
    const volume = host.querySelector('.sound-volume'), value = host.querySelector('.sound-volume-value');
    volume.value = String(Math.round(level * 100)); value.textContent = `${volume.value}%`;
    const trackEditing = (input, key) => {
      input.addEventListener('pointerdown', () => editingControls.add(key));
      input.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) editingControls.add(key); });
      for (const event of ['change', 'keyup', 'blur']) input.addEventListener(event, () => {
        editingControls.delete(key); appliedSignature = ''; reconcileConfirmedControls();
      });
    };
    trackEditing(volume, 'level');
    for (const event of ['pointerup', 'pointercancel']) window.addEventListener(event, () => {
      editingControls.clear(); appliedSignature = ''; reconcileConfirmedControls();
    });
    volume.addEventListener('input', () => { level = Number(volume.value) / 100; engine.setLevel(level); value.textContent = `${volume.value}%`; publishControls({ level }); persist(); });
    for (const input of host.querySelectorAll('[data-macro]')) {
      const key = input.dataset.macro, output = host.querySelector(`[data-value="${key}"]`);
      trackEditing(input, `macro:${key}`);
      input.value = String(Math.round(macros[key] * 100)); output.textContent = `${input.value}%`;
      input.addEventListener('input', () => { macros[key] = Number(input.value) / 100; engine.setMacro(key, macros[key]); appliedAutomation = false; host.querySelector('.sound-auto').checked = false; renderAutomationState(); publishControls({ automation: false, macros: { ...macros } }); output.textContent = `${input.value}%`; persist(); });
    }
    host.querySelector('.sound-reset').addEventListener('click', () => {
      Object.assign(macros, SOUND_DEFAULTS); engine.setMacros(macros); engine.setAutomation?.(true); appliedAutomation = true; host.querySelector('.sound-auto').checked = true; publishControls({ automation: true, macros: { ...macros } });
      renderAutomationState();
      if (followsSlider) { sourceChoice.value = 'morph'; selectSource('morph'); }
      for (const input of host.querySelectorAll('[data-macro]')) { input.value = String(Math.round(macros[input.dataset.macro] * 100)); host.querySelector(`[data-value="${input.dataset.macro}"]`).textContent = `${input.value}%`; }
      persist();
    });
  } else if (projection) {
    if (!remoteControl) loadSoundLibrary().then(async library => {
      const palette = ambianceSources(library);
      engine.setWildlifeSources(palette.mainWildlife ?? null);
      await engine.setMainQuenchSources(palette.mainQuench);
      await engine.setMainBlobSources(palette.mainBlob);
      await Promise.all(Object.entries(palette.variations).filter(([id]) => id !== 'crickets' || !palette.cricketLayers?.length).map(([id, entries]) => engine.setLayerVariations(id, entries)));
      if (palette.cricketLayers?.length) await engine.setCricketLayers(palette.cricketLayers);
      await engine.setResidueSources(palette.residueSources);
    }).catch(() => {});
  } else {
    // Only compact phone recordings are selected. Insects load lazily when
    // the shared extinction progression first needs them in the loop blend.
    loadSoundLibrary().then(library => {
      const palette = ambianceSources(library);
      engine.setWildlifeSources(palette.phoneWildlife ?? null);
      if (palette.phoneCricketLayers.length) engine.setCricketLayers(palette.phoneCricketLayers);
      for (const [id, url] of Object.entries(palette.phone)) {
        if (id === 'rain') engine.setPhoneRainSource(url);
        else if (id !== 'crickets' || !palette.phoneCricketLayers.length) engine.setLayerSource(id, url);
      }
    }).catch(() => { /* The built-in phone recordings remain available. */ });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) engine.release({ cancelPending: true }); if (!fullAudio) engine.setHidden(document.hidden); });
  window.addEventListener('pagehide', () => { engine.release({ cancelPending: true }); engine.setHidden(true); });
  window.addEventListener('pageshow', () => engine.setHidden(document.hidden));
  return engine;
}
