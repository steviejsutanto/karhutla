import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneTapRainAudio, PHONE_RAIN_TRIM } from '../app/phone-tap-rain.js';

class Parameter {
  constructor() { this.value = 1; this.events = []; this.automation = []; }
  setValueAtTime(value, time) { const event = ['set', value, time]; this.events.push(event); this.automation.push(event); }
  linearRampToValueAtTime(value, time) { const event = ['linear', value, time]; this.events.push(event); this.automation.push(event); }
  cancelAndHoldAtTime(time) {
    const value = this.at(time); this.events.push(['hold', time]);
    this.automation = this.automation.filter(event => event[2] < time); this.automation.push(['set', value, time]);
  }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); this.automation = this.automation.filter(event => event[2] < time); }
  at(time) {
    let from = this.value, start = 0;
    for (const [kind, value, end] of this.automation) {
      if (time < end) return kind === 'set' ? from : from + (value - from) * Math.max(0, Math.min(1, (time - start) / (end - start)));
      from = value; start = end;
    }
    return from;
  }
}
class AudioNode {
  constructor(context, kind) { this.context = context; this.kind = kind; this.gain = new Parameter(); this.connections = []; context.nodes.push(this); }
  connect(node) { this.connections.push(node); }
  disconnect() { this.disconnected = true; this.connections = []; }
  start(time, offset) { this.startedAt = time; this.offset = offset; }
  stop(time = this.context.currentTime) { this.stoppedAt = time; this.context.stops.add(this); }
}
class Context {
  constructor() { this.currentTime = 0; this.state = 'running'; this.listeners = new Set(); this.sampleRate = 48000; this.destination = {}; this.nodes = []; this.stops = new Set(); this.decodes = 0; }
  addEventListener(name, listener) { if (name === 'statechange') this.listeners.add(listener); }
  removeEventListener(name, listener) { if (name === 'statechange') this.listeners.delete(listener); }
  changeState(state) { this.state = state; for (const listener of this.listeners) listener(); }
  createGain() { return new AudioNode(this, 'gain'); }
  createBufferSource() { return new AudioNode(this, 'source'); }
  createOscillator() { return new AudioNode(this, 'clock'); }
  decodeAudioData() { this.decodes++; return Promise.resolve(buffer(this.sampleRate)); }
  advance(seconds) {
    if (this.state !== 'running') return;
    this.currentTime += seconds;
    for (const node of [...this.stops]) if (node.stoppedAt <= this.currentTime && !node.ended) { node.ended = true; this.stops.delete(node); node.onended?.(); }
  }
}
function buffer(sampleRate = 48000) {
  const data = new Float32Array(4800).fill(.02);
  return { duration: 18, numberOfChannels: 1, sampleRate, length: data.length, getChannelData: () => data };
}
const response = () => ({ ok: true, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(100) });
const holding = extra => ({ holding: true, eligible: true, ...extra });
const release = () => ({ holding: false, eligible: true });
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
function fixture(t, options = {}) {
  const context = new Context(), requests = [], prepared = [];
  const rain = new PhoneTapRainAudio({ context, destination: context.destination,
    fetchImpl: async (url, options) => { requests.push({ url, options }); return response(); },
    prepareLoop: value => { prepared.push(value); return value; }, ...options });
  t.after(() => rain.destroy());
  return { context, rain, requests, prepared };
}

test('phone rain is lazy while inactive and has no audible or allocated idle loop', async t => {
  const { rain, requests, context, prepared } = fixture(t);
  assert.equal(await rain.setSource('/light-mobile.mp3'), true);
  assert.equal(requests.length, 0); assert.equal(context.nodes.length, 0);
  rain.setActive(true); await flush();
  assert.equal(requests.length, 1); assert.equal(context.decodes, 1); assert.equal(prepared.length, 1);
  assert.equal(rain.getMetrics().loaded, true); assert.equal(rain.getMetrics().rainLoopCount, 0);
  assert.equal(rain.getMetrics().rainGain, 0); assert.equal(context.nodes.length, 0);
  assert.ok(Math.abs(rain.getMetrics().outputRms - .00204 * PHONE_RAIN_TRIM) < 1e-8);
  for (let index = 0; index < 20; index++) { rain.update(release()); rain.setActive(true); }
  assert.equal(requests.length, 1); assert.equal(prepared.length, 1);
});

