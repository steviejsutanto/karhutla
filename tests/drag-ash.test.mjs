import test from 'node:test';
import assert from 'node:assert/strict';
import { DragAshAudio, DRAG_ASH_LIMITS } from '../app/drag-ash.js';

class Parameter {
  constructor(value = 0) { this.value = value; this.events = []; }
  cancelAndHoldAtTime(at) { const value = this.at(at); this.events = this.events.filter(event => event.at < at && !(event.kind === 'curve' && event.at + event.duration > at)); this.events.push({ kind: 'set', value, at }); }
  cancelScheduledValues(at) { this.events = this.events.filter(event => event.at < at); }
  setValueAtTime(value, at) { this.value = value; this.events.push({ kind: 'set', value, at }); }
  setTargetAtTime(value, at, seconds) { const from = this.at(at); this.value = value; this.events.push({ kind: 'target', value, from, at, seconds }); }
  linearRampToValueAtTime(value, at) { this.value = value; this.events.push({ kind: 'linear', value, at }); }
  setValueCurveAtTime(values, at, duration) { this.events.push({ kind: 'curve', values: [...values], at, duration }); }
  at(time) {
    let value = 0, previousAt = 0;
    for (const event of this.events) {
      if (event.kind === 'linear' && time < event.at) return value + (event.value - value) * Math.max(0, (time - previousAt) / (event.at - previousAt));
      if (time < event.at) break;
      if (event.kind === 'curve') {
        if (time < event.at + event.duration) {
          const phase = (time - event.at) / event.duration * (event.values.length - 1), index = Math.floor(phase);
          return event.values[index] + (event.values[Math.min(index + 1, event.values.length - 1)] - event.values[index]) * (phase - index);
        }
        value = event.values.at(-1); previousAt = event.at + event.duration;
      } else if (event.kind === 'target') {
        value = event.value + (event.from - event.value) * Math.exp(-(time - event.at) / event.seconds); previousAt = event.at;
      } else { value = event.value; previousAt = event.at; }
    }
    return value;
  }
}
class Node {
  constructor(context, kind) { this.context = context; this.kind = kind; this.connections = []; this.gain = new Parameter(); this.playbackRate = new Parameter(1); context.nodes.push(this); }
  connect(node) { this.connections.push(node); }
  disconnect() { this.connections = []; this.disconnected = true; }
  start(at, offset, duration) { this.startArgs = [at, offset, duration]; }
  stop(at = this.context.currentTime) { this.stoppedAt = at; this.context.stops.add(this); }
}
class Context {
  constructor() { this.sampleRate = 2000; this.currentTime = 0; this.nodes = []; this.stops = new Set(); this.destination = {}; this.bufferAllocations = 0; }
  createGain() { return new Node(this, 'gain'); }
  createBufferSource() { return new Node(this, 'source'); }
  createBuffer(channels, length, sampleRate) {
    this.bufferAllocations++;
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: index => data[index] };
  }
  advance(seconds) {
    this.currentTime += seconds;
    for (const node of [...this.stops]) if (node.stoppedAt <= this.currentTime) { this.stops.delete(node); if (!node.ended) { node.ended = true; node.onended?.(); } }
  }
}
const contact = (position = [.2, .8], extra = {}) => ({ id: 'finger', holding: true, extinguished: true, position, ...extra });
function fixture(t, { active = true, channels = 2, seconds = 3, candidates: supplied } = {}) {
  const context = new Context(); let randomState = 812;
  const buffer = context.createBuffer(channels, context.sampleRate * seconds, context.sampleRate);
  for (let channel = 0; channel < channels; channel++) buffer.getChannelData(channel).fill(.1 * (channel + 1));
  let candidates = supplied ?? [{ id: 'verified-ash', buffer }], candidateReads = 0;
  const ash = new DragAshAudio({ context, destination: context.destination,
    getCandidates: () => { candidateReads++; return candidates; },
    makeSpatialPath: destination => { const input = context.createGain(), distance = context.createGain(); input.connect(distance); distance.connect(destination); return { input, distance, nodes: [input, distance] }; },
    positionPath: (space, position) => { space.position = [...position]; },
    random: () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; } });
  ash.configure({ active }); t.after(() => ash.destroy());
  return { ash, context, buffer, setCandidates: value => { candidates = value; }, reads: () => candidateReads };
}
function move(ash, context, from = [.2, .8], to = [.25, .75], extra = {}) {
  ash.update({ contacts: [contact(from, extra)] }); context.advance(.06);
  ash.update({ contacts: [contact(to, extra)] }); ash.tick();
}

