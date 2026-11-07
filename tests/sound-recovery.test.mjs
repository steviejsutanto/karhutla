import test from 'node:test';
import assert from 'node:assert/strict';
import { WildfireSound } from '../app/sound-engine.js';

class FakeParam {
  constructor(value = 0) { this.value = value; this.events = []; }
  cancelAndHoldAtTime(at) { this.events.push(['hold', at]); }
  cancelScheduledValues(at) { this.events.push(['cancel', at]); }
  setValueAtTime(value, at) { this.value = value; this.events.push(['set', value, at]); }
  setTargetAtTime(value, at, duration) { this.value = value; this.events.push(['target', value, at, duration]); }
  linearRampToValueAtTime(value, at) { this.value = value; this.events.push(['linear', value, at]); }
  exponentialRampToValueAtTime(value, at) { this.value = value; this.events.push(['exponential', value, at]); }
  setValueCurveAtTime(value, at, duration) { this.events.push(['curve', value, at, duration]); }
}
class FakeNode {
  constructor(context, type) {
    this.context = context; this.nodeType = type; this.connections = []; this.disconnected = false;
    for (const name of ['gain', 'frequency', 'detune', 'pan', 'Q', 'playbackRate', 'delayTime', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[name] = new FakeParam();
    context.nodes.push(this);
  }
  connect(node) { this.connections.push(node); return node; }
  setPeriodicWave(wave) { this.wave = wave; this.type = 'custom'; }
  disconnect() { this.disconnected = true; this.connections = []; }
  start(at = 0, offset = 0) { this.startedAt = at; this.offset = offset; }
  stop(at = this.context.currentTime) { this.stoppedAt = at; (this.stopEvents ??= []).push(at); if (!this.ended) this.context.scheduledStops.add(this); }
}
class FakeContext {
  constructor(events = []) { this.events = events; this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 8000; this.nodes = []; this.scheduledStops = new Set(); this.destination = {}; }
  resume() { this.events.push('resume'); this.state = 'running'; return Promise.resolve(); }
  suspend() { this.events.push('suspend'); this.state = 'suspended'; this.onstatechange?.(); return Promise.resolve(); }
  close() { this.events.push('close'); this.state = 'closed'; return Promise.resolve(); }
  createGain() { return new FakeNode(this, 'gain'); }
  createOscillator() { return new FakeNode(this, 'oscillator'); }
  createPeriodicWave(real, imag, options) { return { real: [...real], imag: [...imag], options }; }
  createBiquadFilter() { return new FakeNode(this, 'filter'); }
  createBufferSource() { return new FakeNode(this, 'source'); }
  createDelay() { return new FakeNode(this, 'delay'); }
  createDynamicsCompressor() { return new FakeNode(this, 'compressor'); }
  createWaveShaper() { return new FakeNode(this, 'shaper'); }
  createStereoPanner() { return new FakeNode(this, 'panner'); }
  createConvolver() { return new FakeNode(this, 'convolver'); }
  createBuffer(channels, frames, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(frames));
    return { numberOfChannels: channels, duration: frames / sampleRate, length: frames, sampleRate, getChannelData: channel => data[channel] };
  }
  decodeAudioData() { this.events.push('decode'); return Promise.resolve(this.createBuffer(1, 16000, 8000)); }
  advance(seconds) {
    this.currentTime += seconds;
    for (const node of this.scheduledStops) if (node.stoppedAt <= this.currentTime && !node.ended) { node.ended = true; this.scheduledStops.delete(node); node.onended?.(); }
  }
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const success = () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
function harness(t, { mode = 'phone', fetchImpl = async () => success() } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const context = new FakeContext(), requests = [];
  const engine = new WildfireSound({ mode, document: null, contextFactory: () => context,
    fetchImpl: (url, options) => { requests.push(url); return fetchImpl(url, options); } });
  // The audio graph stays real to the test double; avoid unrelated periodic
  // synthesis work while advancing the wall clock through download backoff.
  engine._startScheduler = () => {};
  t.after(() => engine.destroy());
  return { engine, context, requests, count: url => requests.filter(value => value === url).length,
    advance: async ms => { t.mock.timers.tick(ms); await flush(); } };
}

test('phone finale crickets recover automatically after one transient Wi-Fi failure', async t => {
  const url = '/cricket-recovery.mp3'; let failed = false;
  const { engine, count, advance } = harness(t, { fetchImpl: async requested => {
    if (requested === url && !failed) { failed = true; throw new TypeError('Failed to fetch'); }
    return success();
  } });
  await engine.setLayerSource('crickets', url);
  engine.setSceneState({ id: 'afterglow', elapsedMs: 50000, paused: false });
  await engine.enable(); await flush();
  assert.equal(count(url), 1); assert.equal(engine.layers.get('crickets').buffer, null);
  await advance(999); assert.equal(count(url), 1);
  await advance(1);
  assert.equal(count(url), 2); assert.ok(engine.layers.get('crickets').buffer);
  assert.equal(engine.failedSamples.has('crickets'), false);
  assert.equal(engine.sourceErrors.has('crickets'), false); assert.equal(engine.sampleRetryTimer, null);
});

test('automatic download retries stop after three retries, while Sound on starts a fresh recovery attempt', async t => {
  const url = '/crackle-recovery.mp3'; let available = false;
  const { engine, count, advance } = harness(t, { fetchImpl: async () => available ? success() : { ok: false, status: 503 } });
  await engine.setLayerSource('crackle', url); await engine.enable(); await flush();
  for (const delay of [1000, 3000, 8000]) await advance(delay);
  assert.equal(count(url), 4); assert.equal(engine.sourceErrors.get('crackle').retryAt, Infinity);
  await advance(60000); assert.equal(count(url), 4); assert.equal(engine.sampleRetryTimer, null);
  available = true; engine.setMuted(true); await engine.enable(); await flush();
  assert.equal(count(url), 5); assert.ok(engine.layers.get('crackle').buffer);
  assert.equal(engine.sourceErrors.size, 0);
});

test('a missing recording is not retried automatically or by Sound on; reselecting it retries', async t => {
  const url = '/missing.mp3'; let available = false;
  const { engine, count, advance } = harness(t, { fetchImpl: async () => available ? success() : { ok: false, status: 404 } });
  await engine.setLayerSource('crackle', url); await engine.enable(); await flush();
  available = true; await advance(60000); await engine.enable(); await flush();
  assert.equal(count(url), 1); assert.equal(engine.sourceErrors.get('crackle').retryable, false);
  assert.equal(await engine.setLayerSource('crackle', url), true); assert.equal(count(url), 2);
});

test('an invalid decoded recording does not trigger repeated downloads', async t => {
  const { engine, context, requests, advance } = harness(t);
  context.decodeAudioData = async () => { throw new Error('Unsupported audio'); };
  await engine.enable(); await flush();
  const initial = requests.length;
  await advance(60000); await engine.enable(); await flush();
  assert.equal(requests.length, initial); assert.equal(engine.sourceErrors.get('crackle').retryable, false);
});

test('a transient palette endpoint failure recovers without removing the working endpoint', async t => {
  const low = '/forest-low.mp3', high = '/forest-high.mp3'; let failures = 0;
  const { engine, count, advance } = harness(t, { mode: 'operator', fetchImpl: async url => {
    if (url === high && failures++ === 0) return { ok: false, status: 429 };
    return success();
  } });
  await engine.setLayerVariations('forest', [{ url: low, at: 0 }, { url: high, at: 1 }]);
  await engine.enable(); await flush();
  const layer = engine.layers.get('forest'), working = layer.variationSlots.get(low).buffer;
  assert.ok(working); assert.equal(layer.variationSlots.get(high).buffer, null);
  await advance(1000);
  assert.equal(layer.variationSlots.get(low).buffer, working); assert.ok(layer.variationSlots.get(high).buffer);
  assert.equal(count(low), 1); assert.equal(count(high), 2); assert.equal(engine.failedSamples.has('forest'), false);
});

test('residue recordings use bounded transient recovery instead of remaining failed for the session', async t => {
  const url = '/ash-residue.mp3'; let attempts = 0;
  const { engine, count, advance } = harness(t, { mode: 'operator', fetchImpl: async requested => {
    if (requested === url && attempts++ === 0) return { ok: false, status: 503 };
    return success();
  } });
  await engine.setResidueSources({ ash: [{ url }] }); await engine.enable(); await flush();
  assert.equal(engine.residueSources.get('ash')[0].buffer, null);
  await advance(1000);
  assert.equal(count(url), 2); assert.ok(engine.residueSources.get('ash')[0].buffer);
  assert.equal(engine.sourceErrors.has(`residue:ash:${url}`), false);
});

test('disable cancels scheduled recovery and re-enable can recover without a reload', async t => {
  let available = false;
  const { engine, requests, advance } = harness(t, { fetchImpl: async () => available ? success() : { ok: false, status: 503 } });
  await engine.enable(); await flush(); engine.disable();
  const initial = requests.length;
  await advance(60000); assert.equal(requests.length, initial); assert.equal(engine.sampleRetryTimer, null);
  available = true; await engine.enable(); await flush();
  assert.equal(requests.length, initial + 1); assert.ok(engine.layers.get('crackle').buffer);
});

for (const method of ['setMuted', 'setHidden']) test(`${method} pauses download recovery until resumed`, async t => {
  let available = false;
  const { engine, requests, advance } = harness(t, { fetchImpl: async () => available ? success() : { ok: false, status: 503 } });
  await engine.enable(); await flush(); engine[method](true);
  const initial = requests.length;
  await advance(5000); engine._loadSamples(); await flush(); assert.equal(requests.length, initial);
  available = true; engine[method](false); await flush();
  assert.equal(requests.length, initial + 1); assert.ok(engine.layers.get('crackle').buffer);
});

test('catalog adoption removes superseded default failures without a retry timer loop', async t => {
  const { engine, count, advance } = harness(t, { mode: 'operator', fetchImpl: async url => url === '/audio-assets/fire-roar.mp3' ? { ok: false, status: 503 } : success() });
  await engine.enable(); await flush(); assert.equal(engine.sourceErrors.has('roar'), true);
  await engine.setLayerVariations('forest', [{ url: '/forest-low.mp3', at: 0 }, { url: '/forest-high.mp3', at: 1 }]);
  await advance(60000);
  assert.equal(count('/audio-assets/fire-roar.mp3'), 1); assert.equal(engine.sourceErrors.has('roar'), false);
  assert.equal(engine.sampleRetryTimer, null);
});

test('promoting a failed residue to a palette endpoint retires its old retry record', async t => {
  const url = '/ash-residue.mp3'; let available = false;
  const { engine, count, advance } = harness(t, { mode: 'operator', fetchImpl: async requested => requested === url && !available ? { ok: false, status: 503 } : success() });
  await engine.setResidueSources({ ash: [{ url }] }); await engine.enable(); await flush();
  assert.equal(engine.sourceErrors.has(`residue:ash:${url}`), true);
  available = true; await engine.setLayerVariations('ash', [{ url, at: 0 }, { url: '/ash-other.mp3', at: 1 }]);
  await advance(60000);
  assert.equal(count(url), 2); assert.equal(engine.sourceErrors.has(`residue:ash:${url}`), false);
  assert.equal(engine.sampleRetryTimer, null);
});

test('reselecting a source cancels retry of the obsolete failed URL', async t => {
  const old = '/old.mp3', replacement = '/replacement.mp3';
  const { engine, count, advance } = harness(t, { fetchImpl: async url => url === old ? { ok: false, status: 503 } : success() });
  await engine.setLayerSource('crackle', old); await engine.enable(); await flush();
  await engine.setLayerSource('crackle', replacement); await advance(60000);
  assert.equal(count(old), 1); assert.equal(engine.layers.get('crackle').currentUrl, replacement);
  assert.equal(engine.sourceErrors.size, 0); assert.equal(engine.sampleRetryTimer, null);
});

test('a stalled fetch is bounded and a slow retry remains a single in-flight download', async t => {
  let stalled = true, resolveRetry;
  const { engine, requests, advance } = harness(t, { fetchImpl: () => stalled ? new Promise(() => {}) : new Promise(resolve => { resolveRetry = resolve; }) });
  await engine.enable(); await flush(); await advance(12000);
  assert.match(engine.sourceErrors.get('crackle').message, /too long/);
  assert.equal(engine.sourceRequests.size, 0); assert.equal(engine.pendingSamples.size, 0);
  stalled = false; await advance(1000);
  for (let index = 0; index < 25; index++) engine._loadSamples();
  await advance(2000); assert.equal(requests.length, 2); assert.equal(engine.sourceRequests.size, 1);
  resolveRetry(success()); await flush();
  assert.ok(engine.layers.get('crackle').buffer); assert.equal(engine.sourceRequests.size, 0);
});

test('destroy cancels a stalled fetch and leaves no scheduled recovery', async t => {
  const { engine, requests, advance } = harness(t, { fetchImpl: async () => new Promise(() => {}) });
  await engine.enable(); await flush(); engine.destroy(); await flush();
  await advance(60000);
  assert.equal(requests.length, 1); assert.equal(engine.sourceErrors.size, 0); assert.equal(engine.sampleRetryTimer, null);
});