test('a held finger rains over hot, out, and null targets with a quiet native attack and finite release', async t => {
  const { rain, context } = fixture(t); await rain.setSource('/light.mp3'); rain.setActive(true); await flush();
  for (const target of [{ patchKey: 'hot', extinguished: false }, { patchKey: 'out', extinguished: true }, { patchKey: null }]) {
    rain.update(holding(target));
    const voice = rain.voice;
    assert.ok(voice); assert.equal(voice.source.loop, true); assert.equal(voice.source.buffer.numberOfChannels, 1);
    assert.deepEqual(voice.source.connections, [voice.gain]); assert.deepEqual(voice.gain.connections, [context.destination]);
    assert.equal(rain.getMetrics().rainGain, 0); context.advance(.025 + .425);
    assert.ok(Math.abs(rain.getMetrics().rainGain - voice.peak / 2) < 1e-8); context.advance(.425);
    assert.ok(Math.abs(rain.getMetrics().rainGain - voice.peak) < 1e-8);
    rain.update(release()); assert.equal(rain.getMetrics().rainLoopCount, 1);
    const start = context.currentTime; assert.equal(voice.releaseClock.stoppedAt, start + 2.5);
    assert.deepEqual(voice.releaseClock.connections, [], 'The native cleanup clock is inaudible.');
    assert.equal(voice.source.stoppedAt, undefined, 'A release can resume without a previously scheduled source stop.');
    context.advance(1.25); assert.ok(Math.abs(rain.getMetrics().rainGain - voice.peak / 2) < 1e-8);
    context.advance(1.251); assert.equal(rain.getMetrics().rainLoopCount, 0); assert.equal(voice.gain.disconnected, true);
  }
  assert.equal(rain.getMetrics().loopsStarted, 3);
});

test('rapid presses resume one phase-continuous loop and one envelope without stacking or cutting a tail', async t => {
  const { rain, context, requests } = fixture(t); await rain.setSource('/light.mp3'); rain.setActive(true); await flush();
  rain.update(holding()); context.advance(.18); const voice = rain.voice, source = voice.source;
  for (let index = 0; index < 100; index++) {
    rain.update(release()); const clock = voice.releaseClock;
    context.advance(.007 + (index % 5) * .013);
    const rendered = voice.gain.gain.at(context.currentTime);
    assert.ok(Math.abs(rendered - rain.getMetrics().rainGain) < 1e-10);
    rain.update(holding({ patchKey: String(index), position: [index / 100, .4] }));
    assert.equal(rain.voice, voice); assert.equal(rain.voice.source, source);
    assert.ok(Math.abs(voice.gain.gain.at(context.currentTime) - rendered) < 1e-10, 'Re-press begins at the rendered release level.');
    assert.equal(clock.disconnected, true); assert.equal(clock.onended, null, 'An old cleanup event cannot stop resumed rain.');
    assert.equal(voice.source.disconnected, undefined);
    assert.equal(rain.getMetrics().rainLoopCount, 1);
    assert.equal(context.nodes.filter(node => node.kind === 'source' && !node.disconnected).length, 1);
    context.advance(.011);
    assert.ok(rain.getMetrics().rainGain <= voice.peak, 'Repeated re-presses never sum coherent recordings.');
    const before = voice.gain.gain.at(context.currentTime), events = voice.gain.gain.events.length;
    for (let drag = 0; drag < 5; drag++) rain.update(holding({ patchKey: `${index}-${drag}` }));
    assert.equal(voice.gain.gain.events.length, events, 'Drag packets do not restart attack or playback.');
    rain.update(release()); assert.ok(Math.abs(voice.gain.gain.at(context.currentTime) - before) < 1e-10);
  }
  context.advance(2.6); assert.equal(rain.getMetrics().rainLoopCount, 0);
  assert.equal(rain.getMetrics().loopsStarted, 1); assert.equal(source.offset, source.startedAt);
  assert.equal(requests.length, 1); assert.equal(context.decodes, 1);
  assert.ok(context.nodes.every(node => node.disconnected));
});

