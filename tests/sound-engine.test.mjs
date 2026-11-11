import test from 'node:test';
import assert from 'node:assert/strict';
import { WildfireSound, SOUND_MACRO_DEFAULTS, SOUND_MIXER_DEFAULTS, automaticSoundMacros, landscapeBlend, macroParameters, variationWeights, dryFireTextureParameters, phoneBedParameters, fireProgression, participantMidi, participantMidiPair, participantFrequency, participantGrainParameters, participantGrainEnvelopeAt, patchMidiPair, patchHash, audibleMoisture, cricketRetreatParameters, participantToneParameters, participantPosition, PARTICIPANT_MIDI, PARTICIPANT_MIDI_PAIRS, PARTICIPANT_PITCH_LABELS, PARTICIPANT_PARTIALS, PARTICIPANT_GRAIN_AMPLITUDES, PARTICIPANT_ASH_RMS_RATIO, PHONE_CRACKLE_GAIN, TONE_REVERB_RETURN, MAIN_DRONE_MIDI, MAIN_DRONE_AMPLITUDES, MAIN_DRONE_LEVEL, sampleMakeupGain, circularLoopBuffer, PATCH_PENTATONIC_MIDI, patchMidi, patchResidueId, patchSoftToneParameters, patchResidueEnvelope } from '../app/sound-engine.js';
import { computeSceneScore, participationVisualProgress } from '../app/scene-score.js';
import { countryPoint } from '../app/country-view.mjs';
import { OVERTONE_ROOT_HZ, TONE_HARMONICS, overtonePitchForKey } from '../app/overtone-scale.js';
import { patchTextureRecordingParameters, patchFrequencyForMidi, PATCH_SOFT_TONE_LEVEL, PATCH_TEXTURE_SOURCE_LIMIT, PATCH_TEXTURE_ADMISSION_SECONDS } from '../app/patch-soft-tones.js';
import { phoneCricketParameters } from '../app/sound-engine.js';
import { createParticipantSoundField, patchSoundVoices } from '../app/sound-participants.js';
import { PHONE_CRICKET_RATE, PHONE_CRICKET_LEVEL } from '../app/sound-engine.js';
import { MAIN_DRONE_OVERTONES } from '../app/sound-engine.js';
import { requestPlaybackAudioSession } from '../app/sound-engine.js';
import { MAIN_ENABLE_FADE_SECONDS, MAIN_DISABLE_FADE_SECONDS, ARRIVAL_HAZE_GAIN } from '../app/sound-engine.js';
import { PHONE_MIXER_DEFAULTS, PHONE_MIXER_FADE_SECONDS } from '../app/sound-engine.js';
import { OUTPUT_MAKEUP_DB, OUTPUT_MAKEUP_GAIN, MAIN_OUTPUT_MAKEUP_DB, MAIN_OUTPUT_MAKEUP_GAIN, OUTPUT_LIMIT_CEILING, OUTPUT_LIMIT_INPUT_RANGE, outputDynamics, smoothPeakLimit, outputProtectionCurve, prepareRecording, recordingPreparation } from '../app/audio-loudness.js';

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
class StrictCurveParam extends FakeParam {
  constructor(context) { super(); this.context = context; this.curves = []; this.points = []; }
  _checkPoint(at) {
    if (this.curves.some(curve => at >= curve.at && at < curve.end)) throw new Error('AudioParam event overlaps setValueCurveAtTime');
    this.points.push(at);
  }
  cancelAndHoldAtTime(at) {
    this.curves = this.curves.filter(curve => curve.at < at).map(curve => ({ ...curve, end: Math.min(at, curve.end) }));
    this.points = this.points.filter(point => point < at); super.cancelAndHoldAtTime(at);
  }
  cancelScheduledValues(at) {
    this.curves = this.curves.filter(curve => curve.at < at); this.points = this.points.filter(point => point < at);
    super.cancelScheduledValues(at);
  }
  setValueAtTime(value, at) { this._checkPoint(at); super.setValueAtTime(value, at); }
  setTargetAtTime(value, at, duration) { this._checkPoint(at); super.setTargetAtTime(value, at, duration); }
  linearRampToValueAtTime(value, at) { this._checkPoint(at); super.linearRampToValueAtTime(value, at); }
  setValueCurveAtTime(values, at, duration) {
    // A render quantum can pass while JS prepares the array. Chromium then
    // clamps an already-past curve start, but retains its supplied duration.
    const start = Math.max(at, this.context.currentTime + .003), end = start + duration;
    if (this.curves.some(curve => start < curve.end && end > curve.at) || this.points.some(point => point >= start && point < end)) throw new Error('AudioParam curve overlaps automation');
    this.curves.push({ at: start, end }); super.setValueCurveAtTime(values, start, duration);
  }
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
const roleGain = engine => engine.master.gain.value * (engine.mainLevelGain?.gain.value ?? 1);
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(t, options = {}) {
  const events = [], context = new FakeContext(events), statuses = [], requests = [];
  const engine = new WildfireSound({ document: null, contextFactory: () => { events.push('context'); return context; },
    onStatus: next => statuses.push(next), ...options,
    fetchImpl: async (url, ...args) => { events.push('fetch'); requests.push(url); return options.fetchImpl ? options.fetchImpl(url, ...args) : { ok: false, status: 404 }; } });
  t.after(() => engine.destroy());
  return { engine, context, events, statuses, requests };
}
const patch = (key, heat = .5, extinguished = false) => ({ key, heat, extinguished, surfaceWetness: .4, moisture: .3 });

test('Main keeps transient headroom at saved full-scale settings while phone dynamics and both peak ceilings stay protected', async t => {
  for (const mode of ['operator', 'phone']) {
    const { engine, context } = harness(t, { mode, level: 1 });
    engine.setMixer({ ash: 2, rain: 1.4 }); await engine.enable();
    const settings = outputDynamics(mode);
    assert.equal(OUTPUT_MAKEUP_DB, 12); assert.equal(MAIN_OUTPUT_MAKEUP_DB, 9); assert.equal(engine.level, 1);
    assert.equal(engine.mixer.ash, 2); assert.equal(engine.mixer.rain, 1.4);
    assert.equal(engine.outputMakeup.gain.value, mode === 'operator' ? MAIN_OUTPUT_MAKEUP_GAIN : OUTPUT_MAKEUP_GAIN);
    assert.deepEqual(['threshold', 'knee', 'ratio', 'attack', 'release'].map(name => engine.compressor[name].value),
      mode === 'operator' ? [-6, 6, 2, .02, .2] : [-1, 1, 20, .001, .08]);
    assert.equal(engine.getMetrics().loudness.makeupDb, settings.makeupDb);
    assert.equal(engine.getMetrics().loudness.peakKnee, settings.peakKnee);
    assert.deepEqual(engine.master.connections, [mode === 'operator' ? engine.mainLevelGain : engine.outputMakeup]);
    if (mode === 'operator') assert.deepEqual(engine.mainLevelGain.connections, [engine.outputMakeup]);
    assert.deepEqual(engine.outputMakeup.connections, [engine.compressor]);
    assert.deepEqual(engine.compressor.connections, [engine.outputHeadroom]);
    assert.equal(engine.outputHeadroom.gain.value, 1 / OUTPUT_LIMIT_INPUT_RANGE);
    assert.deepEqual(engine.outputHeadroom.connections, [engine.outputSafety]);
    assert.deepEqual(engine.outputSafety.connections, [mode === 'operator' ? engine.mainOutputGate : context.destination]);
    if (mode === 'operator') assert.deepEqual(engine.mainOutputGate.connections, [context.destination]);
    assert.equal(engine.outputSafety.curve, outputProtectionCurve(mode));
    assert.equal(engine.outputSafety.oversample, 'none');
    engine.setMuted(true); assert.equal(engine._outputGain(), 0);
    engine.setSceneState({ id: 'ended', elapsedMs: 0 }); engine.setMuted(false);
    assert.equal(engine._outputGain(), 0);
  }
  for (const mode of ['operator', 'phone']) {
    const curve = outputProtectionCurve(mode);
    assert.equal(curve[(curve.length - 1) / 2], 0);
    for (let index = 0; index < curve.length; index++) {
      assert.ok(Math.abs(curve[index]) <= OUTPUT_LIMIT_CEILING + 1e-7);
      if (index) assert.ok(curve[index] >= curve[index - 1]);
      if (mode === 'phone') assert.equal(curve[index], Math.fround(smoothPeakLimit((2 * index / 131072 - 1) * OUTPUT_LIMIT_INPUT_RANGE)), 'The phone safety curve is sample-identical to v27.');
    }
  }
  const mainCurve = outputProtectionCurve('operator'), phoneCurve = outputProtectionCurve('phone');
  assert.ok(mainCurve[68864] > phoneCurve[68864], 'Main preserves more of a .8125 transient before the unchanged ceiling.');
  for (const value of [-.7, -.001, 0, .001, .7]) assert.equal(smoothPeakLimit(value), value);
  for (const value of [.8, 1, 4, 16]) {
    assert.ok(smoothPeakLimit(value) <= OUTPUT_LIMIT_CEILING);
    assert.equal(smoothPeakLimit(-value), -smoothPeakLimit(value));
  }
});

test('Main eases one-time crest reduction while phones retain their existing treatment and natural rain stays linear', () => {
  const context = new FakeContext(), buffer = context.createBuffer(2, 160000, 8000);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) data[index] = index < 1000 ? 0 : .02 * Math.sin(index * .271 + channel);
    data[8000] = .8; data[8001] = -.8;
  }
  const clone = () => {
    const result = context.createBuffer(2, buffer.length, buffer.sampleRate);
    for (let channel = 0; channel < 2; channel++) result.getChannelData(channel).set(buffer.getChannelData(channel));
    return result;
  };
  const rain = clone(), mainRain = clone(), transient = clone(), mainTransient = clone();
  prepareRecording(rain, { naturalRain: true }); prepareRecording(mainRain, { naturalRain: true, mode: 'operator' });
  prepareRecording(transient); prepareRecording(mainTransient, { mode: 'operator' });
  const natural = recordingPreparation(rain), treated = recordingPreparation(transient), main = recordingPreparation(mainTransient);
  assert.equal(natural.transientConditioned, false); assert.equal(treated.transientConditioned, true);
  assert.ok(treated.after.rms > natural.after.rms * 1.3);
  assert.ok(treated.gain / treated.previousGain <= 10 ** (3 / 20) + 1e-12);
  assert.ok(main.gain / main.previousGain <= 10 ** (1.5 / 20) + 1e-12);
  assert.ok(main.after.peak / main.after.rms > treated.after.peak / treated.after.rms * 1.15, 'Main preserves a larger crest than the phone treatment.');
  assert.equal(recordingPreparation(mainRain).gain, natural.gain);
  assert.ok(treated.after.peak < .95); assert.ok(natural.after.peak <= .950001);
  for (let index = 0; index < rain.length; index++) {
    assert.ok(Math.abs(rain.getChannelData(0)[index] - buffer.getChannelData(0)[index] * natural.gain) < 1e-7);
    assert.equal(mainRain.getChannelData(0)[index], rain.getChannelData(0)[index], 'Natural rain retains exactly the same samples on both roles.');
    assert.equal(transient.getChannelData(0)[index], Math.fround(smoothPeakLimit(buffer.getChannelData(0)[index] * treated.gain, .78, .95)), 'Phone recording preparation stays sample-identical to v27.');
    if (index < 1000) assert.equal(transient.getChannelData(0)[index], 0, 'Conditioning preserves a silent guard exactly.');
  }
  const silent = context.createBuffer(1, 1024, 8000); prepareRecording(silent);
  assert.equal(recordingPreparation(silent).after.rms, 0);
});

test('switching to the projection tab keeps operator Main playing while hidden phones still mute', async t => {
  for (const mode of ['operator', 'phone']) {
    const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const { engine } = harness(t, { mode, document });
    await engine.enable(); document.hidden = true; engine._visibilityListener();
    assert.equal(engine.hidden, mode === 'phone');
    if (mode === 'operator') assert.equal(engine.context.state, 'running');
  }
});

test('the original Db2 Ab2 Eb3 drone stays fixed while its half-level duplicate descends continuously with cooling', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 });
  engine.setProgression({ sourceCount: 100, outCount: 0, heat: 1 }); await engine.enable();
  const drone = engine.mainDrone, oscillators = [...drone.oscillators], original = [37, 44, 51].map(patchFrequencyForMidi), smooth = value => value * value * (3 - 2 * value);
  assert.deepEqual(MAIN_DRONE_MIDI, [37, 44, 51]); assert.deepEqual(MAIN_DRONE_AMPLITUDES, [.72, .24, .34]);
  assert.equal(MAIN_DRONE_LEVEL, .05); assert.equal(drone.filter.type, 'lowpass'); assert.equal(drone.filter.frequency.value, 360);
  assert.deepEqual(oscillators.map(node => node.frequency.value), [...original, ...original]);
  assert.deepEqual(drone.partials.map(node => node.gain.value), [.36, .12, .17, .36, .12, .17]);
  assert.ok(oscillators.every(node => node.type === 'custom' && node.wave === engine.mainDroneWave));
  assert.equal(engine.mainDroneWave.options.disableNormalization, true, 'The assigned fundamental retains its original coefficient.');
  assert.equal(MAIN_DRONE_OVERTONES[1], 1);
  assert.ok(MAIN_DRONE_OVERTONES[2] > 0 && MAIN_DRONE_OVERTONES[3] > 0 && MAIN_DRONE_OVERTONES[5] > 0);
  assert.ok(MAIN_DRONE_OVERTONES.reduce((power, amplitude) => power + amplitude ** 2, 0) < 1.04, 'Extra harmonic body has less than0.2dB additional unfiltered energy.');
  for (let index = 0; index < 3; index++) {
    assert.equal(drone.partials[index].gain.value + drone.partials[index + 3].gain.value, MAIN_DRONE_AMPLITUDES[index], 'Coherent unison copies reproduce each original harmonic level.');
    assert.equal(oscillators[index].startedAt, oscillators[index + 3].startedAt, 'Paired harmonic copies begin with the same phase.');
  }
  let previous = original[0];
  for (const progress of [0, .25, .5, .75, 1]) {
    context.advance(.1); engine.setProgression({ sourceCount: 100, outCount: progress * 100, heat: 1 });
    const frequencies = oscillators.map(node => node.frequency.value), expected = original.map(frequency => frequency * .75 ** smooth(progress));
    assert.deepEqual(engine.mainDrone.oscillators, oscillators, 'Cooling retains both continuous harmonic banks.');
    assert.deepEqual(frequencies.slice(0, 3), original, 'All three harmonics of the original drone stay fixed.');
    assert.deepEqual(frequencies.slice(3), expected); assert.deepEqual(engine.getMetrics().mainDrone.frequencies, frequencies);
    assert.deepEqual(engine.getMetrics().mainDrone.harmonicLevels, [.72, .24, .34]);
    assert.equal(engine.getMetrics().mainDrone.coolingProgress, smooth(progress));
    assert.ok(frequencies[3] <= previous); if (progress < 1) assert.ok(frequencies[3] > original[0] * .75);
    assert.ok(oscillators.every(node => node.frequency.events.at(-1)[0] === 'target' && node.frequency.events.at(-1)[3] === 4));
    previous = frequencies[3];
  }
  engine.setProgression({ sourceCount: 100, outCount: 0, heat: .25 });
  assert.deepEqual(oscillators.map(node => node.frequency.value), [...original, ...original.map(frequency => frequency * .75 ** smooth(.75))], 'Confirmed heat loss moves only the duplicate bank before an out flag.');
  engine.setProgression({ sourceCount: 100, outCount: 67, heat: 1 }); const at67 = oscillators[3].frequency.value;
  engine.setProgression({ sourceCount: 100, outCount: 68, heat: 1 });
  assert.ok(at67 - oscillators[3].frequency.value < original[0] * .01, 'The former 67 percent threshold has no harmonic jump.');
  engine.setProgression({ sourceCount: 100, outCount: 0, heat: 1 });
  assert.deepEqual(oscillators.map(node => node.frequency.value), [...original, ...original]);
});

test('closing insects crossfade with rain on Main over thirty seconds before the PA hold and phone handoff', async t => {
  for (const mode of ['operator', 'phone']) {
    const { engine } = harness(t, { mode });
    for (const elapsedMs of [0, 30000, 38000, 42000, 50000, 58000, 60000]) {
      const scene = { id: 'final-rain', elapsedMs }, score = computeSceneScore(scene);
      engine.setProgression({ sourceCount: 100, outCount: 0, heat: 1 - score.finalRainProgress, moisture: score.finalRainProgress });
      engine.setSceneState(scene);
      assert.equal(engine._cricketGain(), 0, 'Cooling and an all-out map cannot reveal closing insects during rain.');
    }
    const before = engine._cricketGain(), beforeCrackle = engine._phoneBed().gain;
    engine.setProgression({ sourceCount: 100, outCount: 100, heat: 0, moisture: 1 });
    assert.equal(engine._cricketGain(), before); assert.equal(engine._phoneBed().gain, beforeCrackle);
    assert.equal(beforeCrackle, 0);
    assert.equal(before, 0);
    for (const elapsedMs of [0, 7500, 15000, 22500, 30000]) {
      engine.setSceneState({ id: 'afterglow', elapsedMs, paused: true });
      const progress = elapsedMs / 30000, smooth = progress * progress * (3 - 2 * progress);
      const expected = mode === 'operator' ? .045 * Math.sin(smooth * Math.PI / 2) : 0;
      assert.ok(Math.abs(engine._cricketGain() - expected) < 1e-12);
      if (mode === 'operator') assert.ok(Math.abs(engine._fieldSceneGain() ** 2 + (engine._cricketGain() / .045) ** 2 - 1) < 1e-12, 'The rain field and Main insects follow one equal-power overlap.');
    }
    engine.setSceneState({ id: 'afterglow', elapsedMs: 32000, paused: true });
    assert.equal(engine._cricketGain(), mode === 'operator' ? .045 : 0);
    engine.setSceneState({ id: 'afterglow', elapsedMs: 34000, paused: true });
    assert.equal(engine._cricketGain(), mode === 'operator' ? .045 : 0);
    engine.setSceneState({ id: 'afterglow', elapsedMs: 42000, paused: true });
    assert.equal(engine._cricketGain(), mode === 'operator' ? .045 : 0);
    engine.setSceneState({ id: 'afterglow', elapsedMs: 48000, paused: true });
    assert.ok(Math.abs(engine._cricketGain() - (mode === 'operator' ? .045 : PHONE_CRICKET_LEVEL) * Math.SQRT1_2) < 1e-12);
    engine.setSceneState({ id: 'afterglow', elapsedMs: 54000, paused: true });
    assert.equal(engine._cricketGain(), mode === 'operator' ? 0 : PHONE_CRICKET_LEVEL);
    engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); engine.setProgression({ sourceCount: 527, outCount: 300 });
    if (mode === 'phone') assert.equal(engine._cricketGain(), PHONE_CRICKET_LEVEL * phoneCricketParameters({ sourceCount: 527, outCount: 300 }).weight, 'Participation still follows actual map-wide extinction.');
  }
});

test('additional residue takes load on Main only and expose every configured candidate without changing global morph endpoints', async t => {
  const { engine, requests } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  const bank = { ash: [{ id: 'fine', url: '/ash-fine-extra.mp3' }, { id: 'settle', url: '/ash-settle-extra.mp3' }] };
  await engine.setResidueSources(bank); assert.equal(requests.length, 0);
  await engine.enable(); await engine._loadResidueSources();
  assert.equal(engine._patchTextureCandidates('ash').filter(entry => entry.buffer).length, 2);
  assert.equal(engine.variations.has('ash'), false);
  const count = requests.length; await engine.setResidueSources(bank); assert.equal(requests.length, count);
  const phone = harness(t); assert.equal(await phone.engine.setResidueSources(bank), false);
});

test('all five macros alter non-gain synthesis parameters nonlinearly', () => {
  const parameters = { haze: 'fireCutoff', forest: 'grainDensity', ash: 'fireHighpass', rain: 'rainScatter', moisture: 'damping' };
  for (const [macro, parameter] of Object.entries(parameters)) {
    const lo = macroParameters({ [macro]: 0 })[parameter], mid = macroParameters({ [macro]: .5 })[parameter], hi = macroParameters({ [macro]: 1 })[parameter];
    assert.notEqual(lo, hi, macro);
    assert.ok(Math.abs(mid - (lo + hi) / 2) > Math.abs(hi - lo) * .03, `${macro} maps nonlinearly`);
  }
  assert.equal(macroParameters().macros.haze, SOUND_MACRO_DEFAULTS.haze);
  assert.equal(macroParameters({ rain: 100, ash: -30, haze: NaN }).macros.rain, 1);
  assert.equal(macroParameters({ ash: -30 }).macros.ash, 0);
});

test('all macro extremes have finite safe values and bounded feedback', () => {
  for (let mask = 0; mask < 32; mask++) {
    const values = Object.fromEntries(Object.keys(SOUND_MACRO_DEFAULTS).map((name, i) => [name, (mask >> i) & 1]));
    const p = macroParameters(values);
    for (const [name, value] of Object.entries(p)) if (name !== 'macros') assert.ok(Number.isFinite(value) && value >= 0, name);
    assert.ok(p.feedback < .5); assert.ok(p.grainDensity < 40); assert.ok(p.delaySeconds < 1.1);
  }
});

test('quiet recordings get bounded makeup gain and silence never explodes', () => {
  assert.equal(sampleMakeupGain(0), 1); assert.equal(sampleMakeupGain(NaN), 1);
  assert.equal(sampleMakeupGain(.001), 18); assert.ok(sampleMakeupGain(.006) > sampleMakeupGain(.08));
  assert.ok(sampleMakeupGain(2) >= .35);
});

test('phone macro bed preserves crackle presence without changing for a local finger', () => {
  const dry = [{ key: 'a', heat: 1, moisture: 0, extinguished: false }];
  const wet = [{ ...dry[0], moisture: 1 }];
  const dryBed = phoneBedParameters(dry), touching = phoneBedParameters(dry, 'a'), wetBed = phoneBedParameters(wet);
  assert.equal(dryBed.gain, .04 * PHONE_CRACKLE_GAIN); assert.equal(touching.gain, dryBed.gain);
  assert.ok(wetBed.gain < dryBed.gain && wetBed.gain >= .016); assert.ok(wetBed.cutoff < dryBed.cutoff && wetBed.cutoff >= 600);
  assert.equal(phoneBedParameters([{ ...wet[0], extinguished: true }]).gain, 0);
  assert.equal(phoneBedParameters([]).gain, 0);
  const local = phoneBedParameters([dry[0], { key: 'b', heat: 1, moisture: 1 }], 'b');
  assert.equal(local.moisture, phoneBedParameters([dry[0], { key: 'b', heat: 1, moisture: 1 }]).moisture);
  const released = phoneBedParameters([dry[0], { key: 'b', heat: 1, moisture: 1 }], 'b', { touching: false });
  assert.equal(released.moisture, local.moisture); assert.equal(released.cutoff, local.cutoff);
  assert.equal(released.touchDucking, 1); assert.equal(released.gain, local.gain);
});

test('forest macro migrates charcoal and substantially increases irregular fire density', async t => {
  assert.equal('charcoal' in SOUND_MACRO_DEFAULTS, false);
  assert.equal(macroParameters({ charcoal: .8 }).macros.forest, .8);
  assert.equal(macroParameters({ charcoal: .8, forest: .2 }).macros.forest, .2);
  assert.ok(macroParameters({ forest: 1 }).grainDensity > macroParameters({ forest: .5 }).grainDensity * 6);
  const { engine, context } = harness(t, { mode: 'operator' });
  engine.setMacro('charcoal', .8); assert.equal(engine.macros.forest, .8);
  engine.setMacros({ forest: 1, moisture: 0 }); engine.setPatches([patch('a', 1)]); await engine.enable();
  for (let i = 0; i < 20; i++) { context.advance(.16); engine._tick(); assert.ok(engine.grains.size <= 24); }
  const grainFilters = context.nodes.filter(node => node.nodeType === 'filter' && node.Q.value === .35);
  assert.ok(grainFilters.length > 50); assert.ok(grainFilters.every(node => node.type !== 'bandpass'));
  const starts = context.nodes.filter(node => node.nodeType === 'source' && node.stoppedAt != null).map(node => node.startedAt);
  const intervals = starts.slice(1).map((value, index) => Math.round((value - starts[index]) * 1000));
  assert.ok(new Set(intervals).size > 10);
  assert.equal(engine.layers.get('rain').sampleGate.gain.value, 0);
  assert.equal(engine._cricketGain(), 0);
});

test('confirmed overall extinction starts crickets independently of the touched patch', async t => {
  const { engine, requests } = harness(t);
  engine.setPatches([patch('a', .2), patch('b', 1)]); await engine.enable(); engine.touch('a'); await flush();
  assert.equal(requests.some(url => url.endsWith('crickets.mp3')), false);
  engine.setPatches([patch('a', 0, true), patch('b', 1)]); await flush();
  assert.equal(requests.filter(url => url.endsWith('crickets.mp3')).length, 1);
  const globalGain = engine._cricketGain(); assert.ok(globalGain > 0); engine.release(); assert.equal(engine._cricketGain(), globalGain);
  engine.touch('b'); assert.equal(engine._cricketGain(), globalGain);
  assert.equal(engine.layers.get('crickets').gain.gain.value, globalGain);
});

test('global progression crossfades fire/crickets at zero, halfway, and complete extinction with partial local patches', async t => {
  const { engine, requests } = harness(t);
  engine.setPatches([{ ...patch('local-out', 0, true), moisture: 0 }]);
  assert.equal(engine.setProgression({ sourceCount: 100, outCount: 0 }), true);
  await engine.enable(); await flush(); engine.touch('local-out');
  assert.equal(engine.layers.get('crackle').gain.gain.value, .04 * PHONE_CRACKLE_GAIN);
  assert.equal(engine.layers.get('crickets').gain.gain.value, 0);
  assert.equal(requests.some(url => url.endsWith('crickets.mp3')), false);
  engine.setProgression({ sourceCount: 100, outCount: 50 }); await flush();
  const middle = engine.getMetrics().phoneBed;
  assert.ok(Math.abs(middle.fireWeight - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(middle.cricketWeight - phoneCricketParameters({ sourceCount: 100, outCount: 50 }).weight) < 1e-12);
  assert.ok(Math.abs(middle.gain - .04 * PHONE_CRACKLE_GAIN * Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(middle.cricketGain - PHONE_CRICKET_LEVEL * phoneCricketParameters({ sourceCount: 100, outCount: 50 }).weight) < 1e-12);
  assert.equal(requests.filter(url => url.endsWith('crickets.mp3')).length, 1);
  engine.setProgression({ sourceCount: 100, outCount: 100 });
  // Global counts win even if a stale local patch still looks hot or very wet.
  engine.setPatches([{ ...patch('stale-hot', 1), moisture: 1 }]); engine.touch('stale-hot');
  assert.equal(engine.layers.get('crackle').gain.gain.value, 0);
  assert.equal(engine.layers.get('crickets').gain.gain.value, PHONE_CRICKET_LEVEL);
  assert.equal(engine.voices.size, 0, 'A stale local hot value cannot restart a phone tone after global extinction.');
  engine.release(); assert.equal(engine._cricketGain(), PHONE_CRICKET_LEVEL);
  assert.deepEqual(engine.getMetrics().progression, { sourceCount: 100, outCount: 100, fraction: 1 });
});

test('invalid global counts retain last confirmed progression; omitted counts and reset return to patch fallback', () => {
  const engine = new WildfireSound({ document: null });
  engine.setPatches([patch('out', 0, true), patch('hot', 1)]);
  assert.equal(engine.setProgression({ sourceCount: 20, outCount: 5 }), true);
  for (const invalid of [null, {}, { sourceCount: 2, outCount: 3 }, { sourceCount: 2.5, outCount: 1 }, { sourceCount: '2', outCount: 1 }, { sourceCount: Infinity, outCount: 0 }, { sourceCount: 2, outCount: -1 }]) {
    assert.equal(engine.setProgression(invalid), false);
    assert.equal(engine.getMetrics().progression.fraction, .25);
  }
  engine.setProgression(undefined); assert.equal(engine.getMetrics().progression.fraction, .5);
  engine.setProgression({ sourceCount: 20, outCount: 20 }); engine.reset('new');
  assert.deepEqual(engine.getMetrics().progression, { sourceCount: 0, outCount: 0, fraction: 0 });
  assert.deepEqual(fireProgression({ sourceCount: 5, outCount: 9 }), { sourceCount: 5, outCount: 5, fraction: 1 });
  engine.destroy();
});

test('main cricket blend follows actual extinction even when a manual forest control is retained', async t => {
  const { engine } = harness(t, { mode: 'operator' });
  engine.setMacro('forest', 1);
  engine.setPatches([patch('a', 0, true), patch('b', .01)]);
  assert.equal(engine._cricketGain(), .045 * .5 ** 3);
  engine.setMacro('forest', 0); assert.equal(engine._cricketGain(), .045 * .5 ** 3);
  engine.setPatches([patch('a', 0, true), patch('b', 0, true)]);
  assert.equal(engine._cricketGain(), .045);
  engine.setPatches([]);
  assert.equal(engine._cricketGain(), 0);
});

test('construction is inert and enable resumes before requesting samples', async t => {
  const { engine, events, requests } = harness(t);
  assert.deepEqual(events, []); assert.equal(engine.timer, null);
  const started = engine.enable();
  assert.deepEqual(events.slice(0, 2), ['context', 'resume']);
  assert.equal(await started, true); await flush();
  assert.ok(events.indexOf('resume') < events.indexOf('fetch'));
  assert.ok(requests.includes('/audio-assets/fire-crackle.mp3')); assert.equal(requests.filter(url => url.includes('rain')).length, 0);
  assert.equal(engine.getMetrics().degraded, true); assert.equal(engine.getMetrics().state, 'ready');
});

test('playback session requests detect support, tolerate restrictions and avoid unnecessary category changes', () => {
  let type = 'auto', writes = 0;
  const session = { get type() { return type; }, set type(value) { type = value; writes++; } };
  assert.equal(requestPlaybackAudioSession({ audioSession: session }), true);
  assert.equal(type, 'playback'); assert.equal(writes, 1);
  assert.equal(requestPlaybackAudioSession({ audioSession: session }), true);
  assert.equal(writes, 1, 'An already configured session does not reconfigure the audio system.');
  const unavailable = [{}, null, { audioSession: null }, { audioSession: {} },
    { get audioSession() { throw new Error('restricted'); } },
    { audioSession: { get type() { throw new Error('restricted'); } } },
    { audioSession: { get type() { return 'auto'; }, set type(value) { throw new Error('unsupported'); } } },
    { audioSession: { get type() { return 'auto'; }, set type(value) {} } }];
  for (const navigator of unavailable) assert.equal(requestPlaybackAudioSession(navigator), false);
});

test('only a phone activation requests playback, synchronously before creating or resuming Web Audio', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let type = 'auto', reads = 0, writes = 0;
  let sessionEvents = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    get audioSession() {
      reads++;
      return { get type() { return type; }, set type(value) { writes++; type = value; sessionEvents.push('playback'); } };
    },
  } });
  t.after(() => original ? Object.defineProperty(globalThis, 'navigator', original) : delete globalThis.navigator);
  const { engine, events, context } = harness(t); sessionEvents = events;
  assert.equal(reads, 0); assert.equal(writes, 0);
  const started = engine.enable();
  assert.deepEqual(events.slice(0, 3), ['playback', 'context', 'resume']);
  assert.equal(await started, true);
  engine.disable(); type = 'auto'; events.length = 0;
  const restarted = engine.enable();
  assert.deepEqual(events.slice(0, 2), ['playback', 'resume']);
  assert.equal(await restarted, true); assert.equal(engine.context, context);
  const readCount = reads, operator = harness(t, { mode: 'operator' });
  await operator.engine.enable();
  assert.equal(reads, readCount, 'Main keeps its existing audio-session behavior.');
  const resumeCount = events.filter(event => event === 'resume').length;
  context.state = 'interrupted'; context.onstatechange();
  assert.equal(engine.timer, null); assert.equal(engine.state, 'suspended');
  assert.equal(events.filter(event => event === 'resume').length, resumeCount, 'An interruption does not trigger a forced resume.');
  engine.setMuted(true); context.state = 'running'; context.onstatechange();
  assert.equal(engine.timer, null); assert.equal(engine.state, 'muted'); assert.equal(roleGain(engine), 0);
  engine.setHidden(true); engine.setMuted(false); context.onstatechange();
  assert.equal(engine.timer, null); assert.equal(engine.state, 'suspended'); assert.equal(roleGain(engine), 0);
  assert.equal(reads, readCount, 'Mute, visibility and interruption handling do not reconfigure the session.');
});

