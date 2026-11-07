import test from 'node:test';
import assert from 'node:assert/strict';
import { PatchSoftToneAudio, PATCH_PENTATONIC_MIDI, PATCH_PENTATONIC_RATIOS, PATCH_TUNING_CENTS, PATCH_SOFT_TONE_LEVEL, PATCH_TONE_EXIT_SECONDS, PATCH_TEXTURE_SOURCE_LIMIT, PATCH_TEXTURE_ADMISSION_SECONDS,
  patchMidi, patchFrequencyForMidi, patchLowRegisterBodyLevel, patchTuningCents, patchResidueId, patchResidueTreatment, patchResiduePitch, patchResidueTransposeProbability, patchResidueEnvelope, patchSoftToneParameters, patchTextureLevel, patchTextureRecordingParameters } from '../app/patch-soft-tones.js';
import { patchHeldToneMotionDepth, PATCH_HELD_MOTION_DEPTH, PATCH_HELD_MOTION_START_SECONDS, PATCH_HELD_MOTION_RISE_SECONDS } from '../app/patch-soft-tones.js';
import { RainSimulation } from '../app/simulation.js';
import { SharedRoom } from '../app/shared-room.mjs';
import { createParticipantSoundField, patchSoundVoices } from '../app/sound-participants.js';

class Param {
  constructor(value = 0) { this.value = value; this.events = []; this.timeline = []; }
  at(now) {
    let value = this.origin ?? this.value;
    for (const event of this.timeline) {
      if (event.at > now) break;
      if (event.type === 'target') value = event.value + (event.from - event.value) * Math.exp(-(now - event.at) / event.seconds);
      else if (event.type === 'curve') {
        const index = Math.min(1, (now - event.at) / event.seconds) * (event.curve.length - 1), left = Math.floor(index);
        value = event.curve[left] + (event.curve[Math.min(left + 1, event.curve.length - 1)] - event.curve[left]) * (index - left);
      } else value = event.value;
    }
    return value;
  }
  cancelAndHoldAtTime(at) {
    const value = this.at(at); this.cancelScheduledValues(at); this.timeline.push({ type: 'set', value, at }); this.events.push(['hold', at]);
  }
  cancelScheduledValues(at) { this.origin ??= this.value; this.timeline = this.timeline.filter(event => event.at < at); this.events.push(['cancel', at]); }
  setValueAtTime(value, at) { this.origin ??= this.value; this.timeline.push({ type: 'set', value, at }); this.value = value; this.events.push(['set', value, at]); }
  setTargetAtTime(value, at, seconds) { const from = this.at(at); this.origin ??= this.value; this.timeline.push({ type: 'target', value, from, at, seconds }); this.value = value; this.events.push(['target', value, at, seconds]); }
  linearRampToValueAtTime(value, at) { this.events.push(['linear', value, at]); }
  setValueCurveAtTime(curve, at, seconds) { this.origin ??= this.value; this.timeline.push({ type: 'curve', curve, at, seconds }); this.events.push(['curve', curve, at, seconds]); }
}
class Node {
  constructor(context) {
    this.context = context; this.connections = [];
    for (const name of ['gain', 'frequency', 'detune', 'Q', 'pan', 'playbackRate']) this[name] = new Param();
  }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.disconnected = true; this.connections = []; }
  start(at, offset = 0) { this.startedAt = at; this.offset = offset; }
  stop(at = this.context.currentTime) { this.stoppedAt = at; this.context.stops.add(this); }
}
class Context {
  constructor() { this.currentTime = 0; this.sampleRate = 48000; this.stops = new Set(); this.sources = []; }
  createGain() { return new Node(this); }
  createBiquadFilter() { return new Node(this); }
  createOscillator() { return new Node(this); }
  createBufferSource() { const source = new Node(this); this.sources.push(source); return source; }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, sampleRate, length, duration: length / sampleRate, getChannelData: channel => data[channel] };
  }
  advance(seconds) {
    this.currentTime += seconds;
    for (const node of this.stops) if (node.stoppedAt <= this.currentTime && !node.ended) {
      node.ended = true; this.stops.delete(node); node.onended?.();
    }
  }
}
const patch = (key, values = {}) => ({ key, holding: true, position: [.2, .7], heat: .01, moisture: 1, surfaceWetness: 1, extinguished: false, ...values });
function harness({ candidates = 1, reverb = false, areaMode = false, random = () => .9 } = {}) {
  const context = new Context(), destination = context.createGain(), reverbDestination = reverb ? context.createGain() : null;
  const recording = context.createBuffer(2, 48000, 48000);
  for (let channel = 0; channel < 2; channel++) for (let i = 0; i < recording.length; i++) {
    recording.getChannelData(channel)[i] = .025 * (Math.sin(i * .11 + channel * .2) + .3 * Math.sin(i * .773));
  }
  const audio = new PatchSoftToneAudio({ context, destination, textureDestination: destination, textureReverbDestination: reverbDestination, areaMode, random,
    makeSpatialPath: bus => {
      const input = context.createGain(), panner = context.createGain(), distance = context.createGain();
      input.connect(panner); panner.connect(distance); distance.connect(bus);
      return { input, panner, distance, mode: 'stereo', nodes: [input, panner, distance] };
    },
    prepareLoop: buffer => buffer,
    getTextureCandidates: id => Array.from({ length: candidates }, (_, index) => ({ url: candidates === 1 ? `/${id}.wav` : `/${id}-${index}.wav`, buffer: recording })),
  });
  audio.configure({ enabled: true });
  return { audio, context, destination, reverbDestination, recording };
}
const curveAt = (record, at) => {
  const index = Math.max(0, Math.min(record.curve.length - 1, (at - record.at) / record.duration * (record.curve.length - 1)));
  const left = Math.floor(index);
  return record.curve[left] + (record.curve[Math.min(left + 1, record.curve.length - 1)] - record.curve[left]) * (index - left);
};

test('long-held motion leaves short notes unchanged, eases into clearly audible motion and never retunes pitch', () => {
  assert.equal(PATCH_HELD_MOTION_START_SECONDS, 4); assert.equal(PATCH_HELD_MOTION_RISE_SECONDS, 1);
  for (const age of [-1, 0, 3, 3.9, 4]) assert.equal(patchHeldToneMotionDepth(age), 0);
  assert.equal(patchHeldToneMotionDepth(4.5), PATCH_HELD_MOTION_DEPTH / 2);
  assert.equal(patchHeldToneMotionDepth(5), .32); assert.equal(patchHeldToneMotionDepth(600), .32);
  const { audio, context } = harness({ areaMode: true });
  audio.setPatches([patch('long-a'), patch('long-b')]);
  const first = audio.voices.get('long-a'), second = audio.voices.get('long-b');
  const identity = first.motionOscillator, automation = first.motionDepth.gain.events.slice();
  assert.equal(first.motionGain.gain.value, 1);
  assert.equal(first.motionOscillator.frequency.value, first.motionFrequencyHz);
  assert.ok(first.motionFrequencyHz >= .32 && first.motionFrequencyHz < .42);
  assert.notEqual(first.motionFrequencyHz, second.motionFrequencyHz);
  assert.notEqual(first.motionOscillator.startedAt, second.motionOscillator.startedAt);
  for (const voice of [first, second]) assert.ok(voice.motionOscillator.startedAt >= 4 && voice.motionOscillator.startedAt < 4.15,
    'A newly held area starts a common breath, with small per-patch timing differences.');
  context.advance(25);
  for (let i = 0; i < 20; i++) audio.setPatches([patch('long-a'), patch('long-b')]);
  assert.equal(audio.voices.get('long-a'), first); assert.equal(first.motionOscillator, identity);
  assert.deepEqual(first.motionDepth.gain.events, automation, 'Repeated packets do not restart movement or add automation.');
  assert.equal(audio.getMetrics().voices[0].motionDepth, .32);
  assert.ok(first.oscillators.every(node => node.frequency.events.length === 0));
  audio.stop(); assert.ok(first.motionOscillator.disconnected && first.motionDepth.disconnected && first.motionGain.disconnected);
});

test('release before four seconds cancels the future motion without a late restart', () => {
  for (const completion of [false, true]) {
    const { audio, context } = harness({ areaMode: completion });
    const key = `early-motion-${completion}`; audio.setPatches([patch(key)]);
    const voice = audio.voices.get(key), start = voice.motionOscillator.startedAt;
    context.advance(1);
    if (completion) {
      audio.setPatches([patch(key, { extinguished: true, heat: 0 })]);
      assert.equal(audio.triggerAreaExtinction({ id: 'early-complete', key, memberKeys: [key] }), true);
    } else audio.setPatches([]);
    assert.equal(voice.motionStop.depth, 0);
    assert.ok(voice.motionOscillator.stoppedAt < start, 'A short gesture stops the future LFO before it can start.');
    context.advance(8); audio.tick();
    assert.equal(audio.getMetrics().voices.length, 0);
    assert.ok(voice.disposed && voice.motionOscillator.disconnected);
    audio.stop();
  }
});

test('motion fades out at release or completion without extending the finite pitched exit', () => {
  for (const completion of [false, true]) {
    const { audio, context } = harness({ areaMode: completion });
    const key = `motion-exit-${completion}`; audio.setPatches([patch(key)]); context.advance(25); audio.tick();
    const voice = audio.voices.get(key), at = context.currentTime;
    if (completion) {
      audio.setPatches([patch(key, { extinguished: true, heat: 0 })]);
      assert.equal(audio.triggerAreaExtinction({ id: 'complete-motion', key, memberKeys: [key] }), true);
    } else audio.setPatches([]);
    assert.equal(voice.motionStop.at, at); assert.equal(voice.motionStop.depth, .32);
    assert.ok(voice.motionDepth.gain.events.some(event => event[0] === 'set' && event[1] === .32 && event[2] === at), 'Release anchors the held depth before its fade, even with native cancel-and-hold.');
    assert.ok(voice.motionDepth.gain.events.some(event => event[0] === 'linear' && event[1] === 0 && event[2] === at + .2));
    assert.equal(voice.motionOscillator.stoppedAt, voice.oscillators[0].stoppedAt);
    assert.ok(voice.motionOscillator.stoppedAt <= at + PATCH_TONE_EXIT_SECONDS + .02);
    context.advance(2.3); audio.tick();
    assert.ok(voice.disposed); assert.ok(voice.motionOscillator.disconnected && voice.motionDepth.disconnected && voice.motionGain.disconnected);
    audio.stop();
  }
});