test('Safari fallback changes attack and release from their actual current levels and leaves no idle loop', async t => {
  const { rain, context } = fixture(t); await rain.setSource('/light.mp3'); rain.setActive(true); await flush();
  rain.update(holding()); const voice = rain.voice; voice.gain.gain.cancelAndHoldAtTime = undefined;
  for (const held of [.03, .07, .13]) {
    context.advance(held); let current = voice.gain.gain.at(context.currentTime);
    rain.update(release()); assert.ok(Math.abs(voice.gain.gain.at(context.currentTime) - current) < 1e-10);
    context.advance(.1); current = voice.gain.gain.at(context.currentTime);
    rain.update(holding()); assert.ok(Math.abs(voice.gain.gain.at(context.currentTime) - current) < 1e-10);
  }
  rain.update(release()); context.advance(2.51);
  assert.equal(rain.getMetrics().rainLoopCount, 0); assert.ok(context.nodes.every(node => node.disconnected));
});

test('mute, hide, stop and ineligible holds are consumed until a fresh finger release', async t => {
  const { rain, context } = fixture(t); await rain.setSource('/light.mp3'); rain.setActive(true); await flush();
  rain.update(holding()); context.advance(.1); const old = rain.voice;
  rain.setActive(false); assert.equal(rain.getMetrics().rainGain, 0); assert.equal(old.source.disconnected, true);
  rain.setActive(true); rain.update(holding()); assert.equal(rain.getMetrics().rainLoopCount, 0);
  rain.update(release()); rain.update(holding()); assert.equal(rain.getMetrics().loopsStarted, 2);
  rain.update(holding({ eligible: false })); rain.update(holding());
  assert.equal(rain.getMetrics().retiringLoopCount, 1); context.advance(2.51);
  assert.equal(rain.getMetrics().rainLoopCount, 0);
  rain.update(release()); rain.update(holding()); assert.equal(rain.getMetrics().loopsStarted, 3);
  rain.stop(); rain.update(holding()); assert.equal(rain.getMetrics().rainLoopCount, 0);
  rain.reset(); rain.update(holding()); assert.equal(rain.getMetrics().loopsStarted, 4);
});

test('an ineligible reading releases smoothly without restarting a continuing hold', async t => {
  const { rain, context } = fixture(t); await rain.setSource('/light.mp3'); rain.setActive(true); await flush();
  rain.update(holding()); context.advance(.9);
  const voice = rain.voice, source = voice.source, peak = rain.getMetrics().rainGain;
  rain.update(holding({ eligible: false }));
  assert.equal(rain.getMetrics().rainGain, peak); assert.equal(source.disconnected, undefined);
  context.advance(.625); assert.ok(Math.abs(rain.getMetrics().rainGain - peak * .84375) < 1e-10);
  rain.update(holding());
  assert.equal(rain.voice, voice); assert.equal(rain.getMetrics().loopsStarted, 1);
  assert.equal(rain.getMetrics().suppressedUntilRelease, true);
  context.advance(.625); assert.ok(Math.abs(rain.getMetrics().rainGain - peak * .5) < 1e-10);
  rain.update(release()); rain.update(holding());
  assert.equal(rain.voice?.source, source); assert.equal(rain.getMetrics().retiringLoopCount, 0);
  context.advance(.85); assert.ok(Math.abs(rain.getMetrics().rainGain - peak) < 1e-10);
  rain.update(release()); context.advance(2.51);
  assert.equal(rain.getMetrics().rainLoopCount, 0); assert.ok(context.nodes.every(node => node.disconnected));
});

test('a hold first observed inactive cannot replay when sound starts', async t => {
  const { rain } = fixture(t); await rain.setSource('/light.mp3'); rain.update(holding());
  rain.setActive(true); await flush(); assert.equal(rain.getMetrics().rainLoopCount, 0);
  rain.update(release()); rain.update(holding()); assert.equal(rain.getMetrics().rainLoopCount, 1);
});