test('a rejected playback category still permits normal phone audio activation', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    get audioSession() { throw new Error('Audio Session API blocked'); },
  } });
  t.after(() => original ? Object.defineProperty(globalThis, 'navigator', original) : delete globalThis.navigator);
  const { engine, events } = harness(t);
  assert.equal(await engine.enable(), true);
  assert.deepEqual(events.slice(0, 2), ['context', 'resume']);
  assert.equal(engine.state, 'ready');
});

test('operator loads distinct layers while no phone oscillators are created', async t => {
  const { engine, requests, context } = harness(t, { mode: 'operator' });
  engine.setPatches([patch('a')]); engine.touch('a'); await engine.enable(); await flush();
  assert.deepEqual(requests.sort(), ['/audio-assets/burning-forest.mp3', '/audio-assets/charcoal.mp3', '/audio-assets/fire-roar.mp3', '/audio-assets/rain.mp3']);
  assert.equal(engine.voices.size, 0); assert.ok(!context.nodes.some(node => node.nodeType === 'oscillator'));
  assert.ok(engine.layers.get('roar').filter !== engine.layers.get('rain').filter);
});

test('phone sample loops use the audio clock and survive late scheduler ticks without new sources', async t => {
  const { engine, context } = harness(t, { fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) });
  await engine.enable(); await flush();
  assert.deepEqual(engine.getMetrics().loadedSamples, ['crackle']);
  const layer = engine.layers.get('crackle'), first = [...layer.sources][0];
  assert.ok(first); assert.equal(first.envelope.gain.events.filter(event => event[0] === 'curve').length, 1);
  assert.equal(first.source.loop, true); assert.equal(first.source.stoppedAt, undefined);
  for (const seconds of [.1, 20, .01, 3, 200, .8, 50]) { context.advance(seconds); engine._tick(); assert.deepEqual([...layer.sources], [first]); }
  assert.equal(layer.nextAt, Infinity);
  const metrics = engine.getMetrics().sampleLoops.crackle[0];
  assert.equal(metrics.nativeLoop, true); assert.equal(metrics.crossfadeSeconds, .5);
  engine.disable(); assert.equal(first.source.disconnected, true);
});

test('phone crackle circularly conditions a whole native recording and keeps moisture filtering and presence', async t => {
  const { engine, context } = harness(t, { fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) });
  context.decodeAudioData = async () => context.createBuffer(1, 120000, 8000);
  engine.setPatches([{ ...patch('hot', 1), moisture: 0 }]); await engine.enable(); await flush();
  const layer = engine.layers.get('crackle'), first = [...layer.sources][0];
  assert.equal(first.buffer.duration, 14.45); assert.equal(first.source.playbackRate.value, 1); assert.equal(first.source.offset, 0);
  assert.equal(first.source.loopEnd, 14.45); assert.equal(first.source.stoppedAt, undefined);
  assert.equal(layer.presence.type, 'peaking'); assert.equal(layer.presence.gain.value, 4.2);
  assert.equal(layer.presence.frequency.value, 420);
  assert.ok(layer.filter.frequency.value >= 3500 && layer.filter.frequency.value <= 3800);
  context.advance(100); engine._tick(); assert.deepEqual([...layer.sources], [first]);
  engine.setPatches([{ ...patch('hot', 1), moisture: 1 }]);
  assert.equal(layer.filter.frequency.value, 600); assert.equal(layer.presence.gain.value, 4.2);
  assert.equal(layer.gain.connections.includes(engine.delaySend), false, 'The presence lift never routes fire into room echoes.');
});

test('disable aborts stale decoding and later enable does not accept old responses', async t => {
  let resolveFetch;
  const pending = new Promise(resolve => { resolveFetch = resolve; });
  const { engine } = harness(t, { fetchImpl: () => pending });
  await engine.enable(); engine.disable();
  resolveFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }); await flush();
  assert.equal(engine.getMetrics().loadedSamples.length, 0); assert.equal(engine.timer, null);
  assert.equal(engine.getMetrics().voiceCount, 0); assert.equal(engine.getMetrics().samplePending.length, 0);
});

test('mute, hidden, reset, disable, and destroy cleanly retain intended state', async t => {
  const { engine, context } = harness(t);
  engine.setLevel(.7); engine.setPatches([patch('a', 0, true)]); await engine.enable(); engine.touch('a');
  engine.setMuted(true); assert.equal(engine.getMetrics().state, 'muted'); assert.equal(engine.timer, null);
  assert.equal(await engine.enable(), true); assert.equal(engine.getMetrics().muted, false); assert.equal(engine.getMetrics().state, 'ready');
  engine.setHidden(true); assert.equal(engine.getMetrics().state, 'suspended'); assert.equal(engine.timer, null);
  engine.setHidden(false); await flush(); assert.equal(engine.getMetrics().state, 'ready');
  assert.equal(roleGain(engine), .7);
  engine.reset('new-epoch'); assert.equal(engine.voices.size, 0); assert.equal(engine.patches.size, 0);
  engine.disable(); assert.equal(engine.getMetrics().state, 'off'); assert.equal(engine.getMetrics().activeSources, 0);
  engine.destroy(); assert.equal(context.state, 'closed'); assert.equal(engine.timer, null); assert.equal(engine.suspendTimer, null);
  assert.equal(await engine.enable(), false);
});

test('unsupported or blocked Web Audio exposes a useful recoverable error', async t => {
  const { engine, statuses } = harness(t, { contextFactory: () => { throw new Error('Web Audio unavailable'); } });
  assert.equal(await engine.enable(), false); assert.equal(engine.state, 'error');
  assert.match(statuses.at(-1).message, /unavailable/);
});

test('supporting fire is dry, softly attacked, and bounded away from bass booms and brittle transients', async t => {
  for (const intensity of [0, .5, 1]) for (const variation of [0, .2, .8, 1]) for (const moisture of [0, 1]) {
    const shape = dryFireTextureParameters(intensity, variation, moisture);
    assert.ok(shape.attack >= .022 && shape.attack <= .06);
    assert.ok(shape.duration > shape.attack + .1);
    assert.ok(shape.gain <= .020001); assert.ok(shape.highpass >= 180); assert.ok(shape.lowpass <= 3500);
    assert.ok(shape.resonance < .5);
  }
  const p = macroParameters({ forest: 1, haze: 0, moisture: 0 });
  assert.equal(p.feedback, 0); assert.equal(p.delaySend, 0); assert.ok(p.saturation <= 2.2); assert.ok(p.fireCutoff <= 5800);
  const { engine } = harness(t, { mode: 'operator' });
  engine.setPatches([patch('a', 1)]); await engine.enable();
  assert.equal(engine.delayReturn.gain.value, 0);
  assert.equal(engine.layers.get('charcoal').gain.connections.includes(engine.delaySend), false);
});

test('alternative source choices stay inert before enabling and only the selected URL is fetched', async t => {
  const { engine, requests } = harness(t, { mode: 'operator' });
  assert.equal(await engine.setForestSource('/audio-assets/dry-forest.mp3'), true);
  assert.equal(await engine.setLayerSource('rain', '/audio-assets/dry-rain.mp3'), true);
  assert.deepEqual(requests, []); assert.equal(engine.context, null);
  assert.equal(await engine.setLayerSource('crackle', '/wrong-mode.mp3'), false);
  assert.equal(await engine.setForestSource('  '), false);
  await engine.enable(); await flush();
  assert.ok(requests.includes('/audio-assets/dry-forest.mp3')); assert.ok(!requests.includes('/audio-assets/burning-forest.mp3'));
  assert.equal(engine.getMetrics().selectedSources.forest, '/audio-assets/dry-forest.mp3');
});

test('late alternative decode cannot replace a newer selection', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) });
  engine.setPatches([patch('a', 1)]); await engine.enable(); await flush();
  const pendingDecodes = [];
  context.decodeAudioData = () => new Promise(resolve => pendingDecodes.push(resolve));
  const first = engine.setForestSource('/alternative-a.mp3'); await flush();
  const second = engine.setForestSource('/alternative-b.mp3'); await flush();
  assert.equal(pendingDecodes.length, 2);
  const newer = context.createBuffer(1, 16000, 8000); pendingDecodes[1](newer);
  assert.equal(await second, true); assert.equal(engine.layers.get('forest').buffer, newer);
  pendingDecodes[0](context.createBuffer(1, 24000, 8000)); assert.equal(await first, false);
  assert.equal(engine.layers.get('forest').buffer, newer); assert.equal(engine.getMetrics().currentSources.forest, '/alternative-b.mp3');
  assert.deepEqual(engine.getMetrics().samplePending, []); assert.equal(engine.sourceRequests.size, 0);
});

test('failed alternative retains the working recording and reports the selected error', async t => {
  const { engine } = harness(t, { mode: 'operator', fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) });
  await engine.enable(); await flush(); const previous = engine.layers.get('forest').buffer;
  engine.fetchImpl = async () => ({ ok: false, status: 404 });
  assert.equal(await engine.setForestSource('/missing-forest.mp3'), false);
  assert.equal(engine.layers.get('forest').buffer, previous);
  assert.equal(engine.getMetrics().currentSources.forest, '/audio-assets/burning-forest.mp3');
  assert.equal(engine.getMetrics().selectedSources.forest, '/missing-forest.mp3');
  assert.equal(engine.getMetrics().sourceErrors.forest.url, '/missing-forest.mp3');
  assert.match(engine.getMetrics().message, /previous sound/);
});

test('alternative switching fades old windows and stays bounded under rapid selections', async t => {
  const { engine, context, events } = harness(t, { mode: 'operator', fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) });
  engine.setPatches([patch('a', 1)]); await engine.enable(); await flush();
  const layer = engine.layers.get('forest'), previous = [...layer.sources][0], resumeCount = events.filter(event => event === 'resume').length;
  assert.ok(previous);
  assert.equal(await engine.setForestSource('/alternative-0.mp3'), true);
  assert.ok(previous.envelope.gain.events.some(event => event[0] === 'linear' && event[1] === 0));
  assert.equal(previous.source.stoppedAt, context.currentTime + .82);
  for (let index = 1; index <= 30; index++) { assert.equal(await engine.setForestSource(`/alternative-${index}.mp3`), true); assert.ok(layer.sources.size <= 6); }
  assert.equal(events.filter(event => event === 'resume').length, resumeCount);
  context.advance(2); engine._tick(); assert.ok(layer.sources.size <= 2);
  engine.disable(); context.advance(MAIN_DISABLE_FADE_SECONDS + .03); assert.equal(layer.sources.size, 0); assert.equal(engine.sourceRequests.size, 0);
});

test('changing a muted source never resumes playback and disabling rejects in-flight decode', async t => {
  const { engine, context, events } = harness(t, { mode: 'operator', fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) });
  await engine.enable(); await flush(); engine.setMuted(true);
  const count = events.filter(event => event === 'resume').length;
  assert.equal(await engine.setForestSource('/muted-selection.mp3'), true);
  assert.equal(events.filter(event => event === 'resume').length, count); assert.equal(engine.getMetrics().state, 'muted');
  let finishDecode; context.decodeAudioData = () => new Promise(resolve => { finishDecode = resolve; });
  const pending = engine.setForestSource('/later-selection.mp3'); await flush(); engine.disable();
  finishDecode(context.createBuffer(1, 16000, 8000)); assert.equal(await pending, false);
  assert.equal(engine.getMetrics().currentSources.forest, '/muted-selection.mp3');
  assert.deepEqual(engine.getMetrics().samplePending, []); assert.equal(engine.sourceRequests.size, 0);
});

const endpoints = id => [{ url: `/generated/${id}-low.mp3`, at: 0 }, { url: `/generated/${id}-high.mp3`, at: 1 }];
const successfulFetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

test('character interpolation reaches exact endpoints, has equal-power midpoint, and softens the edges', () => {
  assert.deepEqual(variationWeights(0), [1, 0]); assert.deepEqual(variationWeights(1), [0, 1]);
  assert.deepEqual(variationWeights(-1), [1, 0]); assert.deepEqual(variationWeights(5), [0, 1]);
  const midpoint = variationWeights(.5);
  assert.ok(Math.abs(midpoint[0] - Math.SQRT1_2) < 1e-12); assert.ok(Math.abs(midpoint[1] - Math.SQRT1_2) < 1e-12);
  for (let index = 0; index <= 100; index++) { const weights = variationWeights(index / 100); assert.ok(Math.abs(weights[0] ** 2 + weights[1] ** 2 - 1) < 1e-12); }
  assert.ok(variationWeights(.01)[1] < .001);
  assert.deepEqual(variationWeights(.2, [.2, .8]), [1, 0]); assert.deepEqual(variationWeights(.8, [.2, .8]), [0, 1]);
});

test('a configured palette is inert, loads only generated endpoints, and smoothly controls their actual source gains', async t => {
  const { engine, context, requests, events } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  for (const id of ['haze', 'forest', 'ash', 'rain', 'moisture', 'crickets']) assert.equal(await engine.setLayerVariations(id, endpoints(id)), true);
  assert.deepEqual(events, []); assert.deepEqual(requests, []);
  engine.setPatches([patch('burning', 1)]); await engine.enable(); await flush();
  assert.equal(requests.length, 10); assert.ok(requests.every(url => url.startsWith('/generated/') && !url.includes('crickets')));
  for (const id of ['haze', 'forest', 'ash', 'rain', 'moisture']) {
    const layer = engine.layers.get(id), slots = endpoints(id).map(entry => layer.variationSlots.get(entry.url));
    engine.setMacro(id, 0); assert.deepEqual(slots.map(slot => slot.mixGain.gain.value), [1, 0]);
    engine.setMacro(id, .5); assert.deepEqual(slots.map(slot => slot.mixGain.gain.value), variationWeights(id === 'moisture' ? .14 : .5));
    engine.setMacro(id, 1); assert.ok(slots.every((slot, index) => Math.abs(slot.mixGain.gain.value - variationWeights(id === 'moisture' ? .28 : 1)[index]) < 1e-12));
    assert.ok(slots.every(slot => [...layer.sources].some(record => record.slot === slot && record.source.playbackRate.value === 1)));
    assert.equal(layer.shaper.curve, null);
  }
  assert.equal(engine.layers.get('roar').gain.gain.value, 0); assert.equal(engine.layers.get('charcoal').gain.gain.value, 0);
  assert.equal(engine.turbulenceGain.gain.value, 0); assert.equal(engine.ashGain.gain.value, 0);
  assert.equal(engine.getMetrics().sourceModes.forest, 'automatic');
  context.advance(1); engine._tick(); assert.equal(engine.grains.size, 0);
  for (let index = 0; index < 100; index++) { context.advance(.4); engine._tick(); for (const layer of engine.layers.values()) assert.ok(layer.sources.size <= 8); }
});

test('generated haze and ash stay clear, water has soft attacks, and moisture gently damps a broad spectrum', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  context.decodeAudioData = async () => context.createBuffer(1, 80000, 8000);
  for (const id of ['haze', 'forest', 'ash', 'rain', 'moisture']) await engine.setLayerVariations(id, endpoints(id));
  engine.setMacros({ forest: 1, haze: 1, ash: 1, rain: 1, moisture: 0 }); engine.setPatches([patch('a', 1)]);
  await engine.enable(); await flush();
  const dryForestCutoff = engine.layers.get('forest').filter.frequency.value;
  assert.ok(dryForestCutoff >= 1500 && dryForestCutoff <= 2400); assert.ok(engine.layers.get('haze').highpass.frequency.value >= 200);
  assert.equal(engine.layers.get('forest').highpass.frequency.value, 35);
  assert.equal(engine.layers.get('forest').distantBody.gain.value, 0); assert.equal(engine.layers.get('forest').distantAir.gain.value, -9);
  assert.ok(engine.layers.get('haze').filter.frequency.value >= 8000); assert.ok(engine.layers.get('ash').filter.frequency.value >= 10000);
  for (const id of ['rain', 'moisture']) for (const record of engine.layers.get(id).sources) {
    if (id === 'rain') assert.ok(Math.abs(record.source.playbackRate.value - 1) < .025);
    else assert.equal(record.source.playbackRate.value, 1);
    assert.ok(record.envelope.gain.events.find(event => event[0] === 'curve')[3] >= (id === 'rain' ? .4 : 1.7));
    if (id === 'rain') assert.equal(record.source.loop, true);
  }
  engine.setMacro('moisture', 1);
  assert.ok(engine.layers.get('forest').filter.frequency.value < dryForestCutoff);
  assert.ok(engine.layers.get('forest').filter.frequency.value >= 1500);
  assert.ok(engine.layers.get('ash').filter.frequency.value >= 7000);
  assert.ok(engine.layers.get('rain').filter.frequency.value >= 7000);
  assert.equal(engine.layers.get('rain').sampleGate.gain.value, 1);
  assert.ok(engine.layers.get('moisture').filter.frequency.value >= 4000);
  assert.equal(engine.delayReturn.gain.value, 0);
});

test('Main ambience cuts both source endpoints before the independent mixer without riding scene gains', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  for (const id of ['haze', 'rain']) await engine.setLayerVariations(id, endpoints(id));
  await engine.enable(); await flush();
  engine.setMixer({ haze: .45, rain: 1, forest: .5 });
  const originalSources = new Map();
  for (const id of ['haze', 'rain']) {
    const layer = engine.layers.get(id), [first, second] = layer.toneEq;
    assert.equal(layer.toneEq.length, 2);
    assert.ok(layer.toneEq.every(node => node.type === 'peaking' && node.gain.value < 0));
    assert.ok(layer.toneEq.every(node => node.frequency.value >= 1000 && node.frequency.value <= 2100), 'Keep the corrective cuts above the thunder/body range.');
    assert.deepEqual(layer.filter.connections, [first]); assert.deepEqual(first.connections, [second]);
    assert.deepEqual(second.connections, [layer.shaper]); assert.deepEqual(layer.gain.connections, [engine.mixerNodes.get(id)]);
    assert.ok([...layer.variationSlots.values()].every(slot => slot.mixGain.connections.includes(layer.sampleGate)), 'Both existing recordings share the same fixed treatment.');
    originalSources.set(id, [...layer.variationSlots.values()].map(slot => ({ url: slot.currentUrl, buffer: slot.buffer })));
  }
  for (const scene of [{ id: 'arrival' }, { id: 'instructions' }, { id: 'participation' }, { id: 'final-rain', rainIntensity: 1 }]) {
    engine.setSceneState({ ...scene, elapsedMs: 20000 }); context.advance(.3); engine._tick();
    for (const id of ['haze', 'rain']) {
      const layer = engine.layers.get(id);
      assert.ok(layer.toneEq.every(node => node.gain.events.length === 0), 'A scene/mixer change cannot turn these cuts into dynamic gain riding.');
      assert.deepEqual([...layer.variationSlots.values()].map(slot => ({ url: slot.currentUrl, buffer: slot.buffer })), originalSources.get(id));
    }
  }
  assert.equal(engine.mixer.haze, .45); assert.equal(engine.mixer.rain, 1); assert.equal(engine.mixer.forest, .5);
  const { engine: phone } = harness(t, { mode: 'phone', fetchImpl: successfulFetch });
  await phone.enable(); await flush();
  assert.ok([...phone.layers.values()].every(layer => layer.toneEq.length === 0), 'Phone asset balance and processing stay separate.');
});

test('a failed endpoint keeps the other at full power and explicit reconfiguration retries the failure', async t => {
  let failHigh = true;
  const { engine, requests } = harness(t, { mode: 'operator', fetchImpl: async url => url.includes('forest-high') && failHigh ? { ok: false, status: 404 } : successfulFetch() });
  await engine.setLayerVariations('forest', endpoints('forest')); engine.setMacro('forest', 1);
  engine.setPatches([patch('a', 1)]); await engine.enable(); await flush();
  const layer = engine.layers.get('forest');
  assert.equal(layer.variationSlots.get('/generated/forest-low.mp3').mixGain.gain.value, 1);
  assert.equal(engine.getMetrics().failedSamples.includes('forest'), true);
  failHigh = false; assert.equal(await engine.setLayerVariations('forest', endpoints('forest')), true);
  assert.equal(requests.filter(url => url.endsWith('forest-high.mp3')).length, 2);
  assert.equal(layer.variationSlots.get('/generated/forest-high.mp3').mixGain.gain.value, 1);
  assert.deepEqual(engine.getMetrics().failedSamples, []); assert.deepEqual(engine.getMetrics().sourceErrors, {});
});

test('manual source success crossfades automatic windows, and clearing it immediately restores cached morphs', async t => {
  const { engine, context, requests } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  await engine.setLayerVariations('forest', endpoints('forest')); engine.setPatches([patch('a', 1)]); await engine.enable(); await flush();
  const layer = engine.layers.get('forest'), oldAutomatic = [...layer.sources];
  await engine.setForestSource('/manual.mp3');
  assert.ok(oldAutomatic.every(record => record.source.stoppedAt === context.currentTime + .82));
  assert.equal(engine.getMetrics().sourceModes.forest, 'manual');
  const manualRecord = [...layer.sources].find(record => record.url === '/manual.mp3'); assert.ok(manualRecord);
  const requestCount = requests.length;
  assert.equal(await engine.clearLayerSource('forest'), true);
  assert.equal(layer.buffer, null); assert.equal(manualRecord.source.stoppedAt, context.currentTime + .82);
  assert.equal(engine.getMetrics().sourceModes.forest, 'automatic'); assert.equal(requests.length, requestCount);
  assert.ok([...layer.variationSlots.values()].every(slot => slot.buffer));
});

test('a failed manual alternative keeps scheduling the previous automatic sound', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  await engine.setLayerVariations('forest', endpoints('forest')); engine.setPatches([patch('a', 1)]); await engine.enable(); await flush();
  engine.fetchImpl = async () => ({ ok: false, status: 404 });
  assert.equal(await engine.setForestSource('/missing.mp3'), false);
  for (let index = 0; index < 30; index++) { context.advance(.4); engine._tick(); }
  assert.ok(engine.layers.get('forest').sources.size > 0);
  assert.ok([...engine.layers.get('forest').sources].every(record => record.url.startsWith('/generated/forest-')));
});

test('newer automatic configurations reject stale decodes and failed refreshes retain the previous texture', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  await engine.setLayerVariations('forest', endpoints('original')); engine.setPatches([patch('a', 1)]); await engine.enable(); await flush();
  const pending = []; context.decodeAudioData = () => new Promise(resolve => pending.push(resolve));
  const oldSelection = engine.setLayerVariations('forest', endpoints('stale')); await flush();
  const newSelection = engine.setLayerVariations('forest', endpoints('new')); await flush(); assert.equal(pending.length, 4);
  pending[2](context.createBuffer(1, 16000, 8000)); pending[3](context.createBuffer(1, 16000, 8000)); assert.equal(await newSelection, true);
  pending[0](context.createBuffer(1, 16000, 8000)); pending[1](context.createBuffer(1, 16000, 8000)); assert.equal(await oldSelection, false);
  context.advance(2); engine._tick();
  assert.ok(engine.getMetrics().currentVariationSources.forest.every(url => url.includes('/new-')));
  engine.fetchImpl = async () => ({ ok: false, status: 404 });
  assert.equal(await engine.setLayerVariations('forest', endpoints('missing')), false);
  for (let index = 0; index < 30; index++) { context.advance(.4); engine._tick(); }
  assert.ok([...engine.layers.get('forest').sources].some(record => record.url.includes('/new-')));
  assert.ok(engine.layers.get('forest').variationSlots.size <= 4);
});

test('generated cricket pulse stays intact and starts only after verified extinction, including at maximum forest', async t => {
  const { engine, context, requests } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  context.decodeAudioData = async () => context.createBuffer(1, 120000, 8000);
  await engine.setLayerVariations('crickets', endpoints('crickets')); engine.setMacro('forest', 1);
  engine.setPatches([patch('a', .01)]); await engine.enable(); await flush();
  assert.equal(requests.some(url => url.includes('/generated/crickets')), false);
  engine.setPatches([patch('a', 0, true)]); await flush();
  assert.equal(requests.filter(url => url.includes('/generated/crickets')).length, 2);
  const layer = engine.layers.get('crickets');
  assert.equal(layer.gain.gain.value, .045);
  for (const record of layer.sources) {
    assert.equal(record.source.playbackRate.value, 1); assert.ok(record.source.offset >= 0 && record.source.offset < record.buffer.duration);
    assert.equal(record.source.loop, true); assert.equal(record.source.stoppedAt, undefined);
    assert.equal(record.source.loopEnd, 14.975);
    assert.equal(record.envelope.gain.events.find(event => event[0] === 'curve')[3], .22);
  }
  engine.setPatches([patch('a', 1)]); assert.equal(layer.gain.gain.value, 0);
});

test('recordings retain linear detail, decoded phone windows are bounded, and disabling releases all buffers', async t => {
  const { engine, context, requests, events } = harness(t, { fetchImpl: successfulFetch });
  context.decodeAudioData = async () => {
    const buffer = context.createBuffer(3, 240000, 8000);
    for (let channel = 0; channel < 3; channel++) { const data = buffer.getChannelData(channel); for (let index = 0; index < data.length; index++) data[index] = index % 3 === 0 ? .01 : index % 3 === 1 ? .02 : 0; }
    return buffer;
  };
  await engine.setLayerSource('crackle', '/phone-medium.mp3'); assert.deepEqual(requests, []);
  engine.setPatches([patch('a', 1)]); await engine.enable(); await flush();
  const buffer = engine.layers.get('crackle').buffer;
  assert.equal(buffer.duration, 19.45); assert.equal(buffer.numberOfChannels, 1);
  const data = buffer.getChannelData(0), offset = 1; assert.ok(Math.abs(data[offset + 1] / data[offset] - 2) < 1e-6); assert.equal(data[offset + 2], 0);
  assert.equal(engine.layers.get('crackle').shaper.curve, null);
  const dry = engine.layers.get('crackle').filter.frequency.value;
  engine.setPatches([{ ...patch('a', 1), moisture: 1 }]); assert.ok(engine.layers.get('crackle').filter.frequency.value < dry);
  engine.disable(); assert.equal(engine.bufferCache.size, 0); assert.equal(engine.getMetrics().decodedBytes, 0); assert.equal(engine.layers.get('crackle').buffer, null);
  const resumeCount = events.filter(event => event === 'resume').length, requestCount = requests.length;
  await engine.setLayerSource('crackle', '/another-phone.mp3');
  assert.equal(events.filter(event => event === 'resume').length, resumeCount); assert.equal(requests.length, requestCount);
});

test('circular conditioning removes old file fades without a repeated level hole, while preserving cricket pulses', () => {
  const context = new FakeContext(), sampleRate = 8000, input = context.createBuffer(1, sampleRate * 15, sampleRate), data = input.getChannelData(0);
  let seed = 771;
  for (let index = 0; index < data.length; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[index] = (seed / 2147483648 - 1) * .12 * Math.min(1, index / (sampleRate * .12), (data.length - 1 - index) / (sampleRate * .3));
  }
  const output = circularLoopBuffer(context, input), joined = output.getChannelData(0), size = sampleRate / 10;
  const rms = start => Math.sqrt(Array.from({ length: size }, (_, index) => joined[(start + index + joined.length) % joined.length] ** 2).reduce((a, b) => a + b) / size);
  const reference = rms(sampleRate * 2);
  for (let start = joined.length - sampleRate; start < joined.length + sampleRate / 2; start += size / 2) {
    assert.ok(rms(start) > reference * .72, 'The join never repeats the original 300 ms fade-out.');
    assert.ok(rms(start) < reference * 1.2, 'The overlap does not create a loud seam.');
  }
  const cricket = context.createBuffer(1, sampleRate * 3, sampleRate), pulses = cricket.getChannelData(0);
  for (let index = 0; index < pulses.length; index++) pulses[index] = Math.sin(index * .4) * (index % sampleRate < sampleRate * .2 ? .2 : .002);
  const prepared = circularLoopBuffer(context, cricket, { cricket: true });
  assert.equal(prepared.duration, 2.975);
  assert.equal(prepared.getChannelData(0)[sampleRate], pulses[sampleRate + 200], 'Only the short boundary region is blended; the natural pulse is unchanged.');
});

test('automatic recording gains recover after disable and re-enable rather than retaining a stale automation cache', async t => {
  const { engine } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  await engine.setLayerVariations('forest', endpoints('forest')); engine.setMacro('forest', .5); engine.setPatches([patch('fire', 1)]);
  await engine.enable(); await flush(); engine.disable(); await engine.enable(); await flush();
  const slots = [...engine.layers.get('forest').variationSlots.values()];
  assert.ok(slots.every(slot => Math.abs(slot.mixGain.gain.value - Math.SQRT1_2) < 1e-12));
  assert.ok(slots.every(slot => [...engine.layers.get('forest').sources].some(record => record.slot === slot)));
});