test('long-held modulation follows the existing native voice budget through replacement and reset', () => {
  const { audio, context } = harness({ areaMode: true });
  audio.setPatches(Array.from({ length: 128 }, (_, i) => patch(`motion-crowd-${i}`)));
  assert.equal(audio.voices.size, 32);
  const voices = [...audio.voices.values()];
  assert.equal(new Set(voices.map(voice => voice.motionOscillator)).size, 32);
  context.advance(30); audio.tick();
  assert.equal(audio.voices.size, 32);
  audio.setPatches(Array.from({ length: 128 }, (_, i) => patch(`motion-next-${i}`)));
  assert.ok(audio.voices.size + audio.tails.size + audio.handoffTails.size <= 96);
  const all = [...voices, ...audio.voices.values(), ...audio.tails, ...audio.handoffTails];
  audio.reset();
  assert.ok(all.every(voice => voice.motionOscillator.disconnected && voice.motionGain.disconnected && voice.motionDepth.disconnected));
  assert.equal(audio.voices.size + audio.tails.size + audio.handoffTails.size + audio.morphVoices.size, 0);
});

// Independently render a settled sine pair through the actual low-pass
// equation. This catches the old coefficient match that hid a 20 dB RMS drop.
function filteredToneRms(midi, withBody = true) {
  const sampleRate = 48000, frequency = patchFrequencyForMidi(midi), omega = 2 * Math.PI * frequency * 2.2 / sampleRate;
  const cosine = Math.cos(omega), alpha = Math.sin(omega) / (2 * 10 ** (-3 / 20)), denominator = 1 + alpha;
  const b0 = (1 - cosine) / (2 * denominator), b1 = 2 * b0, b2 = b0, a1 = -2 * cosine / denominator, a2 = (1 - alpha) / denominator;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, power = 0;
  for (let i = 0; i < sampleRate * 2; i++) {
    const phase = 2 * Math.PI * frequency * i / sampleRate;
    const input = PATCH_SOFT_TONE_LEVEL * (Math.sin(phase) + .04 * Math.sin(2 * phase));
    const output = b0 * input + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = input; y2 = y1; y1 = output;
    const body = withBody ? PATCH_SOFT_TONE_LEVEL * patchLowRegisterBodyLevel(frequency) * Math.sin(4 * phase) : 0;
    if (i >= sampleRate) power += (output + body) ** 2;
  }
  return Math.sqrt(power / sampleRate);
}

test('the fixed pentatonic pitches use subtle harmonic tuning, with exact octaves and no gesture retuning', () => {
  const anchor = 440 * 2 ** ((25 - 69) / 12);
  for (const [index, midi] of PATCH_PENTATONIC_MIDI.entries()) {
    const degree = index % 5, octave = Math.floor(index / 5);
    assert.ok(Math.abs(patchFrequencyForMidi(midi) / anchor / 2 ** octave - PATCH_PENTATONIC_RATIOS[degree]) < 1e-12);
    assert.equal(patchTuningCents(midi), PATCH_TUNING_CENTS[degree]);
    assert.ok(Math.abs(patchTuningCents(midi)) < 16);
  }
  assert.ok(PATCH_TUNING_CENTS.filter(cents => Math.abs(cents) > 10).length === 2, 'Third and sixth receive a small audible shade.');
  assert.equal(patchFrequencyForMidi(97), patchFrequencyForMidi(25) * 64, 'D♭ octaves remain anchored.');
  const { audio, context } = harness();
  const key = Array.from({ length: 100 }, (_, index) => `tuned-${index}`).find(key => Math.abs(patchTuningCents(patchMidi(key))) > 10);
  audio.setPatches([patch(key)]);
  const voice = audio.voices.get(key), frequency = voice.frequency;
  assert.equal(frequency, patchFrequencyForMidi(voice.midi));
  assert.deepEqual(voice.oscillators.map(node => node.frequency.value), [frequency, frequency * 2]);
  context.advance(1);
  audio.setPatches([patch(key, { position: [.9, .1], heat: .1, moisture: .8 })]);
  audio.setPatches([patch(key, { extinguished: true, heat: 0, holding: false })]);
  assert.equal(audio.morphVoices.get(key), voice);
  assert.equal(voice.frequency, frequency);
  assert.ok(voice.oscillators.every(node => node.frequency.events.length === 0), 'Drag and cooling change the envelope rather than the assigned pitch.');
  audio.reset(); audio.setPatches([patch(key)]);
  assert.equal(audio.voices.get(key).frequency, frequency, 'Reload/reset restores the same tuning for the patch.');
});

test('every focused Db1–Db7 note and each fully emerged filtered material retain matched RMS', () => {
  const { audio, recording } = harness();
  assert.equal(PATCH_SOFT_TONE_LEVEL, .012);
  for (const id of ['ash', 'moisture', 'haze']) {
    const conditioned = audio._loopBuffer(recording, id, `/${id}.wav`);
    const textureRms = patchTextureRecordingParameters(conditioned, id).filteredRms * patchTextureLevel(id);
    const expectedRms = .008 * 10 ** ((id === 'moisture' ? -2 : id === 'haze' ? 1 : 0) / 20);
    assert.ok(Math.abs(textureRms - expectedRms) < 1e-7);
    for (const midi of PATCH_PENTATONIC_MIDI) {
      const toneRms = filteredToneRms(midi);
      assert.ok(Math.abs(20 * Math.log10(textureRms / toneRms)) < (id === 'moisture' ? 2.6 : id === 'haze' ? 1.6 : .6), `${id}, MIDI ${midi}: energy follows the gentle listening trim.`);
    }
  }
});

test('low notes carry a stable quiet octave body without brightening upper notes or changing their assigned pitch', () => {
  const { audio, context } = harness();
  const keys = Array.from({ length: 500 }, (_, index) => `low-body-${index}`);
  const low = keys.find(key => patchMidi(key) === 25), high = keys.find(key => patchMidi(key) === 97);
  audio.setPatches([patch(low), patch(high)]);
  const voice = audio.voices.get(low), body = voice.bodyOscillator, frequency = patchFrequencyForMidi(25);
  assert.equal(body.frequency.value, frequency * 4); assert.equal(body.type, 'sine');
  assert.deepEqual(body.connections, [voice.bodyGain]); assert.deepEqual(voice.bodyGain.connections, [voice.gain]);
  assert.equal(voice.bodyGain.gain.value, .22); assert.equal(audio.voices.get(high).bodyOscillator, null);
  for (const midi of PATCH_PENTATONIC_MIDI) assert.ok(20 * Math.log10(filteredToneRms(midi) / filteredToneRms(midi, false)) < .5);
  context.advance(.5); audio.setPatches([patch(low, { heat: .9, moisture: .2 })]);
  assert.equal(voice.bodyOscillator, body); assert.equal(body.frequency.events.length, 0);
  assert.ok(voice.bodyGain.gain.at(context.currentTime + 4) < .15, 'The body follows the same focus as its fundamental.');
  audio.setPatches([]); assert.equal(body.stoppedAt, voice.oscillators[0].stoppedAt);
  context.advance(1.3); assert.ok(body.disconnected && voice.bodyGain.disconnected);
});

test('the fastest real cooling reveals its native note before extinction without increasing its calibrated peak', () => {
  const { audio, context } = harness();
  const simulation = new RainSimulation({ deepCoolingSeconds: 2, extinctionHoldSeconds: 0 });
  const point = [110.125, -2.125], key = '440,-9';
  simulation.seed([{ longitude: point[0], latitude: point[1] }]);
  const snapshot = () => patch(key, { ...simulation.cells.get(key), holding: true });
  audio.configure({ participantCount: 1 }); audio.setPatches([snapshot()]);
  const voice = audio.voices.get(key), heard = [];
  for (let tick = 0; tick < 120 && !simulation.cells.get(key).extinguished; tick++) {
    context.advance(.06); simulation.step(.06, [{ path: [point], strength: 1 }]);
    audio.setPatches([snapshot()]);
    if (!simulation.cells.get(key).extinguished) heard.push({ at: context.currentTime, heat: simulation.cells.get(key).heat, gain: voice.gain.gain.at(context.currentTime) });
  }
  assert.equal(simulation.cells.get(key).extinguished, true);
  const early = heard.find(frame => frame.heat < .8);
  assert.ok(early.gain > PATCH_SOFT_TONE_LEVEL * .18, `The confirmed cooling front is already audible at ${early.at.toFixed(2)}s.`);
  assert.ok(heard.find(frame => frame.heat < .5).gain > PATCH_SOFT_TONE_LEVEL * .7, 'The tone emerges with the ground instead of waiting until out.');
  assert.ok(heard.every(frame => frame.gain >= 0 && frame.gain <= PATCH_SOFT_TONE_LEVEL));
  assert.equal(voice.midi, patchMidi(key)); assert.equal(audio.morphVoices.get(key), voice);
  assert.ok(voice.morphFrom > PATCH_SOFT_TONE_LEVEL * .95);
  assert.equal(patchSoftToneParameters({ heat: 1, moisture: 0, surfaceWetness: 1 }).gain, 0, 'Wet skin alone never creates a pitch.');
});

test('a single real released phone tap still reveals its note when Main never observed the held actor', async () => {
  const { audio, context } = harness({ areaMode: true }), point = [110.125, -2.125], key = '440,-9';
  const time = { now: 0 }, room = new SharedRoom({ records: [{ longitude: point[0], latitude: point[1] }], clock: () => time.now });
  await room.initialize(); await room.bootstrap({ state: null, strength: .5 }); await room.setScene({ scene: 'participation' });
  const phone = room.connect({ clientId: 'brief-phone', role: 'participant', scope: 'indonesia' });
  const snapshot = () => {
    const patches = room.wireState().simulation.cells.map(([longitude, latitude, surfaceWetness, moisture, heat, extinguished, , hasFire]) =>
      ({ longitude, latitude, surfaceWetness, moisture, heat, extinguished, hasFire }));
    return patchSoundVoices(room.actorState().participants, createParticipantSoundField(patches));
  };
  audio.setPatches(snapshot()); assert.equal(audio.voices.size, 0);
  room.hold(phone.connectionId, { type: 'hold', epoch: room.epoch, seq: 0, start: true, holding: true, space: 'country', position: [(point[0] - 94) / 48, (7 - point[1]) / 19] });
  time.now = 300; context.advance(.3);
  room.hold(phone.connectionId, { type: 'hold', epoch: room.epoch, seq: 1, holding: false, space: 'country' });
  const released = snapshot(), source = released.find(value => value.key === key);
  assert.equal(source.holding, false); assert.ok(source.heat < 1 && source.heat > .99); assert.equal(source.extinguished, false);
  audio.setPatches(released);
  const voice = audio.voices.get(key);
  assert.ok(voice, 'The confirmed cooling edge survives a coalesced start/release.');
  context.advance(.6); audio.tick();
  assert.ok(voice.gain.gain.at(context.currentTime) > PATCH_SOFT_TONE_LEVEL * .09, 'A brief measured cooling front has an audible hazy onset.');
  assert.ok(voice.haziness > .99 && voice.focus < .01, 'An early onset does not prematurely clear the uncooled deep ground.');
  assert.equal(voice.midi, patchMidi(key)); assert.equal(audio.residues.size, 0, 'No area completion or out flag is required.');
  for (let tick = 0; tick < 40; tick++) { time.now += 100; context.advance(.1); room.advance(); audio.setPatches(snapshot()); }
  assert.equal(audio.voices.size + audio.tails.size + audio.handoffTails.size, 0, 'Identical or reheating endpoints never prolong the finite response.');
  assert.equal(audio.residues.size + audio.textureSources.size, 0);
});

