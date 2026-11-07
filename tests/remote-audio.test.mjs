import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSoundControls } from '../app/sound-controls.js';
import { SOUND_MACRO_DEFAULTS, SOUND_MIXER_DEFAULTS, PHONE_MIXER_DEFAULTS } from '../app/sound-engine.js';

function element(dataset = {}) {
  const listeners = new Map(), attributes = new Map();
  return { dataset, checked: true, value: '', hidden: false, disabled: false, replaceChildren() {},
    setAttribute(name, value) { attributes.set(name, value); }, getAttribute(name) { return attributes.get(name); },
    addEventListener(name, handler) { listeners.set(name, handler); },
    async dispatch(name) { await listeners.get(name)?.({ target: this }); } };
}
function remoteControls(t, mode = 'operator', { mainSoundControl = null, remoteControl = true } = {}) {
  const selectors = new Map();
  const get = selector => {
    if (!selectors.has(selector)) selectors.set(selector, element());
    return selectors.get(selector);
  };
  const groups = new Map([
    ['[data-mixer]', Object.keys(SOUND_MIXER_DEFAULTS).map(key => element({ mixer: key }))],
    ['[data-phone-mixer]', Object.keys(PHONE_MIXER_DEFAULTS).map(key => element({ phoneMixer: key }))],
    ['[data-macro]', Object.keys(SOUND_MACRO_DEFAULTS).map(key => element({ macro: key }))],
  ]);
  const host = { classList: { add() {} }, dataset: {}, innerHTML: '',
    querySelector: get, querySelectorAll: selector => groups.get(selector) || [] };
  let enables = 0, loads = 0;
  const engine = { getMetrics: () => ({ state: 'off' }), setMacros() {}, setMixer() {},
    setAutomation() {}, setLevel() {}, setLocalBellAudition(value) { this.localBellAudition = value; },
    async enable() { enables++; }, release() {}, setHidden() {} };
  const patches = [];
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  globalThis.fetch = async () => { loads++; throw new Error('Remote controls must not fetch audio assets.'); };
  globalThis.window = { addEventListener() {} };
  globalThis.document = { addEventListener() {}, hidden: false, createElement: () => element() };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  mountSoundControls(host, { mode, engine, shared: true, remoteControl, mainSoundControl, onSettings: patch => patches.push(patch) });
  return { host, get, groups, engine, patches, enables: () => enables, loads: () => loads };
}

test('remote operator can publish Main and phone mix changes without enabling local sound or loading recordings', async t => {
  const controls = remoteControls(t);
  assert.equal(controls.get('.sound-enable').hidden, true);
  assert.equal(controls.get('.sound-enable').disabled, true);
  assert.equal(controls.engine.localBellAudition, false);
  assert.match(controls.host.innerHTML, /Main audio plays on the host computer\. Mixer changes apply there\./);
  await controls.get('.sound-enable').dispatch('click');
  const main = controls.groups.get('[data-mixer]').find(input => input.dataset.mixer === 'bells');
  main.value = '85'; await main.dispatch('input');
  const phone = controls.groups.get('[data-phone-mixer]').find(input => input.dataset.phoneMixer === 'rain');
  phone.value = '45'; await phone.dispatch('input');
  assert.deepEqual(controls.patches, [{ mixer: { bells: .85 } }, { phoneMixer: { rain: .45 } }]);
  assert.equal(controls.enables(), 0);
  assert.equal(controls.loads(), 0);
});

function playbackControl(initial = {}) {
  let state = { remoteControl: true, connected: true, enabled: false, requestedEnabled: false,
    requestId: 0, status: { state: 'off', activated: false }, pending: false, ...initial };
  const listeners = new Set(), statuses = [];
  let toggles = 0;
  const update = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(state); };
  return { getState: () => state, subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    async toggle() { toggles++; update({ enabled: !state.enabled, pending: true }); },
    onStatus(metrics) { statuses.push(metrics); }, update, statuses, toggles: () => toggles };
}