test('phone crackle has seven dB of body gain and the retained main reverb return is six dB above its original level', async t => {
  assert.equal(PHONE_CRACKLE_GAIN, 10 ** (7 / 20)); assert.equal(TONE_REVERB_RETURN, .82 * 10 ** (6 / 20));
  const dry = [{ key: 'gain-check', heat: 1, moisture: 0 }], bed = phoneBedParameters(dry);
  assert.ok(Math.abs(bed.gain / .04 - PHONE_CRACKLE_GAIN) < 1e-12); assert.equal(bed.cricketGain, 0);
  const out = [{ ...dry[0], heat: 0, extinguished: true }];
  assert.equal(phoneBedParameters(out).gain, 0); assert.equal(phoneBedParameters(out).cricketGain, PHONE_CRICKET_LEVEL);
  const { engine, context } = harness(t, { mode: 'operator' }); engine.setPatches(out); await engine.enable();
  assert.equal(engine.toneReverbReturn.gain.value, TONE_REVERB_RETURN);
  engine.reset('gain-reset'); assert.equal(engine.toneReverbReturn.gain.value, 0);
  engine.setPatches(out); engine.setParticipants([{ id: 'audience', number: 1, holding: true, heat: 0, extinguished: true }]); context.advance(.16); engine._tick(); assert.equal(engine.toneReverbReturn.gain.value, TONE_REVERB_RETURN);
  for (const grain of engine.toneGrains) assert.equal(grain.source.playbackRate.value, 1);
  assert.equal(engine.level, .55); assert.equal(engine.mix.gain.value, .8);
  assert.equal(engine.layers.get('crickets').gain.gain.value, .045);
});

const participant = (id, number = 1, values = {}) => ({ id, number, holding: true, position: [.5, .5], heat: 1, moisture: 0, ...values });

test('identities hash into 35 adjacent C Lydian pairs spanning C2–C7 independently of display number, heat and location', () => {
  assert.equal(PARTICIPANT_MIDI.length, 35); assert.equal(PARTICIPANT_PITCH_LABELS.length, 35);
  const all = PARTICIPANT_MIDI_PAIRS.flat(); assert.equal(Math.min(...all), 36); assert.equal(Math.max(...all), 96);
  assert.deepEqual([...new Set(all.map(midi => midi % 12))].sort((a, b) => a - b), [0, 2, 4, 6, 7, 9, 11]);
  const scale = [...new Set(all)].sort((a, b) => a - b);
  for (const [index, pair] of PARTICIPANT_MIDI_PAIRS.entries()) {
    assert.deepEqual(pair, scale.slice(index, index + 2), 'No scale degree may fall between the two notes.');
    assert.deepEqual(participantMidiPair({ pitchIndex: index }), pair);
  }
  assert.equal(PARTICIPANT_PITCH_LABELS[2], 'E2 / F♯2'); assert.equal(PARTICIPANT_PITCH_LABELS.at(-1), 'B6 / C7');
  const expected = participantMidi({ id: 'a' });
  for (let number = 1; number <= 70; number++) {
    assert.equal(participantMidi({ id: 'a', number }), expected);
    assert.equal(participantMidi({ id: 'a', number, heat: 0, extinguished: true, position: [1, 1] }), expected);
    assert.equal(participantFrequency({ id: 'a', number }), 440 * 2 ** ((expected - 69) / 12));
  }
  const assignments = Array.from({ length: 256 }, (_, index) => participantMidi({ id: `persistent-client-${index}`, number: 1 }));
  assert.equal(new Set(assignments).size, 35, 'Identities spread across the whole register, including when display numbers match.');
  assert.equal(participantMidi({ number: 1, pitchIndex: 9 }), PARTICIPANT_MIDI[9]);
  assert.deepEqual(participantMidiPair({ number: 1, pitchIndex: 9 }), PARTICIPANT_MIDI_PAIRS[9]);
});

test('heat changes harmonic balance around a fixed fundamental rather than moving notes', async t => {
  const hot = participantToneParameters({ heat: 1 }), cool = participantToneParameters({ heat: 0 }), out = participantToneParameters({ heat: 1, extinguished: true });
  assert.ok(hot.partialGains.slice(1).reduce((sum, value) => sum + value ** 2, 0) > .98);
  assert.ok(cool.partialGains[0] > .99); assert.deepEqual(out.partialGains, cool.partialGains);
  assert.ok(hot.highpassRatio > cool.highpassRatio && hot.lowpassRatio > cool.lowpassRatio);
  const { engine, context } = harness(t, { mode: 'operator' });
  engine.setParticipants([participant('one')]); await engine.enable();
  const voice = engine.voices.get('one'), oscillators = [...voice.oscillators];
  for (const heat of [.9, .6, .2, .05, 0]) {
    engine.setParticipants([participant('one', 1, { heat, position: [heat, 1 - heat] })]); context.advance(.2); engine._tick();
    assert.equal(engine.voices.get('one'), voice); assert.equal(voice.midi, participantMidi({ id: 'one' }));
    for (const [index, oscillator] of oscillators.entries()) {
      assert.equal(oscillator.frequency.value, voice.frequency * voice.partials[index]); assert.deepEqual(oscillator.frequency.events, []);
    }
  }
  assert.ok(voice.partialNodes[0].gain.value > .99);
  assert.equal(voice.attackSeconds, .8); assert.equal(voice.targetGain, .0016);
});

test('phone mode never creates oscillators, tone grains, or tone space through any legacy gesture or participant API', async t => {
  const { engine, context } = harness(t); await engine.enable();
  for (let index = 0; index < 50; index++) {
    engine.setPatches([patch('a', 1), patch('out', 0, true)]); engine.touch('a');
    engine.setParticipants([participant('phone', index + 1)]); engine.setLocalParticipant(participant('local'));
    engine.release(); engine.touch('out'); context.advance(.1); engine._tick();
  }
  assert.equal(context.nodes.filter(node => node.nodeType === 'oscillator').length, 0);
  assert.equal(engine.voices.size, 0); assert.equal(engine.toneGrains.size, 0); assert.equal(engine.toneGrainBuffers.size, 0);
  assert.equal(engine.toneBus, undefined); assert.equal(engine.toneReverb, undefined); assert.equal(engine.delay, undefined);
  assert.equal(context.nodes.filter(node => ['convolver', 'delay', 'panner', 'HRTF'].includes(node.nodeType)).length, 0);
  engine.setMacroCondition({ sourceCount: 2, outCount: 2, stage: 8, steps: 8, heat: 0, moisture: 1 }); engine.touch('a');
  assert.equal(engine.layers.get('crackle').gain.gain.value, 0); assert.equal(engine.layers.get('crickets').gain.gain.value, PHONE_CRICKET_LEVEL);
});

test('nine global phone stages use shared heat and moisture and retain exact quiet and pure-cricket endpoints', async t => {
  const a = harness(t), b = harness(t);
  a.engine.setPatches([patch('wet-local', 0, true)]); b.engine.setPatches([patch('dry-local', 1)]);
  await a.engine.enable(); await b.engine.enable();
  for (let stage = 0; stage <= 8; stage++) {
    const condition = { sourceCount: 80, outCount: stage * 10, stage, steps: 8, heat: .6, moisture: .35 };
    assert.equal(a.engine.setMacroCondition(condition), true); assert.equal(b.engine.setMacroCondition(condition), true);
    a.engine.touch('wet-local'); b.engine.release();
    assert.deepEqual(a.engine.getMetrics().phoneBed, b.engine.getMetrics().phoneBed);
    const bed = a.engine.getMetrics().phoneBed;
    assert.equal(bed.stage, stage); assert.equal(bed.heat, .6); assert.equal(bed.moisture, .35);
    if (stage === 8) { assert.equal(bed.gain, 0); assert.equal(bed.cricketGain, PHONE_CRICKET_LEVEL); }
  }
  assert.equal(a.engine.setMacroCondition({ sourceCount: 0, outCount: 0, stage: 0, steps: 8, heat: 1, moisture: 0 }), true);
  assert.equal(a.engine.getMetrics().phoneBed.gain, 0); assert.equal(a.engine.getMetrics().phoneBed.cricketGain, 0);
  const previous = a.engine.progression;
  for (const invalid of [null, {}, { sourceCount: 10, outCount: 1, stage: 8, steps: 8, heat: 1, moisture: 0 }, { sourceCount: 10, outCount: 5, stage: 4, steps: 8, heat: NaN, moisture: 0 }, { sourceCount: 10, outCount: 5, stage: 4, steps: 8, heat: 1, moisture: -1 }]) {
    assert.equal(a.engine.setMacroCondition(invalid), false); assert.equal(a.engine.progression, previous);
  }
});

test('main voices require participant identity and never appear automatically for out patches or legacy touch', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  engine.setPatches(Array.from({ length: 100 }, (_, index) => patch(String(index), 0, true))); await engine.enable();
  engine.touch('1'); engine.release(); engine._tick();
  assert.equal(engine.voices.size, 0); assert.equal(engine.toneGrains.size, 0); assert.equal(context.nodes.filter(node => node.nodeType === 'oscillator').length, 0);
  engine.setParticipants([participant('audience', 3, { heat: 0, extinguished: true, holding: false })]);
  assert.equal(engine.voices.size, 1); assert.equal(engine.voices.get('audience').midi, participantMidi({ id: 'audience' }));
  assert.ok(engine.voices.get('audience').targetGain > 0 && engine.voices.get('audience').targetGain < .0016);
});

test('spatial audio uses smoothed HRTF coordinates for direct sound and grains, with stereo-distance fallback', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  context.createPanner = () => {
    const node = new FakeNode(context, 'HRTF');
    node.positionX = new FakeParam(); node.positionY = new FakeParam(); node.positionZ = new FakeParam(); return node;
  };
  engine.setParticipants([participant('move', 1, { position: [0, 0] })]); await engine.enable();
  const voice = engine.voices.get('move'); assert.equal(voice.spatialMode, 'HRTF');
  const oldGrains = [...engine.toneGrains]; assert.ok(oldGrains.length);
  engine.setParticipants([participant('move', 1, { position: { x: 1, y: 1 }, heat: 0 })]);
  for (const path of [voice.directSpace, voice.grainSpace]) {
    assert.equal(path.panner.panningModel, 'HRTF'); assert.equal(path.panner.distanceModel, 'inverse');
    assert.deepEqual(path.panner.positionX.events.at(-1), ['target', participantPosition([1, 1]).world[0], 0, .065]);
    assert.equal(path.panner.positionZ.value, participantPosition([1, 1]).world[2]);
    assert.deepEqual(path.focus.pan.events.at(-1), ['target', participantPosition([1, 1]).focusPan, 0, .065]);
    assert.ok(path.nodes.includes(path.focus));
  }
  for (const grain of oldGrains) { assert.equal(grain.voice, voice); assert.ok(grain.envelope.connections.includes(voice.grainGate)); assert.ok(grain.highpass.frequency.events.length); }
  const fallback = harness(t, { mode: 'operator' }); fallback.engine.setParticipants([participant('stereo', 2)]); await fallback.engine.enable();
  fallback.engine.setParticipants([participant('stereo', 2, { position: [1, 1] })]);
  const stereo = fallback.engine.voices.get('stereo'); assert.equal(stereo.spatialMode, 'stereo');
  assert.equal(stereo.directSpace.panner.pan.value, 1); assert.equal(stereo.directSpace.distance.gain.value, 1 / 1.8);
  fallback.context.createStereoPanner = undefined; fallback.engine.setParticipants([participant('distance', 4)]); fallback.context.advance(2); fallback.engine._tick();
  assert.equal(fallback.engine.voices.get('distance').spatialMode, 'distance');
  assert.deepEqual(participantPosition([Infinity, -4]).world, [0, 0, -.8]);
});

test('local interaction keeps its identity pair through release and supports all 35 explicit audition choices', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  engine.setLocalParticipant({ id: 'local', holding: false, position: [.5, .5], heat: 1 });
  engine.setParticipants([participant('first-phone', 1)]); await engine.enable();
  engine.setLocalParticipant({ id: 'local', holding: true, position: [.2, .2], heat: .5 });
  assert.equal(engine.voices.get('first-phone').midi, participantMidi({ id: 'first-phone' })); assert.equal(engine.voices.get('local').midi, participantMidi({ id: 'local' }));
  const initial = engine.voices.get('local'); engine.setParticipants([participant('first-phone', 1), participant('second-phone', 2)]);
  engine.setLocalParticipant({ id: 'local', holding: true, position: [.9, .8], heat: 0 }); assert.equal(engine.voices.get('local'), initial);
  engine.setLocalParticipant({ id: 'local', holding: false, heat: .2 }); context.advance(2); engine._tick();
  engine.setLocalParticipant({ id: 'local', holding: true, heat: .2 }); assert.equal(engine.voices.get('local').midi, initial.midi);
  for (let index = 0; index < 35; index++) {
    assert.equal(engine.setLocalPitchIndex(index), true); context.advance(2); engine._tick(); assert.equal(engine.voices.get('local').midi, PARTICIPANT_MIDI[index]);
  }
  assert.equal(engine.setLocalPitchIndex(35), false); assert.equal(engine.setLocalPitchIndex(null), true);
  context.advance(2); engine._tick(); assert.equal(engine.voices.get('local').midi, initial.midi);
});

test('release and disconnect retain a complete smooth tail and reconnect restores the same audience note', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  engine.setParticipants([participant('person', 7)]); await engine.enable(); context.advance(.4); engine._tick();
  const voice = engine.voices.get('person'); engine.setParticipants([participant('person', 7, { holding: false })]);
  context.advance(.66); engine._tick();
  assert.equal(engine.voices.size, 0); assert.ok(engine.tails.has(voice)); assert.equal(voice.releaseSeconds, 1.65);
  const curve = voice.envelope.gain.events.filter(event => event[0] === 'curve').at(-1);
  assert.equal(curve[1][0], 1); assert.equal(curve[1].at(-1), 0);
  context.advance(1); engine._tick(); assert.equal(voice.disposed, undefined);
  context.advance(1); engine._tick(); assert.equal(voice.disposed, true);
  engine.setParticipants([]); engine.setParticipants([participant('person', 99, { position: [0, 1], heat: 0 })]);
  assert.equal(engine.voices.get('person').midi, voice.midi);
  const reloaded = harness(t, { mode: 'operator' }); reloaded.engine.setParticipants([participant('person', 1)]); await reloaded.engine.enable();
  assert.deepEqual(reloaded.engine.voices.get('person').midiPair, voice.midiPair, 'A fresh audio engine restores the identity assignment.');
  engine.setParticipants([]); context.advance(2); engine._tick(); assert.equal(engine.voices.size, 0); assert.equal(engine.tails.size, 0);
});

test('every admitted participant enters exact-pitch granular processing and retains its spatial route into the shared reverb', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  const people = Array.from({ length: 10 }, (_, index) => participant(`person-${index}`, index + 1, { position: [index / 9, .5], heat: .5 }));
  engine.setParticipants(people); await engine.enable(); const heard = new Set();
  for (let index = 0; index < 40; index++) {
    for (const grain of engine.toneGrains) {
      heard.add(grain.participantId); assert.equal(grain.source.playbackRate.value, 1); assert.ok(grain.envelope.connections.includes(grain.voice.grainGate));
      assert.ok(grain.voice.midiPair.includes(grain.midi));
      assert.deepEqual(grain.envelope.gain.events.filter(event => event[0] === 'linear').at(-1), ['linear', 0, grain.at + grain.duration]);
      assert.ok(grain.envelope.gain.events.some(event => event[0] === 'exponential'));
    }
    context.advance(.16); engine._tick();
  }
  assert.equal(heard.size, 10); assert.equal(engine.toneGrainBuffers.size, new Set(people.flatMap(participantMidiPair)).size);
  assert.equal(engine.toneReverb.buffer.numberOfChannels, 2); assert.equal(engine.toneReverb.buffer.duration, 3.8);
  assert.equal(engine.toneReverbReturn.gain.value, TONE_REVERB_RETURN);
  for (const voice of engine.voices.values()) {
    assert.ok(voice.directSpace.distance.connections.includes(engine.toneBus)); assert.ok(voice.grainSpace.distance.connections.includes(engine.toneGrainBus));
    const buffer = engine.toneGrainBuffers.get(voice.midi), samples = buffer.getChannelData(0);
    for (const partial of PARTICIPANT_PARTIALS.filter(value => voice.frequency * value < buffer.sampleRate * .45)) {
      let real = 0, imaginary = 0; const frequency = voice.frequency * partial;
      for (let index = 0; index < samples.length; index++) { const angle = 2 * Math.PI * frequency * index / buffer.sampleRate; real += samples[index] * Math.cos(angle); imaginary += samples[index] * Math.sin(angle); }
      const amplitude = PARTICIPANT_GRAIN_AMPLITUDES[PARTICIPANT_PARTIALS.indexOf(partial)];
      assert.ok(2 * Math.hypot(real, imaginary) / samples.length > amplitude * .9);
    }
  }
  for (const layer of engine.layers.values()) assert.deepEqual(layer.gain.connections, [engine.mixerNodes.get(['roar', 'charcoal'].includes(layer.id) ? 'forest' : layer.id)]);
  for (const node of [engine.toneBus, engine.toneGrainDirect, engine.toneReverbReturn, engine.delayReturn]) {
    assert.ok(node.connections.includes(engine.fieldBus)); assert.ok(!node.connections.includes(engine.mix), 'Every non-cricket return follows the field fade.');
  }
  assert.deepEqual(engine.ashGain.connections, [engine.mixerNodes.get('ash')]); assert.deepEqual(engine.turbulenceGain.connections, [engine.mixerNodes.get('forest')]);
  assert.deepEqual(engine.fieldBus.connections, [engine.mix]);
  engine.reset('new-round'); context.advance(.3); engine._tick(); assert.equal(engine.voices.size, 0); assert.equal(engine.toneGrains.size, 0);
  assert.equal(engine.participants.size, 0); assert.equal(engine.localParticipant, null);
});

test('256-person input and rapid changes remain bounded without stealing complete tails or allocating pitch buffers per person', async t => {
  const { engine, context } = harness(t, { mode: 'operator' }); await engine.enable();
  for (let frame = 0; frame < 180; frame++) {
    const people = Array.from({ length: 256 }, (_, index) => participant(`audience-${index}`, index + 1, { holding: (index + frame) % 3 !== 0, heat: frame % 11 / 10, position: [(index % 16) / 15, Math.floor(index / 16) / 15] }));
    engine.setParticipants(people); context.advance(.16); engine._tick();
    assert.ok(engine.voices.size + engine.tails.size <= 32); assert.ok(engine.toneGrains.size <= 256); assert.ok(engine.toneGrainBuffers.size <= 36);
    assert.ok([...engine.voices.values()].every(voice => voice.targetGain <= .0016), 'Each admitted voice retains its fixed per-voice calibration.');
  }
  assert.ok(engine.getMetrics().parkedParticipants > 0); engine.disable(); context.advance(MAIN_DISABLE_FADE_SECONDS + .03);
  assert.equal(engine.voices.size, 0); assert.equal(engine.tails.size, 0); assert.equal(engine.toneGrains.size, 0); assert.equal(engine.toneGrainBuffers.size, 0);
});


test('phone macro API retains older count-only progression and rejects incomplete staged packets', () => {
  const engine = new WildfireSound({ document: null });
  assert.equal(engine.setMacroCondition({ sourceCount: 9, outCount: 4 }), true);
  assert.equal(engine.getMetrics().phoneBed.progression.fraction, 4 / 9);
  const previous = engine.progression;
  for (const packet of [{ sourceCount: 9, outCount: 4, stage: 3 }, { sourceCount: 9, outCount: 4, stage: 3, steps: 8 }]) {
    assert.equal(engine.setMacroCondition(packet), false); assert.equal(engine.progression, previous);
  }
  assert.equal(engine.setMacroCondition(undefined), true); assert.equal(engine.progression, null); engine.destroy();
});

test('shared counts keep early phone insects distant and quiet while the main retains its count blend', () => {
  for (const [outCount, expected] of [[0, 0], [10, .001], [50, .125], [75, .421875], [100, 1]]) {
    const condition = { sourceCount: 100, outCount, stage: Math.floor(outCount * 8 / 100), steps: 8, heat: 1 - outCount / 100, moisture: .2, surfaceWetness: .3 };
    const blend = landscapeBlend(condition); assert.ok(Math.abs(blend.cricketWeight - expected) < 1e-15);
    for (const mode of ['phone', 'operator']) {
      const engine = new WildfireSound({ mode, document: null });
      engine.setPatches([patch('misleading-local-out', 0, true)]);
      assert.equal(engine.setMacroCondition(condition), true);
      const gain = engine.getMetrics().cricketGain / (mode === 'phone' ? PHONE_CRICKET_LEVEL : .045);
      assert.ok(Math.abs(gain - (mode === 'phone' ? phoneCricketParameters(condition).weight : expected)) < 1e-15); engine.destroy();
    }
  }
  assert.equal(landscapeBlend({ sourceCount: 0, outCount: 0 }).cricketWeight, 0);
  const insideStage = phoneBedParameters([], null, { progression: { sourceCount: 100, outCount: 49, stage: 3, steps: 8, heat: .5, moisture: 0 } });
  assert.equal(insideStage.cricketWeight, phoneCricketParameters({ sourceCount: 100, outCount: 49 }).weight, 'The audible blend uses actual counts, not rounded stage labels.');
});

test('300 of 527 extinguished fires keep phone insects far away, then approach near recordings only late', async t => {
  const { engine, context } = harness(t, { fetchImpl: successfulFetch });
  const layers = ['far', 'mid', 'near'].map((id, index) => ({ id, url: `/cricket-${id}.mp3`, depth: 1 - index / 2 }));
  await engine.setCricketLayers(layers);
  engine.setProgression({ sourceCount: 527, outCount: 0 }); await engine.enable(); await flush();
  assert.equal(engine.layers.get('crickets').sources.size, 0);
  engine.setProgression({ sourceCount: 527, outCount: 300 }); await flush(); engine._tick();
  const state = phoneCricketParameters({ sourceCount: 527, outCount: 300 });
  assert.ok(state.weight < (300 / 527) ** 3 / 10); assert.equal(state.approach, 0);
  assert.deepEqual(engine._variationWeights('crickets'), [1, 0, 0]);
  const layer = engine.layers.get('crickets'), slots = layers.map(entry => layer.variationSlots.get(entry.url));
  assert.equal(slots[0].weight, 1); assert.equal(slots[2].weight, 0);
  assert.ok(slots[0].space.filter.frequency.value < slots[2].space.filter.frequency.value);
  assert.ok(slots[0].space.distance.gain.value < slots[2].space.distance.gain.value);
  assert.ok([...layer.sources].every(record => record.buffer.numberOfChannels === 1));
  slots[0].buffer = null; engine._applyVariationWeights(layer);
  assert.equal(slots[2].weight, 0, 'A missing distant asset cannot substitute a loud close chorus.');
  for (const outCount of [450, 500, 527]) { engine.setProgression({ sourceCount: 527, outCount }); engine._tick(); }
  assert.deepEqual(engine._variationWeights('crickets'), [0, 0, 1]); assert.equal(engine._cricketGain(), PHONE_CRICKET_LEVEL);
  assert.equal(engine._phoneBed().gain, 0);
  context.advance(30); engine._tick(); assert.ok(layer.sources.size <= 6, 'Perspective loops stay native and bounded.');
});

test('only Main preloads quench recordings and accepted local retaps align with global bells', async t => {
  const events = [], eventTarget = { CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, dispatchEvent: event => events.push(event) };
  const document = { hidden: false, defaultView: eventTarget, addEventListener() {}, removeEventListener() {} };
  const { engine, context, requests } = harness(t, { mode: 'operator', document, fetchImpl: successfulFetch });
  const entries = ['a', 'b', 'c', 'd'].map(id => ({ id, url: `/quench-${id}.mp3` }));
  await engine.setMainQuenchSources(entries); assert.deepEqual(requests, []);
  engine.setPatchVoices([sourceVoice('edge', { extinguished: true })]);
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); await engine.enable();
  await engine.mainQuench.setSources(entries); await flush();
  assert.equal(engine.mainQuench.getMetrics().assetCount, 4); assert.equal(events.length, 0);
  assert.equal(engine.mainQuench.getMetrics().triggered, 0, 'Existing out state is a silent baseline.');
  const interaction = { holding: true, patchKey: 'edge', extinguished: true, eligible: true };
  engine.setLocalInteraction(interaction);
  assert.equal(events.length, 1); assert.equal(events[0].type, 'wildfire-bell'); assert.equal(events[0].detail.patchKey, 'edge');
  assert.ok(Number.isFinite(events[0].detail.wallAt)); assert.equal(events[0].detail.quenchAssetId, undefined);
  const bell = [...engine.localBells.bells][0], sample = [...engine.mainQuench.quenches][0];
  assert.equal(sample.at, bell.at); assert.equal(sample.source.startedAt, bell.at); assert.equal(engine.localBells.getMetrics().quench, undefined);
  assert.deepEqual(sample.position, [.25, .75]); assert.ok(sample.space.nodes.includes(sample.space.input));
  assert.deepEqual(engine.mainQuench.output.connections, [engine.toneBus], 'Quench shares the soft-tone room and complete role master.');
  engine.setLocalInteraction(null); assert.equal(engine.localBells.bells.size, 1, 'A released tap leaves its bell ringing.');
  engine.setMuted(true); context.advance(.2); assert.equal(engine.mainQuench.getMetrics().currentVoices, 0);
  assert.equal(events.length, 1, 'Mute and decode completion never replay a visual or sound edge.');
  const phone = harness(t, { mode: 'phone', fetchImpl: successfulFetch });
  assert.equal(await phone.engine.setMainQuenchSources(entries), false); assert.equal(await phone.engine.setPhoneQuenchSources(entries), false);
  await phone.engine.enable(); phone.engine.setPhoneInteraction(interaction); await flush();
  assert.equal(phone.engine.mainQuench, null); assert.equal(phone.engine.phoneWeather, null);
  assert.equal(phone.engine.getMetrics().mainBells, null); assert.equal(phone.engine.localBells, null);
  assert.ok(phone.requests.every(url => !url.includes('quench-')), 'No phone API selects or fetches quench recordings.');
});

test('automatic macros follow shared heat and ground state, and operator manual overrides can return to automation', async t => {
  const { engine } = harness(t, { mode: 'operator' });
  engine.setPatches([patch('local-out', 0, true)]); await engine.enable();
  const hot = { sourceCount: 100, outCount: 1, stage: 0, steps: 8, heat: .95, moisture: .02, surfaceWetness: .04 };
  const cool = { sourceCount: 100, outCount: 80, stage: 6, steps: 8, heat: .1, moisture: .8, surfaceWetness: .9 };
  engine.setMacroCondition(hot); const before = engine.getMetrics().macros, fireLevel = engine.layers.get('roar').gain.gain.value;
  assert.deepEqual(before, automaticSoundMacros(hot));
  engine.setMacroCondition(cool); const after = engine.getMetrics().macros;
  assert.ok(after.forest < before.forest && after.haze < before.haze && after.ash > before.ash && after.rain > before.rain && after.moisture > before.moisture);
  assert.ok(engine.layers.get('roar').gain.gain.value < fireLevel);
  engine.setMacros({ forest: .75, rain: .12 }); assert.equal(engine.getMetrics().automation.enabled, false);
  engine.setMacroCondition(hot); assert.equal(engine.getMetrics().macros.forest, .75); assert.equal(engine.getMetrics().macros.rain, .12);
  engine.setAutomation(true); assert.deepEqual(engine.getMetrics().macros, automaticSoundMacros(hot));
  const prior = engine.progression;
  for (const field of ['surfaceWetness', 'activeFireFraction']) {
    assert.equal(engine.setMacroCondition({ ...hot, [field]: 1.01 }), false); assert.equal(engine.progression, prior);
  }
});

test('each identity has a mono chime clock while out identities retain overlapping smooth drones', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  engine.setParticipants([participant('left', 1, { position: [0, 0] }), participant('right', 2, { position: [1, 1] }), participant('out', 3, { heat: 0, extinguished: true, holding: false })]);
  await engine.enable();
  for (const voice of engine.voices.values()) {
    const grains = [...engine.toneGrains].filter(grain => grain.voice === voice).sort((a, b) => a.at - b.at);
    assert.ok(grains.length >= (voice.extinguished ? 2 : 1) && grains.length <= 8);
    assert.equal(voice.grainSpace.input.channelCount, 1); assert.equal(voice.grainSpace.input.channelCountMode, 'explicit');
    assert.equal(voice.grainSpace.panner.pan.value, participantPosition(voice.participant.position).pan);
    for (const grain of grains) {
      assert.equal(grain.source.buffer.numberOfChannels, 1); assert.equal(grain.source.playbackRate.value, 1);
      assert.ok(grain.duration >= (voice.extinguished ? .16 : .4) && grain.duration <= (voice.extinguished ? .24 : .9));
      if (!voice.extinguished) assert.ok(grain.attack >= .001 && grain.attack <= .004);
      assert.equal(grain.highpass, voice.grainHighpass); assert.equal(grain.lowpass, voice.grainLowpass);
    }
    if (voice.extinguished) assert.ok(grains[1].at < grains[0].at + grains[0].duration, 'Out drones retain overlap.');
    else assert.ok(voice.grainEnvelope.gain.events.find(event => event[0] === 'curve')[3] <= .03, 'The first struck grain has no long voice swell.');
  }
  assert.notEqual(engine.voices.get('left').grainSpace.panner, engine.voices.get('right').grainSpace.panner);
  assert.ok(engine.toneGrainDirect.gain.value > engine.toneGrainReverbSend.gain.value * 10, 'Dry localized activity stays clear with the retained reverb return.');
  context.advance(8); engine._tick();
  assert.ok([...engine.toneGrains].every(grain => grain.at >= context.currentTime), 'A late tick resumes ahead without a catch-up burst.');
});

test('a stereo ash recording is mixed quietly into mono pitch grains before every participant panner', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  engine.setParticipants([participant('ash', 1)]); await engine.enable();
  const voice = engine.voices.get('ash'), original = Float32Array.from(engine._toneGrainBuffer(voice).getChannelData(0));
  const stereo = context.createBuffer(2, 8000, 8000); stereo.getChannelData(0).fill(.6); stereo.getChannelData(1).fill(.2);
  engine.layers.get('ash').buffer = stereo;
  const mixed = engine._toneGrainBuffer(voice); assert.equal(mixed.numberOfChannels, 1);
  const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  const toneRms = rms(original), material = Float32Array.from(mixed.getChannelData(0), (value, index) => value - original[index]);
  assert.ok(Math.abs(rms(material) / toneRms - PARTICIPANT_ASH_RMS_RATIO) < 1e-6);
  for (const index of [0, 320, 1600, 7000]) assert.ok(Math.abs(material[index] - toneRms * PARTICIPANT_ASH_RMS_RATIO) < 1e-6);
  const mix = engine.getMetrics().toneGranular.bufferMixes.find(entry => entry.midi === voice.midi);
  assert.equal(mix.ashRmsRatio, PARTICIPANT_ASH_RMS_RATIO);
  assert.equal(engine._toneGrainBuffer(voice), mixed, 'A loaded ash asset does not allocate a buffer per grain.');
  context.advance(.4); engine._tick(); assert.ok([...engine.toneGrains].some(grain => grain.ashMixed));
});