test('local release before its first cooled packet, cooled baselines and wet skin retain truthful admission', () => {
  const { audio, context } = harness({ areaMode: true }), key = 'local-release';
  const hot = patch(key, { holding: false, heat: 1, moisture: 0, surfaceWetness: 0 });
  audio.setPatches([hot]); audio.setPatches([{ ...hot, holding: true }]);
  context.advance(.02); audio.setPatches([hot]);
  assert.equal(audio.voices.size + audio.tails.size, 0, 'A dry start and release is still silent.');
  context.advance(.08); audio.setPatches([{ ...hot, moisture: .2, surfaceWetness: .9 }]);
  assert.equal(audio.voices.size, 0, 'Absorbed water and a wet surface cannot invent heat loss.');
  audio.setPatches([{ ...hot, heat: .9998, moisture: .2, surfaceWetness: .9 }]);
  const voice = audio.voices.get(key); assert.ok(voice);
  context.advance(.6); audio.tick(); assert.ok(voice.gain.gain.at(context.currentTime) > PATCH_SOFT_TONE_LEVEL * .09);
  const reload = harness({ areaMode: true }).audio;
  reload.setPatches([patch(key, { holding: false, heat: .7, moisture: .8 })]);
  assert.equal(reload.voices.size, 0, 'A partially cooled initial snapshot remains a quiet baseline.');
  reload.configure({ enabled: false }); reload.setPatches([patch(key, { holding: false, heat: .6, moisture: .8 })]);
  reload.configure({ enabled: true }); reload.tick(); assert.equal(reload.voices.size, 0, 'Muted cooling cannot replay on enable.');
  reload.configure({ toneWeight: 0 }); reload.setPatches([patch(key, { holding: false, heat: .5, moisture: .9 })]);
  reload.configure({ toneWeight: 1 }); reload.tick(); assert.equal(reload.voices.size, 0, 'A zero scene weight cannot queue global rain for later.');
  assert.equal(patchSoftToneParameters({ heat: 1, moisture: 1, surfaceWetness: 1 }).gain, 0);
});

test('simultaneous released cooling has bounded admission and shared headroom', () => {
  const { audio, context } = harness({ areaMode: true });
  const hot = Array.from({ length: 256 }, (_, index) => patch(`released-crowd-${index}`, { holding: false, heat: 1, moisture: 0 }));
  audio.configure({ participantCount: 256 }); audio.setPatches(hot); context.advance(.3);
  const cool = hot.map(value => ({ ...value, heat: .9998, moisture: .2 })); audio.setPatches(cool);
  assert.equal(audio.voices.size, 32); assert.equal(audio.tails.size, 0);
  assert.equal(audio.getMetrics().normalizationCount, 256); assert.equal(audio.getMetrics().crowdTargetGain, 1);
  for (let tick = 0; tick < 40; tick++) { context.advance(.1); audio.setPatches(cool); assert.ok(audio.voices.size + audio.tails.size + audio.handoffTails.size <= 128); }
  assert.equal(audio.voices.size + audio.tails.size + audio.handoffTails.size, 0);
});

test('global cooling can consume released edges without interrupting an already held note or replaying later', () => {
  const { audio, context } = harness({ areaMode: true });
  audio.setPatches([patch('held-into-rain', { heat: .7, moisture: .8 }), patch('global-rain', { holding: false, heat: 1, moisture: 0 })]);
  const held = audio.voices.get('held-into-rain'); context.advance(.4);
  audio.configure({ allowReleasedCooling: false });
  audio.setPatches([patch('held-into-rain', { heat: .6, moisture: .9 }), patch('global-rain', { holding: false, heat: .7, moisture: .8 })]);
  assert.equal(audio.voices.size, 1); assert.equal(audio.voices.get('held-into-rain'), held); assert.equal(audio.recentCooling.size, 0);
  audio.configure({ allowReleasedCooling: true }); audio.tick();
  assert.equal(audio.voices.size, 1, 'Consumed macro cooling cannot queue notes when audience response resumes.');
  audio.setPatches([patch('held-into-rain', { heat: .6, moisture: .9 }), patch('global-rain', { holding: false, heat: .6, moisture: .9 })]);
  assert.equal(audio.voices.size, 2, 'A fresh permitted cooling edge remains responsive.');
  audio.configure({ allowReleasedCooling: false }); audio.tick();
  assert.equal(audio.voices.size, 1); assert.equal(audio.voices.get('held-into-rain'), held);
});

test('a brief cooling snapshot exits from its current level without a post-bell swell or another scheduler tick', () => {
  const { audio, context } = harness(), key = 'brief';
  audio.setPatches([patch(key, { heat: 1, moisture: 0, surfaceWetness: 0 })]);
  const voice = audio.voices.get(key);
  context.advance(.06); audio.setPatches([patch(key, { heat: .7, moisture: .8 })]);
  context.advance(.06); const before = voice.gain.gain.at(context.currentTime);
  audio.setPatches([patch(key, { extinguished: true, heat: 0, holding: false })]);
  assert.equal(audio.morphVoices.get(key), voice); assert.equal(voice.midi, patchMidi(key));
  assert.ok(Math.abs(voice.gain.gain.at(context.currentTime) - before) < 1e-10, 'The out edge is continuous.');
  assert.ok(before < PATCH_SOFT_TONE_LEVEL * .2, 'This fixture reproduces an unfinished attack.');
  const at = voice.morphCurveAt;
  assert.ok(voice.gain.gain.at(at + .1) > before * .99, 'The rounded exit preserves the live amplitude near its start.');
  const levels = Array.from({ length: 51 }, (_, index) => voice.gain.gain.at(at + index * .05));
  assert.ok(levels.every((value, index) => value >= 0 && value <= before + 1e-10 && (!index || value <= levels[index - 1])), 'Native automation only falls after the bell.');
  assert.ok(voice.gain.gain.at(at + 2.2) < 1e-10); assert.ok(Math.abs(voice.oscillators[0].stoppedAt - (at + 2.2)) < 1e-10);
  context.advance(2.3); assert.equal(audio.morphVoices.size, 0, 'Source completion clears the voice without a scheduler tick.');
  assert.equal(audio.residues.size, 1, 'The original material lifecycle continues.');
});

test('a normal residue keeps one continuous finite recording through delayed ticks without 1.5 second holes or replay', () => {
  const { audio, context, destination } = harness();
  const held = patch('continuous'); audio.setPatches([held]); context.advance(20); audio.tick();
  const voice = audio.voices.get(held.key), midi = voice.midi;
  audio.setPatches([patch(held.key, { extinguished: true, holding: false, position: [.9, .1] })]);
  const residue = audio.residues.get(held.key), record = [...audio.textureSources][0];
  assert.equal(audio.morphVoices.get(held.key), voice); assert.equal(voice.midi, midi);
  assert.deepEqual(record.residue.patch.position, [.2, .7]);
  assert.equal(record.windowed, false); assert.ok(record.duration > 27.9);
  assert.equal(record.source.playbackRate.value, patchResidueTreatment(held.key).playbackRate); assert.equal(record.source.loop, true);
  assert.ok(record.source.stoppedAt <= residue.endAt);
  assert.equal(record.space.distance.connections[0], record.dry); assert.equal(record.dry.connections[0], audio.textureCrowd);
  assert.equal(audio.textureCrowd.connections[0], destination); assert.equal(audio.toneCrowd.connections[0], destination);
  for (const age of [.5, 1.5, 3, 4.5, 6, 7.5, 8, 13, 18, 26]) {
    const actual = curveAt(record, residue.at + age), expected = patchTextureLevel(residue.id) * patchResidueEnvelope(age).texture;
    assert.ok(Math.abs(actual - expected) < .00001, `The recording has no extra dip at ${age} seconds.`);
  }
  context.advance(13); audio.setPatches([patch(held.key, { extinguished: true, holding: false })]);
  assert.equal([...audio.textureSources][0], record, 'A late scheduler tick leaves the native source intact.');
  assert.equal(audio.residues.get(held.key).windowsScheduled, 1);
  context.advance(15.1); audio.tick(); assert.equal(audio.textureSources.size, 0); assert.equal(audio.residues.size, 0);
  audio.setPatches([patch(held.key, { extinguished: true })]); assert.equal(audio.textureSources.size, 0);
  const reload = harness().audio; reload.setPatches([patch('already-out', { extinguished: true })]);
  assert.equal(reload.residues.size, 0);
});

const materialKeys = (id, count) => Array.from({ length: count * 8 }, (_, index) => `material-${index}`)
  .filter(key => patchResidueId(key) === id).slice(0, count);

test('material transposition becomes steadily rarer with real global cooling and keeps the three exact pitch choices', () => {
  assert.equal(patchResidueTransposeProbability(), 2 / 3);
  assert.equal(patchResidueTransposeProbability(-1), 0);
  assert.equal(patchResidueTransposeProbability(2), 2 / 3);
  assert.equal(patchResidueTransposeProbability(.25), 1 / 12);
  const cooling = Array.from({ length: 101 }, (_, index) => patchResidueTransposeProbability(1 - index / 100));
  assert.ok(cooling.every((probability, index) => !index || probability <= cooling[index - 1]));
  assert.equal(cooling.at(-1), 0);
  const fullHeatCounts = new Map([[-3, 0], [4, 0], [0, 0]]);
  for (let index = 0; index < 600; index++) {
    const sample = (index + .5) / 600, choice = patchResiduePitch(1, sample);
    fullHeatCounts.set(choice.transposeSemitones, fullHeatCounts.get(choice.transposeSemitones) + 1);
    assert.equal(choice.transposeRatio, 2 ** (choice.transposeSemitones / 12));
    assert.equal(patchResiduePitch(0, sample).transposeSemitones, 0);
  }
  assert.deepEqual([...fullHeatCounts.values()], [200, 200, 200]);
  assert.equal(patchResiduePitch(1, .2).transposeSemitones, -3);
  assert.equal(patchResiduePitch(.25, .2).transposeSemitones, 0, 'Partial cooling already makes the same draw choose the normal material.');
  assert.equal(patchResiduePitch(0, 0).transposeSemitones, 0, 'The cold endpoint stays normal even at the lowest draw.');
});

