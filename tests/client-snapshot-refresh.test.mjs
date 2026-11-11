import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const noop = () => {};
function delayedRequests() {
  const pending = [];
  return { pending, request() { return new Promise(resolve => pending.push(resolve)); } };
}
async function projection() {
  const source = await readFile(new URL('../app/peat-study.js', import.meta.url), 'utf8');
  const start = source.indexOf('    onState(message, { reset } = {}) {', source.indexOf('connection = new SharedConnection('));
  const end = source.indexOf('\n    onActors(', start);
  assert.ok(start >= 0 && end > start, 'Load the real projection state callback.');
  const method = source.slice(start, end).trim().replace(/,$/, '');
  const requests = delayedRequests(), node = { dataset: {}, querySelector: () => ({}) };
  const context = { dependencies: { load: () => requests.request() },
    sound: { reset: noop, setMacroCondition: noop, applySharedSettings: noop },
    createParticipantSoundField: () => ({}), endGesture: noop, syncScene: noop, $: () => node,
    applyCells: noop, receiveActors: noop, syncStatus: noop, DEFAULT_RAIN_STRENGTH: .54,
  };
  vm.runInNewContext(`
    let soundField, localSoundGeo, actors, rainStrength;
    let layoutEpoch = null, snapshotVersion = 'same-fetch-time', forceLayout = false, installed = null;
    const requestedRegion = 'indonesia', operatorPreview = false, remoteControl = false;
    function loadRegion() { return dependencies.load().then(result => {
      if (result.loaded) { snapshotVersion = result.version; installed = result.label; }
      return result.loaded;
    }); }
    globalThis.receive = { ${method} }.onState;
    globalThis.inspect = () => ({ epoch: layoutEpoch, busy: forceLayout, installed });
  `, context);
  return { receive: context.receive, inspect: context.inspect, requests };
}
async function legacy() {
  const source = await readFile(new URL('../app/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function receiveSharedState('), end = source.indexOf('\nfunction receiveActors(', start);
  assert.ok(start >= 0 && end > start, 'Load the real legacy state handler.');
  const handler = source.slice(start, end);
  const requests = delayedRequests(), node = {};
  const context = { dependencies: { load: () => requests.request() },
    sound: { reset: noop }, patchVisuals: { clear: noop }, visualRainClouds: { clear: noop },
    stopAllPointers: noop, document: { activeElement: null }, $: () => node, text: noop,
    receiveActors: noop, applyCellUpdate: noop, syncSoundPatches: noop, scheduleReadouts: noop, scheduleDraw: noop, notify: noop,
  };
  vm.runInNewContext(`
    let soundActors, localSoundGeo, sharedState, snapshotReload = null, snapshotEpoch = null, installed = null;
    const state = { snapshot: { fetchedAt: 'same-fetch-time' } }, legacyPerformance = null;
    function fetch() { return dependencies.load().then(snapshot => ({ json: async () => snapshot })); }
    function showSnapshot(snapshot) { state.snapshot = snapshot; installed = snapshot.label; }
    ${handler}
    globalThis.receive = receiveSharedState;
    globalThis.inspect = () => ({ epoch: snapshotEpoch, busy: Boolean(snapshotReload), installed });
  `, context);
  return { receive: context.receive, inspect: context.inspect, requests };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const packet = epoch => ({ epoch, snapshotVersion: 'same-fetch-time', simulation: {}, strength: .54, scene: {} });

for (const [name, factory] of [['Projection', projection], ['Legacy map', legacy]]) {
  test(`${name} replaces an older in-flight source read after an import with the same fetch timestamp`, async () => {
    const page = await factory();
    page.receive(packet('before-import'), { reset: false });
    assert.equal(page.requests.pending.length, 1);
    page.receive(packet('after-import'), { reset: true });
    assert.equal(page.requests.pending.length, 1, 'The existing source request stays single-flight.');
    page.requests.pending[0]({ loaded: true, version: 'same-fetch-time', fetchedAt: 'same-fetch-time', label: 'old source' });
    await settle();
    assert.equal(page.inspect().epoch, 'before-import', 'A late source is associated only with the epoch that requested it.');
    page.receive(packet('after-import'), { reset: false });
    assert.equal(page.requests.pending.length, 2, 'The next state must retry even though fetchedAt did not change.');
    page.requests.pending[1]({ loaded: true, version: 'same-fetch-time', fetchedAt: 'same-fetch-time', label: 'imported source' });
    await settle();
    assert.equal(page.inspect().epoch, 'after-import');
    assert.equal(page.inspect().installed, 'imported source');
    page.receive(packet('after-import'), { reset: false });
    assert.equal(page.requests.pending.length, 2, 'A current installed source must not create a reload loop.');
  });
}

test('Projection retries a failed layout read for the same new epoch', async () => {
  const page = await projection();
  page.receive(packet('after-import'), { reset: true });
  page.requests.pending[0]({ loaded: false }); await settle();
  assert.equal(page.inspect().epoch, null);
  page.receive(packet('after-import'), { reset: false });
  assert.equal(page.requests.pending.length, 2);
});
