import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { validateFireSnapshot, MAX_FIRE_SNAPSHOT_BYTES } from '../app/fire-snapshot.mjs';
import { createMainSoundControl } from '../app/main-sound-control.js';

const original = JSON.parse(await readFile(new URL('../data/fire-snapshot.json', import.meta.url), 'utf8'));
function sample(fetchedAt = '2026-11-08T05:00:00Z', empty = false) {
  const data = structuredClone(original);
  data.records = empty ? [] : data.records.slice(0, 2);
  const times = data.records.map(record => record.observedAt).sort();
  data.observationStart = times[0] ?? null; data.observationEnd = times.at(-1) ?? null;
  data.fetchedAt = fetchedAt;
  data.counts = { downloadedRows: times.length, boundingBoxRows: times.length, outsideCountryRows: 0, invalidRows: 0, duplicateRows: 0, retainedRows: times.length };
  return validateFireSnapshot(data);
}

class Element {
  constructor(id = '') {
    this.id = id; this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = '';
    this.attributes = new Map(); this.listeners = new Map(); this.children = new Map(); this.srcChanges = 0; this.clicks = 0;
    this.classList = { add() {}, remove() {} };
  }
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(callback); }
  async emit(name, event = {}) { for (const callback of this.listeners.get(name) || []) await callback({ preventDefault() {}, target: this, ...event }); }
  querySelector(selector) { if (!this.children.has(selector)) this.children.set(selector, new Element()); return this.children.get(selector); }
  querySelectorAll() { return []; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  set src(value) { this.srcChanges++; this.attributes.set('src', String(value)); }
  get src() { return this.attributes.get('src') || ''; }
  reportValidity() { return true; }
  focus() {}
  select() {}
  click() { this.clicks++; }
  remove() {}
}

