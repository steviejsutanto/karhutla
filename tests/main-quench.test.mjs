import test from 'node:test';
import assert from 'node:assert/strict';
import { MainQuenchAudio } from '../app/main-quench.js';

class Parameter {
  constructor(value = 0) { this.value = value; this.events = []; this.automation = []; }
  cancelAndHoldAtTime(at) {
    const held = this.at(at); this.events.push(['hold', at]);
    this.automation = this.automation.filter(event => event[2] < at); this.automation.push(['set', held, at]);
  }
  cancelScheduledValues(at) { this.events.push(['cancel', at]); this.automation = this.automation.filter(event => event[2] < at); }
  _schedule(kind, value, at) { this.value = value; const event = [kind, value, at]; this.events.push(event); this.automation.push(event); }
  setTargetAtTime(value, at) { this._schedule('set', value, at); }
  setValueAtTime(value, at) { this._schedule('set', value, at); }
  linearRampToValueAtTime(value, at) { this._schedule('linear', value, at); }
  exponentialRampToValueAtTime(value, at) { this._schedule('exponential', value, at); }
  at(time) {
    let from = 0, start = 0;
    for (const [kind, value, end] of this.automation) {
      if (!['set', 'linear', 'exponential'].includes(kind)) continue;
      if (time < end) {
        if (kind === 'set') return from;
        const progress = Math.max(0, Math.min(1, (time - start) / (end - start)));
        return kind === 'exponential' && from > 0 ? from * (value / from) ** progress : from + (value - from) * progress;
      }
      from = value; start = end;
    }
    return from;
  }
}
class Node {
  constructor(context, kind) {
    this.context = context; this.kind = kind; this.connections = []; this.disconnected = false;
    for (const name of ['gain', 'frequency']) this[name] = new Parameter();
    context.nodes.push(this);
  }
  connect(node) { this.connections.push(node); }
  disconnect() { this.connections = []; this.disconnected = true; }
  start(at = 0) { this.startedAt = at; }
  stop(at = this.context.currentTime) { this.stoppedAt = at; this.context.stops.add(this); }
}
class Context {
  constructor(sampleRate = 48000) { this.sampleRate = sampleRate; this.currentTime = 0; this.nodes = []; this.stops = new Set(); this.destination = {}; this.decodes = 0; this.buffers = 0; }
  createGain() { return new Node(this, 'gain'); }
  createBiquadFilter() { return new Node(this, 'filter'); }
  createBufferSource() { this.buffers++; return new Node(this, 'source'); }
  createOscillator() { return new Node(this, 'oscillator'); }
  createConvolver() {
    const node = new Node(this, 'convolver'); let buffer = null;
    Object.defineProperty(node, 'buffer', {
      get: () => buffer,
      set: value => {
        if (value && value.sampleRate !== this.sampleRate) throw new Error('Convolver buffer sample rate must match the context.');
        buffer = value;
      },
    });
    return node;
  }
  createBuffer(channels, frames, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(frames));
    return { numberOfChannels: channels, length: frames, sampleRate, duration: frames / sampleRate, getChannelData: index => data[index] };
  }
  decodeAudioData() { this.decodes++; throw new Error('Phones must never decode rain.'); }
  advance(seconds) {
    this.currentTime += seconds;
    for (const node of [...this.stops]) if (node.stoppedAt <= this.currentTime && !node.ended) { node.ended = true; this.stops.delete(node); node.onended?.(); }
  }
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const response = (code = 1) => ({ ok: true, headers: { get: () => '8' }, arrayBuffer: async () => Uint8Array.of(code, 0, 0, 0, 0, 0, 0, 0).buffer });
const patch = (key = 'ground') => ({ key, position: [.2, .8] });
function fixture(t, { fetchImpl, decode, loadTimeoutMs, active = true } = {}) {
  const context = new Context(), requests = [];
  context.decodeAudioData = bytes => { context.decodes++; return decode?.(bytes, context) ?? Promise.resolve(context.createBuffer(1, context.sampleRate * 1.7, context.sampleRate)); };
  const main = new MainQuenchAudio({ context, destination: context.destination, loadTimeoutMs,
    makeSpatialPath: destination => { const input = context.createGain(); input.connect(destination); return { input, nodes: [input] }; },
    positionPath: (space, position) => { space.position = [...position]; },
    fetchImpl: (url, options) => { requests.push({ url, ...options }); return fetchImpl?.(url, options) ?? Promise.resolve(response()); } });
  main.setActive(active); t.after(() => main.destroy()); return { main, context, requests };
}
test('Main banks wait for permission, swap atomically, and never replay an edge after loading', async t => {
  const fetches = [deferred(), deferred()], sources = [{ id: 'ember', url: '/ember.wav' }, { id: 'steam', url: '/steam.wav' }];
  const { main, context, requests } = fixture(t, { active: false, fetchImpl: url => fetches[url === '/ember.wav' ? 0 : 1].promise });
  assert.equal(await main.setSources(sources), true); await flush(); assert.deepEqual(requests, []);
  main.setActive(true); const loading = main.setSources(sources); await flush(); assert.equal(requests.length, 2);
  assert.equal(main.trigger(patch()), false); fetches[0].resolve(response()); await flush(); assert.equal(main.getMetrics().loaded, false);
  fetches[1].resolve(response(2)); assert.equal(await loading, true); assert.equal(main.getMetrics().triggered, 0);
  assert.equal(main.trigger(patch()), true);
  const voice = [...main.quenches][0]; assert.equal(voice.at, context.currentTime); assert.equal(voice.source.loop, false);
  assert.deepEqual(voice.position, [.2, .8]); assert.deepEqual(voice.space.position, [.2, .8]);
  assert.deepEqual(voice.envelope.connections, [voice.space.input]); assert.deepEqual(voice.space.input.connections, [main.output]);
  assert.deepEqual(main.output.connections, [context.destination]);
  assert.equal(await main.setSources(sources), true); assert.equal(requests.length, 2);
  assert.equal(await main.setSources([{ id: 'renamed', url: '/steam.wav' }]), true); assert.equal(context.decodes, 2);
  assert.equal(main.getMetrics().cacheEntries, 1);
});
test('Main validates URL, bytes and duration while failed replacements preserve the last usable bank', async t => {
  const { main, context, requests } = fixture(t, { fetchImpl: url => {
    if (url === '/missing.wav') return Promise.resolve({ ok: false, status: 404 });
    if (url === '/oversized.wav') return Promise.resolve({ ...response(), headers: { get: () => '1500001' } });
    if (url === '/oversized-body.wav') return Promise.resolve({ ...response(), arrayBuffer: async () => new ArrayBuffer(1500001) });
    return Promise.resolve(response());
  } });
  assert.equal(await main.setSources([{ id: 'good', url: '/good.wav' }]), true);
  for (const entries of [[{ url: 'data:audio/wav;base64,AAAA' }], [{ url: 'javascript:alert(1)' }], [{ url: 'https://name:secret@example.test/a.wav' }], [{ url: '/same.wav' }, { url: '/same.wav' }], Array.from({ length: 5 }, (_, index) => ({ url: `/${index}.wav` }))]) {
    assert.equal(await main.setSources(entries), false); assert.equal(requests.length, 1);
  }
  for (const url of ['/missing.wav', '/oversized.wav', '/oversized-body.wav']) {
    assert.equal(await main.setSources([{ id: 'bad', url }]), false); assert.deepEqual(main.getMetrics().assetIds, ['good']);
  }
  assert.equal(context.decodes, 1); context.decodeAudioData = () => Promise.resolve(context.createBuffer(1, context.sampleRate * 4.1, context.sampleRate));
  assert.equal(await main.setSources([{ id: 'long', url: '/long.wav' }]), false); assert.match(main.getMetrics().error, /short mono or stereo/);
  assert.equal(main.trigger(patch()), true); assert.equal(main.getMetrics().currentAssetId, 'good');
});
test('obsolete loads abort and late native decodes never poison the Main bank', async t => {
  const native = new Map();
  const { main, requests, context } = fixture(t, { fetchImpl: url => Promise.resolve(response(url === '/a.wav' ? 1 : url === '/b.wav' ? 2 : 3)), decode: bytes => {
    const pending = deferred(); native.set(new Uint8Array(bytes)[0], pending); return pending.promise;
  } });
  const old = main.setSources([{ id: 'old-a', url: '/a.wav' }, { id: 'old-b', url: '/b.wav' }]); await flush(); assert.equal(native.size, 2);
  const replacement = main.setSources([{ id: 'current', url: '/c.wav' }]); await flush(); assert.equal(await old, false);
  assert.ok(requests[0].signal.aborted && requests[1].signal.aborted); assert.equal(native.size, 2);
  const buffer = context.createBuffer(1, 48000, 48000); native.get(1).resolve(buffer); await flush(); assert.equal(native.size, 3);
  native.get(3).resolve(buffer); assert.equal(await replacement, true); native.get(2).resolve(buffer); await flush();
  assert.deepEqual(main.getMetrics().assetIds, ['current']); assert.equal(main.getMetrics().pendingDecodes, 0); assert.equal(main.getMetrics().triggered, 0);
});
test('muting cancels a pending decode and drains playing shots before suspended-time resume', async t => {
  let pending; const { main, context, requests } = fixture(t); await main.setSources([{ id: 'ready', url: '/ready.wav' }]);
  main.trigger(patch()); const voice = [...main.quenches][0]; context.advance(.2);
  context.decodeAudioData = () => { pending = deferred(); return pending.promise; };
  const loading = main.setSources([{ id: 'late', url: '/late.wav' }]); await flush(); main.setActive(false);
  assert.equal(await loading, false); assert.ok(requests.at(-1).signal.aborted); assert.equal(voice.envelope.gain.at(context.currentTime + .04), 0);
  pending.resolve(context.createBuffer(1, 48000, 48000)); await flush(); assert.deepEqual(main.getMetrics().assetIds, ['ready']);
  context.decodeAudioData = () => Promise.resolve(context.createBuffer(1, 48000, 48000)); main.setActive(true); await flush();
  assert.equal(voice.source.disconnected, true); assert.equal(voice.source.buffer, null); assert.equal(main.getMetrics().triggered, 1);
});
test('hanging network and native decodes time out with at most two unabortable decodes', async t => {
  const { main, requests } = fixture(t, { fetchImpl: () => new Promise(() => {}), loadTimeoutMs: 5 });
  assert.equal(await main.setSources([{ id: 'hang', url: '/hang.wav' }]), false); assert.ok(requests[0].signal.aborted); assert.match(main.getMetrics().error, /too long/);
  main.fetchImpl = () => Promise.resolve(response()); main.context.decodeAudioData = () => new Promise(() => {});
  for (let i = 0; i < 3; i++) assert.equal(await main.setSources([{ id: `native-${i}`, url: `/native-${i}.wav` }]), false);
  assert.equal(main.getMetrics().pendingDecodes, 2); assert.equal(main.getMetrics().triggered, 0);
});
test('simultaneous extinction bursts and rapid retaps keep bounded voices, spatial paths and shared headroom', async t => {
  const { main, context } = fixture(t); await main.setSources([{ id: 'wood', url: '/wood.wav' }]);
  for (let i = 0; i < 1000; i++) main.trigger(patch(`burst-${i}`));
  assert.equal(main.getMetrics().triggered, 8); assert.equal(main.quenches.size, 8); assert.equal(context.buffers, 8);
  for (let i = 0; i < 100; i++) {
    context.advance(.081); main.trigger(patch());
    assert.ok(main.quenches.size <= 8); assert.ok(main.quenches.size + main.retiringQuenches.size <= 9);
    assert.ok(context.nodes.filter(node => node.kind === 'source' && !node.disconnected).length <= 9);
  }
  main.configure({ participantCount: 100 }); assert.equal(main.getMetrics().crowdGain, .1);
  assert.equal(main.outputTarget, .1); assert.equal(main.getMetrics().gain, .16);
  main.configure({ weight: 0 }); assert.equal(main.outputTarget, 0);
  main.reset(); context.advance(.05); assert.equal(main.quenches.size + main.retiringQuenches.size, 0);
  assert.ok(context.nodes.filter(node => node !== main.output).every(node => node.disconnected));
  main.destroy(); assert.ok(context.nodes.every(node => node.disconnected));
});