test('low fundamentals retain the original tone RMS while hot grains expose harmonics through sixteen times pitch', async t => {
  assert.deepEqual(PARTICIPANT_PARTIALS, [1, 2, 3, 4, 6, 8, 10, 12, 16]);
  const expectedRms = .3 * Math.sqrt(5 / 2);
  assert.ok(Math.abs(Math.sqrt(PARTICIPANT_GRAIN_AMPLITUDES.reduce((sum, value) => sum + value ** 2, 0) / 2) - expectedRms) < 1e-12);
  assert.equal(PARTICIPANT_GRAIN_AMPLITUDES[0], .3);
  const { engine } = harness(t, { mode: 'operator' });
  engine.setParticipants([participant('low', 1, { pitchIndex: 0 })]); await engine.enable();
  const voice = engine.voices.get('low'), buffer = engine._toneGrainBuffer(voice), samples = buffer.getChannelData(0);
  const actualRms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  assert.ok(Math.abs(actualRms / expectedRms - 1) < .02);
  assert.equal(participantToneParameters({ heat: 1 }).lowpassRatio, 20);
  assert.equal(participantToneParameters({ heat: 0 }).lowpassRatio, 1.35);
  assert.ok(voice.grainLowpass.frequency.value > voice.frequency * 16);
  assert.ok(voice.grainLowpass.frequency.value > 1000, 'Even C2 has enough hot bandwidth for audible fine ash and positional detail.');
  engine.setParticipants([participant('low', 1, { pitchIndex: 0, extinguished: true, heat: 0 })]);
  assert.equal(voice.grainLowpass.frequency.value, voice.frequency * 1.35);
});

test('title is haze alone even on a cold all-out map and manual controls remain inside the scene mix', async t => {
  const { engine } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  for (const id of ['haze', 'forest', 'ash', 'rain', 'moisture']) await engine.setLayerVariations(id, endpoints(id));
  engine.setProgression({ sourceCount: 100, outCount: 100, heat: 0, moisture: 1, surfaceWetness: 1 });
  engine.setParticipants([participant('held'), participant('out', 2, { extinguished: true, heat: 0 })]);
  engine.setSceneState({ id: 'arrival', paused: true, elapsedMs: 0 }); await engine.enable(); await flush();
  assert.equal(engine.layers.get('haze').gain.gain.value, .046 * ARRIVAL_HAZE_GAIN);
  assert.equal(engine.getMetrics().outputGains.main, .55);
  for (const id of ['forest', 'roar', 'charcoal', 'ash', 'rain', 'moisture', 'crickets']) assert.equal(engine.layers.get(id).gain.gain.value, 0, id);
  assert.equal(engine.ashGain.gain.value, 0); assert.equal(engine.turbulenceGain.gain.value, 0);
  assert.equal(engine.voices.size, 0); assert.equal(engine.mainDrone, null);
  engine.setMacros({ haze: .3, forest: 1, ash: 1, rain: 1, moisture: 1 });
  assert.ok(engine.layers.get('haze').gain.gain.value > 0 && engine.layers.get('haze').gain.gain.value < .046 * ARRIVAL_HAZE_GAIN);
  for (const id of ['forest', 'ash', 'rain', 'moisture', 'crickets']) assert.equal(engine.layers.get(id).gain.gain.value, 0, `Manual ${id} cannot cross the scene gate.`);
});

test('instructions transfer haze to forest over twelve show-clock seconds without title or instruction tones', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  await engine.setLayerVariations('haze', endpoints('haze')); await engine.setLayerVariations('forest', endpoints('forest'));
  engine.setProgression({ sourceCount: 0, outCount: 0, heat: 0 });
  engine.setParticipants([participant('held')]); engine.setSceneState({ id: 'instructions', elapsedMs: 0 });
  await engine.enable(); await flush();
  assert.equal(engine.layers.get('haze').gain.gain.value, .046 * ARRIVAL_HAZE_GAIN); assert.equal(engine.layers.get('forest').gain.gain.value, 0);
  context.advance(6); engine._tick();
  assert.equal(engine.layers.get('haze').gain.gain.value, .023 * ARRIVAL_HAZE_GAIN); assert.ok(Math.abs(engine.layers.get('forest').gain.gain.value - .12) < 1e-12);
  assert.equal(engine.getMetrics().sceneScore.mix.mainForest, .5); assert.equal(engine.voices.size, 0);
  context.advance(6); engine._tick();
  assert.equal(engine.layers.get('haze').gain.gain.value, 0); assert.ok(Math.abs(engine.layers.get('forest').gain.gain.value - .24) < 1e-12);
  assert.equal(engine.voices.size, 0); assert.equal(engine.toneGrains.size, 0); assert.equal(engine.mainDrone, null);
});

test('participation replaces main burning with the two shared harmonic banks that fully leave the final rain space', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  await engine.setLayerVariations('forest', endpoints('forest'));
  await engine.setLayerVariations('haze', endpoints('haze'));
  engine.setProgression({ sourceCount: 100, outCount: 0, heat: 1 });
  engine.setParticipants([participant('active'), participant('out', 2, { extinguished: true, heat: 0 })]);
  engine.setSceneState({ id: 'participation', elapsedMs: 0 }); await engine.enable(); await flush();
  assert.equal(engine.mainDrone, null); assert.equal(engine.voices.size, 0);
  assert.ok(Math.abs(engine.layers.get('forest').gain.gain.value - .24) < 1e-12);
  context.advance(6); engine._tick();
  assert.ok(Math.abs(engine.layers.get('forest').gain.gain.value - .12) < 1e-12); assert.equal(engine.getMetrics().mainDrone.gain, MAIN_DRONE_LEVEL);
  assert.equal(participationVisualProgress(engine.scene, engine._sceneElapsed()), 0, 'The drone is full while the instructions still cover the map.');
  assert.equal(engine.voices.size, 2); assert.ok(engine.toneGrains.size > 0);
  context.advance(6); engine._tick();
  const drone = engine.mainDrone, metrics = engine.getMetrics();
  assert.equal(drone.oscillators.length, 6); assert.equal(metrics.mainDrone.gain, MAIN_DRONE_LEVEL);
  assert.deepEqual(MAIN_DRONE_MIDI, [37, 44, 51]);
  assert.deepEqual(drone.oscillators.map(node => node.frequency.value), [...MAIN_DRONE_MIDI, ...MAIN_DRONE_MIDI].map(patchFrequencyForMidi));
  assert.equal(metrics.voiceCount, 2, 'The single shared drone is independent of audience voice admission.');
  for (const id of ['forest', 'roar', 'charcoal', 'ash', 'rain', 'moisture', 'crickets']) assert.equal(engine.layers.get(id).gain.gain.value, 0, `${id} must leave the tone space clear.`);
  assert.ok(Math.abs(engine.layers.get('haze').gain.gain.value - .046 * .18) < 1e-12, 'A thin haze remains underneath participation.');
  assert.equal(engine.ashGain.gain.value, 0); assert.equal(engine.turbulenceGain.gain.value, 0);
  assert.ok([...engine.toneGrains].filter(grain => !grain.background).every(grain => grain.attack >= .001 && grain.attack <= .004));
  engine.setSceneState({ id: 'final-rain', elapsedMs: 0, rainIntensity: 1 });
  assert.equal(engine.voices.has('active'), true); assert.equal(engine.voices.has('out'), true);
  assert.equal(engine.layers.get('rain').gain.gain.value, 0); assert.equal(engine.getMetrics().mainDrone.gain, MAIN_DRONE_LEVEL, 'A manual early final cue retains its outgoing drone before fading.');
  context.advance(60); engine._tick();
  assert.ok(engine.layers.get('rain').gain.gain.value > 0); assert.equal(engine.getMetrics().mainDrone.gain, 0);
  engine.disable(); context.advance(MAIN_DISABLE_FADE_SECONDS + .03); assert.equal(engine.mainDrone, null);
  assert.ok(drone.oscillators.every(node => node.disconnected));
});

test('phone permission prewarms silently, then crackle and real out-count insects enter once with participation', async t => {
  const { engine, context } = harness(t, { fetchImpl: successfulFetch });
  engine.setProgression({ sourceCount: 100, outCount: 50, heat: .5, moisture: 0 });
  engine.setSceneState({ id: 'arrival', paused: true, elapsedMs: 0 }); await engine.enable(); await flush();
  assert.equal(engine.getMetrics().outputGains.phone, 0); assert.equal(engine.layers.get('crackle').gain.gain.value, 0);
  assert.equal(engine._cricketGain(), 0); assert.equal(context.state, 'running');
  engine.setSceneState({ id: 'instructions', elapsedMs: 12000 });
  assert.equal(engine.getMetrics().outputGains.phone, 0); assert.equal(engine.layers.get('crackle').gain.gain.value, 0);
  engine.setSceneState({ id: 'participation', elapsedMs: 0 }); context.advance(6); engine._tick();
  assert.equal(engine.layers.get('crackle').gain.gain.value, engine._phoneBed().gain * .5);
  assert.equal(engine._cricketGain(), PHONE_CRICKET_LEVEL * phoneCricketParameters({ sourceCount: 100, outCount: 50 }).weight * .5);
  context.advance(6); engine._tick();
  assert.equal(engine.layers.get('crackle').gain.gain.value, engine._phoneBed().gain);
  assert.equal(engine._cricketGain(), PHONE_CRICKET_LEVEL * phoneCricketParameters({ sourceCount: 100, outCount: 50 }).weight);
  assert.equal(context.nodes.some(node => node.nodeType === 'oscillator'), false);
  assert.equal(engine.getMetrics().outputGains.phone, .55);
});

test('the native rain and insect overlap ends at thirty seconds while Main carries the PA hold and phones retreat from 69 seconds', async t => {
  const main = harness(t, { mode: 'operator' }), phone = harness(t);
  for (const { engine } of [main, phone]) {
    engine.setProgression({ sourceCount: 100, outCount: 100, heat: 0, moisture: 1 });
    engine.setSceneState({ id: 'final-rain', elapsedMs: 0 }); await engine.enable();
    engine.setSceneState({ id: 'afterglow', elapsedMs: 0, paused: false });
    assert.equal(engine.fieldBus.gain.value, 1, 'The role master applies each fade exactly once.');
  }
  const mainCurve = main.engine.master.gain.events.filter(event => event[0] === 'curve').at(-1);
  const phoneCurve = phone.engine.master.gain.events.filter(event => event[0] === 'curve').at(-1);
  const fieldCurve = main.engine.fieldBus.gain.events.filter(event => event[0] === 'curve').at(-1);
  assert.equal(mainCurve[2], .02); assert.equal(mainCurve[3], 53.98);
  assert.equal(fieldCurve[2], .02); assert.equal(fieldCurve[3], 29.98);
  assert.equal(fieldCurve[1][0], 1); assert.equal(fieldCurve[1].at(-1), 0);
  assert.ok(fieldCurve[1].slice(1).every((value, index) => value <= fieldCurve[1][index]));
  assert.ok(mainCurve[1].slice(0, -1).every(value => Math.abs(value - 1) < 1e-6), 'The scene master stays open through the PA-only hold and handoff.');
  assert.equal(phoneCurve[2], 69); assert.equal(phoneCurve[3], 60, 'The complete phone fade starts after PA hold, handoff and phone-only hold.');
  assert.ok(Math.abs(mainCurve[1][0] - 1) < 1e-6); assert.equal(mainCurve[1].at(-1), 0);
  assert.ok(Math.abs(phoneCurve[1][0] - .55) < 1e-6); assert.equal(phoneCurve[1].at(-1), 0);
  assert.equal(mainCurve[2] + mainCurve[3], 54); assert.equal(phoneCurve[2] + phoneCurve[3], 129);
  assert.equal(main.engine.fieldBus.gain.events.some(event => event[0] === 'set' && event[2] === 30), false);
  assert.equal(main.engine.master.gain.events.some(event => event[0] === 'set' && event[2] === 54), false);
  assert.equal(phone.engine.master.gain.events.some(event => event[0] === 'set' && event[2] === 129), false);
  for (const state of [main, phone]) state.context.advance(30);
  assert.equal(main.engine.getMetrics().outputGains.main, .55);
  assert.equal(main.engine.getMetrics().outputGains.field, 0, 'All non-cricket returns are silent at the overlap endpoint without another scheduler tick.');
  assert.equal(phone.engine.getMetrics().outputGains.phone, .55);
  assert.equal(phone.engine.getMetrics().cricketRetreat.progress, 0);
  assert.deepEqual(main.engine.layers.get('crickets').gain.connections, [main.engine.mixerNodes.get('crickets')]);
  assert.deepEqual(main.engine.mixerNodes.get('crickets').connections, [main.engine.mix]);
  assert.deepEqual(main.engine.highpass.connections, [main.engine.master]);
  assert.deepEqual(main.engine.toneReverbReturn.connections, [main.engine.fieldBus]);
  main.context.advance(24); main.engine._tick();
  assert.equal(main.engine.getMetrics().outputGains.main, 0, 'The PA master closes after its cricket handoff.');
  phone.context.advance(39); phone.engine._tick();
  assert.equal(phone.engine.getMetrics().outputGains.phone, .55);
  assert.equal(phone.engine.getMetrics().cricketRetreat.progress, 0);
  phone.context.advance(30); phone.engine._tick();
  const retreat = cricketRetreatParameters(30000);
  assert.equal(phone.engine.getMetrics().outputGains.phone, .55 * retreat.gain * retreat.tail);
  assert.equal(phone.engine._cricketGain(), PHONE_CRICKET_LEVEL, 'Distance is in the master, not repeated on the cricket layer.');
  assert.equal(phone.engine.layers.get('crickets').filter.frequency.value, retreat.lowpass);
  assert.equal(main.engine.getMetrics().cricketRetreat.progress, 0, 'Only phones recede after the dark hold.');
  phone.context.advance(30); phone.engine._tick();
  assert.equal(phone.engine.getMetrics().outputGains.phone, 0);
  assert.equal(phone.engine.getMetrics().sceneScore.phase, 'ended');
});

test('the longer final cricket tail stays on the native master clock and never closes the recording gate early', async t => {
  const { engine, context } = harness(t, { fetchImpl: successfulFetch });
  await engine.setLayerSource('crickets', '/cricket-retreat-fixture.mp3');
  engine.setProgression({ sourceCount: 100, outCount: 100, heat: 0, moisture: 1 });
  engine.setSceneState({ id: 'afterglow', elapsedMs: 114000 }); await engine.enable(); await flush();
  const layer = engine.layers.get('crickets'), sources = [...layer.sources];
  assert.ok(sources.length > 0 && sources.every(record => record.source.loop));
  const curve = engine.master.gain.events.filter(event => event[0] === 'curve').at(-1);
  assert.ok(Math.abs(curve[2] + curve[3] - 15) < 1 / context.sampleRate);
  assert.equal(curve[1].at(-1), 0);
  const events = engine.master.gain.events.length;
  context.advance(9); engine._tick();
  assert.equal(engine.master.gain.events.length, events, 'A delayed scheduler does not approximate or restart the ending curve.');
  assert.equal(engine.phoneCricketPhrases.active, true, 'The quiet final field keeps its continuous recording.');
  assert.equal(engine._cricketGain(), PHONE_CRICKET_LEVEL, 'Retreat is applied only once at the master.');
  assert.ok(Math.abs(engine.getMetrics().outputGains.phone - .55 * cricketRetreatParameters(54000).gain * .5) < 1e-12);
  assert.deepEqual([...layer.sources], sources);
  engine.setSceneState({ id: 'afterglow', elapsedMs: 123000, paused: true });
  const frozen = engine.getMetrics().outputGains.phone;
  context.advance(3); engine._tick(); assert.equal(engine.getMetrics().outputGains.phone, frozen);
  engine.setSceneState({ id: 'afterglow', elapsedMs: 123000, paused: false });
  const resumed = engine.master.gain.events.filter(event => event[0] === 'curve').at(-1);
  assert.ok(Math.abs(resumed[2] + resumed[3] - (context.currentTime + 6)) < 1 / context.sampleRate);
  context.advance(6); engine._tick();
  assert.equal(engine.getMetrics().outputGains.phone, 0); assert.equal(engine.phoneCricketPhrases.active, false);
  assert.equal(layer.sampleGate.gain.value, 0, 'The recording gate closes only after the master has reached exact silence.');
});

test('paused, resumed and reloaded scene envelopes preserve configured phase boundaries and exact final silence', async t => {
  for (const mode of ['phone', 'operator']) {
    const { engine, context } = harness(t, { mode });
    const settings = { projectionFadeSeconds: 20, paCricketOnlySeconds: 6, cricketHandoffSeconds: 8, phoneOnlySeconds: 10, phoneFadeSeconds: 40 };
    engine.setSceneState({ id: 'afterglow', elapsedMs: 54000, paused: true, settings }); await engine.enable();
    const frozen = engine.getMetrics();
    assert.equal(frozen.sceneScore.projectionFadeDurationMs, 20000);
    assert.equal(frozen.sceneScore.rainCricketOverlapDurationMs, 30000, 'Shortening the visual fade leaves the audio overlap at thirty seconds.');
    assert.equal(frozen.sceneScore.phoneRetreatStartMs, 54000); assert.equal(frozen.sceneScore.afterglowDurationMs, 94000);
    context.advance(5); engine._tick();
    assert.equal(engine.getMetrics().sceneScore.phaseElapsedMs, frozen.sceneScore.phaseElapsedMs);
    assert.deepEqual(engine.getMetrics().cricketRetreat, frozen.cricketRetreat);
    assert.equal(engine.getMetrics().outputGains[mode === 'phone' ? 'phone' : 'main'], mode === 'phone' ? .55 : 0);
    engine.setSceneState({ id: 'afterglow', elapsedMs: 54000, paused: false, settings });
    if (mode === 'phone') {
      const curve = engine.master.gain.events.filter(event => event[0] === 'curve').at(-1);
      assert.equal(curve[2], 5.02); assert.ok(Math.abs(curve[3] - 39.98) < 1e-10);
      engine.setMuted(true); engine.setMuted(false); await flush();
      assert.ok(engine.master.gain.events.filter(event => event[0] === 'curve').length >= 2, 'Resume reinstalls cancelled native automation.');
    }
    context.advance(40); engine._tick(); assert.equal(engine.getMetrics().outputGains[mode === 'phone' ? 'phone' : 'main'], 0);
    engine.setSceneState({ id: 'ended', paused: false }); engine.setLevel(1);
    assert.equal(roleGain(engine), 0); assert.equal(engine.fieldBus.gain.value, 0);
    assert.equal(engine.setSceneState({ id: 'afterglow', elapsedMs: NaN }), false);
    assert.equal(engine.setSceneState({ id: 'instructions', elapsedMs: 0 }), true);
    engine.setSceneState(null); assert.equal(engine.getMetrics().sceneScore, null);
    assert.equal(roleGain(engine), 1, 'Unscored legacy clients retain their original master behavior.');
  }
});

test('old Safari replaces an active role envelope by cancelling its start before restoring the show-clock level', async t => {
  const { engine, context } = harness(t);
  await engine.enable(); engine.master.gain.cancelAndHoldAtTime = undefined;
  engine.setSceneState({ id: 'afterglow', elapsedMs: 69000 });
  context.advance(5);
  const before = engine.master.gain.events.length;
  engine.setSceneState({ id: 'afterglow', elapsedMs: 74000, paused: true });
  const replacement = engine.master.gain.events.slice(before);
  assert.deepEqual(replacement[0], ['cancel', 0]);
  assert.equal(replacement[1][0], 'set'); assert.equal(replacement[1][2], 5);
  assert.equal(roleGain(engine), .55 * cricketRetreatParameters(5000).gain);
});

test('strict audio parameters catch both past-start clamping and floating-point endpoint overlap', () => {
  const context = new FakeContext(), param = new StrictCurveParam(context);
  param.setValueCurveAtTime(Float32Array.of(1, 0), 0, 30);
  assert.throws(() => param.setValueAtTime(0, 30), /overlaps/, 'The browser clamps the curve start forward by one render quantum.');
  const floating = new StrictCurveParam(context);
  floating.setValueCurveAtTime(Float32Array.of(1, 0), 305.8370133743334, 60);
  assert.throws(() => floating.setValueAtTime(0, 365.8370133743333), /overlaps/, 'An apparently equal endpoint can actually be just inside its curve.');
});

test('role master curves leave scheduling lead, hold final zero without another event, and survive repeated snapshots', async t => {
  for (const mode of ['operator', 'phone']) {
    const { engine, context } = harness(t, { mode }); await engine.enable();
    engine.master.gain = new StrictCurveParam(context);
    context.currentTime = 296.0906666666667;
    const elapsedMs = mode === 'operator' ? 8.152 : 69000;
    const deadline = context.currentTime + ((mode === 'operator' ? 54000 : 129000) - elapsedMs) / 1000;
    assert.doesNotThrow(() => engine.setSceneState({ id: 'afterglow', elapsedMs }));
    let curve = engine.master.gain.events.filter(event => event[0] === 'curve').at(-1);
    assert.ok(curve[2] >= context.currentTime + .019);
    assert.ok(Math.abs(curve[2] + curve[3] - deadline) < 1 / context.sampleRate);
    assert.equal(curve[1].at(-1), 0);
    assert.equal(engine.master.gain.events.filter(event => event[0] === 'set').length, 1);
    context.advance(.12345);
    assert.doesNotThrow(() => engine.setSceneState({ id: 'afterglow', elapsedMs: elapsedMs + 123.45 }));
    assert.doesNotThrow(() => engine.setLevel(.7));
    assert.doesNotThrow(() => engine.setSceneState({ id: 'afterglow', elapsedMs: elapsedMs + 123.45, paused: true }));
    assert.doesNotThrow(() => engine.setSceneState({ id: 'afterglow', elapsedMs: elapsedMs + 123.45, paused: false }));
    const nearEnd = mode === 'operator' ? 53990 : 128990;
    const shortDeadline = context.currentTime + .01;
    assert.doesNotThrow(() => engine.setSceneState({ id: 'afterglow', elapsedMs: nearEnd }));
    const last = engine.master.gain.events.at(-1);
    assert.equal(last[0], 'linear'); assert.equal(last[1], 0);
    assert.ok(Math.abs(last[2] - shortDeadline) < 1 / context.sampleRate);
  }
});

test('native field curves meet the rain-insect overlap deadline and support paused and old Safari replacements', async t => {
  for (const oldSafari of [false, true]) {
    const { engine, context } = harness(t, { mode: 'operator' }); await engine.enable();
    engine.fieldBus.gain = new StrictCurveParam(context);
    if (oldSafari) engine.fieldBus.gain.cancelAndHoldAtTime = undefined;
    context.currentTime = 296.0906666666667;
    assert.doesNotThrow(() => engine.setSceneState({ id: 'afterglow', elapsedMs: 8.152 }));
    const curve = engine.fieldBus.gain.events.filter(event => event[0] === 'curve').at(-1);
    const deadline = context.currentTime + (30000 - 8.152) / 1000;
    assert.ok(curve[2] >= context.currentTime + .019);
    assert.ok(Math.abs(curve[2] + curve[3] - deadline) < 1 / context.sampleRate);
    assert.equal(curve[1].at(-1), 0);
    context.advance(.12345);
    assert.doesNotThrow(() => engine.setSceneState({ id: 'afterglow', elapsedMs: 131.602, paused: true }));
    assert.equal(engine.fieldBus.gain.value, computeSceneScore({ id: 'afterglow', elapsedMs: 131.602 }).mainFieldGain);
    assert.doesNotThrow(() => engine.setSceneState({ id: 'afterglow', elapsedMs: 131.602 }));
    const shortDeadline = context.currentTime + .01;
    assert.doesNotThrow(() => engine.setSceneState({ id: 'afterglow', elapsedMs: 29990 }));
    const last = engine.fieldBus.gain.events.at(-1);
    assert.equal(last[0], 'linear'); assert.equal(last[1], 0);
    assert.ok(Math.abs(last[2] - shortDeadline) < 1 / context.sampleRate, 'A late snapshot cannot extend the final field fade.');
    assert.equal(engine.getMetrics().outputGains.main, engine.level, 'The field deadline leaves the PA-only cricket master open.');
  }
});

test('PA and phone insect gains share the exact audio-clock transfer, including late snapshots, pause and old Safari', async t => {
  for (const mode of ['operator', 'phone']) for (const oldSafari of [false, true]) {
    const { engine, context } = harness(t, { mode }); await engine.enable();
    const parameter = new StrictCurveParam(context); engine.layers.get('crickets').gain.gain = parameter;
    if (oldSafari) parameter.cancelAndHoldAtTime = undefined;
    context.currentTime = 296.0906666666667;
    const elapsedMs = 42000, deadline = context.currentTime + 12;
    assert.doesNotThrow(() => engine.setSceneState({ id: 'afterglow', elapsedMs }));
    const curve = parameter.events.filter(event => event[0] === 'curve').at(-1);
    assert.ok(Math.abs(curve[2] + curve[3] - deadline) < 1 / context.sampleRate);
    const level = mode === 'phone' ? PHONE_CRICKET_LEVEL : .045;
    for (const index of [0, 32, 128, 256, 384, 512]) {
      const score = computeSceneScore({ id: 'afterglow' }, elapsedMs + 12000 * index / 512);
      const expected = level * (mode === 'phone' ? score.mix.phoneCrickets : score.mix.mainCrickets);
      assert.ok(Math.abs(curve[1][index] - expected) < 2e-9);
    }
    if (mode === 'phone') assert.ok(curve[1][32] > 0, 'The phone joins at the start of the transfer, without an extra target envelope.');
    const events = parameter.events.length; context.advance(.12345); engine._tick();
    assert.equal(parameter.events.length, events, 'A scheduler frame does not smooth or overwrite the native transfer.');
    assert.doesNotThrow(() => engine.setSceneState({ id: 'afterglow', elapsedMs: 42123.45, paused: true }));
    assert.ok(Math.abs(parameter.value - engine._cricketGain()) < 1e-12);
    assert.doesNotThrow(() => engine.setSceneState({ id: 'afterglow', elapsedMs: 42123.45 }));
    assert.doesNotThrow(() => engine.setSceneState({ id: 'afterglow', elapsedMs: 53990 }));
    const last = parameter.events.at(-1); assert.equal(last[0], 'linear');
    assert.ok(Math.abs(last[1] - (mode === 'phone' ? PHONE_CRICKET_LEVEL : 0)) < 2e-9);
    assert.doesNotThrow(() => engine.setSceneState({ id: 'participation', elapsedMs: 12000 }));
    assert.equal(parameter.events.at(-1)[0], 'target');
  }
});

test('only phone insect recordings play slower, preserving their own repeated chirps as a less dense field', async t => {
  for (const mode of ['operator', 'phone']) {
    const { engine } = harness(t, { mode, fetchImpl: successfulFetch });
    await engine.setCricketLayers(['far', 'mid', 'near'].map((id, index) => ({ id, url: `/insects/${id}.mp3`, depth: 1 - index / 2 })));
    engine.setProgression({ sourceCount: 100, outCount: 100 }); await engine.enable(); await flush();
    const sources = [...engine.layers.get('crickets').sources]; assert.equal(sources.length, 3);
    for (const record of sources) assert.equal(record.source.playbackRate.value, mode === 'phone' ? PHONE_CRICKET_RATE : 1);
    if (mode === 'operator') assert.equal(engine.toneReverbSend.gain.value, .15);
  }
});

test('native rain-insect overlap follows its audio duration independently of a shorter or longer projection fade', async t => {
  for (const [projectionFadeSeconds, rainCricketOverlapSeconds] of [[10, 45], [60, 20]]) {
    const { engine, context } = harness(t, { mode: 'operator' }); await engine.enable();
    engine.fieldBus.gain = new StrictCurveParam(context);
    const settings = { projectionFadeSeconds, rainCricketOverlapSeconds };
    engine.setSceneState({ id: 'afterglow', elapsedMs: 0, settings });
    const curve = engine.fieldBus.gain.events.filter(event => event[0] === 'curve').at(-1);
    assert.ok(Math.abs(curve[2] + curve[3] - rainCricketOverlapSeconds) < 1 / context.sampleRate, 'Native field automation finishes at the configured audio endpoint.');
    assert.equal(curve[1][0], 1); assert.equal(curve[1].at(-1), 0);
    const holdStart = Math.max(projectionFadeSeconds, rainCricketOverlapSeconds) * 1000;
    assert.equal(engine.getMetrics().sceneScore.paCricketOnlyStartMs, holdStart);
    assert.equal(engine.getMetrics().sceneScore.phoneRetreatStartMs, holdStart + 39000);
    context.advance(rainCricketOverlapSeconds / 2); engine._tick();
    assert.ok(Math.abs(engine._fieldSceneGain() - Math.SQRT1_2) < 1e-12);
    assert.ok(Math.abs(engine._cricketGain() - .045 * Math.SQRT1_2) < 1e-12);
    context.advance(rainCricketOverlapSeconds / 2); engine._tick();
    assert.equal(engine.getMetrics().outputGains.field, 0); assert.equal(engine._cricketGain(), .045);
    assert.equal(engine.getMetrics().outputGains.main, .55, 'Main remains open for the subsequent PA hold and handoff.');
    if (projectionFadeSeconds > rainCricketOverlapSeconds) assert.ok(engine.getMetrics().sceneScore.projectionGain > 0, 'A longer image fade does not extend the rain.');
  }
});

test('moisture travels through the old gentle 28 percent sound domain while shared phone damping stays full range', async t => {
  assert.equal(audibleMoisture(1), .28); assert.equal(audibleMoisture(.5), .14);
  const p = macroParameters({ moisture: 1 }); assert.equal(p.macros.moisture, 1); assert.equal(p.audibleMoisture, .28);
  assert.equal(p.damping, 900 + 9000 * (1 - .28) ** 2);
  const { engine } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  await engine.setLayerVariations('moisture', endpoints('moisture')); await engine.enable(); await flush();
  engine.setMacro('moisture', 1);
  const layer = engine.layers.get('moisture');
  assert.ok(Math.abs(layer.gain.gain.value - .035 * (.28 ** 2 * (3 - 2 * .28))) < 1e-12);
  assert.equal(layer.filter.frequency.value, 7000 - 2500 * .28);
  const dry = phoneBedParameters([], null, { progression: { sourceCount: 1, outCount: 0, heat: 1, moisture: 0 } });
  const wet = phoneBedParameters([], null, { progression: { sourceCount: 1, outCount: 0, heat: 1, moisture: 1 } });
  assert.equal(wet.moisture, 1); assert.equal(wet.cutoff, 600); assert.ok(wet.gain < dry.gain * .5);
});

test('every identity alternates only its assigned pair through movement, cooling and repeated local presses', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  engine.setParticipants([participant('stable-pair', 8)]); await engine.enable();
  const pair = participantMidiPair({ id: 'stable-pair' });
  const played = new Set();
  for (let tick = 0; tick < 25; tick++) {
    for (const grain of engine.toneGrains) { assert.ok(pair.includes(grain.midi)); played.add(grain.midi); }
    engine.setParticipants([participant('stable-pair', 8, { heat: tick / 25, position: [tick / 25, 1 - tick / 25] })]);
    context.advance(.1); engine._tick();
  }
  assert.deepEqual([...played].sort((a, b) => a - b), [...pair]);
  const metrics = engine.getMetrics(); assert.deepEqual(metrics.frequencies[0].midiPair, pair);
  assert.ok(metrics.toneGranular.grains.every(grain => pair.includes(grain.midi)));
  for (const variation of [0, .5, 1]) {
    const chime = participantGrainParameters(false, variation), drone = participantGrainParameters(true, variation);
    assert.ok(chime.attack >= .001 && chime.attack <= .004); assert.equal(chime.interval, (.14 + .24 * variation) / 3);
    assert.ok(drone.interval < drone.duration / 2);
  }
});