async function desk({ remote = false, authorized = true, importError = null, holdImport = false } = {}) {
  const elements = new Map(), requests = [], actions = [], downloads = [], blobs = [], mounts = [], intervals = [], connections = [];
  const element = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  element('fire-data-preview').hidden = true;
  const frame = element('operator-preview'), engine = { context: {}, enabled: true, applySharedSettings() {}, getMetrics: () => ({ state: 'ready' }) };
  const remoteEngine = { context: null, enabled: false, applySharedSettings() {}, getMetrics: () => ({ state: 'off' }) };
  frame.contentWindow = { __wildfireSound: engine, postMessage() {} };
  class SharedConnection {
    constructor(options) { this.options = options; this.socket = { close: () => { this.closed = true; } }; connections.push(this); }
    emitState(state) { this.options.onState?.(state); }
    clearHold() {}
    stop() {}
    destroy() { this.destroyed = true; this.socket.close(); }
  }
  const scene = { id: 'participation', paused: false, elapsedMs: 500, settings: { wifiName: 'Fixture Wi-Fi', wifiPassword: 'fixture', participationSeconds: 333 } };
  const preservedSound = { automation: true, level: .43, mixer: { bells: 1.2 } };
  let current = sample('2026-11-07T05:00:00Z'), releaseImport, pauseRead = false, releaseRead;
  const location = new URL(`http://192.168.1.10:4173/${remote ? 'operator-remote' : 'operator'}`);
  class BrowserURL extends URL {
    static createObjectURL(blob) { blobs.push(blob); return `blob:test-${blobs.length}`; }
    static revokeObjectURL() {}
  }
  const context = {
    URL: BrowserURL, URLSearchParams, Blob, Date, location, navigator: {}, createMainSoundControl, MAX_FIRE_SNAPSHOT_BYTES, SharedConnection,
    validateFireSnapshot: value => validateFireSnapshot(JSON.parse(JSON.stringify(value))),
    DEFAULT_PARAMETERS: {}, PARAMETER_LIMITS: {}, DEFAULT_PROGRAM_NOTES: '', DEFAULT_SCORE_SETTINGS: {}, SCENE_DURATION_LIMITS: {},
    sceneClock: () => '00:00', sceneRemaining: () => 0, scenePresentation: value => ({ cueScene: value.id }), scenePhaseReadout: () => '',
    document: { body: { dataset: { workspaceView: 'performance' }, append(node) { downloads.push(node); } }, getElementById: element, querySelectorAll: () => [], activeElement: null, createElement: () => new Element(), addEventListener() {}, hidden: false },
    window: { addEventListener() {} },
    setInterval(callback, delay) { intervals.push({ callback, delay }); return intervals.length; }, setTimeout() { return 1; }, clearTimeout() {},
    mountSoundControls(_host, options) { mounts.push(options); return options.engine || (options.remoteControl ? remoteEngine : engine); },
    async operatorRequest(url, body) {
      actions.push({ url, body });
      if (url === '/api/snapshot/import') {
        if (holdImport) await new Promise(resolve => { releaseImport = resolve; });
        if (importError) throw new Error(importError);
        current = JSON.parse(JSON.stringify(body));
        return { snapshot: current, state: { epoch: 'imported-epoch', snapshotVersion: current.fetchedAt,
          scene: { ...scene, id: 'arrival', paused: true, elapsedMs: 0 }, strength: .37,
          soundSettings: preservedSound, simulation: { parameters: {} } } };
      }
      return {};
    },
    async fetch(url, options = {}) {
      requests.push({ url, options });
      if (url === '/api/session') return { ok: true, json: async () => ({ operatorAllowed: authorized, localOperator: !remote, scene, audienceUrl: 'http://192.168.1.10:4173/audience' }) };
      if (url === '/api/snapshot/export') return { ok: true, json: async () => current };
      if (url === '/api/snapshot/info') {
        const captured = { recordCount: current.records.length, fetchedAt: current.fetchedAt, observationStart: current.observationStart, observationEnd: current.observationEnd };
        if (pauseRead) { pauseRead = false; await new Promise(resolve => { releaseRead = resolve; }); }
        return { ok: true, json: async () => captured };
      }
      return { ok: true, json: async () => ({ enabled: false }) };
    },
  };
  const source = (await readFile(new URL('../app/operator.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  vm.runInNewContext(source, context, { filename: 'operator.js' });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle(); await frame.emit('load');
  if (authorized && remote) { connections[0].emitState({ type: 'state', epoch: 'initial-epoch', snapshotVersion: current.fetchedAt, scene, soundSettings: preservedSound, strength: .37 }); await settle(); }
  return { element, frame, engine: remote ? remoteEngine : engine, requests, actions, downloads, blobs, mounts, connections, metrics: context.window.__performanceOperator, settle,
    releaseImport() { releaseImport?.(); }, pauseSourceRead() { pauseRead = true; }, releaseSourceRead() { releaseRead?.(); },
    readSnapshot: () => context.readSnapshot(),
    async choose(file) { element('fire-data-file').files = [file]; await element('fire-data-file').emit('change'); await settle(); },
  };
}
const file = (value, extra = {}) => { const content = typeof value === 'string' ? value : JSON.stringify(value); return { name: 'fire-data.json', size: Buffer.byteLength(content), text: async () => content, ...extra }; };

test('export creates a portable canonical JSON download with source date and no performance settings', async () => {
  const page = await desk();
  await page.element('fire-data-export').emit('click'); await page.settle();
  assert.equal(page.downloads.length, 1);
  assert.equal(page.downloads[0].download, 'karhutla-fire-data-2026-11-07.json');
  const exported = JSON.parse(await page.blobs[0].text());
  assert.deepEqual(exported, sample('2026-11-07T05:00:00Z'));
  assert.equal(exported.soundSettings, undefined);
  assert.equal(page.actions.length, 0);
});

test('selecting valid fire data only previews it; Cancel does not change the performance', async () => {
  const page = await desk();
  await page.choose(file(sample()));
  assert.equal(page.element('fire-data-preview').hidden, false, page.element('fire-data-transfer-status').textContent);
  assert.match(page.element('fire-data-summary').textContent, /2 observations/);
  assert.match(page.element('fire-data-summary').textContent, /2026-11-08/);
  assert.equal(page.actions.length, 0);
  await page.element('fire-data-cancel').emit('click');
  await page.element('fire-data-confirm').emit('click'); await page.settle();
  assert.equal(page.element('fire-data-preview').hidden, true);
  assert.equal(page.actions.length, 0);
  assert.equal(page.metrics.scene.id, 'participation');
});

for (const [description, input] of [
  ['malformed JSON', file('{broken')], ['settings JSON', file({ format: 'wildfire-settings' })],
  ['an oversized file', file('{}', { size: 8 * 1024 * 1024 + 1 })],
]) test(`${description} never reaches the import API`, async () => {
  const page = await desk();
  await page.choose(input);
  await page.element('fire-data-confirm').emit('click'); await page.settle();
  assert.equal(page.actions.length, 0);
  assert.equal(page.element('fire-data-preview').hidden, true);
  assert.equal(page.element('fire-data-transfer-status').dataset.error, 'true');
  assert.equal(page.element('operator-controls').disabled, false);
});

for (const remote of [false, true]) test(`${remote ? 'paired remote' : 'host'} import returns to paused Arrival while preserving ${remote ? 'direct controls without loading a preview' : 'the preview and activated engine'}`, async () => {
  const page = await desk({ remote });
  const preview = page.frame.src, srcChanges = page.frame.srcChanges, context = page.engine.context;
  await page.choose(file(sample()));
  await page.element('fire-data-confirm').emit('click'); await page.settle();
  assert.equal(page.actions.filter(action => action.url === '/api/snapshot/import').length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(page.actions[0].body)), sample());
  assert.equal(page.metrics.scene.id, 'arrival'); assert.equal(page.metrics.scene.paused, true);
  assert.equal(page.metrics.soundSettings.level, .43);
  assert.equal(page.element('rain-strength').value, '37');
  assert.equal(page.frame.src, preview); assert.equal(page.frame.srcChanges, srcChanges);
  assert.equal(page.engine.context, context);
  if (remote) {
    assert.equal(page.frame.hasAttribute('src'), false);
    assert.equal(page.connections.length, 1);
    assert.equal(page.connections[0].options.view, 'controls');
    assert.equal(page.engine.enabled, false);
    assert.equal(page.requests.some(request => request.url === '/data/fire-snapshot.json'), false);
    assert.equal(page.requests.some(request => request.url === '/api/snapshot/info'), true);
  } else {
    assert.equal(page.frame.contentWindow.__wildfireSound, page.engine);
    assert.equal(page.engine.enabled, true);
  }
  assert.equal(page.mounts.length, 1);
  assert.equal(page.element('fire-data-preview').hidden, true);
  assert.match(page.element('snapshot-status').textContent, /2026-11-08/);
  assert.match(page.element('fire-data-transfer-status').textContent, /imported and saved on the host/);
  assert.equal(page.requests.every(request => request.url.startsWith('/')), true, 'Offline import uses only the connected local host.');
});

test('an unpaired page cannot read selected fire data, export it or submit an import', async () => {
  const page = await desk({ remote: true, authorized: false });
  let reads = 0;
  await page.choose(file(sample(), { text: async () => { reads++; return JSON.stringify(sample()); } }));
  await page.element('fire-data-confirm').emit('click'); await page.element('fire-data-export').emit('click'); await page.settle();
  assert.equal(reads, 0);
  assert.equal(page.actions.length, 0);
  assert.equal(page.downloads.length, 0);
  assert.equal(page.requests.some(request => request.url === '/api/snapshot/export'), false);
  assert.equal(page.frame.hasAttribute('src'), false);
});

test('a zero-observation canonical snapshot remains a valid import', async () => {
  const page = await desk();
  await page.choose(file(sample('2026-11-08T05:00:00Z', true)));
  assert.match(page.element('fire-data-summary').textContent, /No fire observations/);
  await page.element('fire-data-confirm').emit('click'); await page.settle();
  assert.equal(page.actions[0].body.records.length, 0);
  assert.equal(page.metrics.scene.id, 'arrival');
});

test('a host save failure preserves the current show and leaves the chosen file available to retry', async () => {
  const page = await desk({ importError: 'The snapshot could not be saved.' });
  const preview = page.frame.src;
  await page.choose(file(sample()));
  await page.element('fire-data-confirm').emit('click'); await page.settle();
  assert.equal(page.metrics.scene.id, 'participation');
  assert.equal(page.frame.src, preview);
  assert.equal(page.element('fire-data-preview').hidden, false, page.element('fire-data-transfer-status').textContent);
  assert.equal(page.element('operator-controls').disabled, false);
  assert.match(page.element('fire-data-transfer-status').textContent, /could not be saved/);
});

test('an in-flight import blocks duplicate confirmation and settings transfer', async () => {
  const page = await desk({ holdImport: true });
  await page.choose(file(sample()));
  await page.element('fire-data-confirm').emit('click'); await page.settle();
  assert.equal(page.element('operator-controls').disabled, true);
  await page.element('fire-data-confirm').emit('click'); await page.element('settings-export').emit('click'); await page.settle();
  assert.equal(page.actions.filter(action => action.url === '/api/snapshot/import').length, 1);
  assert.equal(page.requests.some(request => request.url === '/api/settings/export'), false);
  page.releaseImport(); await page.settle();
  assert.equal(page.element('operator-controls').disabled, false);
});

test('import refreshes source details after an older snapshot read finishes late', async () => {
  const page = await desk();
  page.pauseSourceRead();
  const oldRead = page.readSnapshot(); await page.settle();
  await page.choose(file(sample()));
  await page.element('fire-data-confirm').emit('click'); await page.settle();
  page.releaseSourceRead(); await oldRead; await page.settle();
  assert.match(page.element('snapshot-status').textContent, /2026-11-08/);
  assert.equal(page.element('operator-controls').disabled, false);
});