test('taps, stationary holds, jitter, inactive contacts and non-authoritative terrain never create a grain', t => {
  const { ash, context, reads } = fixture(t, { active: false });
  move(ash, context); assert.equal(ash.getMetrics().scheduled, 0); assert.equal(reads(), 0);
  ash.configure({ active: true });
  ash.update({ contacts: [contact()] });
  for (let i = 0; i < 15; i++) { context.advance(.06); ash.update({ contacts: [contact([.2 + (i % 2) * .0001, .8])] }); ash.tick(); }
  assert.equal(ash.getMetrics().scheduled, 0);
  ash.update({ contacts: [] }); ash.tick(); context.advance(.06);
  ash.update({ contacts: [contact([.9, .1])] }); ash.tick(); assert.equal(ash.getMetrics().scheduled, 0);
  for (let i = 0; i < 6; i++) { context.advance(.06); ash.update({ contacts: [contact([.9 - i * .03, .1], { extinguished: false })] }); ash.tick(); }
  assert.equal(ash.getMetrics().scheduled, 0);
  assert.equal(context.nodes.filter(node => node.kind === 'source').length, 0);
  ash.update({ contacts: [contact([NaN, .1])] }); context.advance(.06);
  ash.update({ contacts: [contact([.4, .4])] }); ash.tick(); assert.equal(ash.getMetrics().scheduled, 0);
});

test('motion creates sharp short mono grains with click-free two-millisecond attacks and varied sample positions and rates', t => {
  const { ash, context } = fixture(t);
  move(ash, context);
  const first = [...ash.grains]; assert.ok(first.length >= 2 && first.length <= 3);
  for (const grain of first) {
    assert.equal(grain.source.loop, false); assert.equal(grain.source.buffer.numberOfChannels, 1);
    assert.ok(grain.duration >= .028 && grain.duration <= .065);
    assert.ok(grain.rate >= .82 && grain.rate < 1.18);
    assert.ok(grain.offset >= 0 && grain.offset + grain.duration * grain.rate <= grain.source.buffer.duration);
    assert.deepEqual(grain.source.startArgs, [grain.at, grain.offset, grain.duration * grain.rate]);
    assert.deepEqual(grain.source.connections, [grain.envelope]);
    assert.deepEqual(grain.envelope.connections, [grain.space.input]);
    assert.deepEqual(grain.space.distance.connections, [ash.output]);
    assert.deepEqual(ash.output.connections, [context.destination]);
    assert.deepEqual(grain.space.position, [.25, .75]); assert.equal(grain.space.input.channelCount, 1);
    const curve = grain.envelope.gain.events.find(event => event.kind === 'curve');
    assert.equal(curve.values.length, 65); assert.equal(curve.values[0], 0); assert.equal(curve.values.at(-1), 0);
    const peak = Math.max(...curve.values), index = curve.values.indexOf(peak);
    assert.ok(peak > grain.peak * .95);
    assert.ok(Math.abs(index / 64 * grain.duration - .002) < .001);
    assert.ok(curve.values[32] < peak * .3, 'The short grain has a pronounced attack and a declining tail.');
    for (let i = 0; i < index; i++) assert.ok(curve.values[i] <= curve.values[i + 1]);
    for (let i = index; i < 64; i++) assert.ok(curve.values[i] >= curve.values[i + 1]);
  }
  assert.ok(first[1].at < first[0].at + first[0].duration);
  assert.ok(new Set(first.map(grain => grain.offset)).size > 1);
  assert.ok(new Set(first.map(grain => grain.rate)).size > 1);
  assert.ok(new Set(first.map(grain => grain.duration)).size > 1);
  assert.ok(ash.getMetrics().actors[0].speed > 0);
});