test('ash, moisture and haze use normal, minor-third-down or major-third-up native loops without changing their finite morph or tone', () => {
  for (const id of ['ash', 'moisture', 'haze']) for (const [sample, semitones] of [[.9, 0], [.1, -3], [.5, 4]]) {
    const { audio, context } = harness({ random: () => sample, reverb: true });
    const key = materialKeys(id, 1)[0], normal = patchResidueTreatment(key);
    audio.setPatches([patch(key)]); context.advance(1); audio.tick();
    const voice = audio.voices.get(key), frequency = voice.frequency, hazeRate = voice.hazeSource.playbackRate.value;
    audio.setPatches([patch(key, { holding: false, extinguished: true, heat: 0 })]);
    const residue = audio.residues.get(key), record = [...audio.textureSources][0], rate = normal.playbackRate * 2 ** (semitones / 12);
    assert.equal(residue.treatment.transposeSemitones, semitones);
    assert.equal(residue.treatment.basePlaybackRate, normal.playbackRate);
    assert.equal(record.source.playbackRate.value, rate);
    assert.equal(record.source.loop, true); assert.equal(record.source.loopStart, 0); assert.equal(record.source.loopEnd, record.source.buffer.duration);
    assert.equal(residue.treatment.phase, normal.phase); assert.equal(residue.treatment.reverbSend, normal.reverbSend);
    assert.equal(voice.frequency, frequency); assert.equal(voice.oscillators[0].frequency.value, frequency);
    assert.equal(voice.hazeSource.playbackRate.value, hazeRate, 'The cooling tone halo does not receive material transposition.');
    assert.equal(residue.endAt - residue.at, 28); assert.equal(record.source.stoppedAt, residue.endAt);
    for (const age of [.5, 8, 18, 27]) {
      const expected = patchTextureLevel(id) * patchResidueEnvelope(age, 8, 20).texture;
      assert.ok(Math.abs(curveAt(record, residue.at + age) - expected) < .00001, `${id} ${semitones}: the morph and 20-second fade use wall-clock time.`);
    }
    const duration = record.duration, stopAt = record.source.stoppedAt, curve = record.curve;
    audio.configure({ globalHeat: 0 }); audio.tick();
    assert.equal(record.source.playbackRate.value, rate); assert.equal(record.source.playbackRate.events.length, 0);
    assert.equal(record.duration, duration); assert.equal(record.source.stoppedAt, stopAt); assert.equal(record.curve, curve);
    const metrics = audio.getMetrics();
    assert.equal(metrics.globalHeat, 0); assert.equal(metrics.transposeProbability, 0);
    assert.equal(metrics.residues[0].transposeSemitones, semitones); assert.equal(metrics.residues[0].transposeProbability, 2 / 3);
    assert.equal(metrics.residues[0].pitchHeat, 1); assert.equal(metrics.residues[0].playbackRate, rate);
    audio.configure({ participantCount: 4 }); assert.equal(audio.globalHeat, 0, 'Unrelated configuration retains macro heat.');
    context.advance(28.1); audio.tick(); assert.equal(audio.residues.size + audio.textureSources.size, 0);
  }
});

test('one pitch draw belongs to each admitted extinction even before candidates or decode, while baselines and consumed events stay silent', () => {
  for (const areaMode of [false, true]) {
    let draws = 0, candidateState = 0;
    const { audio, context, recording } = harness({ areaMode, random: () => [.1, .5, .1][draws++] });
    const key = 'deferred-pitch', hot = patch(key, { holding: false }), out = patch(key, { holding: false, extinguished: true, heat: 0 });
    audio.getTextureCandidates = id => candidateState ? [{ url: `/${id}.wav`, buffer: candidateState === 2 ? recording : null }] : [];
    const trigger = id => !areaMode || audio.triggerAreaExtinction(areaEvent([key], id));
    audio.setPatches([out]); if (areaMode) assert.equal(trigger('baseline'), false);
    assert.equal(draws, 0); assert.equal(audio.residues.size, 0);
    audio.setPatches([hot]); context.advance(.1); audio.setPatches([out]); assert.equal(trigger('first'), true);
    const first = audio.residues.get(key);
    assert.equal(draws, 1); assert.equal(first.treatment.transposeSemitones, -3); assert.equal(audio.textureSources.size, 0);
    audio.configure({ globalHeat: 0 });
    for (let index = 0; index < 5; index++) { context.advance(.1); audio.setPatches([out]); if (areaMode) assert.equal(trigger('first'), false); }
    candidateState = 1; audio.tick(); assert.equal(draws, 1); assert.ok(first.assignedUrl); assert.equal(audio.textureSources.size, 0);
    candidateState = 2; context.advance(.1); audio.tick();
    const firstRecord = [...audio.textureSources][0];
    assert.equal(draws, 1); assert.equal(firstRecord.residue, first); assert.equal(firstRecord.source.playbackRate.value, first.treatment.basePlaybackRate * 2 ** (-3 / 12));
    assert.equal(first.treatment.pitchHeat, 1, 'Decode and admission do not resample the later cold macro condition.');
    audio.configure({ globalHeat: 1 }); audio.setPatches([hot]); context.advance(.4); audio.tick();
    audio.setPatches([out]); assert.equal(trigger('second'), true);
    const second = audio.residues.get(key);
    assert.equal(draws, 2); assert.equal(second.treatment.transposeSemitones, 4);
    assert.equal(second.treatment.phase, first.treatment.phase); assert.equal(second.treatment.reverbSend, first.treatment.reverbSend);
    audio.configure({ enabled: false }); audio.setPatches([hot]); audio.setPatches([out]);
    if (areaMode) assert.equal(trigger('muted'), false);
    audio.configure({ enabled: true }); audio.setPatches([out]);
    if (areaMode) assert.equal(trigger('muted'), false);
    assert.equal(draws, 2); assert.equal(audio.residues.size + audio.textureSources.size, 0);
    audio.configure({ globalHeat: 0 }); audio.setPatches([hot]); context.advance(.4); audio.setPatches([out]); assert.equal(trigger('cold'), true);
    assert.equal(draws, 3, 'A cold admitted lifecycle still owns exactly one draw.');
    assert.equal(audio.residues.get(key).treatment.transposeSemitones, 0);
    context.advance(29); audio.tick(); audio.setPatches([out]);
    if (areaMode) assert.equal(trigger('cold'), false);
    assert.equal(draws, 3); assert.equal(audio.residues.size + audio.textureSources.size, 0);
  }
});

test('transposed crowd windows retain the same pitch and material phase after global cooling without another draw', () => {
  let draws = 0;
  const { audio, context } = harness({ random: () => [.1, .5, .9][draws++ % 3] });
  const keys = materialKeys('moisture', 70);
  audio.setPatches(keys.map(key => patch(key, { holding: false })));
  audio.setPatches(keys.map(key => patch(key, { holding: false, extinguished: true })));
  assert.equal(draws, keys.length);
  for (let tick = 1; tick < PATCH_TEXTURE_SOURCE_LIMIT; tick++) { context.advance(.1); audio.tick(); }
  const first = new Map([...audio.textureSources].map(record => [record.residue.key, record]));
  assert.ok([...first.values()].some(record => record.residue.treatment.transposeSemitones === -3));
  assert.ok([...first.values()].some(record => record.residue.treatment.transposeSemitones === 4));
  audio.configure({ globalHeat: 0 });
  let replay;
  for (let tick = 0; tick < 350 && !replay; tick++) {
    context.advance(.06); audio.tick();
    assert.ok(audio.textureSources.size <= PATCH_TEXTURE_SOURCE_LIMIT);
    for (const record of audio.textureSources) {
      const treatment = record.residue.treatment;
      assert.equal(record.source.playbackRate.value, treatment.basePlaybackRate * treatment.transposeRatio);
      assert.ok(record.source.stoppedAt <= record.residue.endAt);
    }
    replay = [...audio.textureSources].find(record => first.has(record.residue.key) && first.get(record.residue.key) !== record);
  }
  assert.ok(replay); assert.equal(draws, keys.length);
  const original = first.get(replay.residue.key), { phase, playbackRate } = replay.residue.treatment, duration = replay.source.buffer.duration;
  assert.equal(replay.source.playbackRate.value, original.source.playbackRate.value);
  assert.ok(Math.abs(replay.source.offset - (phase * duration + (replay.at - replay.residue.at) * playbackRate) % duration) < 1e-12);
  assert.equal(replay.residue.treatment.pitchHeat, 1);
});

test('simultaneous and closely timed extinctions share the bank without duplicating a material recording', () => {
  const keys = materialKeys('ash', 4);
  const run = (order, staggered = false) => {
    const { audio, context } = harness({ candidates: 4 });
    const extinguished = new Set();
    audio.setPatches(order.map(key => patch(key, { holding: false })));
    if (staggered) for (const key of order) {
      context.advance(.2); extinguished.add(key);
      audio.setPatches(order.map(key => patch(key, { holding: false, extinguished: extinguished.has(key) })));
    } else audio.setPatches(order.map(key => patch(key, { holding: false, extinguished: true })));
    const assignments = Object.fromEntries([...audio.residues].map(([key, residue]) => [key, residue.assignedUrl]));
    assert.equal(new Set(Object.values(assignments)).size, 4, 'Nearby patches use four independently recorded materials before repeating.');
    for (let tick = 0; tick < 3; tick++) { context.advance(.1); audio.tick(); }
    const records = [...audio.textureSources];
    assert.equal(new Set(records.map(record => record.source.offset)).size, 4);
    assert.equal(new Set(records.map(record => record.source.playbackRate.value)).size, 4);
    assert.ok(records.every(record => record.source.playbackRate.value >= .965 && record.source.playbackRate.value <= 1.035));
    return assignments;
  };
  assert.deepEqual(run(keys), run([...keys].reverse()), 'Packet insertion order cannot change a simultaneous assignment.');
  run(keys, true);
});