test('dense chimes retain their strike rate while piano-like rings overlap within fixed scheduling limits', async t => {
  const { engine, context } = harness(t, { mode: 'operator' }); engine._random = () => .5;
  engine.setParticipants([participant('dense', 1, { pitchIndex: 0 })]); await engine.enable();
  const scheduled = new Set(); let overlap = false;
  for (let frame = 0; frame < 100; frame++) {
    const grains = [...engine.toneGrains].sort((a, b) => a.at - b.at);
    for (const grain of grains) scheduled.add(grain);
    if (grains.length > 1) overlap ||= grains[1].at < grains[0].at + grains[0].duration;
    assert.ok(grains.length <= 20); assert.ok(grains.every(grain => grain.source.stoppedAt > context.currentTime));
    context.advance(.06); engine._tick();
  }
  assert.ok(scheduled.size >= 69 && scheduled.size <= 73, `${scheduled.size} strikes over six seconds replaces about 24 sparse strikes.`);
  assert.ok(overlap); assert.ok([...scheduled].every(grain => grain.attack === .0025 && grain.duration === .65 && grain.mono));
  context.advance(30); engine._tick();
  assert.ok([...engine.toneGrains].every(grain => grain.at >= context.currentTime + .008));
  assert.ok(engine.toneGrains.size <= 20, 'Late callbacks never schedule the missed thirty seconds.');
});

test('out grains and the low drone have audible unity-level routes after participant, distance and main-output attenuation', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  engine.setParticipants([participant('struck', 1, { pitchIndex: 0 }), participant('cool-bed', 2, { pitchIndex: 7, holding: false, extinguished: true, heat: 0 })]);
  engine.setSceneState({ id: 'participation', elapsedMs: 12000, paused: true }); await engine.enable();
  context.advance(1); engine._tick();
  const out = engine.voices.get('cool-bed'), grains = [...engine.toneGrains].filter(grain => grain.voice === out);
  assert.ok(grains.length >= 3); assert.equal(out.grainGate.gain.value, .9);
  const peak = grains[0].peak * out.grainGate.gain.value;
  const oldPeak = .0045 / Math.sqrt(2) * .55;
  assert.ok(peak > oldPeak * 7.9, 'The granular bed gains about 18 dB before the unchanged main output.');
  const postMainPeak = peak * out.grainSpace.distance.gain.value * out.grainMixer.gain.value * engine.toneGrainDirect.gain.value * engine.mix.gain.value * engine.level;
  assert.ok(postMainPeak > .004, 'The audible path retains a useful envelope peak at the default listening position.');
  assert.deepEqual(out.grainEnvelope.connections, [out.grainMixer]); assert.deepEqual(out.grainMixer.connections, [out.grainSpace.input]);
  const drone = engine.mainDrone;
  assert.deepEqual(drone.oscillators.slice(0, 3).map(oscillator => oscillator.frequency.value), MAIN_DRONE_MIDI.map(patchFrequencyForMidi));
  assert.ok(drone.oscillators.slice(3).every((oscillator, index) => oscillator.frequency.value >= patchFrequencyForMidi(MAIN_DRONE_MIDI[index]) * .75 && oscillator.frequency.value <= patchFrequencyForMidi(MAIN_DRONE_MIDI[index])));
  assert.ok(drone.filter.frequency.value >= 2 * drone.oscillators.at(-1).frequency.value);
  const dronePower = drone.partials.reduce((sum, partial) => sum + partial.gain.value ** 2 / 2, 0);
  const postMainRms = Math.sqrt(dronePower) * drone.gain.gain.value * engine.mix.gain.value * engine.level;
  assert.ok(postMainRms > .009 && postMainRms < .015, 'The separated half-level banks retain quiet, speaker-audible support.');
  const coherentPower = MAIN_DRONE_AMPLITUDES.reduce((sum, level) => sum + level ** 2 / 2, 0);
  const unisonRms = Math.sqrt(coherentPower) * drone.gain.gain.value * engine.mix.gain.value * engine.level;
  assert.ok(unisonRms > .012 && unisonRms < .015, 'Coherent unison restores the original drone level without doubling it.');
  assert.deepEqual(drone.gain.connections, [engine.mixerNodes.get('lowDrone')]);
  assert.deepEqual(engine.mixerNodes.get('lowDrone').connections, [engine.fieldBus]);
});

test('main mixer validates atomically, clamps finite trims, and controls recordings, synthetic beds and both participant paths independently', async t => {
  const { engine, context, events } = harness(t, { mode: 'operator' });
  assert.deepEqual(engine.getMetrics().mixer, SOUND_MIXER_DEFAULTS);
  assert.equal(SOUND_MIXER_DEFAULTS.bells, 1.6); assert.equal(SOUND_MIXER_DEFAULTS.quench, 1);
  assert.equal(engine.setMixer({ forest: 3, ash: -1, chimes: .4 }), true);
  assert.equal(engine.mixer.forest, 2); assert.equal(engine.mixer.ash, 0); assert.equal(engine.mixer.chimes, .4); assert.deepEqual(events, []);
  const beforeInvalid = engine.getMetrics().mixer;
  for (const invalid of [null, [], 4, { forest: NaN }, { forest: Infinity }, { forest: '1' }, { forest: null }, { haze: .1, unknown: 1 }]) {
    assert.equal(engine.setMixer(invalid), false); assert.deepEqual(engine.getMetrics().mixer, beforeInvalid);
  }
  engine.setPatches([patch('fire', 1)]);
  engine.setParticipants([participant('chime'), participant('drone', 2, { holding: false, extinguished: true, heat: 0 })]); await engine.enable();
  const active = engine.voices.get('chime'), out = engine.voices.get('drone'), macros = { ...engine.macros };
  assert.equal(active.directMixer.gain.value, .4); assert.equal(active.grainMixer.gain.value, .4);
  engine.setMixer({ forest: 0, ash: .2, haze: .3, rain: .4, moisture: .5, crickets: .6, chimes: 0, outDrone: 1.7, lowDrone: 1.4 });
  engine._tick();
  for (const [id, node] of engine.mixerNodes) {
    assert.equal(node.gain.value, engine.mixer[id]);
    assert.ok(node.gain.events.some(event => event[0] === 'target' && event[3] === .06), `${id} smoothly changes its real output gain.`);
  }
  for (const id of ['forest', 'roar', 'charcoal']) assert.deepEqual(engine.layers.get(id).gain.connections, [engine.mixerNodes.get('forest')]);
  for (const grain of engine.grains) assert.deepEqual(grain.envelope.connections, [engine.mixerNodes.get('forest')]);
  assert.deepEqual(engine.turbulenceGain.connections, [engine.mixerNodes.get('forest')]);
  assert.deepEqual(engine.ashGain.connections, [engine.mixerNodes.get('ash')]);
  for (const id of ['haze', 'ash', 'rain', 'moisture', 'crickets']) assert.deepEqual(engine.layers.get(id).gain.connections, [engine.mixerNodes.get(id)]);
  for (const node of [active.directMixer, active.grainMixer]) assert.equal(node.gain.value, 0);
  for (const node of [out.directMixer, out.grainMixer]) assert.equal(node.gain.value, 1.7);
  assert.deepEqual(engine.macros, macros, 'Mixing changes loudness without rewriting timbre controls.');
  engine.setParticipants([]); assert.ok(engine.tails.has(active));
  engine.setMixer({ chimes: .7, outDrone: .3 });
  assert.equal(active.grainMixer.gain.value, .7); assert.equal(out.grainMixer.gain.value, .3, 'Releasing voices retain their own mixer channel.');
  context.advance(2); engine._tick();
});

test('mixer boosts remain inside scene masks and the complete role ending, while all phone gains stay unchanged', async t => {
  const main = harness(t, { mode: 'operator' }), phone = harness(t);
  const boosts = Object.fromEntries(Object.keys(SOUND_MIXER_DEFAULTS).map(name => [name, 2]));
  main.engine.setMixer(boosts); main.engine.setProgression({ sourceCount: 1, outCount: 1 });
  main.engine.setParticipants([participant('held'), participant('out', 2, { extinguished: true, heat: 0 })]);
  main.engine.setSceneState({ id: 'arrival', elapsedMs: 0, paused: true }); await main.engine.enable();
  assert.equal(main.engine.voices.size, 0); assert.equal(main.engine.mainDrone, null);
  for (const id of ['forest', 'roar', 'charcoal', 'ash', 'rain', 'moisture', 'crickets']) assert.equal(main.engine.layers.get(id).gain.gain.value, 0);
  main.engine.setSceneState({ id: 'participation', elapsedMs: 12000, paused: true }); main.engine._tick();
  main.engine.setSceneState({ id: 'afterglow', elapsedMs: 0, paused: false });
  const endingEvents = main.engine.master.gain.events.length;
  main.engine.setMixer(Object.fromEntries(Object.keys(boosts).map(name => [name, 0]))); main.engine.setMixer(boosts);
  assert.equal(main.engine.master.gain.events.length, endingEvents, 'Trims cannot restart or overwrite the audio-clock ending.');
  main.context.advance(30); assert.equal(main.engine.getMetrics().outputGains.main, .55);
  assert.equal(main.engine.getMetrics().outputGains.field, 0);
  main.context.advance(24); assert.equal(main.engine.getMetrics().outputGains.main, 0);
  assert.equal(main.engine.master.gain.events.filter(event => event[0] === 'curve').at(-1)[1].at(-1), 0);
  for (const node of main.engine.mixerNodes.values()) assert.ok(node.connections.includes(main.engine.mix) || node.connections.includes(main.engine.fieldBus));
  assert.deepEqual(main.engine.mix.connections, [main.engine.highpass]); assert.deepEqual(main.engine.highpass.connections, [main.engine.master]);
  main.engine.setSceneState({ id: 'ended', elapsedMs: 0 }); main.engine.setMixer(boosts);
  assert.equal(roleGain(main.engine), 0); assert.equal(main.engine.voices.size, 0);
  phone.engine.setProgression({ sourceCount: 2, outCount: 1 }); phone.engine.setPatches([patch('phone', 1)]); await phone.engine.enable();
  const phoneBed = phone.engine.getMetrics().phoneBed, phoneGains = [...phone.engine.layers.values()].map(layer => layer.gain.gain.value), phoneMasterEvents = phone.engine.master.gain.events.length;
  phone.engine.setMixer(Object.fromEntries(Object.keys(boosts).map(name => [name, 0]))); phone.engine._tick(); phone.engine.setMixer(boosts);
  assert.deepEqual(phone.engine.getMetrics().phoneBed, phoneBed); assert.deepEqual([...phone.engine.layers.values()].map(layer => layer.gain.gain.value), phoneGains);
  assert.equal(phone.engine.mixerNodes.size, 0); assert.equal(phone.engine.master.gain.events.length, phoneMasterEvents);
  assert.deepEqual(phone.engine.layers.get('crackle').gain.connections, [phone.engine.phoneMixerNodes.get('crackle')]);
  assert.deepEqual(phone.engine.layers.get('crickets').gain.connections, [phone.engine.phoneMixerNodes.get('crickets')]);
});

test('rain has independent circular passages and spatial depths with fixed source gain and gentle Main output compression', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  context.decodeAudioData = async () => context.createBuffer(1, 120000, 8000);
  await engine.setLayerVariations('rain', endpoints('rain')); engine.setMacro('rain', .65); await engine.enable(); await flush();
  const layer = engine.layers.get('rain'), records = [...layer.sources]; assert.equal(records.length, 6);
  const gainEvents = layer.gain.gain.events.length;
  for (const record of records) { assert.equal(record.source.loop, true); assert.ok(Math.abs(record.source.playbackRate.value - 1) < .025); assert.equal(record.duration, Infinity); }
  assert.equal(new Set(records.map(record => record.phase)).size, 6);
  assert.equal(new Set(records.map(record => record.perspective.name)).size, 3);
  assert.ok(layer.highpass.frequency.value <= 55, 'The common rain path retains the regenerated thunder low end.');
  assert.equal(records.filter(record => record.perspective.highpass <= 80).length, 4, 'Both endpoint recordings retain bass in their broad and far perspectives.');
  for (let tick = 0; tick < 40; tick++) { context.advance(.3); engine._tick(); }
  assert.deepEqual([...layer.sources], records); assert.equal(layer.gain.gain.events.length, gainEvents);
  assert.equal(engine.compressor.threshold.value, -6); assert.equal(engine.compressor.ratio.value, 2); assert.equal(engine.compressor.knee.value, 6);
  engine.setSceneState({ id: 'final-rain', rainIntensity: .2 }); assert.equal(engine.getMetrics().macros.rain, .65);
  engine.setSceneState({ id: 'final-rain', paused: true, rainIntensity: .2 }); context.advance(3); engine._tick(); assert.equal(engine.getMetrics().macros.rain, .65);
  engine.setSceneState({ id: 'afterglow', rainIntensity: 1, elapsedMs: 2000 }); assert.equal(layer.gain.gain.value, .125);
  engine.disable(); context.advance(MAIN_DISABLE_FADE_SECONDS + .03);
  assert.ok(records.every(record => record.nodes.every(node => node.disconnected)));
  assert.ok(records.every(record => record.modulators.every(node => node.stoppedAt !== undefined)));
});

test('rain replacement preserves unchanged perspectives and dry voices retain level as the audience grows', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  context.decodeAudioData = async () => context.createBuffer(1, 120000, 8000);
  const [a, b] = endpoints('rain');
  await engine.setLayerVariations('rain', [a, b]); engine.setMacro('rain', 1); await engine.enable(); await flush();
  const rain = engine.layers.get('rain'), unchanged = [...rain.sources].filter(record => record.url === a.url);
  assert.equal(unchanged.length, 3);
  await engine.setLayerVariations('rain', [a, { ...b, url: '/rain-replacement.mp3' }]); await flush();
  assert.ok(unchanged.every(record => rain.sources.has(record)), 'A palette refresh cannot evict a still-selected rain perspective.');
  assert.ok(rain.sources.size <= 12);
  context.advance(2); engine._tick();
  assert.equal(rain.sources.size, 6);
  engine.setAudienceParticipationCount(16);
  engine.setPatchVoices([sourceVoice('crowded', { holding: true, heat: .02, moisture: 1 })]);
  assert.equal(engine.getMetrics().participantCount, 16); assert.equal(engine.getMetrics().softTones.participantCount, 16);
  assert.equal(engine.getMetrics().softTones.crowdTargetGain, 1);
  assert.equal(engine.patchSoftTones.textureDestination, engine.textureDryBus);
  assert.equal(engine.textureDryBus.gain.value, .8); assert.deepEqual(engine.textureDryBus.connections, [engine.fieldBus]);
  assert.equal(engine.patchSoftTones.textureReverbDestination, engine.toneReverbFilter, 'Selected material sends retain the shared spatial room.');
  engine.setAudienceParticipationCount(0); assert.equal(engine.getMetrics().softTones.crowdTargetGain, 1);
});

test('three insect recordings retain independent phase and perspective while the Main master carries their dark PA hold', async t => {
  const { engine, context, requests } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  const entries = ['near', 'middle', 'far'].map((id, index) => ({ id, url: `/insects/${id}.mp3`, depth: index / 2 }));
  assert.equal(await engine.setCricketLayers(entries), true); assert.equal(requests.length, 0);
  engine.setProgression({ sourceCount: 100, outCount: 0 }); await engine.enable(); await flush();
  assert.equal(requests.some(url => url.startsWith('/insects/')), false);
  engine.setProgression({ sourceCount: 100, outCount: 100 }); await flush();
  const layer = engine.layers.get('crickets'), slots = entries.map(entry => layer.variationSlots.get(entry.url));
  assert.equal(layer.sources.size, 3); assert.equal(new Set([...layer.sources].map(record => record.source.offset)).size, 3);
  assert.ok(Math.abs(slots.reduce((sum, slot) => sum + slot.weight ** 2, 0) - 1) < 1e-12);
  assert.equal(new Set(slots.map(slot => slot.space.filter)).size, 3); assert.equal(new Set(slots.map(slot => slot.space.panner)).size, 3);
  assert.ok(slots[0].space.filter.frequency.value > slots[2].space.filter.frequency.value);
  const initial = { gain: layer.gain.gain.value, cutoff: layer.filter.frequency.value, pan: Math.abs(slots[0].space.panner.pan.value) };
  engine.setSceneState({ id: 'afterglow', elapsedMs: 34000 });
  assert.equal(roleGain(engine), engine.level); assert.equal(layer.gain.gain.value, initial.gain);
  assert.equal(engine.getMetrics().outputGains.field, 0);
  assert.equal(layer.filter.frequency.value, initial.cutoff); assert.equal(Math.abs(slots[0].space.panner.pan.value), initial.pan);
  const halfTail = cricketRetreatParameters(58900); assert.ok(halfTail.tail > 0 && halfTail.tail < 1);
  context.advance(60); engine._tick(); assert.equal(engine.getMetrics().outputGains.main, 0);
  assert.equal(engine.master.gain.events.filter(event => event[0] === 'curve').at(-1)[1].at(-1), 0);
  const phone = harness(t); assert.equal(await phone.engine.setCricketLayers(entries), true);
});


test('short local and audience taps complete a minimum audible attack before their full release', async t => {
  for (const local of [false, true]) {
    const { engine, context } = harness(t, { mode: 'operator' }); await engine.enable();
    const setActor = actor => local ? engine.setLocalParticipant(actor) : engine.setParticipants([actor]);
    setActor(participant('quick-tap', 1)); const voice = engine.voices.get('quick-tap');
    context.advance(.1); setActor(participant('quick-tap', 1, { holding: false }));
    assert.equal(engine.voices.get('quick-tap'), voice); assert.equal(engine.tails.size, 0);
    context.advance(.54); engine._tick(); assert.equal(engine.voices.get('quick-tap'), voice);
    context.advance(.02); engine._tick(); assert.equal(engine.voices.size, 0); assert.ok(engine.tails.has(voice));
    assert.equal(voice.releaseSeconds, 1.65); assert.ok(voice.releaseFrom > .95);
    context.advance(1.7); engine._tick(); assert.equal(engine.tails.size, 0); assert.equal(engine.voices.size, 0);
  }
});

test('removed identities and paused or disabled pages cannot revive stale minimum-gate taps', async t => {
  for (const action of ['disconnect', 'local-null', 'mute', 'hidden', 'reset', 'disable']) {
    const { engine, context } = harness(t, { mode: 'operator' }); await engine.enable();
    const local = action === 'local-null';
    if (local) engine.setLocalParticipant(participant('tap')); else engine.setParticipants([participant('tap')]);
    context.advance(.03);
    if (local) engine.setLocalParticipant(null);
    else if (action === 'disconnect') engine.setParticipants([]);
    else {
      engine.setParticipants([participant('tap', 1, { holding: false })]);
      if (action === 'mute') { engine.setMuted(true); engine.setMuted(false); await flush(); }
      if (action === 'hidden') { engine.setHidden(true); engine.setHidden(false); await flush(); }
      if (action === 'reset') engine.reset('new');
      if (action === 'disable') { engine.disable(); await engine.enable(); }
    }
    assert.equal(engine.participantActivity.size, 0, action);
    assert.equal(engine.voices.size, 0, action);
    context.advance(2); engine._tick(); assert.equal(engine.voices.size, 0, action); assert.equal(engine.tails.size, 0, action);
  }
});

const sourceVoice = (key, values = {}) => ({ id: `patch:${key}`, key, position: [.25, .75], holding: false, heat: .8, moisture: .2, surfaceWetness: .1, extinguished: false, sourceCount: 1, ...values });

test('Main dragging on confirmed out terrain excites spatial ash without retapping bells or reviving pitched notes', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  await engine.setLayerVariations('ash', endpoints('ash'));
  const patch = { key: '440,-8', longitude: 110.125, latitude: -1.875, heat: 0, moisture: 1, surfaceWetness: 1, extinguished: true };
  const field = createParticipantSoundField([patch]);
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); engine.setPatchVoices([sourceVoice(patch.key, patch)]);
  engine.setRainAreaContacts(field, [{ id: 'phone', holding: true, position: [110.125, -1.875] }]);
  await engine.enable(); await flush();
  for (let tick = 0; tick < 5; tick++) { context.advance(.1); engine.setRainAreaContacts(field, [{ id: 'phone', holding: true, position: [110.125, -1.875] }]); engine._tick(); }
  assert.equal(engine.dragAsh.getMetrics().scheduled, 0, 'A stationary held touch stays silent.');
  for (const longitude of [110.325, 110.525, 110.725]) { context.advance(.1); engine.setRainAreaContacts(field, [{ id: 'phone', holding: true, position: [longitude, -1.875] }]); engine._tick(); }
  const moving = engine.dragAsh.getMetrics(); assert.ok(moving.scheduled > 0); assert.ok(moving.grains.every(grain => grain.mono));
  assert.equal(engine.localBells.getMetrics().bellsTriggered, 0); assert.equal(engine.getMetrics().rainAreas.triggered, 0);
  assert.equal(engine.patchSoftTones.voices.size, 0, 'Dragging ash does not create a new cooling tone on baseline-out terrain.');
  engine.setMixer({ outDrone: 0, dragAsh: 1.5 });
  assert.equal(engine.dragAsh.weight, 1.5, 'The dedicated grain trim is independent of the material tails.');
  engine.setMixer({ dragAsh: 0 }); assert.equal(engine.dragAsh.outputTarget, 0);
  engine.setMixer({ dragAsh: 1 });

  const scheduled = moving.scheduled;
  engine.setRainAreaContacts(field, []);
  for (let tick = 0; tick < 10; tick++) { context.advance(.1); engine._tick(); }
  assert.equal(engine.dragAsh.getMetrics().currentGrains, 0);
  engine.setSceneState({ id: 'forest-takeover', elapsedMs: 0 }); assert.equal(engine.dragAsh.active, true);
  assert.ok(engine.dragAsh.getMetrics().scheduled >= scheduled);
  engine.reset('new'); assert.equal(engine.dragAsh.getMetrics().trackedActors, 0);
  const phone = harness(t); await phone.engine.enable(); assert.equal(phone.engine.getMetrics().dragAsh, null);
});

test('Main blobs follow individual new out edges independently of grouped area sounds, and rearm only after real fire returns', async t => {
  let wall = 100;
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch, areaClock: () => wall });
  const sources = ['a', 'b', 'c', 'd'].map(id => ({ id: `blob-${id}`, url: `/blob-${id}.mp3` }));
  await engine.setMainBlobSources(sources);
  engine.setRainAreaContacts({ patches: [], patchesAt: () => [] }, []);
  const hot = Array.from({ length: 5 }, (_, index) => sourceVoice(`fire-${index}`));
  const baseline = sourceVoice('baseline', { extinguished: true, heat: 0 });
  engine.setPatchVoices([...hot, baseline]); engine.setSceneState({ id: 'participation', elapsedMs: 12000 });
  await engine.enable(); await flush(); await engine.mainBlob.setSources(sources);
  assert.equal(engine.mainBlob.getMetrics().assetCount, 4); assert.equal(engine.mainBlob.getMetrics().triggered, 0);
  const out = hot.map(patch => ({ ...patch, extinguished: true, heat: 0 }));
  engine.setPatchVoices([...out, baseline]);
  assert.equal(engine.mainBlob.getMetrics().triggered, 1); assert.equal(engine.pendingBlobs.length, 4);
  const played = [engine.mainBlob.getMetrics().currentAssetId];
  for (let index = 0; index < 4; index++) { context.advance(.101); wall += .101; engine._tick(); played.push(engine.mainBlob.getMetrics().currentAssetId); }
  assert.equal(engine.mainBlob.getMetrics().triggered, 5);
  assert.ok(played.slice(1).every((id, index) => id !== played[index]), 'Consecutive blobs use genuinely different recordings.');
  assert.equal(engine.localBells.getMetrics().bellsTriggered, 0); assert.equal(engine.mainQuench.getMetrics().triggered, 0);
  engine.setPatchVoices([...out, baseline]); assert.equal(engine.mainBlob.getMetrics().triggered, 5, 'Repeated out packets and taps stay quiet.');
  engine.setPatchVoices([hot[0], ...out.slice(1), baseline]);
  context.advance(.11); wall += .11; engine.setPatchVoices([...out, baseline]);
  assert.equal(engine.mainBlob.getMetrics().triggered, 6);
  engine.setMixer({ blob: 2, quench: .3 }); assert.equal(engine.mainBlob.weight, 2); assert.equal(engine.mainQuench.weight, .3);
  engine.setMuted(true); engine.setPatchVoices([hot[0], ...out.slice(1), baseline]); engine.setPatchVoices([...out, baseline]);
  assert.equal(engine.pendingBlobs.length, 0); engine.setMuted(false); await flush(); engine._tick();
  assert.equal(engine.mainBlob.getMetrics().triggered, 6, 'Unmuting never replays an observed old extinction.');
  engine.setSceneState({ id: 'forest-takeover', elapsedMs: 0 });
  engine.setPatchVoices(hot); engine.setPatchVoices(out); assert.ok(engine.pendingBlobs.length > 0, 'New real extinctions remain audible during takeover.');
  const phone = harness(t); assert.equal(await phone.engine.setMainBlobSources(sources), false); await phone.engine.enable();
  assert.equal(phone.engine.getMetrics().mainBlob, null);
});

test('mass-extinction blobs retain bounded admission, expiry and cleanup instead of accumulating a late chorus', async t => {
  let wall = 0;
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch, areaClock: () => wall });
  const sources = [{ id: 'blob', url: '/blob.mp3' }]; await engine.setMainBlobSources(sources);
  engine.setRainAreaContacts({ patches: [], patchesAt: () => [] }, []);
  const hot = Array.from({ length: 1000 }, (_, index) => sourceVoice(`burst-${index}`));
  engine.setPatchVoices(hot); engine.setSceneState({ id: 'participation', elapsedMs: 12000 });
  await engine.enable(); await flush(); await engine.mainBlob.setSources(sources);
  engine.setPatchVoices(hot.map(patch => ({ ...patch, extinguished: true, heat: 0 })));
  assert.ok(engine.pendingBlobs.length <= 64); assert.equal(engine.blobObserved, 1000);
  for (let tick = 0; tick < 45; tick++) {
    context.advance(.101); wall += .101; engine._tick();
    const metrics = engine.mainBlob.getMetrics(); assert.ok(metrics.currentVoices <= 8); assert.ok(metrics.currentVoices + metrics.retiringVoices <= 9);
  }
  assert.equal(engine.pendingBlobs.length, 0); assert.ok(engine.blobDropped > 900);
  const triggered = engine.mainBlob.getMetrics().triggered; context.advance(10); wall += 10; engine._tick();
  assert.equal(engine.mainBlob.getMetrics().triggered, triggered, 'Expired events cannot emerge later.');
  engine.reset('fresh'); assert.equal(engine.blobObserved, 0); assert.equal(engine.pendingBlobs.length, 0);
});

test('blob loading and interrupted audio consume old edges instead of replaying them when output becomes ready', async t => {
  let finishLoad;
  const waiting = { promise: new Promise(resolve => { finishLoad = resolve; }), resolve: value => finishLoad(value) };
  const sources = [{ id: 'blob', url: '/blob.mp3' }];
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: url => url === '/blob.mp3' ? waiting.promise : successfulFetch() });
  await engine.setMainBlobSources(sources); engine.setRainAreaContacts({ patches: [], patchesAt: () => [] }, []);
  const hot = sourceVoice('one'), out = { ...hot, extinguished: true, heat: 0 };
  engine.setPatchVoices([hot]); engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); await engine.enable(); await flush();
  engine.setPatchVoices([out]); assert.equal(engine.pendingBlobs.length, 0);
  waiting.resolve(await successfulFetch()); await flush(); await flush();
  assert.equal(engine.mainBlob.getMetrics().assetCount, 1); engine._tick(); assert.equal(engine.mainBlob.getMetrics().triggered, 0);
  engine.setPatchVoices([hot]); await context.suspend();
  engine.setPatchVoices([out]); assert.equal(engine.mainBlob.active, false); assert.equal(engine.pendingBlobs.length, 0);
  await context.resume(); context.onstatechange?.(); engine._tick();
  assert.equal(engine.mainBlob.getMetrics().triggered, 0);
  engine.setPatchVoices([hot]); engine.setPatchVoices([out]); assert.equal(engine.mainBlob.getMetrics().triggered, 1);
  engine.setPatchVoices([hot, sourceVoice('two')]);
  engine.setPatchVoices([out, sourceVoice('two', { extinguished: true, heat: 0 })]);
  assert.ok(engine.pendingBlobs.length > 0); await context.suspend(); assert.equal(engine.pendingBlobs.length, 0);
});

test('production patches have one stable D-flat overtone note and a ground-driven airy emergence', async t => {
  assert.deepEqual(PATCH_PENTATONIC_MIDI, TONE_HARMONICS.map(harmonic => 37 + 12 * Math.log2(harmonic)));
  const assigned = new Set();
  for (let key = 0; key < 1000; key++) {
    const midi = patchMidi(String(key)); assert.ok(PATCH_PENTATONIC_MIDI.includes(midi)); assigned.add(midi);
    assert.equal(patchMidi({ key: String(key), heat: 0, pitchIndex: 34 }), midi);
    assert.deepEqual(patchMidiPair({ key: String(key) }), [midi]);
    assert.equal(midi, PATCH_PENTATONIC_MIDI[patchHash(String(key)) % 29]);
    assert.equal(patchFrequencyForMidi(midi), OVERTONE_ROOT_HZ * overtonePitchForKey(String(key)).harmonic);
  }
  assert.deepEqual([...assigned].sort((a,b) => a-b), PATCH_PENTATONIC_MIDI, 'Fixed keys span each harmonic from 2 through 30.');
  const dry = patchSoftToneParameters({ heat: 1, moisture: 0, surfaceWetness: 0 });
  const skin = patchSoftToneParameters({ heat: 1, moisture: 0, surfaceWetness: 1 });
  const middle = patchSoftToneParameters({ heat: .5, moisture: .6, surfaceWetness: 1 });
  const deep = patchSoftToneParameters({ heat: .04, moisture: .95, surfaceWetness: 1 });
  assert.equal(dry.emergence, 0); assert.ok(skin.emergence < .0001);
  assert.ok(middle.emergence > skin.emergence && deep.emergence > middle.emergence);
  const { engine, context } = harness(t, { mode: 'operator' });
  engine.setPatchVoices([sourceVoice('west', { holding: true, heat: 1, moisture: 0, surfaceWetness: 0, position: [.1,.8] })]);
  await engine.enable(); const voice = engine.patchSoftTones.voices.get('west');
  assert.equal(voice.gain.gain.value, 0); assert.equal(voice.oscillators.length, 2); assert.equal(engine.toneGrains.size, 0);
  context.advance(3); engine._tick(); assert.equal(voice.targetGain, 0, 'Elapsed touch time alone cannot reveal a note.');
  engine.setPatchVoices([sourceVoice('west', { holding: true, heat: .04, moisture: .95, surfaceWetness: 1, position: [.99,.01], pitchIndex: 0 })]);
  assert.equal(engine.patchSoftTones.voices.get('west'), voice);
  assert.equal(voice.midi, patchMidi('west',0)); assert.deepEqual(voice.position, [.1,.8]);
  assert.ok(voice.targetGain > .95 * PATCH_SOFT_TONE_LEVEL && voice.targetGain <= PATCH_SOFT_TONE_LEVEL); assert.ok(voice.gain.gain.events.some(event => event[0] === 'target' && event[1] > 0 && event[3] === .3), 'The rounded attack follows confirmed cooling within the brief live cooling window.');
  assert.equal(voice.space.input.channelCount, 1); assert.equal(voice.space.panner.pan.value, participantPosition([.1,.8]).pan);
  assert.equal(engine.getMetrics().softTones.singlePitch, true); assert.equal(engine.getMetrics().patchVoices.patches[0].midi, patchMidi('west',0));
  assert.ok(!context.nodes.some(node => node.nodeType === 'source' && engine.toneGrains.has(node)), 'Production never schedules struck pitch grains.');
});

