import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createMainSoundControl } from '../app/main-sound-control.js';

class Element {
  constructor(id = '') {
    this.id = id; this.dataset = {}; this.hidden = false; this.disabled = false;
    this.value = ''; this.textContent = ''; this.attributes = new Map(); this.listeners = new Map(); this.children = new Map();
    this.classList = { add() {}, remove() {} };
  }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }
  async emit(name, event = {}) {
    for (const callback of this.listeners.get(name) || []) await callback({ preventDefault() {}, target: this, ...event });
  }
  querySelector(selector) {
    if (!this.children.has(selector)) this.children.set(selector, new Element());
    return this.children.get(selector);
  }
  querySelectorAll() { return []; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  set src(value) { this.attributes.set('src', String(value)); }
  get src() { return this.attributes.get('src') || ''; }
  reportValidity() { return true; }
  focus() {}
  select() {}
}

async function desk({ pathname = '/operator-remote', localOperator = false, authorized = false, pinStatus = 200 } = {}) {
  const elements = new Map(), requests = [], actions = [], mounts = [], engines = [], intervals = [], connections = [], timeouts = new Map(), windowListeners = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  const frame = element('operator-preview');
  const engine = { applySharedSettings() {}, getMetrics: () => ({}), enabled: false };
  frame.contentWindow = { __wildfireSound: engine, postMessage() {} };
  const tabs = ['performance', 'mixer', 'setup'].map(view => { const tab = element(`workspace-tab-${view}`); tab.dataset.workspaceTab = view; return tab; });
  const sceneButtons = ['arrival', 'participation'].map(scene => { const button = element(`scene-${scene}`); button.dataset.scene = scene; return button; });
  const location = new URL(`http://192.168.1.10:4173${pathname}`);
  let allowed = authorized, clockNow = 1000, pauseSession = false, releaseSession = null, timeoutId = 0;
  let mainSound = { revision: 1, requestId: 0, requestedEnabled: false, status: { requestId: 0, state: 'off', activated: true } };
  class SharedConnection {
    constructor(options) { this.options = options; this.socket = { close: () => { this.closed = true; } }; connections.push(this); }
    emitState(state) { this.options.onState?.(state); }
    emitConnection(status) { this.options.onConnection?.(status); }
    emitError(message) { this.options.onError?.(message); }
    clearHold() {}
    stop() {}
    destroy() { this.destroyed = true; this.socket.close(); }
  }
  class ClockDate extends Date { static now() { return clockNow; } }
  const context = {
    URL, URLSearchParams, Blob, Date: ClockDate, createMainSoundControl, SharedConnection,
    DEFAULT_PARAMETERS: {}, PARAMETER_LIMITS: {}, DEFAULT_PROGRAM_NOTES: '', DEFAULT_SCORE_SETTINGS: {}, SCENE_DURATION_LIMITS: {},
    sceneClock: () => '00:00', sceneRemaining: () => 0, scenePresentation: () => ({}), scenePhaseReadout: () => '',
    location, history: { replaceState(_state, _unused, address) { location.href = new URL(address, location).href; } },
    navigator: {},
    document: { body: { dataset: { workspaceView: 'performance' } }, getElementById: element, addEventListener() {}, hidden: false,
      querySelectorAll: selector => selector === '[data-workspace-tab]' ? tabs : selector === 'button[data-scene]' ? sceneButtons : [], activeElement: null },
    window: { addEventListener(name, handler) { if (!windowListeners.has(name)) windowListeners.set(name, []); windowListeners.get(name).push(handler); } },
    setInterval(callback, delay) { intervals.push({ callback, delay }); return intervals.length; },
    setTimeout(callback, delay) { const id = ++timeoutId; timeouts.set(id, { callback, delay }); return id; }, clearTimeout(id) { timeouts.delete(id); },
    mountSoundControls(_host, options) {
      mounts.push(options);
      if (options.engine) return options.engine;
      const fresh = { enabled: false, appliedSettings: [], getMetrics: () => ({}),
        applySharedSettings(settings) { this.appliedSettings.push(JSON.parse(JSON.stringify(settings))); } };
      engines.push(fresh); return fresh;
    },
    async operatorRequest(url, body) {
      actions.push({ url, body });
      if (url === '/api/scene') return { scene: { id: body.scene || 'arrival', paused: false, elapsedMs: 0, settings: {} } };
      if (url === '/api/main-sound') {
        const requestId = mainSound.requestId + 1;
        mainSound = { revision: mainSound.revision + 1, requestId, requestedEnabled: body.enabled,
          status: { requestId, state: body.enabled ? 'ready' : 'muted', activated: true } };
        return mainSound;
      }
      return {};
    },
    async fetch(url, options = {}) {
      requests.push({ url, options });
      if (url === '/api/operator/pair') {
        if (pinStatus === 200) allowed = true;
        return { ok: pinStatus === 200, status: pinStatus, headers: { get: () => '2' }, json: async () => pinStatus === 200 ? { operatorAllowed: true } : { error: pinStatus === 429 ? 'Too many PIN attempts. Try again in a minute.' : 'Incorrect operator PIN.' } };
      }
      if (url === '/api/session') {
        const snapshot = { operatorAllowed: allowed, localOperator, scene: null, audienceUrl: 'http://192.168.1.10:4173/audience', joinUrl: 'http://192.168.1.10:4173/join' };
        if (pauseSession) { pauseSession = false; await new Promise(resolve => { releaseSession = resolve; }); }
        return { ok: true, status: 200, json: async () => snapshot };
      }
      if (url === '/api/snapshot/info') return { ok: true, status: 200, json: async () => ({ recordCount: 2, fetchedAt: '2026-11-12T00:00:00Z', observationStart: '2026-11-11T00:00:00Z', observationEnd: '2026-11-11T01:00:00Z' }) };
      return { ok: true, status: 200, json: async () => ({ enabled: false, urls: [] }) };
    },
  };
  // The production module uses absolute browser imports. Inject those narrow
  // dependencies while running all of its actual DOM and request handling.
  const source = (await readFile(new URL('../app/operator.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  vm.runInNewContext(source, context, { filename: 'operator.js' });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  return { element, frame, requests, actions, mounts, engines, intervals, connections, get engine() { return engines.at(-1) || engine; }, metrics: context.window.__performanceOperator, settle, revoke() { allowed = false; },
    state(overrides = {}) { return { type: 'state', epoch: 'controller-epoch', snapshotVersion: '2026-11-12', joinedCount: 7, activeCount: 2, scene: { id: 'participation', paused: false, elapsedMs: 0, settings: {} }, mainSound, soundSettings: { automation: false, level: .6 }, strength: .4, ...overrides }; },
    async flushTimeouts(delay = 160) { for (const [id, timer] of [...timeouts]) if (timer.delay === delay) { timeouts.delete(id); await timer.callback(); } await settle(); },
    async message(data) { for (const handler of windowListeners.get('message') || []) await handler({ origin: location.origin, source: frame.contentWindow, data }); await settle(); },
    advance(milliseconds) { clockNow += milliseconds; }, pauseNextSession() { pauseSession = true; }, releaseSession() { releaseSession?.(); } };
}

test('remote controller route opens silent live controls without loading a landscape, including on the host and trailing-slash alias', async () => {
  for (const pathname of ['/operator-remote', '/operator-remote/']) {
    const page = await desk({ pathname, localOperator: true, authorized: true });
    assert.equal(page.metrics.remoteControl, true);
    assert.equal(page.frame.hasAttribute('src'), false);
    assert.equal(page.element('remote-operator-panel').hidden, true);
    assert.equal(page.element('operator-access-help').hidden, true);
    assert.equal(page.mounts.length, 1);
    assert.equal(page.mounts[0].remoteControl, true);
    assert.equal(page.connections.length, 1);
    assert.equal(page.connections[0].options.role, 'operator');
    assert.equal(page.connections[0].options.view, 'controls');
    assert.equal(page.requests.some(request => request.url === '/data/fire-snapshot.json'), false);
  }
});

test('the host Operator route keeps its Main audio controls', async () => {
  const page = await desk({ pathname: '/operator', localOperator: true, authorized: true });
  assert.equal(page.metrics.remoteControl, false);
  assert.equal(page.frame.src, '/projection?operator-preview=1');
  assert.equal(page.element('remote-operator-panel').hidden, false);
  await page.frame.emit('load');
  assert.equal(page.mounts[0].remoteControl, false);
  assert.equal(page.connections.length, 0, 'The host retains its original preview-owned connection.');
  const original = page.frame.src;
  await page.element('workspace-tab-setup').emit('click');
  await page.element('workspace-tab-performance').emit('click');
  assert.equal(page.frame.src, original, 'Workspace switches preserve the host audio owner.');
});

test('PIN submission retains a leading zero, then enables direct silent controls without a preview', async () => {
  const page = await desk();
  assert.equal(page.element('operator-controls').disabled, true);
  assert.equal(page.element('operator-access-help').hidden, false);
  assert.equal(page.frame.hasAttribute('src'), false);
  page.element('operator-pin').value = '012345';
  await page.element('operator-pin-form').emit('submit'); await page.settle();
  const request = page.requests.find(request => request.url === '/api/operator/pair');
  assert.ok(request, 'The form actually submits a pairing request.');
  assert.equal(JSON.parse(request.options.body).pin, '012345');
  assert.equal(page.metrics.allowed, true);
  assert.equal(page.element('operator-controls').disabled, false);
  assert.equal(page.element('operator-access-help').hidden, true);
  assert.equal(page.frame.hasAttribute('src'), false);
  assert.equal(page.connections.length, 1);
  assert.equal(page.mounts[0].remoteControl, true);
});

for (const status of [403, 429]) test(`a rejected PIN (${status}) keeps the form usable and the performance disabled`, async () => {
  const page = await desk({ pinStatus: status });
  page.element('operator-pin').value = '123456';
  await page.element('operator-pin-form').emit('submit'); await page.settle();
  assert.equal(page.metrics.allowed, false);
  assert.equal(page.element('operator-controls').disabled, true);
  assert.equal(page.element('operator-access-help').hidden, false);
  assert.equal(page.element('operator-pin-submit').disabled, status === 429);
  assert.equal(page.frame.hasAttribute('src'), false);
  assert.match(page.element('operator-pin-status').textContent, status === 429 ? /Too many PIN/ : /Incorrect operator PIN/);
  if (status === 429) {
    page.advance(2000); await page.intervals.find(timer => timer.delay === 1000).callback();
    assert.equal(page.element('operator-pin-submit').disabled, false, 'The form is usable when the server cooldown expires.');
    assert.match(page.element('operator-pin-status').textContent, /try the PIN again/);
  }
});

test('a remembered controller opens directly, then loses controls and an optional preview when host access is reset', async () => {
  const page = await desk({ authorized: true });
  assert.equal(page.requests.some(request => request.url === '/api/operator/pair'), false);
  assert.equal(page.metrics.allowed, true);
  await page.element('operator-preview-toggle').emit('click'); await page.settle();
  assert.equal(page.frame.src, '/projection?operator-preview=1&remote-control=1');
  page.revoke();
  await page.intervals.find(timer => timer.delay === 5000).callback(); await page.settle();
  assert.equal(page.metrics.allowed, false);
  assert.equal(page.element('operator-controls').disabled, true);
  assert.equal(page.element('operator-access-help').hidden, false);
  assert.equal(page.frame.hasAttribute('src'), false);
  assert.equal(page.connections[0].destroyed, true, 'Revocation disposes the direct connection instead of leaving a reconnect loop.');
});


test('PIN success reads a fresh authorization even if an older unauthorized session poll is still in flight', async () => {
  const page = await desk();
  page.pauseNextSession();
  page.intervals.find(timer => timer.delay === 5000).callback();
  await page.settle();
  page.element('operator-pin').value = '012345';
  const submission = page.element('operator-pin-form').emit('submit');
  await page.settle();
  page.releaseSession();
  await submission; await page.settle();
  assert.equal(page.metrics.allowed, true);
  assert.equal(page.element('operator-controls').disabled, false);
  assert.equal(page.element('operator-access-help').hidden, true);
  assert.equal(page.frame.hasAttribute('src'), false);
  assert.equal(page.connections.length, 1);
});

test('direct controller state, scene cues, Main sound and mixer saves work before any landscape is opened', async () => {
  const page = await desk({ authorized: true }), connection = page.connections[0];
  assert.ok(connection, 'A compact connection exists without the iframe.');
  connection.emitConnection('connected');
  connection.emitState(page.state()); await page.settle();
  assert.equal(page.metrics.connected, true);
  assert.equal(page.metrics.scene.id, 'participation');
  assert.equal(page.element('operator-crowd').textContent, '7 phones · 2 raining');
  assert.equal(page.element('rain-strength').value, '40');
  assert.equal(page.frame.hasAttribute('src'), false);
  await page.element('scene-arrival').emit('click'); await page.settle();
  assert.equal(page.actions.some(action => action.url === '/api/scene' && action.body.scene === 'arrival'), true);
  assert.equal(page.metrics.scene.id, 'arrival');
  await page.mounts[0].mainSoundControl.toggle();
  assert.equal(page.actions.some(action => action.url === '/api/main-sound' && action.body.enabled === true), true);
  const saving = page.mounts[0].onSettings({ mixer: { bells: .75 } });
  await page.flushTimeouts(); await saving;
  assert.equal(page.actions.some(action => action.url === '/api/sound-settings' && action.body.mixer.bells === .75), true);
  assert.equal(page.frame.hasAttribute('src'), false);
  assert.equal(page.engine.enabled, false, 'Remote control never activates local audio.');
  assert.equal(page.requests.some(request => ['/data/fire-snapshot.json', '/api/snapshot', '/api/snapshot/export'].includes(request.url)), false);
  assert.equal(page.requests.some(request => request.url === '/api/snapshot/info'), true);
});

test('showing and hiding the remote landscape preserves the compact controls and mounted mixer', async () => {
  const page = await desk({ authorized: true }), connection = page.connections[0];
  connection.emitState(page.state()); await page.settle();
  await page.element('operator-preview-toggle').emit('click'); await page.settle();
  assert.equal(page.frame.src, '/projection?operator-preview=1&remote-control=1');
  await page.frame.emit('load');
  assert.equal(page.mounts.length, 1, 'An optional iframe does not replace or duplicate remote mixer controls.');
  await page.message({ type: 'wildfire-preview-state', state: page.state({ scene: { id: 'ended' } }) });
  await page.message({ type: 'wildfire-preview-connection', status: 'disconnected' });
  assert.equal(page.metrics.scene.id, 'participation', 'The optional preview cannot replace the direct controller state.');
  assert.equal(page.metrics.connected, true, 'The optional preview does not own controller connectivity.');
  await page.element('operator-preview-toggle').emit('click'); await page.settle();
  assert.equal(page.frame.hasAttribute('src'), false);
  assert.equal(page.connections.length, 1);
  connection.emitState(page.state({ joinedCount: 9, activeCount: 3 })); await page.settle();
  assert.equal(page.element('operator-crowd').textContent, '9 phones · 3 raining');
  assert.equal(page.metrics.connected, true);
  assert.equal(page.mounts.length, 1);
  await page.intervals.find(timer => timer.delay === 5000).callback(); await page.settle();
  assert.equal(page.connections.length, 1, 'Session polling reuses the active compact connection.');
});

test('re-pairing hydrates a fresh standalone mixer even when shared settings are unchanged', async () => {
  const page = await desk({ authorized: true });
  const settings = { automation: false, level: .41, mixer: { bells: .76 }, phoneMixer: { rain: .29 } };
  page.connections[0].emitState(page.state({ soundSettings: settings })); await page.settle();
  assert.deepEqual(page.engines[0].appliedSettings.at(-1), settings);
  page.revoke();
  await page.intervals.find(timer => timer.delay === 5000).callback(); await page.settle();
  assert.equal(page.metrics.allowed, false);
  page.element('operator-pin').value = '012345';
  await page.element('operator-pin-form').emit('submit'); await page.settle();
  assert.equal(page.metrics.allowed, true);
  assert.equal(page.engines.length, 2);
  assert.notEqual(page.engines[1], page.engines[0]);
  page.connections[1].emitState(page.state({ soundSettings: settings })); await page.settle();
  assert.deepEqual(page.engines[1].appliedSettings.at(-1), settings, 'Cached settings from the disposed mixer must not suppress the first state on its replacement.');
  assert.equal(page.frame.hasAttribute('src'), false);
});