test('material clocks remain distinct with one recording and preserve their phase through crowd windows', () => {
  const { audio, context } = harness();
  const keys = materialKeys('moisture', 70);
  audio.setPatches(keys.map(key => patch(key, { holding: false })));
  audio.setPatches(keys.map(key => patch(key, { holding: false, extinguished: true })));
  for (let tick = 1; tick < PATCH_TEXTURE_SOURCE_LIMIT; tick++) { context.advance(.1); audio.tick(); }
  assert.equal(audio.textureSources.size, PATCH_TEXTURE_SOURCE_LIMIT);
  const first = new Map([...audio.textureSources].map(record => [record.residue.key, record]));
  assert.equal(new Set([...first.values()].map(record => record.source.offset)).size, first.size,
    'Even the fallback recording has independent source phases.');
  assert.equal(new Set([...first.values()].map(record => record.source.playbackRate.value)).size, first.size);
  assert.equal(new Set([...first.values()].map(record => record.filter.frequency.value)).size, first.size);
  let replay;
  for (let tick = 0; tick < 350 && !replay; tick++) {
    context.advance(.06); audio.tick();
    replay = [...audio.textureSources].find(record => first.has(record.residue.key) && first.get(record.residue.key) !== record);
  }
  assert.ok(replay, 'The crowded material returns for another fair finite window.');
  const original = first.get(replay.residue.key), { phase, playbackRate } = patchResidueTreatment(replay.residue.key);
  const duration = replay.source.buffer.duration;
  const expected = (phase * duration + (replay.at - replay.residue.at) * playbackRate) % duration;
  assert.ok(Math.abs(replay.source.offset - expected) < 1e-12);
  assert.equal(replay.source.playbackRate.value, original.source.playbackRate.value);
  assert.ok(replay.source.stoppedAt <= replay.residue.endAt, 'Rate changes never extend the finite envelope.');
});

test('a preassigned recording survives decode order, overload admission and repeated extinction of the same patch', () => {
  const { audio, context, recording } = harness({ candidates: 4 });
  let loaded = false;
  audio.getTextureCandidates = id => [3, 1, 0, 2].map(index => ({ url: `/${id}-${index}.wav`, buffer: loaded ? recording : null }));
  const keys = Array.from({ length: 75 }, (_, index) => `queued-material-${index}`);
  audio.setPatches(keys.map(key => patch(key, { holding: false })));
  audio.setPatches(keys.map(key => patch(key, { holding: false, extinguished: true })));
  const assigned = new Map([...audio.residues].map(([key, residue]) => [key, residue.assignedUrl]));
  assert.equal(audio.textureSources.size, 0);
  assert.equal(assigned.size, 75); assert.ok([...assigned.values()].every(Boolean), 'Waiting for a native source never defers a patch assignment.');
  loaded = true; context.advance(.5); audio.tick();
  for (let tick = 1; tick < PATCH_TEXTURE_SOURCE_LIMIT; tick++) { context.advance(.1); audio.tick(); }
  assert.equal(audio.textureSources.size, PATCH_TEXTURE_SOURCE_LIMIT);
  for (const record of audio.textureSources) assert.equal(record.residue.selected.url, assigned.get(record.residue.key));
  const key = keys[0], treatment = { ...audio.residues.get(key).treatment };
  audio.reset(); audio.setPatches([patch(key)]); context.advance(.1);
  audio.setPatches([patch(key, { holding: false, extinguished: true })]);
  const residue = audio.residues.get(key);
  assert.equal(residue.assignedUrl, assigned.get(key)); assert.deepEqual(residue.treatment, treatment);
});

test('patch room choices are fixed, more present and normalized with their direct material', () => {
  const { audio, context, destination, reverbDestination } = harness({ reverb: true });
  const keys = Array.from({ length: 1000 }, (_, index) => `room-${index}`);
  const treatments = keys.map(patchResidueTreatment), wet = treatments.filter(treatment => treatment.reverbSend > 0);
  assert.ok(wet.length > 520 && wet.length < 680, `${wet.length} of 1000 material identities have a room send.`);
  for (const treatment of treatments) {
    assert.ok(treatment.reverbSend === 0 || treatment.reverbSend >= .28 && treatment.reverbSend <= .46);
    assert.ok(Math.abs(treatment.dryGain ** 2 + treatment.reverbSend ** 2 - 1) < 1e-12);
  }
  const wetKey = keys.find(key => patchResidueTreatment(key).reverbSend > 0);
  const dryKey = keys.find(key => patchResidueTreatment(key).reverbSend === 0);
  audio.setPatches([patch(wetKey), patch(dryKey)]);
  context.advance(1); audio.configure({ participantCount: 64 });
  audio.setPatches([patch(wetKey, { extinguished: true }), patch(dryKey, { extinguished: true })]);
  context.advance(.1); audio.tick();
  const records = new Map([...audio.textureSources].map(record => [record.residue.key, record]));
  const wetRecord = records.get(wetKey), dryRecord = records.get(dryKey);
  assert.ok(wetRecord.wet); assert.equal(dryRecord.wet, null); assert.equal(dryRecord.dry.gain.value, 1);
  assert.equal(wetRecord.wet.gain.value, patchResidueTreatment(wetKey).reverbSend);
  assert.ok(wetRecord.dry.gain.value > .887, 'The direct material remains dominant at the strongest room setting.');
  assert.equal(wetRecord.dry.connections[0], audio.textureCrowd);
  assert.equal(wetRecord.wet.connections[0], audio.textureReverbCrowd);
  assert.equal(audio.textureCrowd.connections[0], destination);
  assert.equal(audio.textureReverbCrowd.connections[0], reverbDestination);
  assert.deepEqual(audio.textureReverbCrowd.gain.events, audio.textureCrowd.gain.events);
  assert.equal(audio.getMetrics().textureNormalizationCount, 2, 'The finite pool uses audible sources rather than all holding identities.');
  assert.equal(audio.getMetrics().textureCrowdTargetGain, 1 / Math.sqrt(2));
  audio.configure({ participantCount: 1 }); context.advance(1); audio.tick();
  assert.deepEqual(audio.textureReverbCrowd.gain.events, audio.textureCrowd.gain.events);
  audio.stop(); assert.ok(wetRecord.wet.disconnected && wetRecord.dry.disconnected);
});

test('a 28-person rehearsal and larger audiences retain the same patch tone gain and finite material envelope', () => {
  const { audio, context } = harness();
  audio.configure({ participantCount: 1 });
  audio.setPatches(new Map([['first', patch('one')], ['duplicate', patch('one')]]).values());
  assert.equal(audio.voices.size, 1); assert.equal(audio.voices.get('one').midi, patchMidi('one'));
  context.advance(20); audio.tick();
  const voice = audio.voices.get('one'), toneGain = voice.targetGain;
  for (const count of [28, 64, 256, 1]) {
    audio.configure({ participantCount: count }); audio.tick(); context.advance(.4);
    const metrics = audio.getMetrics();
    assert.equal(metrics.participantCount, count); assert.equal(metrics.normalizationCount, count);
    assert.equal(metrics.crowdTargetGain, 1); assert.equal(metrics.crowdGain, 1);
    assert.equal(audio.voices.get('one'), voice); assert.equal(voice.targetGain, toneGain);
    assert.equal(metrics.textureCrowdGain, 1);
  }
  audio.setPatches([patch('one', { extinguished: true, holding: false })]);
  const record = [...audio.textureSources][0], curve = record.curve;
  audio.configure({ participantCount: 256 }); context.advance(.4); audio.tick();
  assert.equal(audio.getMetrics().crowdGain, 1);
  assert.equal(record.curve, curve, 'A growing audience cannot reshape an existing finite recording.');
  assert.equal(audio.getMetrics().textureNormalizationCount, 1);
  audio.configure({ participantCount: Infinity }); assert.equal(audio.participantCount, 0);
});

test('new overload smoothly retires long windows, fairly serves feasible finite transitions and retains the eight-source budget', () => {
  const { audio, context } = harness();
  const held = patch('existing'); audio.setPatches([held]); context.advance(20); audio.tick();
  audio.setPatches([patch('existing', { extinguished: true, holding: false })]);
  const long = [...audio.textureSources][0]; context.advance(4); audio.tick();
  const burning = Array.from({ length: 127 }, (_, i) => patch(`crowd-${i}`, { holding: false }));
  const existingOut = patch('existing', { extinguished: true, holding: false });
  audio.setPatches([existingOut, ...burning]);
  const from = curveAt(long, context.currentTime);
  const out = burning.map(value => ({ ...value, extinguished: true }));
  audio.setPatches([existingOut, ...out]);
  assert.ok(long.release && long.release.seconds >= .3 && long.release.seconds <= .9);
  assert.ok(Math.abs(long.release.from - from) < 1e-12, 'Budget handoff starts from the current native envelope.');
  assert.equal(long.source.disconnected, undefined, 'An audible old recording fades before disposal.');
  const firstEnds = new Set(), firstAdmissions = new Map();
  for (let tick = 0; tick < 390; tick++) {
    context.advance(.06); audio.tick();
    assert.ok(audio.textureSources.size <= PATCH_TEXTURE_SOURCE_LIMIT);
    assert.ok(context.sources.filter(source => !source.disconnected).length <= 8, 'Retiring native sources still count against the pool.');
    assert.ok([...audio.textureSources].every(value => value.source.stoppedAt <= value.residue.endAt));
    for (const value of audio.textureSources) {
      firstEnds.add(value.endAt.toFixed(3));
      if (!firstAdmissions.has(value.residue.key)) firstAdmissions.set(value.residue.key, value.at);
    }
  }
  const metrics = audio.getMetrics();
  assert.equal(metrics.pendingResidues, 0); assert.ok(metrics.residues.every(value => value.windowsScheduled >= 1));
  assert.equal(firstAdmissions.size, 128, 'Never-heard lifecycles are served before already-heard ones return.');
  assert.ok(firstEnds.size > 20, 'Crowd windows finish at varied times.');
  assert.ok(metrics.normalizationCount <= PATCH_TEXTURE_SOURCE_LIMIT);
  assert.ok(metrics.textureNormalizationCount <= PATCH_TEXTURE_SOURCE_LIMIT);
  const starts = context.sources.map(source => source.startedAt);
  assert.ok(starts.slice(1).every((at, index) => at - starts[index] >= .1 - 1e-9));
  context.advance(5); audio.tick(); assert.equal(audio.textureSources.size, 0); assert.equal(audio.residues.size, 0);
});