test('remote Main sound button controls the host and follows its status without activating the remote engine', async t => {
  const mainSoundControl = playbackControl();
  const controls = remoteControls(t, 'operator', { mainSoundControl }), button = controls.get('.sound-enable');
  assert.equal(button.hidden, false); assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-label'), 'Enable main sound');
  assert.match(controls.host.innerHTML, /Use the sound button to control it/);
  await button.dispatch('click');
  assert.equal(mainSoundControl.toggles(), 1); assert.equal(button.disabled, true);
  assert.equal(button.getAttribute('aria-label'), 'Disable main sound');
  assert.equal(controls.get('.sound-status').textContent, 'Enabling Main sound…');
  mainSoundControl.update({ pending: false, status: { state: 'ready', activated: true } });
  assert.equal(button.disabled, false); assert.equal(controls.host.dataset.soundState, 'ready');
  assert.equal(controls.get('.sound-status').textContent, 'Main sound enabled on host computer');
  controls.engine.onStatus({ state: 'off' });
  assert.equal(controls.host.dataset.soundState, 'ready', 'The silent preview cannot overwrite the host status.');
  assert.deepEqual(mainSoundControl.statuses, []);
  await button.dispatch('click');
  assert.equal(mainSoundControl.toggles(), 2);
  assert.equal(controls.get('.sound-status').textContent, 'Disabling Main sound…');
  mainSoundControl.update({ pending: false, status: { state: 'muted', activated: true } });
  assert.equal(button.getAttribute('aria-label'), 'Enable main sound');
  assert.equal(controls.get('.sound-status').textContent, 'Main sound disabled');
  assert.equal(controls.enables(), 0); assert.equal(controls.loads(), 0);
});

test('remote sound status explains first host activation and a disconnected host without claiming playback', async t => {
  const mainSoundControl = playbackControl({ enabled: true, requestedEnabled: true, status: { state: 'needs-gesture', activated: false } });
  const controls = remoteControls(t, 'operator', { mainSoundControl });
  assert.equal(controls.get('.sound-status').textContent, 'Enable Main sound once on the host computer.');
  assert.equal(controls.host.dataset.soundState, 'off');
  assert.equal(controls.get('.sound-enable').getAttribute('aria-pressed'), 'true');
  mainSoundControl.update({ enabled: false, status: { state: 'unavailable', activated: false } });
  assert.match(controls.get('.sound-status').textContent, /Keep the host Operator page open/);
  mainSoundControl.update({ connected: false });
  assert.equal(controls.get('.sound-enable').disabled, true);
  assert.equal(controls.get('.sound-status').textContent, 'Connecting to Main sound…');
  assert.equal(controls.enables(), 0); assert.equal(controls.loads(), 0);
});

test('host controls report engine status through the shared controller and delegate the local gesture', async t => {
  const mainSoundControl = playbackControl({ remoteControl: false });
  const controls = remoteControls(t, 'operator', { mainSoundControl, remoteControl: false });
  controls.engine.onStatus({ state: 'ready', degraded: true });
  assert.deepEqual(mainSoundControl.statuses.at(-1), { state: 'ready', degraded: true });
  mainSoundControl.update({ enabled: true, status: { state: 'ready', activated: true } });
  assert.match(controls.get('.sound-status').textContent, /recording unavailable/);
  await controls.get('.sound-enable').dispatch('click');
  assert.equal(mainSoundControl.toggles(), 1);
  assert.equal(controls.enables(), 0, 'The controller owns the synchronous activation, so UI cannot start a second engine.');
  await new Promise(resolve => setImmediate(resolve));
});

test('remote preview sound stays disabled after state reports and synthetic button activation', async t => {
  const controls = remoteControls(t, 'projection');
  controls.engine.onStatus({ state: 'ready' });
  await controls.get('.sound-enable').dispatch('click');
  assert.equal(controls.host.dataset.soundState, 'remote');
  assert.equal(controls.get('.sound-enable').hidden, true);
  assert.equal(controls.get('.sound-enable').disabled, true);
  assert.equal(controls.enables(), 0);
  assert.equal(controls.loads(), 0);
});
