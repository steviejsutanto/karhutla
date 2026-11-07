import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneWeatherAudio, BELL_NOTE_TRIM_DB } from '../app/phone-weather.js';
import { nationalPhoneInteraction, peatPhonePatches } from '../app/peat-phone.js';
import { COUNTRY_BOUNDS, countryPoint } from '../app/country-view.mjs';

class Parameter {
  constructor(value = 0) { this.value = value; this.events = []; this.automation = []; }
  cancelAndHoldAtTime(at) {
    const held = this.at(at); this.events.push(['hold', at]);
    this.automation = this.automation.filter(event => event[2] < at); this.automation.push(['set', held, at]);
  }
  cancelScheduledValues(at) { this.events.push(['cancel', at]); this.automation = this.automation.filter(event => event[2] < at); }
  _schedule(kind, value, at) { this.value = value; const event = [kind, value, at]; this.events.push(event); this.automation.push(event); }
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
    for (const name of ['gain', 'frequency', 'detune']) this[name] = new Parameter();
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
const hot = (patchKey = 'a') => ({ holding: true, patchKey, extinguished: false });
const out = (patchKey = 'a') => ({ holding: true, patchKey, extinguished: true });
const released = () => ({ holding: false, patchKey: null, extinguished: false });
function fixture(t, sampleRate = 48000) {
  const context = new Context(sampleRate), requests = [];
  const weather = new PhoneWeatherAudio({ context, destination: context.destination,
    fetchImpl: async url => { requests.push(url); throw new Error('Phones must never request rain.'); } });
  t.after(() => weather.destroy());
  return { context, weather, requests };
}
function audibleVoice(weather, context) {
  const voice = [...weather.bells].at(-1), at = context.currentTime + .029;
  assert.ok(voice, 'A real native voice exists for this bell edge.');
  assert.ok(voice.envelope.connections.includes(context.destination), 'The envelope reaches the parent phone master.');
  assert.ok(voice.envelope.gain.at(at) > voice.peak * .95, 'The newest envelope reaches its quiet peak before ringing down.');
  assert.ok(voice.oscillators.length > 0);
  for (let index = 0; index < voice.oscillators.length; index++) {
    const oscillator = voice.oscillators[index], level = voice.levels[index];
    assert.ok(oscillator.startedAt <= at && oscillator.stoppedAt > at, 'The oscillator is running while its envelope is audible.');
    const partial = voice.partials[index];
    assert.ok(oscillator.connections.includes(level));
    assert.ok(partial.motion ? level.connections.includes(partial.motion) && partial.motion.connections.includes(voice.envelope) : level.connections.includes(voice.envelope));
    assert.ok(level.gain.value > 0); assert.equal(oscillator.disconnected, false);
  }
  return voice;
}

test('phones never fetch, decode, allocate or play rain, including legacy source calls', async t => {
  const { weather, context, requests } = fixture(t);
  weather.setActive(true); weather.update(hot());
  assert.equal(await weather.setRainSource('/never-load-rain.mp3'), false);
  weather.update(released()); weather.setActive(false); weather.setActive(true);
  await Promise.resolve();
  assert.deepEqual(requests, []); assert.equal(context.decodes, 0); assert.equal(context.buffers, 0);
  assert.deepEqual(context.nodes, [], 'Idle and held hot ground need no native audio nodes.');
  assert.equal(weather.getMetrics().rainGain, 0); assert.equal(weather.getMetrics().rainLoopCount, 0);
  assert.equal(weather.getMetrics().loaded, false); assert.equal(weather.getMetrics().loading, false); assert.equal(weather.getMetrics().sourceUrl, null);
});

test('initial out state is silent, fresh out taps ring, packets and dragging into out stay silent', t => {
  const { weather, context } = fixture(t); weather.setActive(true);
  weather.update({ ...out('initial'), holding: false }); assert.equal(weather.getMetrics().bellsTriggered, 0);
  weather.update(out('a')); audibleVoice(weather, context);
  for (let index = 0; index < 30; index++) weather.update(out('a'));
  weather.update(out('b')); assert.equal(weather.getMetrics().bellsTriggered, 1);
  weather.update(released()); weather.update(hot('a')); weather.update(out('b'));
  assert.equal(weather.getMetrics().bellsTriggered, 1, 'Dragging to a different already-out patch never creates an extinction.');
  weather.update(hot('b')); weather.update(out('b')); audibleVoice(weather, context);
  assert.equal(weather.getMetrics().bellsTriggered, 2);
  weather.update(released()); weather.update(out('b')); assert.equal(weather.getMetrics().bellsTriggered, 3);
});

test('one uninterrupted hold rings for every actual hot-to-out transition, including reheated ground', t => {
  const { weather, context } = fixture(t); weather.setActive(true);
  for (let index = 0; index < 30; index++) {
    const key = `fire-${index % 4}`;
    weather.update(hot(key)); weather.update(out(key)); weather.update(out(key));
    assert.equal(weather.getMetrics().bellsTriggered, index + 1);
    audibleVoice(weather, context); context.advance(.03);
  }
  weather.update(hot('restored')); weather.update(out('restored'));
  assert.equal(weather.getMetrics().bellsTriggered, 31); audibleVoice(weather, context);
});

test('100 rapid press-release gestures keep audible voices after extinction and resources bounded', t => {
  const { weather, context } = fixture(t); weather.setActive(true);
  for (let index = 0; index < 100; index++) {
    weather.update(released()); weather.update(index % 2 ? hot('a') : out('a'));
    if (index % 2) weather.update(out('a'));
    assert.equal(weather.getMetrics().bellsTriggered, index + 1);
    audibleVoice(weather, context);
    assert.ok(weather.bells.size <= 8); assert.ok(weather.retiringBells.size <= 8);
    assert.ok(context.nodes.filter(node => node.kind === 'oscillator' && !node.disconnected).length <= 113);
    assert.equal(context.nodes.filter(node => node.kind === 'convolver' && !node.disconnected).length, 1, 'Every rapid tap shares one room.');
    context.advance(.03);
  }
  context.advance(16);
  assert.equal(weather.bells.size, 0); assert.equal(weather.retiringBells.size, 0);
  assert.ok(context.nodes.every(node => node.disconnected));
  weather.update(released()); weather.update(out()); audibleVoice(weather, context);
  assert.equal(weather.getMetrics().bellsTriggered, 101, 'Natural cleanup never disables later bells.');
});

test('fresh taps across fully extinguished brush footprints keep ringing outside the tiny source cell', t => {
  const { weather, context } = fixture(t); weather.setActive(true);
  const rows = [['440,-8', 110.125, -1.875, 0, true], ['443,-8', 110.875, -1.875, 0, true]];
  const patches = peatPhonePatches({ format: 'country-v1', bounds: COUNTRY_BOUNDS, cellSize: .25, patches: rows });
  for (let index = 0; index < 100; index++) {
    weather.update(released());
    const interaction = nationalPhoneInteraction(patches, countryPoint([index % 2 ? 111.2 : 110.3, -1.875]), { holding: true, eligible: true });
    assert.notEqual(interaction.patchKey, null, 'The rain brush still targets cooled sources.');
    weather.update(interaction); audibleVoice(weather, context); context.advance(.03);
  }
  assert.equal(weather.getMetrics().bellsTriggered, 100);
});

test('C3/G3 through C5/G5 keep equal C/G odds with fixed individual note calibration', t => {
  const { weather, context } = fixture(t), random = Math.random; weather.setActive(true);
  t.after(() => { Math.random = random; });
  const probabilities = [.17, .17, .22, .22, .11, .11];
  const heard = [], decays = [], peaks = []; let cursor = 0;
  for (const probability of probabilities) {
    Math.random = () => cursor + probability / 2;
    weather.update(released()); weather.update(out());
    const voice = audibleVoice(weather, context); heard.push(voice.midi); decays.push(voice.decaySeconds); peaks.push(voice.peak);
    assert.ok(voice.envelope.gain.events.some(event => event[0] === 'linear' && event[1] === voice.peak && event[2] === voice.at + .028));
    assert.ok(voice.envelope.gain.events.some(event => event[0] === 'exponential' && event[2] === voice.at + voice.decaySeconds));
    assert.equal(voice.oscillators[0].frequency.value, 440 * 2 ** ((voice.midi - 69) / 12));
    cursor += probability; context.advance(.03);
  }
  assert.deepEqual(heard, [48, 55, 60, 67, 72, 79]);
  assert.deepEqual(decays, [12, 12, 10, 10, 8, 8]);
  assert.deepEqual(peaks, [0, -2, 0, 2, 6, 6].map(db => .026 * 10 ** (db / 20)));
  assert.deepEqual(weather.getMetrics().bellNoteTrimsDb, { 48: 0, 55: -2, 60: 0, 67: 2, 72: 6, 79: 6 });
  assert.deepEqual(weather.getMetrics().bellNoteTrimsDb, BELL_NOTE_TRIM_DB);
  assert.deepEqual(weather.getMetrics().bellOctaveWeights.map(value => value.weight), [.34, .44, .22]);
  assert.deepEqual(weather.getMetrics().bellPitchMidi, heard);
  assert.deepEqual(weather.getMetrics().bellDecayRangeSeconds, [8, 12]);
  // A deterministic uniform grid also catches accidental uniform note selection.
  const counts = new Map();
  for (let index = 0; index < 2000; index++) {
    context.advance(16);
    Math.random = () => (index + .5) / 2000;
    weather.update(released()); weather.update(out());
    const midi = weather.getMetrics().lastBellMidi; counts.set(midi, (counts.get(midi) ?? 0) + 1);
  }
  assert.deepEqual([...counts.values()], [340, 340, 440, 440, 220, 220]);
});

test('low fundamentals have metallic phone-audible partials and full tails survive finger release', t => {
  const { weather, context } = fixture(t), random = Math.random; Math.random = () => 0; t.after(() => { Math.random = random; });
  weather.setActive(true); weather.update(out());
  const voice = audibleVoice(weather, context), envelope = voice.envelope.gain;
  assert.ok(voice.oscillators[0].frequency.value > 130 && voice.oscillators[0].frequency.value < 131);
  assert.deepEqual(voice.oscillators.map(node => node.frequency.value / voice.oscillators[0].frequency.value), [1, 2.71, 4.13, 6.4]);
  assert.equal(envelope.at(0), 0); assert.equal(envelope.at(.014), .013);
  assert.ok(envelope.at(.9) > .012, 'The low bell retains its body beyond the strike.');
  assert.ok(envelope.at(2.5) > .005); assert.ok(envelope.at(4) > .0015); assert.ok(envelope.at(5) > .0001);
  weather.update(released()); assert.equal(weather.getMetrics().currentBellVoices, 1);
  assert.equal(voice.oscillators[0].stoppedAt, 12.08, 'Release never truncates the scheduled natural decay.');
  assert.ok(voice.levels[1].gain.at(6) > .1, 'The second partial still contributes strongly halfway through the natural decay.');
  assert.ok(voice.levels[2].gain.at(6) > .03); assert.ok(voice.levels[3].gain.at(6) > .013);
  assert.equal(envelope.at(12.07), 0);
  context.advance(12.1); assert.equal(weather.getMetrics().currentBellVoices, 0);
  assert.equal(weather.getMetrics().bellReverb.active, true);
  assert.ok(weather.getMetrics().bellReverb.tailRemainingSeconds > 1);
  context.advance(1.5); assert.equal(weather.getMetrics().bellReverb.graphCount, 0);
  assert.ok(context.nodes.every(node => node.disconnected));
});

test('each retained inharmonic partial has slow native pitch and amplitude movement through mid-decay', t => {
  const { weather, context } = fixture(t), random = Math.random; Math.random = () => 0; t.after(() => { Math.random = random; });
  weather.setActive(true); weather.update(out()); const voice = audibleVoice(weather, context);
  assert.equal(voice.modulators.length, 3); assert.equal(voice.modulationNodes.length, 9);
  assert.equal(context.nodes.some(node => node.connections.includes(voice.oscillators[0].detune)), false, 'The fundamental pitch stays stable.');
  const rates = [];
  for (const partial of voice.partials.slice(1)) {
    const { modulator, pitchDepth, amplitudeDepth, motion, oscillator, level } = partial;
    assert.equal(modulator.type, 'sine'); rates.push(modulator.frequency.value);
    assert.ok(modulator.frequency.value > .1 && modulator.frequency.value < .4, 'A several-second native cycle moves the partial gently.');
    assert.deepEqual(modulator.connections, [pitchDepth, amplitudeDepth]);
    assert.deepEqual(pitchDepth.connections, [oscillator.detune]);
    assert.deepEqual(amplitudeDepth.connections, [motion.gain]);
    assert.ok(pitchDepth.gain.value > 0 && pitchDepth.gain.value < 3, 'Pitch motion remains only a few cents.');
    assert.ok(amplitudeDepth.gain.value > 0 && amplitudeDepth.gain.value < .1, 'Gentle amplitude motion cannot reverse or chop the partial.');
    assert.equal(motion.gain.value, 1); assert.deepEqual(level.connections, [motion]);
    assert.equal(modulator.startedAt, voice.at); assert.equal(modulator.stoppedAt, voice.at + voice.stopSeconds);
    assert.ok(level.gain.at(voice.decaySeconds / 2) > partial.amplitude * .24, 'Metallic partials retain useful energy halfway through the long decay.');
  }
  assert.equal(new Set(rates).size, 3, 'Independent rates prevent a single obvious vibrato or tremolo.');
  const nodes = context.nodes.length; context.advance(7);
  assert.equal(context.nodes.length, nodes, 'Native modulation continues without recurring JS node creation.');
  assert.ok(voice.modulators.every(node => !node.disconnected));
  weather.stop(); context.advance(.041);
  assert.ok([...voice.oscillators, ...voice.modulators, ...voice.modulationNodes].every(node => node.disconnected));
});

test('long low bell tails survive other strikes and bounded overflow always finishes its fade', t => {
  const { weather, context } = fixture(t), random = Math.random; Math.random = () => 0; t.after(() => { Math.random = random; });
  weather.setActive(true); assert.equal(weather.ring(), true); const first = [...weather.bells][0], originalStop = first.oscillators[0].stoppedAt;
  Math.random = () => .999;
  for (let index = 0; index < 7; index++) { context.advance(.15); assert.equal(weather.ring(), true); }
  assert.equal(first.oscillators[0].stoppedAt, originalStop, 'Seven subsequent strikes preserve the full earlier low tail.');
  assert.ok(first.envelope.gain.at(context.currentTime) > .01); assert.equal(first.disposed, undefined);
  for (let index = 0; index < 8; index++) assert.equal(weather.ring(), true);
  assert.equal(weather.bells.size, 8); assert.equal(weather.retiringBells.size, 8);
  const fading = [...weather.retiringBells], before = context.nodes.length;
  for (let index = 0; index < 1000; index++) assert.equal(weather.ring(), false);
  assert.equal(context.nodes.length, before, 'A burst cannot allocate beyond the bounded voices.');
  assert.equal(weather.getMetrics().bellsTriggered, 16);
  assert.ok(fading.every(voice => !voice.disposed), 'Saturation never disconnects a voice during its short release.');
  context.advance(.04); assert.ok(fading.every(voice => !voice.disposed));
  assert.ok(first.envelope.gain.at(context.currentTime) > 0);
  context.advance(.041); assert.ok(fading.every(voice => voice.disposed));
  assert.equal(weather.getMetrics().bellsTriggered, 16, 'Saturated strikes are consumed without a deferred replay.');
  assert.equal(weather.ring(), true); audibleVoice(weather, context);
  context.advance(16); assert.ok(context.nodes.every(node => node.disconnected));
});

test('the upper middle-register bell retains its metallic partials within every supported native bandwidth', t => {
  const random = Math.random; Math.random = () => .999; t.after(() => { Math.random = random; });
  for (const sampleRate of [22050, 32000, 48000, 96000]) {
    const { weather, context } = fixture(t, sampleRate); weather.setActive(true); weather.update(out());
    const voice = audibleVoice(weather, context);
    assert.equal(voice.midi, 79); assert.equal(voice.decaySeconds, 8); assert.equal(voice.peak, .026 * 10 ** (6 / 20));
    assert.ok(voice.oscillators.every(oscillator => oscillator.frequency.value < sampleRate * .45));
    assert.equal(voice.oscillators.length, 4);
    context.advance(10); assert.ok(context.nodes.every(node => node.disconnected));
  }
});

test('one fixed low-cost room has delayed reflections, bounded wet output and parent-master routing', t => {
  const { weather, context } = fixture(t); weather.setActive(true); weather.update(out());
  const room = weather.reverb, impulse = room.convolver.buffer, data = impulse.getChannelData(0);
  assert.equal(impulse.numberOfChannels, 1); assert.equal(impulse.sampleRate, context.sampleRate);
  assert.equal(impulse.length, 67200); assert.equal(room.convolver.normalize, false);
  assert.equal(room.send.gain.value, .18); assert.deepEqual(room.send.connections, [room.convolver]);
  assert.deepEqual(room.convolver.connections, [room.output]); assert.deepEqual(room.output.connections, [context.destination]);
  assert.deepEqual(room.clock.connections, [], 'The cleanup clock cannot produce audible sound.');
  assert.ok(data.slice(0, Math.floor(.016 * impulse.sampleRate)).every(value => value === 0), 'The dry attack stays clear.');
  assert.ok(data[Math.round(.017 * impulse.sampleRate)] > .27, 'Early reflections give the room an audible contribution.');
  assert.ok(data.slice(Math.floor(.2 * impulse.sampleRate), Math.floor(.4 * impulse.sampleRate)).some(value => value !== 0), 'A diffuse tail follows the early reflections.');
  const absoluteSum = data.reduce((sum, value) => sum + Math.abs(value), 0);
  assert.ok(absoluteSum > .99 && absoluteSum < 1.001);
  const highestPeak = Math.max(...weather.getMetrics().bellOctaveWeights.map(value => value.peak));
  const worstCasePeak = 16 * highestPeak * (1 + .24 * 1.053 + .11 * 1.071 + .055 * 1.089) * (1 + .18 * absoluteSum);
  assert.ok(worstCasePeak < 1.5, 'The calibrated coherent burst stays bounded in the float graph before Main protection; native output is checked separately.');
  assert.ok(weather.getMetrics().bellDecaySeconds >= 5 && weather.getMetrics().bellDecaySeconds <= 14);
  assert.equal(weather.getMetrics().bellReverb.durationSeconds, 1.4);
  context.advance(8); weather.update(released()); weather.update(out());
  assert.equal(weather.reverb.convolver.buffer, impulse, 'The static impulse is reused instead of regenerated for each gesture.');
});

test('native-style convolution accepts only matching context rates and stays bounded at 48 and 96 kHz', t => {
  for (const sampleRate of [48000, 96000]) {
    const { weather, context } = fixture(t, sampleRate), probe = context.createConvolver();
    assert.throws(() => { probe.buffer = context.createBuffer(1, 240, 24000); }, /sample rate must match/);
    probe.disconnect();
    weather.setActive(true); weather.update(out()); audibleVoice(weather, context);
    const impulse = weather.reverb.convolver.buffer, metrics = weather.getMetrics().bellReverb;
    assert.equal(impulse.sampleRate, sampleRate); assert.equal(metrics.impulseSampleRate, sampleRate);
    assert.equal(impulse.length, Math.ceil(1.4 * sampleRate));
    assert.ok(impulse.length * Float32Array.BYTES_PER_ELEMENT <= 537600, 'One mono native-rate impulse stays below 526 KiB even at 96 kHz.');
    assert.equal(metrics.graphCount, 1); assert.equal(weather.getMetrics().bellsTriggered, 1);
    context.advance(16); assert.ok(context.nodes.every(node => node.disconnected));
  }
});

test('mute and hidden suspension flush old dry and wet tails before resuming without replay', t => {
  const { weather, context } = fixture(t); weather.setActive(true); weather.update(out());
  const oldRoom = weather.reverb, oldVoice = audibleVoice(weather, context); context.advance(.7);
  weather.setActive(false);
  assert.equal(oldRoom.send.gain.at(context.currentTime), 0, 'New input into the old convolution history is cut immediately.');
  assert.equal(oldRoom.output.gain.at(context.currentTime + .04), 0, 'Existing wet history has a short release.');
  assert.equal(oldVoice.envelope.gain.at(context.currentTime + .04), 0);
  // Resume before any audio time passes, as when a browser suspends immediately.
  weather.setActive(true); weather.update(out());
  assert.equal(weather.getMetrics().bellsTriggered, 1); assert.equal(weather.getMetrics().bellReverb.graphCount, 0);
  assert.equal(oldRoom.convolver.buffer, null); assert.equal(oldRoom.output.disconnected, true);
  assert.equal(oldVoice.envelope.disconnected, true);
  weather.update(hot()); weather.update(out()); assert.equal(weather.getMetrics().bellsTriggered, 1);
  weather.update(released()); weather.update(out()); audibleVoice(weather, context);
  assert.equal(weather.getMetrics().bellsTriggered, 2); assert.notEqual(weather.reverb, oldRoom);
});

test('stop and reset drain the room in a short release and repeated reset remains bounded', t => {
  const { weather, context } = fixture(t); weather.setActive(true); weather.update(out());
  const impulse = weather.reverbImpulse, room = weather.reverb; context.advance(12.1);
  assert.equal(weather.getMetrics().currentBellVoices, 0, 'Only the wet tail remains when stop is called.');
  weather.stop(); context.advance(.05);
  assert.equal(room.output.disconnected, true); assert.equal(room.convolver.buffer, null);
  assert.equal(weather.getMetrics().bellReverb.graphCount, 0);
  weather.update(out()); assert.equal(weather.getMetrics().bellsTriggered, 1);
  for (let index = 0; index < 100; index++) {
    weather.reset(); weather.update(out());
    assert.ok(weather.getMetrics().bellReverb.graphCount <= 2);
    assert.ok(context.nodes.filter(node => node.kind === 'convolver' && !node.disconnected).length <= 2);
    assert.ok(weather.bells.size + weather.retiringBells.size <= 16);
    assert.equal(weather.reverbImpulse, impulse);
    context.advance(.001);
  }
  weather.reset(); context.advance(.05);
  assert.equal(weather.getMetrics().bellReverb.graphCount, 0);
  assert.equal(weather.bells.size + weather.retiringBells.size, 0);
  assert.ok(context.nodes.every(node => node.disconnected));
});

test('inactive, null-focus and ineligible edges are consumed without packet or unmute replay', t => {
  const { weather, context } = fixture(t);
  weather.update(out()); weather.setActive(true); weather.update(out()); assert.equal(weather.getMetrics().bellsTriggered, 0);
  weather.update(released()); weather.update({ ...out(), eligible: false }); weather.update(out()); assert.equal(weather.getMetrics().bellsTriggered, 0);
  weather.update(released()); weather.update({ ...out(), patchKey: null }); assert.equal(weather.getMetrics().bellsTriggered, 0);
  weather.update(released()); weather.update(hot()); weather.setActive(false); weather.update(out()); weather.setActive(true); weather.update(out());
  assert.equal(weather.getMetrics().bellsTriggered, 0);
  weather.update(released()); weather.update(out()); audibleVoice(weather, context); assert.equal(weather.getMetrics().bellsTriggered, 1);
  weather.setActive(false); context.advance(.05); assert.equal(weather.bells.size + weather.retiringBells.size, 0);
  weather.setActive(true); weather.update(out()); assert.equal(weather.getMetrics().bellsTriggered, 1);
  weather.update(released()); weather.update(hot()); weather.update(out()); audibleVoice(weather, context); assert.equal(weather.getMetrics().bellsTriggered, 2);
});

test('stop requires release, reset permits a fresh gesture and Safari fades from the current bell level', t => {
  const { weather, context } = fixture(t); weather.setActive(true); weather.update(out());
  const voice = audibleVoice(weather, context); voice.envelope.gain.cancelAndHoldAtTime = undefined;
  context.advance(.1); weather.stop();
  assert.ok(voice.envelope.gain.events.some(event => event[0] === 'set' && event[1] > 0 && event[1] < voice.peak));
  weather.update(hot()); weather.update(out()); assert.equal(weather.getMetrics().bellsTriggered, 1);
  context.advance(.1); assert.equal(weather.bells.size + weather.retiringBells.size, 0);
  weather.update(released()); weather.update(out()); audibleVoice(weather, context); assert.equal(weather.getMetrics().bellsTriggered, 2);
  weather.reset(); weather.update(out()); audibleVoice(weather, context); assert.equal(weather.getMetrics().bellsTriggered, 3);
});

test('destroy disconnects every owned native node and makes future interaction inert', async t => {
  const { weather, context } = fixture(t); weather.setActive(true);
  for (let index = 0; index < 8; index++) { weather.update(released()); weather.update(out()); }
  weather.destroy(); const count = context.nodes.length;
  weather.update(released()); weather.update(out('another')); weather.setActive(true); weather.reset(); weather.stop();
  assert.equal(await weather.setRainSource('/later.mp3'), false); assert.equal(context.nodes.length, count);
  assert.ok(context.nodes.every(node => node.disconnected)); assert.equal(weather.getMetrics().rainLoopCount, 0);
  assert.equal(weather.getMetrics().currentBellVoices, 0); assert.equal(weather.getMetrics().retiringBellVoices, 0);
});

test('a short high bell never shortens a preceding low bell room tail', t => {
  const { weather, context } = fixture(t), random = Math.random; t.after(() => { Math.random = random; });
  weather.setActive(true); Math.random = () => 0; weather.update(out()); const tail = weather.reverb.tailUntil;
  context.advance(.1); Math.random = () => .999; weather.update(released()); weather.update(out());
  assert.equal(weather.getMetrics().lastBellMidi, 79); assert.equal(weather.getMetrics().bellDecaySeconds, 8);
  assert.equal(weather.reverb.tailUntil, tail); context.advance(3); assert.equal(weather.getMetrics().bellReverb.active, true);
});

test('a bell arriving after the room clock ended gets a fresh room before the old ended event runs', t => {
  const { weather, context } = fixture(t); weather.setActive(true); weather.ring();
  const oldRoom = weather.reverb, delayedEnded = oldRoom.clock.onended;
  context.currentTime = oldRoom.tailUntil + .001; // The audio clock advanced while JS event dispatch was delayed.
  oldRoom.clock.ended = true;
  weather.ring(); const newRoom = weather.reverb;
  assert.notEqual(newRoom, oldRoom); assert.equal(oldRoom.disposed, true);
  delayedEnded(); assert.equal(weather.reverb, newRoom);
  assert.equal(newRoom.disposed, false); assert.ok(newRoom.clock.stoppedAt > context.currentTime);
  context.advance(16); assert.ok(context.nodes.every(node => node.disconnected));
});

test('legacy quench selection cannot request, decode or allocate samples on phones', async t => {
  const { weather, context, requests } = fixture(t);
  assert.equal(await weather.setQuenchSources([{ id: 'wood', url: '/quench-wood.mp3' }]), false);
  weather.setActive(true); weather.update(out());
  assert.equal(await weather.setQuenchSources([{ id: 'steam', url: '/quench-steam.mp3' }]), false);
  weather.update(released()); weather.update(out()); weather.setActive(false); weather.setActive(true);
  assert.deepEqual(requests, []); assert.equal(context.decodes, 0); assert.equal(context.buffers, 0);
  assert.equal(weather.getMetrics().bellsTriggered, 2); assert.equal(weather.getMetrics().quench, undefined);
});