test('rapid extinction packets admit at most one native texture every 100 milliseconds', () => {
  const { audio, context } = harness();
  const keys = Array.from({ length: 16 }, (_, index) => `rapid-${index}`);
  const out = keys.map(key => patch(key, { holding: false, extinguished: true }));
  audio.setPatches(keys.map(key => patch(key, { holding: false })));
  audio.setPatches(out);
  assert.equal(PATCH_TEXTURE_SOURCE_LIMIT, 8); assert.equal(PATCH_TEXTURE_ADMISSION_SECONDS, .1);
  for (let tick = 0; tick < 100; tick++) { audio.setPatches(out); audio.tick(); }
  assert.equal(context.sources.length, 1, 'Repeated snapshots cannot fill the pool at the same audio time.');
  context.advance(.099); audio.tick(); assert.equal(context.sources.length, 1);
  context.advance(.001); audio.tick(); assert.equal(context.sources.length, 2);
  for (let tick = 2; tick < 8; tick++) { context.advance(.1); audio.tick(); }
  assert.equal(audio.textureSources.size, 8);
  for (let tick = 0; tick < 100; tick++) { context.advance(.001); audio.setPatches(out); }
  assert.equal(context.sources.length, 8, 'A full bank waits for a native source to finish.');
  const starts = context.sources.map(source => source.startedAt);
  assert.ok(starts.slice(1).every((at, index) => at - starts[index] >= .1 - 1e-9));
  assert.equal(audio.getMetrics().textureAdmissionSeconds, .1);
});

test('an impossible burst expires unheard entries at the original finite deadline without late replay', () => {
  const { audio, context } = harness();
  const keys = Array.from({ length: 528 }, (_, index) => `expires-${index}`);
  const out = keys.map(key => patch(key, { holding: false, extinguished: true }));
  audio.setPatches(keys.map(key => patch(key, { holding: false })));
  audio.setPatches(out);
  for (let tick = 0; tick < 270; tick++) {
    context.advance(.1); audio.tick();
    assert.ok(audio.textureSources.size <= 8);
    assert.ok([...audio.textureSources].every(record => record.source.stoppedAt <= 28));
  }
  assert.ok(audio.getMetrics().pendingResidues > 0, 'The 100ms admission limit cannot serve all 528 original lifecycles in 28 seconds.');
  assert.ok(context.sources.length <= 271); assert.ok(audio.getMetrics().textureNormalizationCount <= 8);
  const admitted = context.sources.length;
  context.advance(1.1); audio.tick();
  assert.equal(audio.residues.size, 0); assert.equal(audio.textureSources.size, 0);
  audio.setPatches(out); context.advance(10); audio.tick();
  assert.equal(context.sources.length, admitted, 'Out snapshots never extend or replay an expired queue.');
});

test('later extinction bursts cannot jump ahead of an older unheard lifecycle', () => {
  const { audio, context } = harness();
  const first = ['older-y', 'older-z'].map(key => patch(key, { holding: false }));
  const firstOut = first.map(value => ({ ...value, extinguished: true }));
  audio.setPatches(first); audio.setPatches(firstOut);
  assert.equal([...audio.textureSources][0].residue.key, 'older-y');
  context.advance(.05);
  const later = ['later-a', 'later-b'].map(key => patch(key, { holding: false }));
  audio.setPatches([...firstOut, ...later]);
  audio.setPatches([...firstOut, ...later.map(value => ({ ...value, extinguished: true }))]);
  context.advance(.05); audio.tick();
  assert.deepEqual([...audio.textureSources].map(record => record.residue.key), ['older-y', 'older-z']);
});

test('mute and reset flush pending lifecycles and reset admission timing without replay', () => {
  const { audio, context } = harness();
  const hot = [patch('mute-a', { holding: false }), patch('mute-b', { holding: false })];
  const out = hot.map(value => ({ ...value, extinguished: true }));
  audio.configure({ morphSeconds: 3, fadeSeconds: 5 }); audio.setPatches(hot); audio.setPatches(out);
  const old = [...audio.textureSources][0];
  assert.equal(old.residue.endAt, 8);
  audio.configure({ enabled: false }); audio.configure({ enabled: true }); audio.setPatches(out);
  assert.equal(audio.textureSources.size, 0); assert.equal(audio.residues.size, 0); assert.equal(old.source.disconnected, true);
  audio.setPatches(hot); audio.setPatches(out);
  assert.equal(audio.textureSources.size, 1, 'A fresh extinction is admitted immediately after mute, even before audio time advances.');
  audio.reset(); audio.setPatches(hot); audio.setPatches(out);
  assert.equal(audio.textureSources.size, 1); assert.equal(audio.residues.size, 2);
  assert.equal(context.sources.filter(source => !source.disconnected).length, 1);
});

const areaEvent = (keys, id = 'area:1') => ({ id, key: [...keys].sort()[0], memberKeys: [...keys].sort() });

test('area mode retains held cooling notes through raw out edges and creates one explicit group material', () => {
  const { audio, context } = harness({ areaMode: true });
  const keys = Array.from({ length: 20 }, (_, index) => `area-member-${String(index).padStart(2, '0')}`);
  audio.setPatches(keys.map(key => patch(key))); context.advance(1); audio.tick();
  const voices = new Map(audio.voices), out = new Set();
  for (const key of keys) {
    out.add(key);
    audio.setPatches(keys.map(key => patch(key, { extinguished: out.has(key), heat: out.has(key) ? 0 : .01 })));
    assert.equal(audio.residues.size, 0); assert.equal(audio.textureSources.size, 0);
    assert.equal(audio.voices.size, keys.length, 'An out member waits for the whole held rain footprint.');
  }
  const event = areaEvent(keys);
  assert.equal(audio.triggerAreaExtinction(event), true);
  assert.equal(audio.voices.size, 0); assert.equal(audio.morphVoices.size, keys.length);
  assert.equal(audio.residues.size, 1); assert.equal(audio.textureSources.size, 1);
  const residue = audio.residues.get(event.key), texture = [...audio.textureSources][0];
  assert.deepEqual(residue.memberKeys, keys); assert.equal(residue.eventId, event.id);
  assert.equal(residue.endAt, context.currentTime + 28);
  assert.deepEqual(texture.residue.patch.position, voices.get(event.key).position);
  for (const key of keys) {
    const voice = audio.morphVoices.get(key);
    assert.equal(voice, voices.get(key)); assert.equal(voice.residue, residue);
    assert.equal(voice.morphCurve.at(-1), 0);
    assert.equal(voice.oscillators[0].stoppedAt, context.currentTime + PATCH_TONE_EXIT_SECONDS + .02);
  }
  assert.equal(audio.triggerAreaExtinction(event), false);
  assert.equal(audio.triggerAreaExtinction(areaEvent(keys, 'duplicate-new-id')), false, 'Covered members cannot replay through a new caller identity.');
  audio.setPatches(keys.map(key => patch(key, { extinguished: true })));
  assert.equal(audio.voices.size, 0, 'Out snapshots cannot restart notes after their group morph.');
  context.advance(8.1); audio.tick(); assert.equal(audio.morphVoices.size, 0);
  context.advance(20); audio.tick(); assert.equal(audio.residues.size + audio.textureSources.size, 0);
  assert.equal(audio.triggerAreaExtinction(event), false);
});

test('area mode recovers the same briefly released notes continuously after a late completion packet', () => {
  const { audio, context } = harness({ areaMode: true }), keys = ['released-a', 'released-b'];
  audio.setPatches(keys.map(key => patch(key))); context.advance(1); audio.tick();
  const voices = new Map(audio.voices);
  audio.setPatches(keys.map(key => patch(key, { holding: false })));
  context.advance(.1);
  const levels = new Map([...voices].map(([key, voice]) => [key, audio._voiceGainAt(voice, context.currentTime)]));
  audio.setPatches(keys.map(key => patch(key, { holding: false, extinguished: true })));
  assert.equal(audio.triggerAreaExtinction(areaEvent(keys)), true);
  for (const key of keys) {
    const voice = audio.morphVoices.get(key);
    assert.equal(voice, voices.get(key)); assert.equal(voice.release, undefined);
    assert.ok(Math.abs(voice.morphFrom - levels.get(key)) < 1e-12);
    assert.equal(audio.tails.has(voice), false);
    assert.ok(Math.abs(voice.oscillators[0].stoppedAt - (context.currentTime + PATCH_TONE_EXIT_SECONDS + .02)) < 1e-10);
  }
});

test('area material can fade in without recreating notes after their release has finished', () => {
  const { audio, context } = harness({ areaMode: true }), keys = ['gone-note'];
  audio.setPatches(keys.map(key => patch(key))); context.advance(1); audio.tick();
  audio.setPatches(keys.map(key => patch(key, { holding: false })));
  context.advance(1.4); audio.tick();
  audio.setPatches(keys.map(key => patch(key, { holding: false, extinguished: true })));
  assert.equal(audio.triggerAreaExtinction(areaEvent(keys)), true);
  assert.equal(audio.voices.size + audio.morphVoices.size, 0);
  assert.equal(audio.textureSources.size, 1);
  assert.equal([...audio.textureSources][0].curve[0], 0);
});

test('area mode consumes muted and expired events and keeps initial or reloaded out snapshots silent', () => {
  const keys = ['quiet-a', 'quiet-b'];
  const reload = harness({ areaMode: true }).audio;
  reload.setPatches(keys.map(key => patch(key, { extinguished: true })));
  assert.equal(reload.triggerAreaExtinction(areaEvent(keys)), false);
  assert.equal(reload.voices.size + reload.residues.size + reload.textureSources.size, 0);
  for (const reason of ['muted', 'expired']) {
    const { audio, context } = harness({ areaMode: true });
    audio.setPatches(keys.map(key => patch(key))); context.advance(1);
    if (reason === 'muted') audio.configure({ enabled: false });
    audio.setPatches(keys.map(key => patch(key, { extinguished: true })));
    const event = { ...areaEvent(keys), ...(reason === 'expired' ? { expiresAt: .5 } : {}) };
    assert.equal(audio.triggerAreaExtinction(event), false);
    audio.configure({ enabled: true });
    assert.equal(audio.triggerAreaExtinction(event), false);
    audio.tick(); assert.equal(audio.residues.size + audio.textureSources.size, 0);
  }
});

