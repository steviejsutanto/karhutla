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
  const elements = new Map(), requests = [], mounts = [], intervals = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  const frame = element('operator-preview');
  frame.contentWindow = { __wildfireSound: { applySharedSettings() {}, getMetrics: () => ({}) } };
  const location = new URL(`http://192.168.1.10:4173${pathname}`);
  let allowed = authorized, clockNow = 1000, pauseSession = false, releaseSession = null;
  class ClockDate extends Date { static now() { return clockNow; } }
  const context = {
    URL, URLSearchParams, Blob, Date: ClockDate, createMainSoundControl,
    DEFAULT_PARAMETERS: {}, PARAMETER_LIMITS: {}, DEFAULT_PROGRAM_NOTES: '', DEFAULT_SCORE_SETTINGS: {}, SCENE_DURATION_LIMITS: {},
    sceneClock: () => '00:00', sceneRemaining: () => 0, scenePresentation: () => ({}), scenePhaseReadout: () => '',
    location, history: { replaceState(_state, _unused, address) { location.href = new URL(address, location).href; } },
    navigator: {},
    document: { body: { dataset: { workspaceView: 'performance' } }, getElementById: element, querySelectorAll: () => [], activeElement: null },
    window: { addEventListener() {} },
    setInterval(callback, delay) { intervals.push({ callback, delay }); return intervals.length; },
    setTimeout() { return 1; }, clearTimeout() {},
    mountSoundControls(_host, options) { mounts.push(options); return frame.contentWindow.__wildfireSound; },
    operatorRequest: async () => ({}),
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
      return { ok: true, status: 200, json: async () => ({ enabled: false, urls: [] }) };
    },
  };
  // The production module uses absolute browser imports. Inject those narrow
  // dependencies while running all of its actual DOM and request handling.
  const source = (await readFile(new URL('../app/operator.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  vm.runInNewContext(source, context, { filename: 'operator.js' });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  return { element, frame, requests, mounts, intervals, metrics: context.window.__performanceOperator, settle, revoke() { allowed = false; },
    advance(milliseconds) { clockNow += milliseconds; }, pauseNextSession() { pauseSession = true; }, releaseSession() { releaseSession?.(); } };
}

test('remote controller route forces silent controls even on the host, including its trailing-slash alias', async () => {
  for (const pathname of ['/operator-remote', '/operator-remote/']) {
    const page = await desk({ pathname, localOperator: true, authorized: true });
    assert.equal(page.metrics.remoteControl, true);
    assert.equal(page.frame.src, '/projection?operator-preview=1&remote-control=1');
    assert.equal(page.element('remote-operator-panel').hidden, true);
    assert.equal(page.element('operator-access-help').hidden, true);
    await page.frame.emit('load');
    assert.equal(page.mounts.length, 1);
    assert.equal(page.mounts[0].remoteControl, true);
  }
});

test('the host Operator route keeps its Main audio controls', async () => {
  const page = await desk({ pathname: '/operator', localOperator: true, authorized: true });
  assert.equal(page.metrics.remoteControl, false);
  assert.equal(page.frame.src, '/projection?operator-preview=1');
  assert.equal(page.element('remote-operator-panel').hidden, false);
  await page.frame.emit('load');
  assert.equal(page.mounts[0].remoteControl, false);
});

test('PIN submission retains a leading zero, then enables the silent preview using the browser authorization', async () => {
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
  assert.equal(page.frame.src, '/projection?operator-preview=1&remote-control=1');
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

test('a remembered controller opens directly, then loses the preview and controls when host access is reset', async () => {
  const page = await desk({ authorized: true });
  assert.equal(page.requests.some(request => request.url === '/api/operator/pair'), false);
  assert.equal(page.metrics.allowed, true);
  page.revoke();
  await page.intervals.find(timer => timer.delay === 5000).callback(); await page.settle();
  assert.equal(page.metrics.allowed, false);
  assert.equal(page.element('operator-controls').disabled, true);
  assert.equal(page.element('operator-access-help').hidden, false);
  assert.equal(page.frame.hasAttribute('src'), false);
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
  assert.equal(page.frame.src, '/projection?operator-preview=1&remote-control=1');
});