test('late loading follows only a still-held eligible finger and never replays a released tap', async t => {
  let complete;
  const { rain, context } = fixture(t, { fetchImpl: () => new Promise(resolve => { complete = resolve; }) });
  await rain.setSource('/light.mp3'); rain.setActive(true); rain.update(holding()); await flush();
  rain.update(release()); complete(response()); await flush();
  assert.equal(rain.getMetrics().loaded, true); assert.equal(rain.getMetrics().loopsStarted, 0); assert.equal(context.nodes.length, 0);
  rain.update(holding()); assert.equal(rain.getMetrics().rainLoopCount, 1);
});

test('the cold first voice schedules its full rounded attack after device setup and late decoding', async t => {
  let complete;
  const { rain, context } = fixture(t, { fetchImpl: () => new Promise(resolve => { complete = resolve; }) });
  await rain.setSource('/cold.mp3'); rain.setActive(true); rain.update(holding()); await flush();
  context.advance(1.7);
  const createGain = context.createGain.bind(context);
  context.createGain = () => { context.advance(.7); return createGain(); };
  complete(response()); await flush();
  const voice = rain.voice, parameter = voice.gain.gain;
  assert.ok(voice); assert.equal(voice.source.startedAt, context.currentTime + .025);
  assert.equal(parameter.value, 0, 'The connected gain starts silent even before its scheduled events.');
  const attack = rain.getMetrics().attackSeconds;
  assert.equal(attack, .85);
  assert.ok(parameter.at(voice.source.startedAt + .08) < voice.peak * .03, 'A first cold touch stays quiet during its opening 80ms.');
  assert.ok(Math.abs(parameter.at(voice.source.startedAt + attack / 2) - voice.peak * .5) < 1e-10);
  assert.ok(Math.abs(parameter.at(voice.source.startedAt + attack) - voice.peak) < 1e-10);
  assert.ok(parameter.events.filter(event => event[0] === 'linear').length <= 64, 'The native envelope has a bounded number of points.');
});

test('a long held loop keeps one source through many laps then renders its complete rounded release', async t => {
  const { rain, context } = fixture(t); await rain.setSource('/light.mp3'); rain.setActive(true); await flush();
  rain.update(holding()); const voice = rain.voice, source = voice.source;
  context.advance(184.7);
  const before = voice.gain.gain.at(context.currentTime);
  assert.equal(before, voice.peak);
  rain.update(holding({ patchKey: null })); rain.update(release());
  assert.equal(rain.voice, voice); assert.equal(rain.getMetrics().loopsStarted, 1);
  assert.equal(voice.gain.gain.at(context.currentTime), before, 'Release begins at the actual long-held native gain.');
  assert.ok(Math.abs(voice.gain.gain.at(context.currentTime + .625) - before * .84375) < 1e-10);
  assert.ok(Math.abs(voice.gain.gain.at(context.currentTime + 1.25) - before * .5) < 1e-10);
  assert.ok(voice.gain.gain.at(context.currentTime + 2.48) < before * .0005, 'The endpoint is already nearly silent before native disposal.');
  assert.equal(source.stoppedAt, undefined);
  context.advance(2.49); assert.equal(source.disconnected, undefined);
  context.advance(.02); assert.equal(source.disconnected, true); assert.equal(rain.getMetrics().rainLoopCount, 0);
});

test('a frozen device clock resumes the same long-held source through a fresh quiet attack', async t => {
  const { rain, context } = fixture(t); await rain.setSource('/light.mp3'); rain.setActive(true); await flush();
  rain.update(holding()); context.advance(120);
  const voice = rain.voice, source = voice.source, phase = source.offset;
  context.changeState('interrupted');
  assert.equal(voice.gain.gain.at(context.currentTime), 0);
  context.advance(30); assert.equal(context.currentTime, 120, 'Device interruption freezes native audio time.');
  rain.update(holding({ patchKey: null })); assert.equal(voice.gain.gain.at(context.currentTime), 0);
  context.changeState('running');
  assert.equal(rain.voice, voice); assert.equal(rain.getMetrics().loopsStarted, 1); assert.equal(source.offset, phase);
  context.advance(.105); assert.ok(voice.gain.gain.at(context.currentTime) < voice.peak * .03);
  context.advance(.77); assert.ok(Math.abs(voice.gain.gain.at(context.currentTime) - voice.peak) < 1e-10);
  rain.update(release()); context.advance(2.51); assert.equal(rain.getMetrics().rainLoopCount, 0);
  rain.destroy(); assert.equal(context.listeners.size, 0);
});