async function prepareResidueLibrary(engine, context) {
  context.decodeAudioData = async () => {
    const buffer = context.createBuffer(2, 16000, 8000);
    for (let channel = 0; channel < 2; channel++) for (let i = 0; i < buffer.length; i++) buffer.getChannelData(channel)[i] = .1 * Math.sin(i * (.173 + channel * .031));
    return buffer;
  };
  for (const id of ['ash','moisture','haze']) await engine.setLayerVariations(id, endpoints(id));
}

test('only in-session out edges morph the same fixed note into one stable actual texture, then fully finish', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  await prepareResidueLibrary(engine, context);
  engine.setPatchVoices([sourceVoice('canonical', { holding: true, heat: .02, moisture: 1, surfaceWetness: 1 })]);
  await engine.enable(); await flush(); context.advance(3); engine._tick();
  const voice = engine.patchSoftTones.voices.get('canonical'), pitch = voice.midi;
  const out = sourceVoice('canonical', { heat: 0, extinguished: true });
  engine.setPatchVoices([out]); engine._tick();
  assert.equal(engine.patchSoftTones.voices.size, 0); assert.equal(engine.patchSoftTones.morphVoices.get('canonical'), voice);
  const residue = engine.patchSoftTones.residues.get('canonical');
  assert.equal(residue.id, patchResidueId('canonical')); assert.equal(residue.endAt - residue.at, 28);
  assert.equal(voice.midi, pitch); assert.deepEqual(voice.position, out.position);
  assert.ok(residue.selected.url.startsWith(`/generated/${residue.id}-`));
  for (const source of engine.patchSoftTones.textureSources) {
    assert.equal(source.source.loop, true); assert.equal(source.source.playbackRate.value, source.residue.treatment.playbackRate);
    assert.equal(source.source.buffer.numberOfChannels, 1); assert.ok(source.source.stoppedAt <= residue.endAt + .02);
    assert.equal(source.space.input.channelCount, 1); assert.equal(source.space.panner.pan.value, participantPosition(out.position).pan);
    const curve = source.gain.gain.events.find(event => event[0] === 'curve')[1]; assert.equal(curve[0], 0); assert.equal(curve.at(-1), 0);
    assert.ok(source.source.buffer.getChannelData(0).some(value => value !== 0), 'The residue uses the loaded recording rather than a noise substitute.');
  }
  for (let tick = 0; tick < 140; tick++) { context.advance(.06); engine.setPatchVoices([out]); engine._tick(); }
  assert.equal(engine.patchSoftTones.morphVoices.size, 0); assert.ok(engine.patchSoftTones.residues.has('canonical'));
  assert.deepEqual(patchResidueEnvelope(0), { tone: 1, texture: 0, done: false });
  assert.ok(Math.abs(patchResidueEnvelope(4).tone ** 2 + patchResidueEnvelope(4).texture ** 2 - 1) < 1e-12);
  assert.equal(patchResidueEnvelope(8).texture, 1); assert.ok(patchResidueEnvelope(18).texture > 0);
  assert.deepEqual(patchResidueEnvelope(28), { tone: 0, texture: 0, done: true });
  context.advance(20); engine._tick(); assert.equal(engine.patchSoftTones.residues.size, 0); assert.equal(engine.patchSoftTones.textureSources.size, 0);
  engine.setPatchVoices([out]); engine._tick(); assert.equal(engine.patchSoftTones.residues.size, 0, 'Repeated out snapshots never replay.');
  const reload = harness(t, { mode: 'operator', fetchImpl: successfulFetch }); await prepareResidueLibrary(reload.engine, reload.context);
  reload.engine.setPatchVoices([out]); await reload.engine.enable(); await flush();
  assert.equal(reload.engine.patchSoftTones.residues.size, 0); assert.equal(reload.engine.patchSoftTones.textureSources.size, 0, 'Already-out reloads remain quiet.');
});

test('527 simultaneous out transitions share eight staggered textures beside 32 held notes and unheard entries expire on time', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch }); await prepareResidueLibrary(engine, context);
  const burning = Array.from({ length: 527 }, (_, index) => sourceVoice(`out-${index}`, { position: [(index % 31) / 30, Math.floor(index / 31) / 17] }));
  const out = burning.map(patch => ({ ...patch, extinguished: true, heat: 0 }));
  const active = Array.from({ length: 32 }, (_, index) => sourceVoice(`held-${index}`, { holding: true, heat: .03, moisture: 1, position: [index/31,.5] }));
  engine.setPatchVoices([...burning, ...active]); await engine.enable(); await flush(); engine.setPatchVoices([...out, ...active]);
  const nativeSources = new Set([...engine.patchSoftTones.textureSources].map(record => record.source));
  for (let tick = 0; tick < 400; tick++) {
    context.advance(.06); engine.setPatchVoices([...out, ...active]); engine._tick();
    const soft = engine.getMetrics().softTones;
    assert.equal(soft.activeCount, 32); assert.ok(soft.textureSourceCount <= PATCH_TEXTURE_SOURCE_LIMIT); assert.equal(engine.toneGrains.size, 0);
    assert.equal(soft.textureSourceLimit, 8); assert.equal(soft.textureAdmissionSeconds, .1);
    assert.ok(soft.textureNormalizationCount <= 8);
    for (const record of engine.patchSoftTones.textureSources) nativeSources.add(record.source);
    assert.ok([...nativeSources].filter(source => !source.disconnected).length <= 8);
    assert.ok(soft.voices.every(voice => Number.isFinite(voice.targetGain) && voice.targetGain <= .055));
  }
  const soft = engine.getMetrics().softTones;
  assert.equal(soft.residueCount, 527); assert.ok(soft.pendingResidues > 0);
  assert.ok(soft.servedTransitions > 150 && soft.servedTransitions <= 241, 'Global admissions stay within ten onsets per second while serving the finite queue.');
  assert.ok(soft.residues.every(residue => residue.windowsScheduled <= 1), 'Unheard lifecycles have priority over repeat windows.');
  assert.equal(soft.pendingResidues + soft.servedTransitions, 527);
  assert.ok(soft.residues.every(residue => residue.endAt === 28));
  const starts = [...nativeSources].map(source => source.startedAt).sort((a, b) => a - b);
  assert.ok(starts.slice(1).every((at, index) => at - starts[index] >= PATCH_TEXTURE_ADMISSION_SECONDS - 1e-9));
  context.advance(5); engine._tick(); assert.equal(engine.getMetrics().softTones.residueCount, 0); assert.equal(engine.getMetrics().softTones.textureSourceCount, 0);
  assert.equal(engine.getMetrics().softTones.activeCount, 32, 'The texture pool cannot starve held notes.');
  engine.setPatchVoices([...out, ...active]); engine._tick();
  assert.equal(engine.getMetrics().softTones.servedTransitions, soft.servedTransitions, 'Expired queue entries cannot replay from an out snapshot.');
});

test('a complete 32-person handover admits fresh soft notes immediately while previous notes finish smooth bounded tails', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  const group = number => Array.from({ length: 32 }, (_, index) => sourceVoice(`${number}-${index}`, { holding: true, heat: .02, moisture: 1 }));
  engine.setPatchVoices(group(0)); await engine.enable(); context.advance(3); engine._tick();
  const old = [...engine.patchSoftTones.voices.values()]; engine.setPatchVoices(group(1));
  assert.equal(engine.patchSoftTones.voices.size, 32); assert.equal(engine.patchSoftTones.tails.size, 32);
  assert.ok([...engine.patchSoftTones.voices.keys()].every(key => key.startsWith('1-')));
  assert.ok(old.every(voice => voice.release.from > .006 && voice.gain.gain.events.at(-1)[0] === 'linear'));
  for (let number = 2; number < 40; number++) {
    context.advance(.1); engine.setPatchVoices(group(number)); engine._tick();
    assert.equal(engine.patchSoftTones.voices.size, 32);
    assert.ok(engine.patchSoftTones.voices.size + engine.patchSoftTones.tails.size + engine.patchSoftTones.morphVoices.size <= 96);
    assert.equal(engine.toneGrains.size, 0);
  }
  context.advance(2); engine._tick(); assert.equal(engine.patchSoftTones.tails.size, 0);
});

test('repeated 32-patch extinction bursts cannot let long morphs starve new foreground holds', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  const group = number => Array.from({ length: 32 }, (_, index) => sourceVoice(`burst-${number}-${index}`, { holding: true, heat: .02, moisture: 1 }));
  let current = group(0), history = []; engine.setPatchVoices(current); await engine.enable(); context.advance(3); engine._tick();
  for (let number = 1; number <= 24; number++) {
    history.push(...current.map(patch => ({ ...patch, extinguished: true, holding: false, heat: 0 })));
    current = group(number); context.advance(.04); engine.setPatchVoices([...history, ...current]);
    const soft = engine.patchSoftTones, metrics = soft.getMetrics();
    assert.equal(metrics.activeCount, 32); assert.ok(metrics.voices.filter(voice => voice.key.startsWith(`burst-${number}-`)).length === 32);
    assert.ok(soft.morphVoices.size <= 32); assert.ok(soft.tails.size <= 32); assert.ok(soft.handoffTails.size <= 32);
    assert.ok(soft.voices.size + soft.morphVoices.size + soft.tails.size + soft.handoffTails.size <= 128);
    assert.equal(metrics.residueCount, history.length, 'Reclaiming a tone must preserve its independent finite recording lifecycle.');
  }
  context.advance(.2); engine._tick(); assert.equal(engine.patchSoftTones.handoffTails.size, 0);
});

test('native-style strict gain curves preserve scheduling lead and old Safari can interrupt a live morph without overlap', async t => {
  for (const oldSafari of [false, true]) {
    const { engine, context } = harness(t, { mode: 'operator', maxVoices: 1, fetchImpl: successfulFetch });
    const original = context.createGain.bind(context);
    const strictGain = () => { const node = original(); node.gain = new StrictCurveParam(context); if (oldSafari) node.gain.cancelAndHoldAtTime = undefined; return node; };
    await prepareResidueLibrary(engine, context); engine.setPatchVoices([sourceVoice('first', { holding: true, heat: .01, moisture: 1 })]);
    await engine.enable(); await flush(); context.advance(3); engine._tick();
    for (const layer of engine.layers.values()) { layer.nextAt = Infinity; for (const slot of layer.variationSlots.values()) slot.nextAt = Infinity; }
    const firstGain = engine.patchSoftTones.voices.get('first').gain, currentGain = firstGain.gain.value; firstGain.gain = new StrictCurveParam(context); firstGain.gain.value = currentGain; if (oldSafari) firstGain.gain.cancelAndHoldAtTime = undefined; context.createGain = strictGain;
    engine.setPatchVoices([sourceVoice('first', { extinguished: true }), sourceVoice('second', { holding: true, heat: .01, moisture: 1 })]);
    const first = engine.patchSoftTones.morphVoices.get('first');
    assert.ok(first.gain.gain.events.find(event => event[0] === 'curve')[2] >= context.currentTime + .02);
    context.advance(.4); engine._tick();
    assert.doesNotThrow(() => engine.setPatchVoices([sourceVoice('first', { extinguished: true }), sourceVoice('second', { extinguished: true }), sourceVoice('third', { holding: true })]));
    assert.equal(engine.patchSoftTones.voices.size, 1); assert.ok(first.release.from > 0);
    const set = first.gain.gain.events.filter(event => event[0] === 'set').at(-1);
    assert.ok(set[1] > 0 && set[1] < first.morphFrom, 'Interrupted morph releases from its actual analytic level.');
    assert.ok([...engine.patchSoftTones.textureSources].every(record => record.source.stoppedAt <= record.residue.endAt));
  }
});

test('forest takeover raises a full forest on an already-cold map while subduing the other main paths once', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  await engine.setLayerVariations('forest', endpoints('forest'));
  engine.setPatches([patch('cold', 0, true)]); engine.setMacros({ forest: 0, rain: 1, ash: 1, moisture: 1 });
  engine.setSceneState({ id: 'participation', elapsedMs: 12000, paused: true }); await engine.enable(); await flush();
  engine.setAutomation(true); engine.setSceneState({ id: 'forest-takeover', elapsedMs: 0, paused: true }); assert.equal(engine.layers.get('forest').gain.gain.value, 0);
  engine.setSceneState({ id: 'forest-takeover', elapsedMs: 30000, paused: true }); engine._tick();
  assert.equal(engine.getMetrics().macros.forest, 1); assert.ok(engine.layers.get('forest').gain.gain.value > .2);
  assert.equal(engine._mainDroneGain(), 0);
  assert.ok(Math.abs(engine._sceneScore().mix.mainOther - .08) < 1e-12); assert.equal(engine.layers.get('rain').gain.gain.value, 0);
  assert.deepEqual(MAIN_DRONE_MIDI, [37, 44, 51]);
  assert.equal(roleGain(engine), engine.level); context.advance(1); engine._tick(); assert.ok(engine.layers.get('forest').gain.gain.value > .2);
});

test('cue 4 follows new holds and releases while keeping live cooling tones audible against the returning forest', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  const cooled = key => sourceVoice(key, { holding: true, heat: .02, moisture: 1 });
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 });
  engine.setPatchVoices([cooled('entry')]); await engine.enable();
  context.advance(3); engine._tick();
  const soft = engine.patchSoftTones, entry = soft.voices.get('entry');
  engine.setSceneState({ id: 'forest-takeover', elapsedMs: 30000 });
  engine.setPatchVoices([{ ...cooled('entry'), holding: false }, cooled('new')]);
  assert.equal(soft.voices.has('entry'), false); assert.ok(soft.tails.has(entry));
  const current = soft.voices.get('new'); assert.ok(current);
  context.advance(MAIN_ENABLE_FADE_SECONDS + .01); engine._tick();
  assert.equal(current.mixer.gain.value, .3, 'Interaction remains audible as the forest dominates.');
  assert.equal(soft.hazeOnlyBlend, 1);
  assert.equal(current.partials[0].gain.value, 0, 'Full takeover removes the clear fundamental.');
  assert.equal(current.partials[1].gain.value, 0, 'The stable upper harmonic also disappears.');
  assert.ok(current.hazeGain.gain.value > .5, 'Cooled ground still has an audible, band-compensated hazy response.');
  engine.setPatchVoices([sourceVoice('new', { holding: true, heat: 1, moisture: 0, surfaceWetness: 0 })]);
  assert.equal(soft.voices.get('new'), current); assert.equal(current.targetGain, 0, 'Returning heat changes the actual tone emergence.');
  engine.setPatchVoices([cooled('new')]); assert.ok(current.targetGain > .95 * PATCH_SOFT_TONE_LEVEL);
  engine.setSceneState({ id: 'final-rain', elapsedMs: 0 });
  assert.equal(current.mixer.gain.value, .3, 'The first finale frame retains the outgoing interaction balance.');
  assert.equal(soft.hazeOnlyBlend, 1, 'Finale tails retain their outgoing hazy character.');
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 });
  assert.equal(soft.hazeOnlyBlend, 0); assert.ok(current.partials[0].gain.value > 0);
});

test('joining or resetting inside cue 4 retains live held-patch tone admission', async t => {
  const { engine } = harness(t, { mode: 'operator' });
  const held = sourceVoice('late', { holding: true, heat: .02, moisture: 1 });
  engine.setPatchVoices([held]); engine.setSceneState({ id: 'forest-takeover', elapsedMs: 30000 });
  await engine.enable(); assert.ok(engine.patchSoftTones.voices.has('late'));
  engine.reset('inside-takeover'); engine.setPatchVoices([held]);
  assert.ok(engine.patchSoftTones.voices.has('late'));
  engine.setPatchVoices([{ ...held, holding: false }]);
  assert.equal(engine.patchSoftTones.voices.size, 0);
});

test('the real forest-to-heavy-rain handoff preserves its entry gain and character despite an all-out wet snapshot', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  for (const id of ['forest', 'rain']) await engine.setLayerVariations(id, endpoints(id));
  engine.setProgression({ sourceCount: 100, outCount: 0, heat: 1, moisture: 0, surfaceWetness: 0 });
  engine.setSceneState({ id: 'forest-takeover', elapsedMs: 30000, paused: true });
  await engine.enable(); await flush(); engine._tick();
  const forest = engine.layers.get('forest'), rain = engine.layers.get('rain');
  const before = { gain: forest.gain.gain.value, cutoff: forest.filter.frequency.value, weights: engine._variationWeights('forest') };
  const background = engine._mainDroneGain();
  // The projection receives the new authoritative condition before its scene.
  engine.setProgression({ sourceCount: 100, outCount: 100, heat: 0, moisture: 1, surfaceWetness: 1 });
  engine.setSceneState({ id: 'final-rain', elapsedMs: 0, paused: true, rainIntensity: 0 }); engine._tick();
  assert.equal(forest.gain.gain.value, before.gain); assert.equal(forest.filter.frequency.value, before.cutoff);
  assert.deepEqual(engine._variationWeights('forest'), before.weights); assert.equal(engine._effectiveMacros().forest, 1);
  assert.equal(engine._effectiveMacros().moisture, 0); assert.equal(rain.gain.gain.value, 0); assert.equal(engine._mainDroneGain(), background);
  assert.equal(engine._cricketGain(), 0, 'Main crickets also enter along the rain ramp.');
  let previousForest = before.gain, previousRain = 0;
  for (const elapsedMs of [1, 1000, 10000, 20000, 30000, 45000, 59999, 60000]) {
    const score = computeSceneScore({ id: 'final-rain', elapsedMs });
    engine.setSceneState({ id: 'final-rain', elapsedMs, paused: true, rainIntensity: score.finalRainProgress }); engine._tick();
    assert.ok(forest.gain.gain.value <= previousForest); assert.ok(rain.gain.gain.value >= previousRain);
    assert.equal(rain.gain.gain.value, .125 * score.mix.mainRain, 'Rain receives its composed scene weight exactly once.');
    previousForest = forest.gain.gain.value; previousRain = rain.gain.gain.value;
    if (elapsedMs === 30000) {
      assert.ok(forest.gain.gain.value > 0 && rain.gain.gain.value > 0);
      assert.equal(engine._mainDroneGain(), 0);
    }
  }
  assert.equal(forest.gain.gain.value, 0); assert.equal(rain.gain.gain.value, .125);
  assert.deepEqual(engine._variationWeights('rain'), [0, 1]); assert.equal(engine._cricketGain(), 0);
  engine.setProgression({ sourceCount: 100, outCount: 0, heat: 1, moisture: 0, surfaceWetness: 0 });
  assert.equal(engine._cricketGain(), 0, 'A late map packet cannot reveal insects before the PA-only cue.');
  engine.setSceneState({ id: 'forest-takeover', elapsedMs: 30000 });
  assert.equal(engine._cricketGain(), 0, 'Outside the finale, restored fire removes insects through actual out counts.');
});

test('warm ground return cancels finite residue with continuous bounded tails and admits its cooling note again', async t => {
  for (const oldSafari of [false, true]) {
    const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
    const original = context.createGain.bind(context);
    await prepareResidueLibrary(engine, context);
    engine.setPatchVoices([sourceVoice('return', { holding: true, heat: .02, moisture: 1 })]);
    await engine.enable(); await flush(); context.advance(3); engine._tick();
    for (const layer of engine.layers.values()) { layer.nextAt = Infinity; for (const slot of layer.variationSlots.values()) slot.nextAt = Infinity; }
    const firstGain = engine.patchSoftTones.voices.get('return').gain, level = firstGain.gain.value;
    firstGain.gain = new StrictCurveParam(context); firstGain.gain.value = level; if (oldSafari) firstGain.gain.cancelAndHoldAtTime = undefined;
    context.createGain = () => { const node = original(); node.gain = new StrictCurveParam(context); if (oldSafari) node.gain.cancelAndHoldAtTime = undefined; return node; };
    engine.setPatchVoices([sourceVoice('return', { extinguished: true, heat: 0 })]);
    const voice = engine.patchSoftTones.morphVoices.get('return');
    context.advance(1); engine._tick(); context.advance(.3);
    const textures = [...engine.patchSoftTones.textureSources].filter(source => source.at <= context.currentTime && source.endAt > context.currentTime);
    assert.ok(textures.length > 0);
    assert.doesNotThrow(() => engine.setPatchVoices([sourceVoice('return', { holding: true, heat: .5, moisture: .5 })]));
    const soft = engine.patchSoftTones;
    assert.equal(soft.residues.size, 0); assert.equal(soft.morphVoices.size, 0); assert.equal(soft.voices.size, 1);
    assert.equal(soft.tails.has(voice), true); assert.ok(voice.release.from > 0); assert.equal(voice.release.seconds, .3);
    assert.equal(voice.disposed, undefined);
    for (const source of textures) {
      assert.equal(source.source.disconnected, false); assert.ok(source.release.from > 0);
      const events = source.gain.gain.events.slice(-3);
      assert.equal(events[1][0], 'set'); assert.equal(events[1][1], source.release.from);
      assert.deepEqual(events[2], ['linear', 0, source.endAt - .01]);
    }
    context.advance(.32); engine._tick();
    assert.equal(soft.textureSources.size, 0); assert.equal(soft.tails.size, 0); assert.equal(soft.voices.size, 1);
    engine.setPatchVoices([sourceVoice('return', { holding: true, heat: .02, moisture: 1 })]);
    assert.ok(soft.voices.get('return').targetGain > .95 * PATCH_SOFT_TONE_LEVEL); assert.equal(soft.residues.size, 0);
  }
});

test('residue makeup matches mono filtered class energy while preserving linear grain, headroom and independent mixing', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  await prepareResidueLibrary(engine, context);
  await engine.enable(); await flush();
  const expected = { haze: .1, ash: .11, moisture: .085 };
  for (const [id, targetRms] of Object.entries(expected)) {
    const buffer = context.createBuffer(2, 16000, 8000), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    const level = id === 'ash' ? .015 : id === 'haze' ? .025 : .08;
    for (let i = 0; i < buffer.length; i++) { left[i] = level * Math.sin(i * .173); right[i] = level * Math.sin(i * .173 + .9); }
    const reference = context.createBuffer(1, buffer.length, buffer.sampleRate);
    for (let i = 0; i < buffer.length; i++) reference.getChannelData(0)[i] = (left[i] + right[i]) / 2;
    const conditionedReference = circularLoopBuffer(context, reference);
    const output = engine.patchSoftTones._loopBuffer(buffer, id, `/${id}.mp3`);
    assert.equal(output.numberOfChannels, 1);
    const shape = patchTextureRecordingParameters(output, id), metric = engine.getMetrics().softTones.recordings.find(recording => recording.id === id);
    assert.ok(Math.abs(shape.filteredRms - targetRms) < .000001, `${id} reaches its audible target after downmix and filtering.`);
    assert.ok(metric.makeupGain <= 16); assert.ok(metric.outputFilteredPeak <= 4); assert.ok(metric.makeupGain > 1);
    const input = conditionedReference.getChannelData(0)[100];
    assert.ok(Math.abs(output.getChannelData(0)[100] / input - metric.makeupGain) < .00001, 'Only a fixed linear gain changes the grain.');
  }
  const quiet = context.createBuffer(1, 8000, 8000); quiet.getChannelData(0).fill(.00000001);
  assert.equal(patchTextureRecordingParameters(quiet, 'ash').makeupGain, 1, 'Near-silence never receives extreme makeup.');
  engine.setMixer({ haze: 0, ash: 0, moisture: 0, outDrone: 1.5 });
  engine.setPatchVoices([sourceVoice('balanced')]); engine.setPatchVoices([sourceVoice('balanced', { extinguished: true })]);
  assert.ok(engine.patchSoftTones.textureSources.size > 0);
  assert.ok([...engine.patchSoftTones.textureSources].every(source => source.mixer.gain.value === 1.5 && source.space.input.connections.length > 0));
});

test('Main forwards confirmed global extinction to new tone and bell register choices', async t => {
  const {engine,context}=harness(t,{mode:'operator',fetchImpl:successfulFetch});
  engine.setSceneState({id:'participation',elapsedMs:12000});
  engine.setProgression({sourceCount:100,outCount:0,heat:.2});
  engine.setPatchVoices([sourceVoice('register-main',{holding:true,heat:.01,moisture:1})]);
  await engine.enable(); await flush();
  assert.equal(engine.patchSoftTones.extinctionProgress,0); assert.equal(engine.localBells.extinctionProgress,0);
  const voice=engine.patchSoftTones.voices.get('register-main'); assert.ok(voice);
  assert.equal(voice.frequency,overtonePitchForKey('register-main',0).frequency);
  engine.localBells.random=()=>.5; engine.localBells.ring({key:'early'});
  const early=[...engine.localBells.bells].at(-1);
  context.advance(.2); engine.setProgression({sourceCount:100,outCount:90,heat:.2});
  engine.setPatchVoices([sourceVoice('register-main',{holding:true,heat:.01,moisture:1})]);
  assert.equal(engine.patchSoftTones.extinctionProgress,.9); assert.equal(engine.localBells.extinctionProgress,.9);
  assert.equal(engine.patchSoftTones.voices.get('register-main'),voice);
  assert.equal(voice.frequency,overtonePitchForKey('register-main',0).frequency);
  engine.localBells.ring({key:'late'}); assert.ok([...engine.localBells.bells].at(-1).harmonic<early.harmonic);
});

test('after-extinction pitch choices snapshot real macro heat and never retune an already playing texture', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  await prepareResidueLibrary(engine, context);
  engine.setProgression({ sourceCount: 100, outCount: 0, heat: 1, moisture: 0, surfaceWetness: 0 });
  engine.setPatchVoices([sourceVoice('warm-material')]);
  await engine.enable(); await flush();
  engine.patchSoftTones.random = () => .05;
  const warmOut = sourceVoice('warm-material', { heat: 0, extinguished: true });
  engine.setPatchVoices([warmOut]);
  const warm = engine.patchSoftTones.residues.get('warm-material');
  assert.equal(warm.treatment.pitchHeat, 1); assert.equal(warm.treatment.transposeSemitones, -3);
  const playing = [...engine.patchSoftTones.textureSources][0], warmRate = playing.source.playbackRate.value;
  engine.setProgression({ sourceCount: 100, outCount: 20, heat: .5, moisture: .5, surfaceWetness: .5 });
  engine.setPatchVoices([warmOut]); // A venue packet updates macro condition, then its authoritative cells.
  assert.equal(engine.patchSoftTones.globalHeat, .5);
  assert.ok(engine.getMetrics().softTones.transposeProbability < warm.treatment.transposeProbability);
  assert.equal(warm.treatment.pitchHeat, 1); assert.equal(playing.source.playbackRate.value, warmRate);
  engine.setPatchVoices([warmOut, sourceVoice('cold-material')]);
  engine.setProgression({ sourceCount: 100, outCount: 100, heat: 0, moisture: 1, surfaceWetness: 1 });
  context.advance(.11);
  engine.setPatchVoices([warmOut, sourceVoice('cold-material', { heat: 0, extinguished: true })]);
  const cold = engine.patchSoftTones.residues.get('cold-material');
  assert.equal(cold.treatment.pitchHeat, 0); assert.equal(cold.treatment.transposeProbability, 0); assert.equal(cold.treatment.transposeSemitones, 0);
  assert.equal(playing.source.playbackRate.value, warmRate, 'Existing tails retain their admitted pitch through macro cooling.');
});

test('texture variation assignment waits for its configured recording and never depends on decode arrival order', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch }); await prepareResidueLibrary(engine, context);
  const key = 'stable-recording', id = patchResidueId(key); engine.setPatchVoices([sourceVoice(key)]); await engine.enable(); await flush();
  const candidates = engine._patchTextureCandidates(id).sort((a,b) => a.url.localeCompare(b.url));
  const selected = candidates[patchHash(`${key}:recording`) % candidates.length], slot = engine.layers.get(id).variationSlots.get(selected.url), saved = slot.buffer;
  slot.buffer = null;
  engine.setPatchVoices([sourceVoice(key, { extinguished: true })]);
  assert.equal(engine.patchSoftTones.residues.get(key).selected, null); assert.equal(engine.patchSoftTones.textureSources.size, 0);
  slot.buffer = saved; engine._tick();
  assert.equal(engine.patchSoftTones.residues.get(key).selected.url, selected.url);
  assert.ok(engine.patchSoftTones.textureSources.size > 0);
});