test('any returning or removed group member cancels its material and every outgoing tone', () => {
  for (const reason of ['return', 'removed']) {
    const { audio, context } = harness({ areaMode: true }), keys = ['cancel-a', 'cancel-b', 'cancel-c'];
    audio.setPatches(keys.map(key => patch(key))); context.advance(1);
    audio.setPatches(keys.map(key => patch(key, { extinguished: true })));
    audio.triggerAreaExtinction(areaEvent(keys)); context.advance(2); audio.tick();
    const residue = audio.residues.get(keys[0]);
    const values = keys.map(key => patch(key, { holding: false, extinguished: key !== keys[1] || reason !== 'return' }))
      .filter(value => reason !== 'removed' || value.key !== keys[1]);
    audio.setPatches(values);
    assert.equal(audio.residues.size, 0); assert.equal(audio.morphVoices.size, 0);
    assert.ok([...audio.textureSources].every(source => source.residue === residue && source.release));
    context.advance(.4); audio.tick(); assert.equal(audio.textureSources.size, 0);
  }
});

test('area mode allows a fresh real reheat cycle and reset clears group history', () => {
  const { audio, context } = harness({ areaMode: true }), keys = ['reheat-a', 'reheat-b'];
  const hot = keys.map(key => patch(key)), out = keys.map(key => patch(key, { extinguished: true }));
  audio.setPatches(hot); context.advance(.5); audio.setPatches(out);
  assert.equal(audio.triggerAreaExtinction(areaEvent(keys, 'first')), true);
  audio.setPatches(hot); context.advance(.5); audio.setPatches(out);
  assert.equal(audio.triggerAreaExtinction(areaEvent(keys, 'second')), true);
  assert.equal(audio.residues.size, 1);
  audio.reset(); audio.setPatches(out);
  assert.equal(audio.triggerAreaExtinction(areaEvent(keys, 'after-reset-baseline')), false);
  assert.equal(audio.residues.size + audio.textureSources.size, 0);
});

test('crowded explicit area events retain the finite native tone and texture budgets', () => {
  const { audio, context } = harness({ areaMode: true });
  const keys = Array.from({ length: 80 }, (_, index) => `bounded-area-${index}`);
  audio.setPatches(keys.map(key => patch(key))); context.advance(.5);
  audio.setPatches(keys.map(key => patch(key, { extinguished: true })));
  for (let index = 0; index < keys.length; index++) {
    audio.triggerAreaExtinction(areaEvent([keys[index]], `area:${index}`));
    assert.ok(audio.morphVoices.size <= 32); assert.ok(audio.textureSources.size <= PATCH_TEXTURE_SOURCE_LIMIT);
  }
  for (let tick = 0; tick < 300; tick++) {
    context.advance(.1); audio.tick();
    assert.ok(audio.textureSources.size <= PATCH_TEXTURE_SOURCE_LIMIT);
    assert.ok(audio.voices.size + audio.morphVoices.size + audio.tails.size + audio.handoffTails.size <= 128);
  }
  const starts = context.sources.filter(source => source.buffer !== audio.hazeBuffer).map(source => source.startedAt).sort((a, b) => a - b);
  assert.ok(starts.every((at, index) => !index || at - starts[index - 1] >= PATCH_TEXTURE_ADMISSION_SECONDS - 1e-9));
  assert.equal(audio.residues.size + audio.textureSources.size, 0);
});


test('confirmed cooling clears a substantial noise halo while the same pentatonic fundamental and spatial path remain fixed', () => {
  const { audio, context } = harness();
  const key = 'focused-upper', states = [
    { heat: .94, moisture: .08, surfaceWetness: .9 },
    { heat: .62, moisture: .38, surfaceWetness: 1 },
    { heat: .26, moisture: .75, surfaceWetness: 1 },
    { heat: .01, moisture: 1, surfaceWetness: 1 },
  ];
  audio.setPatches([patch(key, states[0])]);
  const voice = audio.voices.get(key), fundamental = voice.oscillators[0], octave = voice.oscillators[1], space = voice.space;
  const targets = [voice.upperBlurCents];
  assert.ok(targets[0] > 150 && targets[0] < 180, 'The emerging pitch begins with an audibly rough upper.');
  assert.ok(voice.hazeGain.gain.value / voice.hazeMakeup > .8, 'The emerging note has a substantial real noise halo.');
  assert.ok(voice.partials[0].gain.value < .45, 'Early noise and upper grain share the note level rather than only adding volume.');
  assert.ok(voice.modulators[0].frequency.value >= 21 && voice.modulators[0].frequency.value < 43);
  assert.deepEqual(voice.upperBlur.connections, [octave.detune]);
  assert.equal(fundamental.detune.events.length, 0, 'The assigned note never receives the upper grain.');
  assert.equal(audio.textureSources.size, 0, 'Tone character consumes no material source.');
  assert.deepEqual(voice.hazeSource.connections, [voice.hazeFilter]);
  assert.deepEqual(voice.hazeGain.connections, [voice.gain], 'Noise shares the same finite gain, mixer, position and crowd path as the assigned tone.');
  const hazeTargets = [voice.haziness];
  for (const state of states.slice(1)) {
    context.advance(.2); audio.setPatches([patch(key, { ...state, position: [.8, .1] })]);
    assert.equal(audio.voices.get(key), voice); targets.push(voice.upperBlurCents); hazeTargets.push(voice.haziness);
    assert.equal(voice.space, space); assert.deepEqual(voice.position, [.2, .7]);
    assert.equal(voice.targetGain, patchSoftToneParameters(state).gain);
  }
  assert.ok(targets.every((value, index) => !index || value < targets[index - 1]));
  assert.ok(hazeTargets.every((value, index) => !index || value < hazeTargets[index - 1]));
  assert.equal(targets.at(-1), 0);
  assert.ok(voice.upperBlur.gain.at(context.currentTime + 5) < .1, 'Native automation focuses the upper even without another scheduler tick.');
  assert.ok(voice.hazeGain.gain.at(context.currentTime + 5) / voice.hazeMakeup < .001);
  assert.ok(voice.partials[0].gain.at(context.currentTime + 5) > .999);
  assert.equal(fundamental.frequency.value, patchFrequencyForMidi(patchMidi(key)));
  assert.equal(octave.frequency.value, fundamental.frequency.value * 2);
  assert.ok(voice.oscillators.every(node => node.frequency.events.length === 0));
  assert.equal(voice.targetGain, PATCH_SOFT_TONE_LEVEL);
  const wetSkin = patchSoftToneParameters({ heat: 1, moisture: 0, surfaceWetness: 1 });
  assert.equal(wetSkin.gain, 0); assert.equal(wetSkin.upperBlurCents, 180, 'A wet surface alone cannot focus uncooled ground.');
  assert.equal(wetSkin.haziness, 1); assert.equal(wetSkin.focus, 0);
});

test('forest takeover blends clear partials into cooling-driven haze without revealing wet skin or changing the normal character', () => {
  for (const state of [
    { heat: 1, moisture: 0, surfaceWetness: 1 },
    { heat: .9998, moisture: .2, surfaceWetness: .9 },
    { heat: .5, moisture: .6, surfaceWetness: 1 },
    { heat: .01, moisture: 1, surfaceWetness: 1 },
    { extinguished: true, heat: 0, moisture: 1 },
  ]) {
    const normal = patchSoftToneParameters(state), half = patchSoftToneParameters(state, .5), haze = patchSoftToneParameters(state, 1);
    assert.deepEqual(patchSoftToneParameters(state, 0), normal);
    assert.equal(half.gain, normal.gain); assert.equal(haze.gain, normal.gain);
    assert.equal(haze.emergence, normal.emergence); assert.equal(haze.cooling, normal.cooling);
    assert.equal(half.fundamentalGain, normal.fundamentalGain / 2); assert.equal(half.harmonicGain, normal.harmonicGain / 2);
    assert.equal(haze.fundamentalGain, 0); assert.equal(haze.harmonicGain, 0);
    assert.equal(haze.focus, 0); assert.equal(haze.haziness, 1); assert.equal(haze.hazeGain, .9);
    assert.ok(half.haziness >= normal.haziness && half.haziness <= haze.haziness);
    assert.deepEqual(patchSoftToneParameters(state, -1), normal); assert.deepEqual(patchSoftToneParameters(state, 2), haze);
  }
  assert.equal(patchSoftToneParameters({ heat: 1, moisture: 1, surfaceWetness: 1 }, 1).gain, 0);
});

test('haze takeover and its interrupted return change every clear partial continuously while retaining pitch, spatial path and source count', () => {
  const { audio, context } = harness();
  const key = Array.from({ length: 500 }, (_, index) => `haze-return-${index}`).find(key => patchMidi(key) === 25);
  audio.setPatches([patch(key)]); context.advance(2); audio.tick();
  const voice = audio.voices.get(key), space = voice.space, sources = [...context.sources], frequency = voice.frequency;
  const parameters = [voice.partials[0].gain, voice.partials[1].gain, voice.bodyGain.gain, voice.hazeGain.gain];
  const before = parameters.map(parameter => parameter.at(context.currentTime));
  audio.configure({ hazeOnlyBlend: 1 }); audio.tick();
  assert.deepEqual(parameters.map(parameter => parameter.at(context.currentTime)), before, 'The takeover starts at the current native values.');
  assert.equal(voice.partials[0].gain.value, 0); assert.equal(voice.partials[1].gain.value, 0); assert.equal(voice.bodyGain.gain.value, 0);
  assert.equal(voice.hazeGain.gain.value / voice.hazeMakeup, .9);
  assert.ok(voice.hazeFilter.Q.value <= 1, 'The remaining noise band stays broad rather than becoming a ringing note.');
  context.advance(4); audio.tick();
  const full = audio.getMetrics();
  assert.equal(full.hazeOnlyBlend, 1); assert.equal(full.voices[0].focus, 0);
  assert.ok(full.voices[0].currentFundamentalGain < .001 && full.voices[0].currentHarmonicGain < .001 && full.voices[0].currentBodyGain < .001);
  assert.ok(full.voices[0].currentHazeGain > .899, 'Deep-cold ground retains an audible halo after the pitched body disappears.');
  audio.configure({ participantCount: 1 }); assert.equal(audio.hazeOnlyBlend, 1, 'Unrelated configuration retains the scene character.');
  audio.configure({ hazeOnlyBlend: 0 }); audio.tick(); context.advance(.13);
  const returning = parameters.map(parameter => parameter.at(context.currentTime));
  audio.configure({ hazeOnlyBlend: .7 }); audio.tick();
  assert.deepEqual(parameters.map(parameter => parameter.at(context.currentTime)), returning, 'An interrupted return remains continuous.');
  context.advance(.17); audio.configure({ hazeOnlyBlend: 0 }); audio.tick(); context.advance(5);
  const restored = audio.getMetrics().voices[0];
  assert.ok(restored.currentFundamentalGain > .999 && restored.currentHazeGain < .001);
  assert.ok(Math.abs(restored.currentHarmonicGain - .04) < .001 && Math.abs(restored.currentBodyGain - voice.bodyLevel) < .001);
  assert.equal(audio.voices.get(key), voice); assert.equal(voice.space, space); assert.equal(voice.frequency, frequency);
  assert.deepEqual(context.sources, sources); assert.ok(voice.oscillators.every(node => node.frequency.events.length === 0));
  assert.equal(voice.hazeFilter.frequency.value, Math.max(70, Math.min(2600, frequency * 1.7)));
  audio.stop(); assert.ok(voice.nodes.every(node => node.disconnected));
});