test('release or hard mute while the device clock is frozen cannot revive an old hold', async t => {
  for (const action of ['release', 'mute']) {
    const { rain, context } = fixture(t); await rain.setSource('/light.mp3'); rain.setActive(true); await flush();
    rain.update(holding()); context.advance(12); context.changeState('suspended');
    if (action === 'release') rain.update(release()); else rain.setActive(false);
    assert.equal(rain.getMetrics().rainLoopCount, 0);
    context.changeState('running'); rain.setActive(true); await flush();
    assert.equal(rain.getMetrics().rainLoopCount, 0);
    rain.update(release()); rain.update(holding()); assert.equal(rain.getMetrics().loopsStarted, 2);
  }
});

test('cancellation settles even an uncooperative fetch and a late decode cannot resurrect cancelled sound', async t => {
  let finishDecode;
  const { rain, context } = fixture(t);
  context.decodeAudioData = () => { context.decodes++; return new Promise(resolve => { finishDecode = resolve; }); };
  await rain.setSource('/light.mp3'); rain.setActive(true); rain.update(holding()); await flush();
  const pending = rain.request.promise; assert.equal(context.decodes, 1);
  rain.setActive(false); assert.equal(await pending, false); rain.setActive(true); rain.update(holding());
  await flush(); assert.equal(context.decodes, 1, 'A stale native decode bounds further decode allocations.');
  finishDecode(buffer()); await flush();
  assert.equal(rain.getMetrics().loopsStarted, 0); assert.equal(rain.getMetrics().rainLoopCount, 0);
  rain.setActive(false);
  const hanging = fixture(t, { fetchImpl: () => new Promise(() => {}) }).rain;
  await hanging.setSource('/light.mp3'); hanging.setActive(true); await flush();
  const stalled = hanging.request.promise; hanging.stop(); assert.equal(await stalled, false);
  assert.equal(hanging.getMetrics().loading, false);
});

test('deadlines cover hanging network and decode work and a fresh gesture can retry after failure', async t => {
  const { rain } = fixture(t, { loadTimeoutMs: 5, fetchImpl: () => new Promise(() => {}) });
  await rain.setSource('/light.mp3'); rain.setActive(true); const result = await rain.request.promise;
  assert.equal(result, false); assert.match(rain.getMetrics().error, /too long/); assert.equal(rain.getMetrics().loading, false);
  rain.fetchImpl = async () => response(); rain.update(holding()); await flush();
  assert.equal(rain.getMetrics().loaded, true); assert.equal(rain.getMetrics().rainLoopCount, 1);
  const other = fixture(t, { loadTimeoutMs: 5 }); other.context.decodeAudioData = () => new Promise(() => {});
  await other.rain.setSource('/decode.mp3'); other.rain.setActive(true);
  assert.equal(await other.rain.request.promise, false); assert.match(other.rain.getMetrics().error, /too long/);
});

test('bad assets fail quietly and destroy makes every later operation inert', async t => {
  const { rain, context } = fixture(t, { fetchImpl: async () => ({ ...response(), ok: false, status: 404 }) });
  assert.equal(await rain.setSource('javascript:bad'), false); assert.equal(rain.getMetrics().sourceUrl, null);
  await rain.setSource('/missing.mp3'); rain.setActive(true); assert.equal(await rain.request.promise, false);
  assert.match(rain.getMetrics().error, /404/); assert.equal(context.nodes.length, 0);
  rain.fetchImpl = async () => response(); rain.update(holding()); await flush(); rain.destroy();
  const count = context.nodes.length;
  rain.update(release()); rain.update(holding()); rain.setActive(true); rain.stop(); rain.reset();
  assert.equal(await rain.setSource('/next.mp3'), false); assert.equal(context.nodes.length, count);
  assert.equal(rain.getMetrics().rainLoopCount, 0); assert.ok(context.nodes.every(node => node.disconnected));
});