test('phone holds play quiet rain through the phone master and never create extinction bells', async t => {
  const { engine, context, requests } = harness(t, { mode: 'phone', fetchImpl: successfulFetch });
  context.decodeAudioData = async () => { const buffer = context.createBuffer(1,16000,8000); for (let i=0;i<buffer.length;i++) buffer.getChannelData(0)[i] = .1*Math.sin(i*.173); return buffer; };
  assert.equal(await engine.setPhoneRainSource('/phone-rain-custom.mp3'), true); assert.deepEqual(requests, []);
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); await engine.enable(); await flush();
  assert.equal(engine.phoneWeather, null); assert.equal(engine.localBells, null); assert.equal(engine.getMetrics().mainBells, null);
  assert.equal(engine.phoneRain.getMetrics().rainLoopCount, 0);
  engine.setPhoneInteraction({ holding: true, patchKey: 'local', extinguished: false, eligible: true }); await flush();
  const rain = engine.phoneRain.voice; assert.ok(rain); assert.deepEqual(rain.gain.connections, [engine.phoneMixerNodes.get('rain')]);
  context.advance(.2); assert.ok(engine.getMetrics().phoneRain.rainGain > 0);
  engine.setPhoneInteraction({ holding: true, patchKey: 'out', extinguished: true, eligible: true });
  assert.equal(engine.phoneRain.voice, rain, 'Moving onto out ground keeps the same quiet rain passage.');
  assert.equal(context.nodes.filter(node => node.nodeType === 'oscillator').length, 0, 'Phones never synthesize C/G bells.');
  assert.equal(requests.filter(url => url === '/phone-rain-custom.mp3').length, 1);
  engine.setPhoneInteraction(null); context.advance(.41); assert.equal(engine.phoneRain.getMetrics().rainLoopCount, 1);
  context.advance(2.1); assert.equal(engine.phoneRain.getMetrics().rainLoopCount, 0, 'Finger release keeps the full 2.5 second rain tail.');
  engine.setPhoneInteraction({ holding: true, eligible: true }); assert.ok(engine.phoneRain.voice);
  engine.setSceneState({ id: 'participation', elapsedMs: 12000, paused: true }); assert.equal(engine.phoneRain.active, false);
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); assert.equal(engine.phoneRain.voice, null, 'Resume cannot replay an already-held finger.');
  engine.setPhoneInteraction(null); engine.setPhoneInteraction({ holding: true, eligible: true }); assert.ok(engine.phoneRain.voice);
  engine.setHidden(true); assert.equal(engine.phoneRain.active, false); assert.equal(engine.phoneRain.voice, null);
  engine.setHidden(false); await flush(); engine.reset('phone-new-round'); assert.equal(engine.phoneRain.interaction.holding, false);
  engine.setSceneState({ id: 'ended', elapsedMs: 0 }); assert.equal(engine.phoneRain.active, false); assert.equal(roleGain(engine), 0);
});

test('Main canonical extinction rings spatial global bells without a local audition and preserves the complete output route', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  engine.setPatchVoices([sourceVoice('already-out', { extinguished: true }), sourceVoice('remote')]);
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); await engine.enable();
  const bells = engine.localBells; assert.ok(bells); assert.equal(engine.getMetrics().mainBells.bellsTriggered, 0);
  assert.equal(engine.phoneWeather, null); assert.equal(engine.phoneRain, null);
  engine.setPhoneInteraction({ holding: true, patchKey: 'remote', extinguished: true });
  engine.setLocalInteraction({ holding: true, patchKey: 'missing', extinguished: true });
  assert.equal(bells.bellsTriggered, 0, 'Only canonical Main ground can create a bell.');
  const out = sourceVoice('remote', { extinguished: true });
  engine.setPatchVoices([sourceVoice('already-out', { extinguished: true }), out]);
  const voice = [...bells.bells][0], room = bells.reverb;
  assert.equal(bells.bellsTriggered, 1); assert.ok(voice.oscillators.length > 0);
  assert.equal(voice.key, 'remote'); assert.equal(voice.space.panner.pan.value, participantPosition(out.position).pan);
  assert.deepEqual(voice.envelope.connections, [voice.space.input, room.send]);
  assert.deepEqual(voice.space.distance.connections, [engine.mainBellBus]); assert.deepEqual(room.output.connections, [engine.mainBellBus]);
  assert.deepEqual(engine.mainBellBus.connections, [engine.fieldBus]); assert.deepEqual(engine.fieldBus.connections, [engine.mix]);
  assert.deepEqual(engine.mix.connections, [engine.highpass]); assert.deepEqual(engine.highpass.connections, [engine.master]);
  assert.ok(voice.envelope.gain.events.some(event => event[0] === 'linear' && event[1] === voice.peak));
  for (let packet = 0; packet < 12; packet++) engine.setPatchVoices([sourceVoice('already-out', { extinguished: true }), out]);
  assert.equal(bells.bellsTriggered, 1, 'Repeated canonical out snapshots never replay extinction.');
  engine.setLocalBellAudition(false); context.advance(.1); engine.setLocalInteraction(null);
  engine.setLocalInteraction({ holding: true, patchKey: 'remote', extinguished: true, eligible: true });
  assert.equal(bells.bellsTriggered, 2, 'A fresh local out-ground press joins the same global bell system.');
  assert.equal(engine.lastBellEvent.origin, 'main'); assert.equal(engine.lastBellEvent.patchKey, 'remote');
  assert.equal(engine.mainQuench.getMetrics().triggered, 0, 'The bell remains available while quench recordings are unavailable.');
  context.advance(.1); assert.equal(engine.triggerPatchQuench({ key: 'remote', eventId: 'remote-retap' }), true);
  assert.equal(engine.triggerPatchQuench({ key: 'remote', eventId: 'remote-retap' }), false);
  assert.equal(bells.bellsTriggered, 3, 'An accepted remote retap rings once even without a decoded quench asset.');
  assert.equal(bells.getMetrics().rainLoopCount, 0);
});

test('a local held edge before sound enable is a silent baseline and phones cannot allocate an audition controller', async t => {
  const { engine } = harness(t, { mode: 'operator' }), phone = harness(t);
  const out = { holding: true, patchKey: 'already-out', extinguished: true, eligible: true };
  engine.setPatchVoices([sourceVoice('already-out', { extinguished: true })]);
  engine.setLocalInteraction(out); await engine.enable();
  assert.equal(engine.getMetrics().localBells.bellsTriggered, 0);
  engine.setLocalInteraction(out); assert.equal(engine.getMetrics().localBells.bellsTriggered, 0);
  engine.setLocalInteraction(null); engine.setLocalInteraction(out); assert.equal(engine.getMetrics().localBells.bellsTriggered, 1);
  assert.equal(phone.engine.setLocalInteraction(out), false); await phone.engine.enable(); assert.equal(phone.engine.getMetrics().localBells, null);
});

test('a quick local tap preserves the full dry bell and room decay after pointer release', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); await engine.enable();
  engine.setPatchVoices([sourceVoice('quick-tap', { extinguished: true })]);
  const out = { holding: true, patchKey: 'quick-tap', extinguished: true, eligible: true };
  const released = { holding: false, patchKey: null, extinguished: false, eligible: false };
  engine.setLocalInteraction(out);
  const bells = engine.localBells, voice = [...bells.bells][0], room = bells.reverb;
  context.advance(.02); engine.setLocalInteraction(released);
  assert.equal(bells.active, true, 'Releasing the audition gesture does not close the parent audio gate.');
  assert.equal(bells.bells.has(voice), true); assert.equal(bells.retiringBells.size, 0);
  assert.equal(voice.oscillators[0].stoppedAt, voice.at + voice.stopSeconds); assert.ok(room.tailUntil > voice.at + voice.stopSeconds + 1.3);
  context.advance(voice.decaySeconds * .4); engine._tick();
  assert.equal(bells.bells.has(voice), true); assert.equal(voice.envelope.disconnected, false);
  assert.equal(bells.reverb, room); assert.ok(bells.getMetrics().bellReverb.tailRemainingSeconds > 1.4);
  context.advance(voice.stopSeconds * .61); engine._tick();
  assert.equal(bells.bells.size, 0); assert.equal(bells.reverb, room, 'The room finishes after the dry voice.');
  context.advance(bells.getMetrics().bellReverb.durationSeconds); engine._tick(); assert.equal(bells.getMetrics().bellReverb.graphCount, 0);
  engine.setLocalInteraction(out); engine.setLocalInteraction(released); engine.setMuted(true); context.advance(MAIN_DISABLE_FADE_SECONDS + .03); context.advance(.08);
  assert.equal(bells.active, false); assert.equal(bells.bells.size + bells.retiringBells.size, 0);
  assert.equal(bells.getMetrics().bellReverb.graphCount, 0, 'Mute still flushes the complete tail.');
  engine.setMuted(false); await flush(); engine.setLocalInteraction(out); engine.setLocalInteraction(released);
  engine.setSceneState({ id: 'ended', elapsedMs: 0 }); context.advance(.1);
  assert.equal(bells.active, false); assert.equal(bells.bells.size + bells.retiringBells.size, 0);
  assert.equal(bells.getMetrics().bellReverb.graphCount, 0, 'The ending still flushes the complete tail.');
});

test('final rain enters the native field fade at its composed level while the PA master stays open for crickets', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  const settings = { projectionFadeSeconds: 30, phoneOnlySeconds: 15, phoneFadeSeconds: 60 };
  engine.setSceneState({ id: 'final-rain', elapsedMs: 120000, rainIntensity: 1, settings }); await engine.enable();
  const rain = engine.layers.get('rain'), endpoint = rain.gain.gain.value;
  assert.equal(endpoint, .125);
  for (const seconds of [0, 1, 5, 15, 29.9, 30]) {
    engine.setSceneState({ id: 'afterglow', elapsedMs: seconds * 1000, rainIntensity: Math.max(0, 1 - seconds / 30), paused: true, settings });
    const score = engine._sceneScore();
    assert.equal(rain.gain.gain.value, endpoint * score.mix.mainRain, 'The composed rain level is attenuated by the field bus once.');
    assert.equal(roleGain(engine), engine.level * score.mainGain);
    assert.equal(engine.fieldBus.gain.value, score.mainFieldGain);
    assert.equal(roleGain(engine), engine.level, 'Blackout cannot close the PA master before its cricket cue.');
    assert.equal(engine._effectiveMacros().rain, Math.max(0, 1 - seconds / 30));
  }
  assert.equal(engine.fieldBus.gain.value, 0); assert.equal(roleGain(engine), engine.level);
  engine.setSceneState({ id: 'afterglow', elapsedMs: 54000, paused: true, settings });
  assert.equal(roleGain(engine), 0); context.advance(1); engine._tick(); assert.equal(engine.getMetrics().outputGains.main, 0);
});

test('editable residue timing, source removal, reseeding and ending cancel all finite outputs', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch }); await prepareResidueLibrary(engine, context);
  engine.setSceneState({ id: 'participation', elapsedMs: 12000, paused: true, settings: { residueMorphSeconds: 2, residueFadeSeconds: 3 } });
  engine.setPatchVoices([sourceVoice('old', { holding: true, heat: .01, moisture: 1 })]); await engine.enable(); await flush();
  engine.setPatchVoices([sourceVoice('old', { extinguished: true, heat: 0 })]);
  assert.equal(engine.getMetrics().softTones.residues[0].endAt, 5);
  const sources = [...engine.patchSoftTones.textureSources]; engine.setPatchVoices([]);
  assert.equal(engine.patchSoftTones.residues.size, 0); assert.ok(sources.every(source => source.source.disconnected));
  engine.setPatchVoices([sourceVoice('new')]); engine.setPatchVoices([sourceVoice('new', { extinguished: true })]);
  assert.ok(engine.patchSoftTones.residues.size); engine.reset('replacement-round');
  assert.equal(engine.patchSoftTones.residues.size, 0); assert.equal(engine.patchSoftTones.textureSources.size, 0);
  engine.setPatchVoices([sourceVoice('new', { extinguished: true })]); assert.equal(engine.patchSoftTones.residues.size, 0);
  engine.setPatchVoices([sourceVoice('end', { holding: true })]); engine.setPatchVoices([sourceVoice('end', { extinguished: true })]);
  engine.setSceneState({ id: 'ended', elapsedMs: 0 });
  assert.equal(roleGain(engine), 0); assert.equal(engine.patchSoftTones.residues.size, 0); assert.equal(engine.patchSoftTones.textureSources.size, 0);
  engine.disable(); assert.equal(engine.patchSoftTones.voices.size, 0);
});

test('struck grain amplitude remains audible after 80ms and follows a gradual two-stage piano decay', () => {
  for (const variation of [0, .5, 1]) {
    const shape = { ...participantGrainParameters(false, variation), background: false }, amplitude = age => participantGrainEnvelopeAt(age, shape);
    assert.ok(shape.duration >= .4 && shape.duration <= .9); assert.equal(amplitude(0), 0); assert.equal(amplitude(shape.attack), 1);
    assert.ok(amplitude(.08) > .5, 'The struck note has not collapsed to -60dB in 80ms.');
    const knee = shape.attack + (shape.duration - .008 - shape.attack) * .32;
    assert.ok(Math.abs(amplitude(knee) - .38) < 1e-12); assert.ok(amplitude(shape.duration * .5) > .12 && amplitude(shape.duration * .5) < .16);
    assert.ok(amplitude(shape.duration * .8) > .02 && amplitude(shape.duration * .8) < .04);
    assert.ok(Math.abs(amplitude(shape.duration - .008) - .008) < 1e-12); assert.equal(amplitude(shape.duration), 0);
    let previous = 1; for (let age = shape.attack; age < shape.duration; age += .001) { const current = amplitude(age); assert.ok(current <= previous + 1e-12); previous = current; }
  }
});

test('grain interruption evaluates the scheduled envelope and old Safari cancels its curve before replacing it', async t => {
  for (const background of [false, true]) {
    const { engine, context } = harness(t, { mode: 'operator' }); engine._random = () => .5;
    engine.setParticipants([participant('fade', 1, { holding: !background, extinguished: background, heat: background ? 0 : .8 })]);
    await engine.enable(); const grain = [...engine.toneGrains].sort((a, b) => a.at - b.at)[0];
    const strict = new StrictCurveParam(context); strict.cancelAndHoldAtTime = undefined;
    for (const event of grain.envelope.gain.events) if (event[0] === 'set') strict.setValueAtTime(event[1], event[2]); else if (event[0] === 'curve') strict.setValueCurveAtTime(event[1], event[2], event[3]);
    grain.envelope.gain = strict; context.advance(.08);
    const expected = grain.peak * participantGrainEnvelopeAt(context.currentTime - grain.at, grain);
    assert.doesNotThrow(() => engine._fadeToneGrain(grain, .1));
    const events = strict.events.slice(-3); assert.deepEqual(events[0], ['cancel', grain.at]); assert.deepEqual(events[1], ['set', expected, context.currentTime]);
    assert.deepEqual(events[2], ['linear', 0, context.currentTime + .1]);
    context.advance(.12); assert.ok(!engine.toneGrains.has(grain));
  }
  const { engine, context } = harness(t, { mode: 'operator' }); engine.setParticipants([participant('retire')]); await engine.enable();
  const voice = engine.voices.get('retire'); context.advance(.1); engine.setParticipants([]);
  assert.equal(voice.grainReleaseFrom, 1, 'The already-open grain path does not jump down to the slower oscillator attack during retirement.');
  assert.ok(voice.releaseFrom < .25); assert.equal(voice.grainEnvelope.gain.events.filter(event => event[0] === 'curve').at(-1)[1][0], 1);
});


async function readyMainQuench(engine) {
  await engine.setMainQuenchSources([{ id: 'wood', url: '/quench-wood.mp3' }]);
  await engine.enable(); await engine.mainQuench.setSources(engine.mainQuenchSources); await flush();
}

const areaGround = () => Array.from({ length: 5 }, (_, x) => Array.from({ length: 4 }, (_, y) => ({
  longitude: 109.625 + x * .25, latitude: -2.375 + y * .25,
  heat: .02, moisture: 1, surfaceWetness: 1, extinguished: false,
}))).flat();
const areaContact = (position = [110.125, -1.875], id = 'audience') => ({ id, position, holding: true });
const outGround = values => values.map(value => ({ ...value, heat: 0, extinguished: true }));
function areaSnapshot(engine, ground, contacts = []) {
  const field = createParticipantSoundField(ground);
  assert.equal(engine.setRainAreaContacts(field, contacts), true);
  engine.setPatchVoices(patchSoundVoices(contacts.map(contact => ({ ...contact, role: 'participant' })), field));
  return field;
}

test('one complete twenty-cell rain footprint couples one bell, quench and material after the final staggered extinction', async t => {
  let wallTime = 0;
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch, areaClock: () => wallTime });
  const ground = areaGround(), contacts = [areaContact(), areaContact([110.15, -1.875], '__local')];
  const initialField = areaSnapshot(engine, ground, contacts);
  assert.equal(initialField.patchesAt(contacts[0].position).length, 20);
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 });
  await prepareResidueLibrary(engine, context); await readyMainQuench(engine);
  const soft = engine.patchSoftTones, bells = engine.localBells;
  assert.equal(soft.areaMode, true); assert.equal(soft.voices.size, 20);
  for (let count = 1; count < ground.length; count++) {
    context.advance(.025); wallTime = context.currentTime;
    areaSnapshot(engine, ground.map((value, index) => index < count ? outGround([value])[0] : value), contacts);
    assert.equal(bells.bellsTriggered, 0); assert.equal(engine.mainQuench.getMetrics().triggered, 0);
    assert.equal(soft.residues.size, 0, 'An individual source-cell out flag cannot start material before its rain area is complete.');
  }
  const field = areaSnapshot(engine, outGround(ground), contacts), representative = field.patches[0];
  assert.equal(engine.getMetrics().rainAreas.triggered, 1);
  assert.equal(bells.bellsTriggered, 1); assert.equal(engine.mainQuench.getMetrics().triggered, 1);
  assert.equal(soft.residues.size, 1); assert.equal(soft.morphVoices.size, 20);
  const residue = [...soft.residues.values()][0], bell = [...bells.bells][0], quench = [...engine.mainQuench.quenches][0];
  assert.deepEqual(residue.memberKeys, field.patches.map(value => value.key).sort());
  assert.equal(residue.key, representative.key); assert.equal(bell.key, representative.key); assert.equal(quench.key, representative.key);
  const completionPosition = countryPoint([110.1375, -1.875]);
  assert.deepEqual(residue.patch.position, representative.position);
  assert.deepEqual(quench.position, completionPosition);
  assert.equal(bell.space.panner.pan.value, participantPosition(completionPosition).pan);
  assert.deepEqual(engine.lastBellEvent.position, completionPosition, 'Bell spatial sound and relayed visual use the same completed brush centre.');
  assert.ok([...soft.morphVoices.values()].every(voice => voice.residue === residue), 'All already sounding notes join one shared material transition.');
  for (let repeat = 0; repeat < 20; repeat++) {
    context.advance(.025); wallTime = context.currentTime;
    areaSnapshot(engine, outGround(ground), repeat % 2 ? contacts : []);
    engine.setLocalInteraction(null); engine.setLocalInteraction({ holding: true, patchKey: representative.key, extinguished: true, eligible: true });
    assert.equal(engine.triggerPatchQuench({ key: representative.key, eventId: `out-retap-${repeat}` }), false);
  }
  assert.equal(bells.bellsTriggered, 1); assert.equal(engine.mainQuench.getMetrics().triggered, 1); assert.equal(soft.residues.size, 1);
  const reheated = outGround(ground); reheated[0] = { ...ground[0] };
  areaSnapshot(engine, reheated, contacts); context.advance(.11); wallTime = context.currentTime;
  areaSnapshot(engine, outGround(ground), contacts);
  assert.equal(engine.getMetrics().rainAreas.triggered, 2); assert.equal(bells.bellsTriggered, 2);
  assert.equal(engine.mainQuench.getMetrics().triggered, 2, 'A real hot return re-arms the area for one new cycle.');
});

test('a released rain footprint can complete on the next authoritative packet without replaying out taps', async t => {
  let wallTime = 0;
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch, areaClock: () => wallTime });
  const ground = areaGround(), contacts = [areaContact()];
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); areaSnapshot(engine, ground, contacts);
  await readyMainQuench(engine); areaSnapshot(engine, ground, []);
  context.advance(.1); wallTime = .1; areaSnapshot(engine, outGround(ground), []);
  assert.equal(engine.localBells.bellsTriggered, 1); assert.equal(engine.mainQuench.getMetrics().triggered, 1);
  assert.equal(engine.patchSoftTones.residues.size, 1);
  for (let packet = 0; packet < 10; packet++) {
    context.advance(.1); wallTime += .1; areaSnapshot(engine, outGround(ground), contacts);
  }
  assert.equal(engine.localBells.bellsTriggered, 1); assert.equal(engine.getMetrics().rainAreas.triggered, 1);
});

test('inaudible and later-scene area completions are consumed before resumed packets and reset out baselines', async t => {
  for (const state of ['muted', 'hidden', 'paused', 'final-rain']) {
    let wallTime = 0;
    const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch, areaClock: () => wallTime });
    const ground = areaGround(), contacts = [areaContact()];
    engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); areaSnapshot(engine, ground, contacts); await readyMainQuench(engine);
    if (state === 'muted') engine.setMuted(true);
    else if (state === 'hidden') engine.setHidden(true);
    else if (state === 'paused') engine.setSceneState({ id: 'participation', elapsedMs: 12000, paused: true });
    else engine.setSceneState({ id: state, elapsedMs: 0 });
    context.advance(.1); wallTime = .1; areaSnapshot(engine, outGround(ground), contacts);
    if (state === 'muted') engine.setMuted(false);
    else if (state === 'hidden') engine.setHidden(false);
    else engine.setSceneState({ id: 'participation', elapsedMs: 12000 });
    await flush(); context.advance(.1); wallTime = .2; areaSnapshot(engine, outGround(ground), contacts); engine._tick();
    assert.equal(engine.localBells.bellsTriggered, 0); assert.equal(engine.mainQuench.getMetrics().triggered, 0);
    assert.equal(engine.patchSoftTones.residues.size, 0); assert.equal(engine.getMetrics().rainAreas.pending, 0);
    engine.reset(`area-reset-${state}`); areaSnapshot(engine, outGround(ground), contacts); engine._tick();
    assert.equal(engine.localBells.bellsTriggered, 0); assert.equal(engine.patchSoftTones.residues.size, 0, 'An out baseline after reset has no new hot-to-out area cycle.');
  }
});

test('an area completed before first sound enable is an out baseline without a deferred event', async t => {
  let wallTime = 0;
  const { engine } = harness(t, { mode: 'operator', fetchImpl: successfulFetch, areaClock: () => wallTime });
  const ground = areaGround(), contacts = [areaContact()];
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); areaSnapshot(engine, ground, contacts);
  wallTime = .1; areaSnapshot(engine, outGround(ground), contacts);
  await readyMainQuench(engine); areaSnapshot(engine, outGround(ground), contacts); engine._tick();
  assert.equal(engine.localBells.bellsTriggered, 0); assert.equal(engine.mainQuench.getMetrics().triggered, 0);
  assert.equal(engine.patchSoftTones.residues.size, 0); assert.equal(engine.getMetrics().rainAreas.pending, 0);
});

test('independent completed rain areas are gently staggered and expired groups never replay late', async t => {
  for (const late of [false, true]) {
    let wallTime = 0;
    const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch, areaClock: () => wallTime });
    const ground = [110.125, 115.125, 120.125].map(longitude => ({ longitude, latitude: -1.875, heat: .02, moisture: 1, surfaceWetness: 1, extinguished: false }));
    const contacts = ground.map((patch, index) => areaContact([patch.longitude, patch.latitude], `audience-${index}`));
    engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); areaSnapshot(engine, ground, contacts); await readyMainQuench(engine);
    areaSnapshot(engine, outGround(ground), contacts);
    assert.equal(engine.getMetrics().rainAreas.triggered, 1); assert.equal(engine.getMetrics().rainAreas.pending, 2);
    if (late) {
      context.advance(2.1); wallTime = 2.1; engine._tick();
      assert.equal(engine.getMetrics().rainAreas.triggered, 1); assert.equal(engine.getMetrics().rainAreas.pending, 0);
    } else {
      for (let step = 1; step <= 2; step++) { context.advance(.1); wallTime = context.currentTime; engine._tick(); }
      assert.equal(engine.getMetrics().rainAreas.triggered, 3); assert.equal(engine.getMetrics().rainAreas.pending, 0);
      assert.equal(engine.localBells.bellsTriggered, 3); assert.equal(engine.mainQuench.getMetrics().triggered, 3);
      assert.equal(engine.patchSoftTones.residues.size, 3);
      const starts = [...engine.localBells.bells].map(voice => voice.at);
      assert.deepEqual(starts, [0, .1, .2], 'Independent groups share one audio-clock stagger for bell, quench and material.');
    }
  }
});

test('Main canonical extinction, accepted fresh retaps and local cooling make one quench per event at a fixed patch position', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  const hot = sourceVoice('source', { holding: true, position: [.1, .7] }), out = { ...hot, extinguished: true, heat: 0, holding: false, position: [.9, .1] };
  engine.setPatchVoices([hot]); engine.setLocalBellAudition(true); await readyMainQuench(engine);
  engine.setLocalInteraction({ holding: true, patchKey: 'source', extinguished: false });
  engine.setPatchVoices([out]); engine.setLocalInteraction({ holding: true, patchKey: 'source', extinguished: true });
  assert.equal(engine.mainQuench.getMetrics().triggered, 1, 'Canonical edge and local bell cannot double-trigger extinction.');
  assert.deepEqual([...engine.mainQuench.quenches][0].position, [.1, .7]);
  for (let i = 0; i < 30; i++) engine.setPatchVoices([out]);
  engine.setLocalInteraction({ holding: true, patchKey: 'other-out', extinguished: true });
  assert.equal(engine.mainQuench.getMetrics().triggered, 1, 'Packets and dragging cannot create retaps.');
  context.advance(.1); assert.equal(engine.triggerPatchQuench({ key: 'source', eventId: 'accepted-press-1' }), true);
  assert.equal(engine.triggerPatchQuench({ key: 'source', eventId: 'accepted-press-1' }), false);
  engine.setLocalInteraction(null); engine.setLocalInteraction({ holding: true, patchKey: 'source', extinguished: true });
  assert.equal(engine.mainQuench.getMetrics().triggered, 3, 'Remote accepted press and fresh local tap each add one quench.');
  assert.equal(engine.localBells.getMetrics().bellsTriggered, 3);
});
test('Main consumes muted and paused events and cancels shots on ending and reset without baseline replay', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  const hot = sourceVoice('pause'), out = { ...hot, extinguished: true, heat: 0 };
  engine.setPatchVoices([hot]); engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); await readyMainQuench(engine);
  engine.setPatchVoices([out]); assert.equal(engine.mainQuench.getMetrics().triggered, 1);
  const bells = engine.localBells; assert.equal(bells.bellsTriggered, 1);
  engine.setSceneState({ id: 'participation', elapsedMs: 12000, paused: true }); context.advance(.05);
  assert.equal(engine.mainQuench.getMetrics().currentVoices, 0);
  assert.equal(bells.bells.size + bells.retiringBells.size, 0); assert.equal(bells.getMetrics().bellReverb.graphCount, 0);
  assert.equal(engine.triggerPatchQuench({ key: 'pause', eventId: 'paused-tap' }), false);
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 });
  assert.equal(engine.triggerPatchQuench({ key: 'pause', eventId: 'paused-tap' }), false);
  engine.setMuted(true); assert.equal(engine.triggerPatchQuench({ key: 'pause', eventId: 'muted-tap' }), false);
  engine.setPatchVoices([hot]); engine.setPatchVoices([out]); engine.setMuted(false); await flush();
  assert.equal(engine.mainQuench.getMetrics().triggered, 1);
  assert.equal(bells.bellsTriggered, 1, 'Unmuting cannot replay a canonical edge or a consumed retap.');
  engine.setHidden(true); assert.equal(engine.triggerPatchQuench({ key: 'pause', eventId: 'hidden-tap' }), false);
  engine.setHidden(false); await flush(); assert.equal(engine.triggerPatchQuench({ key: 'pause', eventId: 'hidden-tap' }), false);
  context.advance(.1); assert.equal(engine.triggerPatchQuench({ key: 'pause', eventId: 'fresh-tap' }), true);
  assert.equal(bells.bellsTriggered, 2);
  engine.setSceneState({ id: 'ended', elapsedMs: 0 }); context.advance(.05); assert.equal(engine.mainQuench.quenches.size + engine.mainQuench.retiringQuenches.size, 0);
  assert.equal(bells.bells.size + bells.retiringBells.size, 0); assert.equal(bells.getMetrics().bellReverb.graphCount, 0);
  engine.reset('quench-reset'); engine.setPatchVoices([out]); engine.setSceneState({ id: 'participation', elapsedMs: 12000 });
  assert.equal(engine.mainQuench.getMetrics().triggered, 2, 'Reset out snapshot cannot replay prior extinction.');
  assert.equal(bells.bellsTriggered, 2); assert.equal(engine.mainBellBus.gain.value, SOUND_MIXER_DEFAULTS.bells);
  const reload = harness(t, { mode: 'operator', fetchImpl: successfulFetch }); reload.engine.setPatchVoices([out]); await readyMainQuench(reload.engine);
  assert.equal(reload.engine.mainQuench.getMetrics().triggered, 0); assert.equal(reload.engine.getMetrics().mainBells.bellsTriggered, 0);
});
test('Main bursts retain fixed bell levels and quench overlap blending without audience-count attenuation', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  const hot = Array.from({ length: 500 }, (_, i) => sourceVoice(`extinction-${i}`, { holding: i < 32 }));
  engine.setPatchVoices(hot); engine.setAudienceParticipationCount(100); await readyMainQuench(engine);
  engine.setPatchVoices(hot.map(patch => ({ ...patch, extinguished: true, holding: false })));
  const main = engine.mainQuench; assert.equal(main.getMetrics().triggered, 8); assert.ok(main.quenches.size + main.retiringQuenches.size <= 9);
  const bells = engine.localBells; assert.equal(bells.bellsTriggered, 8);
  assert.ok(bells.bells.size <= 8); assert.ok(bells.retiringBells.size <= 8); assert.ok(bells.bells.size + bells.retiringBells.size <= 16);
  assert.deepEqual(bells.getMetrics().bellDecayRangeSeconds, [8, 12]); assert.equal(bells.getMetrics().bellReverb.graphCount, 1);
  assert.equal(engine.mainBellBus.gain.value, SOUND_MIXER_DEFAULTS.bells, 'Bell dry sound and room retain the full trim during overlap.');
  assert.equal(main.getMetrics().crowdGain, 1 / Math.sqrt(main.quenches.size + main.retiringQuenches.size));
  const bellGain = engine.mainBellBus.gain.value, quenchGain = main.outputTarget;
  engine.setMixer({ outDrone: .3 }); assert.equal(main.weight, 1); assert.equal(main.outputTarget, quenchGain);
  assert.equal(engine.mainBellBus.gain.value, bellGain, 'The after-extinction texture trim cannot change bells or quench.');
  engine.setMixer({ bells: 1.9, quench: .3 }); assert.ok(Math.abs(main.weight - .3) < 1e-12); assert.equal(main.outputTarget, .3 * main.crowdGain);
  assert.equal(engine.mainBellBus.gain.value, 1.9);
  context.advance(.1); engine.setAudienceParticipationCount(1000); assert.equal(main.outputTarget, .3 * main.crowdGain);
  assert.equal(engine.mainBellBus.gain.value, 1.9, 'A larger holding audience cannot bury the same eight bell voices.');
  const before = main.getMetrics().triggered; engine._tick(); assert.equal(main.getMetrics().triggered, before, 'Dropped burst events never become a delayed queue.');
  assert.equal(bells.bellsTriggered, 8, 'A large extinction packet cannot become a delayed bell barrage.');
});