test('spatial paths follow out-terrain drag, hold their last out position, and release to silence after stopping', t => {
  const { ash, context } = fixture(t);
  move(ash, context); const initial = [...ash.grains];
  context.advance(.06); ash.update({ contacts: [contact([.4, .7])] }); ash.tick();
  for (const grain of initial) if (!grain.disposed) assert.deepEqual(grain.space.position, [.4, .7]);
  const energy = ash.getMetrics().actors[0].energy;
  context.advance(.06); ash.update({ contacts: [contact([.65, .65], { extinguished: false })] }); ash.tick();
  assert.ok(ash.getMetrics().actors[0].energy < energy);
  for (const grain of ash.grains) assert.deepEqual(grain.space.position, [.4, .7]);
  for (let i = 0; i < 7; i++) { context.advance(.06); ash.update({ contacts: [contact([.65 + i * .01, .65], { extinguished: false })] }); ash.tick(); }
  const scheduled = ash.getMetrics().scheduled;
  assert.equal(ash.getMetrics().movingActors, 0);
  context.advance(.22); ash.tick(); assert.equal(ash.getMetrics().currentGrains, 0);
  assert.equal(ash.getMetrics().scheduled, scheduled);
  assert.ok(initial.every(grain => grain.disposed && grain.source.buffer === null));
  assert.ok(initial.every(grain => grain.source.disconnected && grain.envelope.disconnected && grain.space.nodes.every(node => node.disconnected)));
});

test('stationary repeats and missing pointer-up decay without refreshing movement, and stale updates cannot produce a burst', t => {
  const { ash, context } = fixture(t);
  move(ash, context);
  for (let i = 0; i < 9; i++) { context.advance(.06); ash.update({ contacts: [contact([.25, .75])] }); ash.tick(); }
  assert.equal(ash.getMetrics().movingActors, 0);
  context.advance(.2); ash.tick(); assert.equal(ash.getMetrics().currentGrains, 0);
  const scheduled = ash.getMetrics().scheduled;
  context.advance(7); ash.update({ contacts: [contact([.8, .2])] }); ash.tick();
  assert.equal(ash.getMetrics().scheduled, scheduled);
  context.advance(.06); ash.update({ contacts: [contact([.84, .2])] }); ash.tick();
  assert.ok(ash.getMetrics().scheduled > scheduled);
  ash.update({ contacts: [] });
  context.advance(.7); ash.tick(); assert.equal(ash.getMetrics().currentGrains, 0); assert.equal(ash.getMetrics().trackedActors, 0);
});

test('shared mono asset preparation is bounded, reused across actors and replaces stale cache entries', t => {
  const { ash, context, buffer, setCandidates } = fixture(t, { seconds: 40 });
  ash.tick(); const mono = ash.bank[0].buffer;
  assert.equal(mono.numberOfChannels, 1); assert.equal(mono.duration, 32);
  assert.ok(Math.abs(mono.getChannelData(0)[0] - .18) < 1e-7);
  assert.ok(Math.abs(buffer.getChannelData(0)[0] - .1) < 1e-7, 'Shared ambient assets are never modified.');
  const allocations = context.bufferAllocations;
  const contacts = Array.from({ length: 100 }, (_, id) => contact([.2, .2], { id }));
  ash.update({ contacts }); context.advance(.06);
  ash.update({ contacts: contacts.map(contact => ({ ...contact, position: [.25, .25] })) }); ash.tick();
  assert.equal(context.bufferAllocations, allocations); assert.equal(ash.cache.get(buffer), mono);
  assert.equal(ash.getMetrics().trackedActors, DRAG_ASH_LIMITS.actors);
  const replacements = Array.from({ length: 10 }, (_, index) => ({ id: `asset-${index}`, buffer: context.createBuffer(1, 2000, 2000) }));
  setCandidates(replacements); ash.tick();
  assert.equal(ash.getMetrics().cacheEntries, DRAG_ASH_LIMITS.assets); assert.equal(ash.cache.has(buffer), false);
  assert.ok(ash.bank.every(asset => asset.buffer !== asset.source && asset.buffer.numberOfChannels === 1));
  setCandidates([replacements[0], replacements[0], { buffer, weight: 0 }, { buffer: { ...buffer, sampleRate: 44100 } }]);
  ash.tick(); assert.equal(ash.getMetrics().assetCount, 1);
  setCandidates([]); ash.tick(); assert.equal(ash.getMetrics().cacheEntries, 0); assert.equal(ash.getMetrics().loaded, false);
});

