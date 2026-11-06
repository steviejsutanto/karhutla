import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSoundControls } from '../app/sound-controls.js';
import { SOUND_MACRO_DEFAULTS, SOUND_MIXER_DEFAULTS, PHONE_MIXER_DEFAULTS } from '../app/sound-engine.js';

function element(dataset = {}) {
  const listeners = new Map();
  return { dataset, checked: true, value: '', hidden: false, disabled: false,
    setAttribute() {}, addEventListener(name, handler) { listeners.set(name, handler); },
    async dispatch(name) { await listeners.get(name)?.({ target: this }); } };
}
function remoteControls(t, mode = 'operator') {
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
  globalThis.document = { addEventListener() {}, hidden: false };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  mountSoundControls(host, { mode, engine, shared: true, remoteControl: true, onSettings: patch => patches.push(patch) });
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