test('Main room history is discarded at suspension, pause, ending and reset, and patch voices reopen the fresh return', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  const hot = sourceVoice('room', { holding: true, heat: .01, moisture: 1 }), out = { ...hot, holding: false, extinguished: true };
  engine.setPatchVoices([hot]); engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); await readyMainQuench(engine);
  engine.setPatchVoices([out]); context.advance(.1); const mutedRoom = engine.toneReverb, shot = [...engine.mainQuench.quenches][0];
  engine.setMuted(true); assert.equal(mutedRoom.disconnected, false, 'The room remains connected through the Main output fade.');
  context.advance(MAIN_DISABLE_FADE_SECONDS + .03);
  assert.equal(mutedRoom.disconnected, true); assert.equal(engine.mainQuench.output.gain.value, 0);
  engine.setMuted(false); await flush();
  assert.equal(shot.source.disconnected, true); assert.notEqual(engine.toneReverb, mutedRoom);
  assert.equal(engine.toneReverbReturn.gain.value, TONE_REVERB_RETURN, 'Resetting a room does not permanently remove the patch wet return.');
  const pausedRoom = engine.toneReverb; engine.setSceneState({ id: 'participation', elapsedMs: 12000, paused: true });
  assert.equal(pausedRoom.disconnected, true); assert.equal(engine.mainQuench.output.gain.value, 0);
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 });
  const endedRoom = engine.toneReverb; engine.setSceneState({ id: 'ended', elapsedMs: 0 }); assert.equal(endedRoom.disconnected, true);
  const resetRoom = engine.toneReverb; engine.reset('room-reset'); assert.equal(resetRoom.disconnected, true);
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); engine.setPatchVoices([hot]);
  assert.equal(engine.toneReverbReturn.gain.value, TONE_REVERB_RETURN); assert.equal(engine.mainQuench.getMetrics().triggered, 1);
  assert.equal(engine.retiredToneSpaces.size, 0);
});

test('Main bell trim remains audible through forest takeover instead of following the fading drone', async t => {
  const { engine } = harness(t, { mode: 'operator' }); await engine.enable();
  engine.setMixer({ bells: 1.6 });
  for (const [id, elapsedMs] of [['participation', 0], ['participation', 12000], ['forest-takeover', 0], ['forest-takeover', 15000], ['forest-takeover', 30000], ['final-rain', 0]]) {
    engine.setSceneState({ id, elapsedMs });
    assert.equal(engine.mainBellBus.gain.value, 1.6, `${id} at ${elapsedMs} retains the bell's independent trim.`);
  }
  engine.setSceneState({ id: 'forest-takeover', elapsedMs: 30000, paused: true }); assert.equal(engine.mainBellBus.gain.value, 0);
  engine.setSceneState({ id: 'ended', elapsedMs: 0 }); assert.equal(engine.mainBellBus.gain.value, 0);
});


test('Main enable and rapid mute reversals follow one rounded final output gate without interrupting the scene master', async t => {
  const { engine, context, events } = harness(t, { mode: 'operator' });
  engine.setSceneState({ id: 'arrival', paused: true, elapsedMs: 0 });
  const enabling = engine.enable(); assert.equal(events.includes('resume'), true, 'User activation resumes synchronously.');
  await enabling;
  assert.equal(engine.getMetrics().mainActivation.gain, 0);
  context.advance(MAIN_ENABLE_FADE_SECONDS / 2);
  assert.ok(Math.abs(engine.getMetrics().mainActivation.gain - .5) < 1e-12);
  const fieldSource = engine.ashSource;
  engine.setMuted(true); const cleanup = engine.mainStopClock;
  assert.ok(cleanup); assert.equal(fieldSource.disconnected, false);
  assert.equal(roleGain(engine), .55, 'The user fade leaves the composed scene envelope open.');
  context.advance(MAIN_DISABLE_FADE_SECONDS / 2);
  assert.equal(context.state, 'running'); assert.ok(engine.getMetrics().mainActivation.gain > 0);
  const before = engine.getMetrics().mainActivation.gain;
  await engine.enable();
  assert.equal(engine.mainStopClock, null); assert.equal(cleanup.onended, null);
  assert.equal(engine.getMetrics().mainActivation.gain, before, 'A rapid reversal starts at the actual current gain.');
  assert.equal(engine.ashSource, fieldSource, 'The continuing field is not stacked or restarted.');
  context.advance(1); engine._tick();
  assert.equal(engine.getMetrics().mainActivation.gain, 1); assert.equal(context.state, 'running');
  engine.disable();
  assert.equal(engine.enabled, false); assert.equal(engine.timer, null);
  context.advance(.3); assert.equal(context.state, 'running'); assert.equal(fieldSource.disconnected, false);
  context.advance(.38); assert.equal(engine.getMetrics().mainActivation.gain, 0); assert.equal(fieldSource.disconnected, true);
  assert.equal(context.state, 'running', 'Native one-shot cleanup finishes behind the silent gate.');
  context.advance(.08); await flush(); assert.equal(context.state, 'suspended'); assert.equal(engine.mainStopClock, null);
  assert.equal(engine.getMetrics().activeSources, 0);
  const resumed = engine.enable(); assert.equal(context.state, 'running'); await resumed;
  assert.equal(engine.getMetrics().mainActivation.gain, 0, 'A suspended context re-enters from silence.');
});

test('Main fade cleanup survives incoming held patches, preserves ending silence, and cannot suspend after destruction', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 });
  engine.setPatchVoices([sourceVoice('steady', { holding: true, heat: .1, moisture: .9 })]); await engine.enable();
  context.advance(1); engine._tick();
  const voice = engine.patchSoftTones.voices.get('steady');
  engine.setMuted(true); context.advance(.2);
  engine.setPatchVoices([sourceVoice('steady', { holding: true, heat: .05, moisture: 1 })]);
  assert.equal(engine.patchSoftTones.voices.get('steady'), voice); assert.notEqual(voice.disposed, true);
  engine.setSceneState({ id: 'ended', elapsedMs: 0 });
  assert.equal(roleGain(engine), 0); assert.equal(engine.fieldBus.gain.value, 0);
  const clock = engine.mainStopClock;
  engine.destroy(); assert.equal(clock.onended, null); assert.equal(context.state, 'closed');
  assert.equal(engine.mainStopClock, null); assert.equal(engine.getMetrics().activeSources, 0);
  context.advance(5); assert.equal(context.state, 'closed'); assert.equal(await engine.enable(), false);
});

test('Main extinction edges observed during a device interruption never become strikes on resume', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  const hot = sourceVoice('interrupted-source'), out = { ...hot, extinguished: true, heat: 0 };
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); engine.setPatchVoices([hot]); await readyMainQuench(engine);
  context.advance(1); context.state = 'interrupted'; context.onstatechange();
  engine.setPatchVoices([out]);
  assert.equal(engine.localBells.bellsTriggered, 0); assert.equal(engine.mainQuench.getMetrics().triggered, 0);
  await engine.enable(); engine._tick();
  assert.equal(engine.localBells.bellsTriggered, 0); assert.equal(engine.mainQuench.getMetrics().triggered, 0);
  assert.equal(engine.getMetrics().mainActivation.gain, 0);
});

test('phone mixer settings do not activate audio, and saved trims initialize before the first sound', async t => {
  const { engine, context, events, requests } = harness(t, { mode: 'phone' });
  assert.deepEqual(engine.getMetrics().phoneMixer, PHONE_MIXER_DEFAULTS);
  assert.equal(engine.setPhoneMixer({ overall: .6, crackle: 0, birds: 1.7, drone: .4 }), true);
  assert.equal(engine.context, null); assert.deepEqual(events, []); assert.deepEqual(requests, []);
  for (const invalid of [{ birds: -1 }, { rain: 2.1 }, { overall: NaN }, { birds: '1' }, { orangutan: 1 }, [], null]) {
    const before = { ...engine.phoneMixer }; assert.equal(engine.setPhoneMixer(invalid), false); assert.deepEqual(engine.phoneMixer, before);
  }
  await engine.enable();
  for (const [name, value] of Object.entries(engine.phoneMixer)) assert.equal(engine.phoneMixerNodes.get(name).gain.value, value);
  assert.equal(engine.phoneMixerRamps.size, 0, 'A late enabled phone starts directly at its saved trims behind the existing quiet activation.');
  assert.deepEqual(engine.highpass.connections, [engine.phoneMixerNodes.get('overall')]);
  assert.deepEqual(engine.phoneMixerNodes.get('overall').connections, [engine.master]);
  assert.deepEqual(engine.master.connections, [engine.outputMakeup], 'Every phone trim remains before the existing output protection.');
  const trims = [...engine.phoneMixerNodes.values()]; engine.destroy();
  assert.ok(trims.every(node => node.disconnected)); assert.equal(engine.phoneMixerNodes.size, 0);
  assert.equal(engine.setPhoneMixer({ overall: 1 }), false);
});

test('each phone asset has one independent trim downstream of its own score and gesture envelopes', async t => {
  const { engine } = harness(t, { mode: 'phone' }); await engine.enable();
  assert.equal(engine.phoneMixerNodes.size, 6);
  assert.deepEqual(engine.layers.get('crackle').gain.connections, [engine.phoneMixerNodes.get('crackle')]);
  assert.deepEqual(engine.layers.get('crickets').gain.connections, [engine.phoneMixerNodes.get('crickets')]);
  assert.equal(engine.phoneRain.destination, engine.phoneMixerNodes.get('rain'));
  assert.equal(engine.phoneDrone.destination, engine.phoneMixerNodes.get('drone'));
  assert.deepEqual(engine.wildlife.gain.connections, [engine.phoneMixerNodes.get('birds')]);
  for (const name of ['crackle', 'rain', 'drone']) assert.deepEqual(engine.phoneMixerNodes.get(name).connections, [engine.fieldBus]);
  for (const name of ['crickets', 'birds']) assert.deepEqual(engine.phoneMixerNodes.get(name).connections, [engine.mix]);
  const gates = Object.fromEntries([...engine.phoneMixerNodes].map(([name, node]) => [name, node]));
  engine.setPhoneMixer({ rain: 0 });
  for (const name of ['crackle', 'crickets', 'birds', 'drone', 'overall']) assert.equal(gates[name].gain.events.length, 0, `${name} is unaffected by the rain trim`);
  const tail = gates.rain.gain.events.at(-1); assert.deepEqual(tail, ['linear', 0, PHONE_MIXER_FADE_SECONDS]);
  assert.equal(engine.getMetrics().phoneMixer.rain, 0);
});

test('live phone mixer reversals are continuous and cannot overwrite the precomputed ending or restart sources', async t => {
  const { engine, context, events, requests } = harness(t, { mode: 'phone' });
  engine.setSceneState({ id: 'afterglow', startedAt: 1, elapsedMs: 60000 }); await engine.enable();
  const masterEvents = engine.master.gain.events.slice(), cricketEvents = engine.layers.get('crickets').gain.gain.events.slice();
  const fieldEvents = engine.fieldBus.gain.events.slice(), sourceNodes = context.nodes.filter(node => node.nodeType === 'source');
  const beforeRequests = requests.slice(), beforeResumeCount = events.filter(event => event === 'resume').length;
  engine.setPhoneMixer({ overall: 0, crickets: .3, birds: 1.9, crackle: .7, rain: 1.2, drone: .4 });
  context.advance(PHONE_MIXER_FADE_SECONDS / 2);
  const overall = engine.phoneMixerNodes.get('overall'); engine.setPhoneMixer({ overall: 2 });
  assert.equal(overall.gain.events.filter(event => event[0] === 'set').at(-1)[1], .5, 'A reversal starts at the audible midpoint, not the previous destination.');
  assert.equal(engine.phoneMixerRamps.get('overall').from, .5);
  context.advance(PHONE_MIXER_FADE_SECONDS); engine.setPhoneMixer({ overall: 0 });
  assert.deepEqual(overall.gain.events.at(-1), ['linear', 0, context.currentTime + PHONE_MIXER_FADE_SECONDS]);
  const stableEvents = overall.gain.events.slice(); engine.setPhoneMixer({ overall: 0 });
  assert.deepEqual(overall.gain.events, stableEvents, 'Identical received settings never stack automation.');
  assert.deepEqual(engine.master.gain.events, masterEvents); assert.deepEqual(engine.layers.get('crickets').gain.gain.events, cricketEvents);
  assert.deepEqual(engine.fieldBus.gain.events, fieldEvents);
  assert.deepEqual(context.nodes.filter(node => node.nodeType === 'source'), sourceNodes); assert.deepEqual(requests, beforeRequests);
  assert.equal(events.filter(event => event === 'resume').length, beforeResumeCount);
  engine.setSceneState({ id: 'ended', elapsedMs: 0 }); const endedMaster = engine.master.gain.events.slice();
  engine.setPhoneMixer({ overall: 2, rain: 2, crickets: 2, birds: 2 });
  assert.equal(engine._outputGain(), 0); assert.deepEqual(engine.master.gain.events, endedMaster);
  assert.equal(engine.phoneRain.getMetrics().rainLoopCount, 0);
});

test('phone mixer changes remain silent while muted or hidden and never alter Main audio', async t => {
  const { engine, context, requests, events } = harness(t, { mode: 'phone' });
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); await engine.enable();
  engine.setMuted(true); const before = { requests: requests.length, resumes: events.filter(event => event === 'resume').length, contextState: context.state };
  engine.setPhoneMixer({ overall: 2, crackle: 2 }); assert.equal(engine.muted, true); assert.equal(engine._outputGain(), 0);
  engine.setHidden(true); engine.setPhoneMixer({ overall: 1.4, birds: .8 }); assert.equal(engine._outputGain(), 0);
  assert.equal(requests.length, before.requests); assert.equal(events.filter(event => event === 'resume').length, before.resumes);
  assert.equal(engine.phoneMixer.overall, 1.4); assert.equal(context.state, before.contextState, 'Mixer changes never resume or suspend the device context.');
  const main = harness(t, { mode: 'operator' }); await main.engine.enable();
  const nodes = main.context.nodes.length, master = main.engine.master.gain.events.slice(), mixer = { ...main.engine.mixer };
  assert.equal(main.engine.setPhoneMixer({ overall: 0, rain: 0, birds: 0 }), false);
  assert.equal(main.engine.phoneMixerNodes.size, 0); assert.equal(main.engine.getMetrics().phoneMixer, null);
  assert.equal(main.context.nodes.length, nodes); assert.deepEqual(main.engine.master.gain.events, master); assert.deepEqual(main.engine.mixer, mixer);
});

test('suspended phone trim changes commit exact targets before resume without activating audio', async t => {
  const { engine, context, events, requests } = harness(t, { mode: 'phone' });
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); await engine.enable();
  await context.suspend();
  const resumeCount = events.filter(event => event === 'resume').length, requestCount = requests.length;
  const masterEvents = engine.master.gain.events.slice(), cricketEvents = engine.layers.get('crickets').gain.gain.events.slice();
  engine.setPhoneMixer({ overall: 0, birds: 0, drone: .4 });
  for (const [name, value] of Object.entries(engine.phoneMixer)) {
    assert.equal(engine.phoneMixerNodes.get(name).gain.value, value);
    assert.deepEqual(engine.phoneMixerNodes.get(name).gain.events.at(-1), ['set', value, context.currentTime]);
  }
  assert.equal(engine.phoneMixerRamps.size, 0); assert.equal(context.state, 'suspended');
  assert.equal(events.filter(event => event === 'resume').length, resumeCount); assert.equal(requests.length, requestCount);
  assert.deepEqual(engine.master.gain.events, masterEvents); assert.deepEqual(engine.layers.get('crickets').gain.gain.events, cricketEvents);
  await engine.enable();
  assert.equal(context.state, 'running'); assert.equal(engine.phoneMixerNodes.get('overall').gain.value, 0);
  assert.equal(engine.phoneMixerNodes.get('birds').gain.value, 0); assert.equal(engine.phoneMixerRamps.size, 0);
});

test('an interrupted same-target mute settles even when the next inactive edit changes another phone channel', async t => {
  const { engine, context } = harness(t, { mode: 'phone' }); await engine.enable();
  engine.setPhoneMixer({ overall: 0, birds: 0 }); context.advance(PHONE_MIXER_FADE_SECONDS / 2);
  assert.equal(engine.phoneMixerRamps.get('birds').to, 0);
  // Simulate an interruption before a queued statechange has been delivered.
  context.state = 'interrupted'; engine.setPhoneMixer({ rain: .6 });
  for (const name of ['overall', 'birds']) {
    assert.deepEqual(engine.phoneMixerNodes.get(name).gain.events.at(-1), ['set', 0, context.currentTime]);
    assert.equal(engine.phoneMixerRamps.has(name), false);
  }
  assert.equal(engine.phoneMixerNodes.get('rain').gain.value, .6); assert.equal(engine.phoneMixerRamps.size, 0);
  await engine.enable();
  assert.equal(engine.phoneMixerNodes.get('overall').gain.value, 0); assert.equal(engine.phoneMixerNodes.get('birds').gain.value, 0);
  engine.setPhoneMixer({ overall: 1, birds: 1 }); context.advance(.03); context.state = 'interrupted'; context.onstatechange();
  assert.equal(engine.phoneMixerRamps.size, 0, 'A device statechange settles pending trims even without another remote setting.');
  assert.equal(engine.phoneMixerNodes.get('birds').gain.value, 1);
});

test('Main opening haze keeps its calibration across cues and current mixer trims stay downstream', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  await engine.setLayerVariations('haze', endpoints('haze')); await engine.setLayerVariations('forest', endpoints('forest'));
  engine.setMixer({ haze: .37, forest: .25 }); engine.setSceneState({ id: 'arrival', startedAt: 1, elapsedMs: 0, paused: true });
  await engine.enable(); await flush(); context.advance(2); engine._tick();
  const haze = engine.layers.get('haze'), before = haze.gain.gain.value;
  engine.setSceneState({ id: 'instructions', startedAt: 2, elapsedMs: 0 });
  assert.equal(haze.gain.gain.value, before); assert.equal(engine.mixerNodes.get('haze').gain.value, .37);
  for (let index = 0; index < 12; index++) { context.advance(1); engine._tick(); assert.ok(haze.gain.gain.value <= before); }
  assert.equal(haze.gain.gain.value, 0);
  engine.setMixer({ haze: 0 }); engine.setSceneState({ id: 'arrival', startedAt: 3, elapsedMs: 0 });
  for (let index = 0; index < 6; index++) { context.advance(1); engine._tick(); assert.equal(engine.mixerNodes.get('haze').gain.value, 0); }
  engine.setMixer({ haze: .6 }); assert.equal(engine.mixerNodes.get('haze').gain.value, .6);
  assert.ok(haze.gain.gain.value > 0, 'Live mixer changes multiply the existing transition rather than restarting it.');
});

test('early, skipped and rapid Main cues carry their current amplitudes without inventing a forest hump', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  for (const id of ['haze', 'forest', 'rain']) await engine.setLayerVariations(id, endpoints(id));
  engine.setSceneState({ id: 'instructions', startedAt: 1, elapsedMs: 2000 }); await engine.enable(); await flush();
  const first = { ...engine._sceneScore().mix };
  engine.setSceneState({ id: 'participation', startedAt: 2, elapsedMs: 0 });
  assert.equal(engine._sceneScore().mix.mainForest, first.mainForest); assert.equal(engine._sceneScore().mix.mainHaze, first.mainHaze);
  context.advance(3); engine._tick(); const partial = { ...engine._sceneScore().mix };
  engine.setSceneState({ id: 'instructions', startedAt: 3, elapsedMs: 0 });
  assert.equal(engine._sceneScore().mix.mainForest, partial.mainForest); assert.equal(engine._sceneScore().mix.mainHaze, partial.mainHaze);
  context.advance(12); engine._tick(); engine.setSceneState({ id: 'arrival', startedAt: 4, elapsedMs: 0 }); context.advance(12); engine._tick();
  engine.setSceneState({ id: 'participation', startedAt: 5, elapsedMs: 0 });
  for (let index = 0; index < 13; index++) { engine._tick(); assert.equal(engine._sceneScore().mix.mainForest, 0); context.advance(1); }
  engine.setSceneState({ id: 'forest-takeover', startedAt: 6, elapsedMs: 0 }); context.advance(5); engine._tick();
  const outgoing = { ...engine._sceneScore().mix }, drone = engine.mainDrone;
  engine.setSceneState({ id: 'final-rain', startedAt: 7, elapsedMs: 0 });
  assert.equal(engine._sceneScore().mix.mainForest, outgoing.mainForest); assert.equal(engine._sceneScore().mix.mainDrone, outgoing.mainDrone);
  for (let index = 0; index < 52; index++) {
    context.advance(1); engine._tick();
    assert.ok(engine._sceneScore().mix.mainForest <= outgoing.mainForest + 1e-12);
    assert.ok(engine._sceneScore().mix.mainDrone <= outgoing.mainDrone + 1e-12);
  }
  assert.equal(engine.mainDrone, drone); assert.equal(engine._sceneScore().mix.mainForest, 0); assert.equal(engine._mainDroneGain(), 0);
});

test('Main takeover carries thin haze out smoothly and manual texture choices are never replaced by warm defaults', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  await engine.setLayerVariations('haze', endpoints('haze'));
  engine.setSceneState({ id: 'participation', elapsedMs: 12000 }); await engine.enable(); await flush();
  const haze = engine.layers.get('haze').gain.gain.value;
  engine.setSceneState({ id: 'forest-takeover', elapsedMs: 0 }); assert.equal(engine.layers.get('haze').gain.gain.value, haze);
  context.advance(15); engine._tick(); assert.ok(engine.layers.get('haze').gain.gain.value > 0 && engine.layers.get('haze').gain.gain.value < haze);
  const macros = { haze: .17, forest: .23, ash: .31, rain: .64, moisture: .42 }; engine.setMacros(macros);
  context.advance(15); engine._tick(); assert.deepEqual(engine._effectiveMacros(), macros);
  engine.setSceneState({ id: 'final-rain', elapsedMs: 0, rainIntensity: .01 }); assert.deepEqual(engine._effectiveMacros(), macros);
  context.advance(52); engine._tick(); assert.deepEqual(engine._effectiveMacros(), macros);
});

test('reverse Main rain cues preserve effective field attenuation and do not kill the outgoing rain source', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  await engine.setLayerVariations('rain', endpoints('rain')); engine.setSceneState({ id: 'afterglow', elapsedMs: 25000 });
  await engine.enable(); await flush(); const records = [...engine.layers.get('rain').sources];
  const before = engine._sceneScore(), rain = before.mix.mainRain * before.mainFieldGain;
  engine.setSceneState({ id: 'participation', elapsedMs: 0 });
  const initial = engine._sceneScore(); assert.ok(Math.abs(initial.mix.mainRain * initial.mainFieldGain - rain) < 1e-12);
  assert.deepEqual([...engine.layers.get('rain').sources], records);
  for (let index = 0; index < 12; index++) {
    context.advance(1); engine._tick(); const score = engine._sceneScore();
    assert.ok(score.mix.mainRain * score.mainFieldGain <= rain + 1e-12);
  }
  assert.equal(engine.layers.get('rain').gain.gain.value, 0); assert.equal(engine._fieldSceneGain(), 1);
});

test('Main output uses an independent finite trim during the ending and covers its wildlife bypass exactly once', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  engine.setSceneState({ id: 'afterglow', elapsedMs: 10000 }); await engine.enable();
  const master = engine.master.gain.events.slice(), field = engine.fieldBus.gain.events.slice(), crickets = engine.layers.get('crickets').gain.gain.events.slice();
  assert.deepEqual(engine.wildlife.gain.connections, [engine.wildlife.finalRelease]);
  assert.deepEqual(engine.wildlife.finalRelease.connections, [engine.mainLevelGain]);
  engine.setLevel(.2);
  assert.deepEqual(engine.master.gain.events, master); assert.deepEqual(engine.fieldBus.gain.events, field); assert.deepEqual(engine.layers.get('crickets').gain.gain.events, crickets);
  assert.equal(engine.mainLevelGain.gain.events.findLast(event => event[0] === 'set')[1], .55);
  assert.ok(Math.abs(engine.mainLevelGain.gain.events.at(-1)[2] - context.currentTime - .16) < 1e-12);
  context.advance(.08); const from = engine._mainLevelAt(); engine.setLevel(0);
  assert.ok(Math.abs(engine.mainLevelGain.gain.events.findLast(event => event[0] === 'set')[1] - from) < 1e-12);
  context.advance(.2); assert.equal(engine._mainLevelAt(), 0);
  assert.equal(engine.master.gain.events.filter(event => event[0] === 'curve').at(-1)[1].at(-1), 0);
  context.advance(44); engine._tick(); assert.equal(engine._sceneGain(), 0);
});

test('phone early final-rain drone stays at its current weight and manual opening returns fade existing sound before cleanup', async t => {
  const { engine, context } = harness(t, { fetchImpl: successfulFetch });
  await engine.setLayerSource('crickets', '/phone-crickets-fixture.mp3');
  engine.setProgression({ sourceCount: 100, outCount: 100, heat: 0 });
  engine.setSceneState({ id: 'forest-takeover', elapsedMs: 5000 }); await engine.enable(); await flush();
  const drone = engine.phoneDrone.voice, weight = engine._phoneDroneSceneWeight(); assert.ok(drone && weight > 0 && weight < 1);
  engine.setSceneState({ id: 'final-rain', elapsedMs: 0 }); assert.equal(engine._phoneDroneSceneWeight(), weight); assert.equal(engine.phoneDrone.voice, drone);
  context.advance(5); engine._tick(); assert.ok(engine._phoneDroneSceneWeight() <= weight);
  const gate = engine.layers.get('crickets').sampleGate.gain.events.slice(), sources = [...engine.layers.get('crickets').sources];
  engine.setSceneState({ id: 'instructions', elapsedMs: 0 });
  assert.ok(engine.phoneSceneExit); assert.equal(engine.phoneDrone.voice, drone); assert.deepEqual(engine.layers.get('crickets').sampleGate.gain.events, gate);
  const initial = engine.master.gain.events.findLast(event => event[0] === 'set'); assert.ok(initial[1] > 0);
  const end = engine.master.gain.events.at(-1); assert.equal(end[0], 'linear'); assert.equal(end[1], 0); assert.equal(end[2], context.currentTime + .35);
  context.advance(.15); engine._tick(); assert.deepEqual([...engine.layers.get('crickets').sources], sources); assert.deepEqual(engine.layers.get('crickets').sampleGate.gain.events, gate);
  context.advance(.21); engine._tick(); assert.equal(roleGain(engine), 0); assert.equal(engine.phoneDrone.voice, null);
  assert.equal(engine.layers.get('crickets').sampleGate.gain.value, 0);
});

test('a phone opening-return tail is discarded on mute, hide, disable or interruption and cannot revive on resume', async t => {
  for (const action of ['mute', 'hide', 'disable', 'interrupt']) {
    const { engine, context } = harness(t, { fetchImpl: successfulFetch });
    engine.setProgression({ sourceCount: 10, outCount: 10, heat: 0 });
    engine.setSceneState({ id: 'forest-takeover', elapsedMs: 15000 }); await engine.enable();
    engine.setSceneState({ id: 'instructions', elapsedMs: 0 }); context.advance(.1);
    assert.ok(engine.phoneSceneExit);
    if (action === 'mute') { engine.setMuted(true); engine.setMuted(false); }
    if (action === 'hide') { engine.setHidden(true); engine.setHidden(false); }
    if (action === 'disable') { engine.disable(); await engine.enable(); }
    if (action === 'interrupt') { context.state = 'interrupted'; context.onstatechange(); await engine.enable(); }
    await flush(); context.advance(.3); engine._tick();
    assert.equal(engine.phoneSceneExit, null, action); assert.equal(roleGain(engine), 0, action);
    assert.equal(engine.phoneDrone.voice, null, action); assert.equal(engine.wildlife.shots.size, 0, action);
  }
});

test('an interrupted Main output trim settles its exact target before the activation gate can reopen', async t => {
  const { engine, context } = harness(t, { mode: 'operator' }); await engine.enable();
  engine.setLevel(0); context.advance(.05); assert.ok(engine._mainLevelAt() > 0);
  context.state = 'interrupted'; context.onstatechange();
  assert.equal(engine._mainLevelAt(), 0); assert.equal(engine.mainLevelRamp, null);
  await engine.enable(); assert.equal(engine.mainLevelGain.gain.value, 0);
  context.advance(1); engine._tick(); assert.equal(engine.mainLevelGain.gain.value, 0);
});

test('Main voice and remaining-tail trims stay live and phase-preserving during a carried reverse fade', async t => {
  const { engine, context } = harness(t, { mode: 'operator', fetchImpl: successfulFetch });
  context.decodeAudioData = async () => context.createBuffer(1, 16 * 8000, 8000);
  engine.setWildlifeSources({ orangutan: '/audio-assets/v3/orangutan-distant-v25.mp3' });
  engine.setSceneState({ id: 'afterglow', elapsedMs: 43480 }); await engine.enable(); await flush(); context.advance(.05); engine._tick();
  context.advance(11.5); engine._tick();
  const shot = [...engine.wildlife.shots][0]; assert.ok(shot);
  engine.setSceneState({ id: 'instructions', elapsedMs: 0 });
  const base = .035 * .8 * .16;
  engine.setMixer({ orangutanTail: .4 }); assert.ok(Math.abs(engine.wildlife.gain.gain.value - base * .4) < 1e-12);
  engine.setMixer({ orangutanTail: 0 }); assert.equal(engine.wildlife.gain.gain.value, 0); assert.equal([...engine.wildlife.shots][0], shot);
  engine.setMixer({ orangutanTail: 1.6, orangutan: .3 });
  assert.ok(Math.abs(engine.wildlife.gain.gain.value - base * 1.6 * .3) < 1e-12);
  assert.equal([...engine.wildlife.shots][0], shot, 'Fader changes preserve the existing call rather than replaying it.');
  context.advance(12); engine._tick(); assert.equal(engine.wildlife.shots.size, 0);
});

test('a delayed initial Participation cue establishes the drone before the map without jumping or changing its trim', async t => {
  const { engine, context } = harness(t, { mode: 'operator' });
  engine.setSceneState({ id: 'instructions', elapsedMs: 12000, startedAt: 1 });
  await engine.enable(); engine.setMixer({ lowDrone: .37 });
  engine.setSceneState({ id: 'participation', elapsedMs: 5500, startedAt: 2, participationOpening: true });
  assert.equal(engine._sceneScore().mix.mainDrone, 0, 'The late packet does not create an immediate level jump.');
  context.advance(MAIN_ENABLE_FADE_SECONDS / 2); engine._tick();
  assert.ok(Math.abs(engine._sceneScore().mix.mainDrone - .5) < 1e-9);
  context.advance(MAIN_ENABLE_FADE_SECONDS / 2 + .001); engine._tick();
  assert.equal(engine._sceneScore().mix.mainDrone, 1);
  assert.equal(participationVisualProgress(engine.scene, engine._sceneElapsed()), 0, 'The whole instruction panel is still fully visible.');
  assert.equal(engine.mixerNodes.get('lowDrone').gain.value, .37);
  const drone = engine.mainDrone;
  engine.setSceneState({ ...engine.scene, elapsedMs: engine._sceneElapsed(), paused: true });
  const mix = engine._sceneScore().mix.mainDrone;
  context.advance(3); engine._tick();
  assert.equal(engine._sceneScore().mix.mainDrone, mix); assert.equal(engine.mainDrone, drone);
});