test('many moving participants share a fair bounded global pool and conservative headroom', t => {
  const { ash, context } = fixture(t, { channels: 1 });
  const contacts = Array.from({ length: 100 }, (_, id) => contact([.1, .1], { id }));
  ash.configure({ participantCount: 100, weight: 2 }); ash.update({ contacts });
  let peakSources = 0; const heard = new Set();
  for (let tick = 0; tick < 40; tick++) {
    context.advance(.06);
    ash.update({ contacts: contacts.map(contact => ({ ...contact, position: [.1 + tick % 10 * .04, .1] })) }); ash.tick();
    const metrics = ash.getMetrics();
    assert.ok(metrics.currentGrains <= DRAG_ASH_LIMITS.grains); assert.equal(metrics.crowdGain, .1);
    assert.ok(Math.abs(metrics.gain - .14) < 1e-12);
    const live = context.nodes.filter(node => node.kind === 'source' && !node.disconnected);
    peakSources = Math.max(peakSources, live.length); assert.ok(live.length <= DRAG_ASH_LIMITS.grains);
    for (const grain of ash.grains) heard.add(grain.actorId);
    const worstCase = metrics.grains.reduce((sum, grain) => sum + grain.peak, 0) * metrics.gain * DRAG_ASH_LIMITS.recordingPeak;
    assert.ok(worstCase <= .36 + 1e-9);
  }
  assert.ok(peakSources > 0); assert.ok(heard.size > 20); assert.ok(ash.getMetrics().skipped > 0);
  assert.ok(DRAG_ASH_LIMITS.grains * DRAG_ASH_LIMITS.peak * DRAG_ASH_LIMITS.outputGain * 2 * DRAG_ASH_LIMITS.recordingPeak < 4,
    'Even an impossible coherent pool retains headroom in the protected output range.');
});

test('stop, mute, reset and destroy remove scheduled work and dispose all routing nodes and buffers', t => {
  const { ash, context } = fixture(t);
  move(ash, context); const allGrains = [...ash.grains]; context.advance(.025);
  ash.stop(); assert.equal(ash.getMetrics().trackedActors, 0);
  assert.ok([...ash.grains].every(grain => grain.fading));
  for (const grain of ash.grains) assert.equal(grain.envelope.gain.at(context.currentTime + .04), 0);
  context.advance(.05); ash.tick(); assert.equal(ash.getMetrics().currentGrains, 0);
  assert.ok(allGrains.every(grain => grain.source.buffer === null));
  move(ash, context); context.advance(.015); ash.configure({ active: false });
  assert.equal(ash.getMetrics().active, false); assert.equal(ash.getMetrics().gain, 0);
  // Reactivation while the audio clock is suspended drains the unfinished fade.
  ash.configure({ active: true }); assert.equal(ash.getMetrics().currentGrains, 0);
  ash.update({ contacts: [contact([.8, .2])] }); ash.tick();
  assert.equal(ash.getMetrics().currentGrains, 0);
  ash.reset(); assert.equal(ash.getMetrics().active, false);
  ash.destroy(); ash.destroy(); assert.ok(context.nodes.every(node => node.disconnected));
  assert.equal(ash.getMetrics().cacheEntries, 0);
  ash.configure({ active: true }); ash.update({ contacts: [contact()] }); ash.tick(); assert.equal(ash.getMetrics().currentGrains, 0);
});

test('legacy AudioParams cancel the original native curve before adding a stop ramp', t => {
  const { ash, context } = fixture(t); move(ash, context); context.advance(.015);
  const grain = [...ash.grains][0]; grain.envelope.gain.cancelAndHoldAtTime = undefined;
  ash.stop();
  assert.equal(grain.envelope.gain.events.some(event => event.kind === 'curve'), false);
  assert.ok(grain.envelope.gain.events.some(event => event.kind === 'set' && event.at === context.currentTime && event.value > 0));
  assert.equal(grain.envelope.gain.at(context.currentTime + .04), 0);
});