test('full haze stays diffuse through real deep cooling and keeps the original finite area completion exit', () => {
  const { audio, context } = harness({ areaMode: true });
  audio.configure({ hazeOnlyBlend: 1 });
  const simulation = new RainSimulation({ deepCoolingSeconds: 8, extinctionHoldSeconds: 0 });
  const point = [110.125, -2.125], key = '440,-9'; simulation.seed([{ longitude: point[0], latitude: point[1] }]);
  const snapshot = () => patch(key, { ...simulation.cells.get(key), holding: true });
  audio.setPatches([snapshot()]); const voice = audio.voices.get(key), haze = voice.hazeSource;
  assert.equal(voice.targetGain, 0, 'Haze receives no instant amplitude from a newly wet or still-hot patch.');
  let heardColdHaze = false;
  for (let tick = 0; tick < 600 && !simulation.cells.get(key).extinguished; tick++) {
    context.advance(.06); simulation.step(.06, [{ path: [point], strength: 1 }]); audio.setPatches([snapshot()]);
    assert.equal(voice.focus, 0); assert.equal(voice.haziness, 1);
    assert.equal(voice.partials[0].gain.value, 0); assert.equal(voice.partials[1].gain.value, 0);
    if (voice.bodyGain) assert.equal(voice.bodyGain.gain.value, 0);
    assert.equal(voice.hazeSource, haze); assert.equal(voice.targetGain, patchSoftToneParameters(voice.patch).gain);
    if (voice.patch.heat < .2 && !voice.patch.extinguished) heardColdHaze ||= voice.gain.gain.at(context.currentTime) > .01 && voice.hazeGain.gain.at(context.currentTime) / voice.hazeMakeup > .899;
  }
  assert.ok(heardColdHaze); assert.equal(simulation.cells.get(key).extinguished, true);
  assert.equal(audio.triggerAreaExtinction(areaEvent([key], 'haze-completion')), true);
  const stopAt = voice.morphCurveAt + PATCH_TONE_EXIT_SECONDS, record = [...audio.textureSources][0];
  assert.equal(voice.hazeSource.stoppedAt, stopAt); assert.equal(voice.oscillators[0].stoppedAt, stopAt);
  assert.equal(voice.partials[0].gain.value, 0); assert.equal(voice.haziness, 1);
  context.advance(PATCH_TONE_EXIT_SECONDS + .03);
  assert.equal(audio.morphVoices.size, 0); assert.ok(haze.disconnected);
  assert.equal([...audio.textureSources][0], record, 'The existing material morph remains independent of haze character.');
  audio.reset(); assert.equal(audio.textureSources.size + audio.residues.size, 0); assert.ok(record.nodes.every(node => node.disconnected));
});

test('a haze scene change reaches released and morphing voices without restarting their finite envelopes', () => {
  const { audio, context } = harness();
  audio.setPatches([patch('haze-tail'), patch('haze-morph')]); context.advance(1); audio.tick();
  const tail = audio.voices.get('haze-tail'), morph = audio.voices.get('haze-morph');
  audio.setPatches([patch('haze-tail', { holding: false }), patch('haze-morph', { extinguished: true, holding: false, heat: 0 })]);
  assert.ok(audio.tails.has(tail)); assert.equal(audio.morphVoices.get('haze-morph'), morph);
  const ends = [tail.disposeAt, morph.disposeAt], curve = morph.morphCurve, sources = context.sources.length;
  const before = [tail.partials[0].gain.at(context.currentTime), morph.partials[0].gain.at(context.currentTime)];
  audio.configure({ hazeOnlyBlend: 1 }); audio.tick();
  assert.deepEqual([tail.partials[0].gain.at(context.currentTime), morph.partials[0].gain.at(context.currentTime)], before);
  assert.equal(tail.partials[0].gain.value, 0); assert.equal(morph.partials[0].gain.value, 0);
  assert.equal(tail.hazeGain.gain.value / tail.hazeMakeup, .9); assert.equal(morph.hazeGain.gain.value / morph.hazeMakeup, .9);
  assert.deepEqual([tail.disposeAt, morph.disposeAt], ends); assert.equal(morph.morphCurve, curve); assert.equal(context.sources.length, sources);
  context.advance(2.3); assert.ok(tail.disposed && morph.disposed);
  assert.ok(tail.hazeSource.disconnected && morph.hazeSource.disconnected); assert.equal(audio.textureSources.size, 1);
  audio.stop(); assert.equal(audio.textureSources.size + audio.residues.size, 0);
});

test('upper grain follows the existing finite tone morph and is stopped with every released voice', () => {
  const { audio, context } = harness(), key = 'grain-morph';
  audio.setPatches([patch(key, { heat: .9, moisture: .1 })]); context.advance(.5); audio.tick();
  const voice = audio.voices.get(key), modulator = voice.modulators[0];
  assert.ok(voice.upperBlurCents > 0);
  audio.setPatches([patch(key, { extinguished: true, heat: 0, holding: false })]);
  assert.equal(audio.morphVoices.get(key), voice); assert.equal(voice.upperBlurCents, 0);
  assert.ok(voice.upperBlur.gain.at(context.currentTime + 2) < .1);
  assert.equal(modulator.stoppedAt, voice.oscillators[0].stoppedAt);
  context.advance(8.1); audio.tick();
  assert.ok(modulator.disconnected && voice.upperBlur.disconnected && voice.hazeSource.disconnected && voice.hazeGain.disconnected);
  audio.setPatches([patch('grain-release', { heat: .8, moisture: .2 })]); context.advance(.5); audio.tick();
  const released = audio.voices.get('grain-release'); audio.setPatches([]);
  assert.equal(released.modulators[0].stoppedAt, released.oscillators[0].stoppedAt); assert.equal(released.hazeSource.stoppedAt, released.oscillators[0].stoppedAt);
  audio.reset(); assert.ok(released.modulators[0].disconnected && released.upperBlur.disconnected);
});

test('real cooling clears the noise halo progressively before the confirmed out edge', () => {
  const { audio, context } = harness({ areaMode: true });
  const simulation = new RainSimulation({ deepCoolingSeconds: 8, extinctionHoldSeconds: 0 });
  const point = [110.125, -2.125], key = '440,-9'; simulation.seed([{ longitude: point[0], latitude: point[1] }]);
  const snapshot = () => patch(key, { ...simulation.cells.get(key), holding: true });
  audio.setPatches([snapshot()]); const voice = audio.voices.get(key), hazeSource = voice.hazeSource, frames = [];
  for (let tick = 0; tick < 600 && !simulation.cells.get(key).extinguished; tick++) {
    context.advance(.06); simulation.step(.06, [{ path: [point], strength: 1 }]); audio.setPatches([snapshot()]);
    if (!simulation.cells.get(key).extinguished) frames.push({ heat: voice.patch.heat, focus: voice.focus, haze: voice.haziness, audibleHaze: voice.hazeGain.gain.at(context.currentTime) / voice.hazeMakeup });
    assert.equal(audio.voices.get(key), voice); assert.equal(voice.hazeSource, hazeSource);
  }
  assert.equal(simulation.cells.get(key).extinguished, true);
  const early = frames.find(frame => frame.heat < .9), middle = frames.find(frame => frame.heat < .5), late = frames.find(frame => frame.heat < .2);
  assert.ok(early.haze > .8 && early.audibleHaze > .65, 'The real cooling window begins with a substantial noise halo.');
  assert.ok(middle.haze < early.haze && late.haze < middle.haze);
  assert.ok(late.haze < .1 && late.focus > .95, 'The ground settles into a focused note before confirmed out.');
  assert.ok(frames.every((frame, index) => !index || frame.haze <= frames[index - 1].haze));
  assert.equal(audio.residues.size, 0, 'The full area event still owns the bell and material transition.');
});

test('even a three-minute material morph cannot extend a completed held area tone beyond its short native exit', () => {
  const { audio, context } = harness({ areaMode: true });
  audio.configure({ morphSeconds: 180, fadeSeconds: 37 });
  const keys = ['short-exit-a', 'short-exit-b'], hot = keys.map(key => patch(key));
  audio.setPatches(hot); context.advance(2); audio.tick();
  const voices = [...audio.voices.values()], before = voices.map(voice => voice.gain.gain.at(context.currentTime));
  const out = hot.map(value => ({ ...value, extinguished: true, heat: 0 }));
  audio.setPatches(out); assert.equal(audio.triggerAreaExtinction(areaEvent(keys)), true);
  const residue = audio.residues.get(keys[0]), record = [...audio.textureSources][0];
  assert.equal(residue.endAt, context.currentTime + 217); assert.ok(record.source.stoppedAt <= residue.endAt);
  for (const [index, voice] of voices.entries()) {
    assert.ok(Math.abs(voice.morphFrom - before[index]) < 1e-12);
    const start = voice.morphCurveAt, initial = voice.gain.gain.at(start), nearEnd = voice.gain.gain.at(start + 2.19);
    assert.ok(Math.abs(initial - before[index]) < 1e-9);
    assert.ok(nearEnd < initial * .001, 'Zero-slope easing is already nearly silent before its scheduled stop.');
    assert.equal(voice.gain.gain.at(start + 2.2), 0);
    assert.equal(voice.hazeSource.stoppedAt, voice.oscillators[0].stoppedAt);
  }
  context.advance(2.23);
  assert.ok(voices.every(voice => voice.disposed && voice.hazeSource.disconnected), 'Native source completion works while the JS scheduler is late.');
  assert.equal(audio.morphVoices.size, 0); assert.equal(audio.residues.get(keys[0]), residue); assert.equal([...audio.textureSources][0], record);
  for (let tick = 0; tick < 50; tick++) { context.advance(.1); audio.setPatches(out); }
  assert.equal(audio.voices.size + audio.morphVoices.size + audio.tails.size, 0, 'An uninterrupted cold hold cannot restart a note after the area bell.');
  assert.equal([...audio.textureSources][0], record, 'The material retains its original source and deadline.');
});
