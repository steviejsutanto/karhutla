import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneDroneAudio, PHONE_DRONE_TRANSPOSITION_OFFSETS, PHONE_DRONE_PITCH_SEMITONES,
  PHONE_DRONE_PITCH_RATIO, PHONE_DRONE_GAIN_TRIM, phoneDroneTransposition, phoneDroneFrequency } from '../app/phone-drone.js';

class Parameter {
  constructor() { this.value = 0; this.targets = []; }
  setTargetAtTime(value, at, seconds) { this.value = value; this.targets.push({ value, at, seconds }); }
  cancelScheduledValues() {}
}
class Node {
  constructor(context) { this.context = context; this.connections = []; this.gain = new Parameter(); this.frequency = new Parameter(); this.Q = new Parameter(); }
  connect(node) { this.connections.push(node); }
  disconnect() { this.connections = []; this.disconnected = true; }
  start(at) { this.startedAt = at; }
  stop(at = this.context.currentTime) { this.stoppedAt = at; }
  setPeriodicWave(wave) { this.wave = wave; }
}
function fixture(sample) {
  const context = { currentTime: 0, nodes: [], waves: 0,
    createGain() { return this.node(); }, createBiquadFilter() { return this.node(); },
    createWaveShaper() { return this.node(); }, createOscillator() { const node = this.node(); node.oscillator = true; return node; },
    node() { const node = new Node(this); this.nodes.push(node); return node; },
    createPeriodicWave() { this.waves++; return {}; } };
  let draws = 0;
  const drone = new PhoneDroneAudio({ context, destination: {}, random: () => { draws++; return sample; } });
  return { context, drone, draws: () => draws };
}
const frequencies = [100, 150, 200, 100, 150, 200];
const sounding = { active: true, weight: .75, frequencies, amplitudes: [.72, .24, .34] };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} differs from ${b}`);

test('four equal random bins choose the current register, minor third, minor sixth or octave', () => {
  assert.deepEqual(PHONE_DRONE_TRANSPOSITION_OFFSETS, [0, 3, 8, 12]);
  assert.equal(Object.isFrozen(PHONE_DRONE_TRANSPOSITION_OFFSETS), true);
  const samples = [0, .249999, .25, .499999, .5, .749999, .75, .999999];
  assert.deepEqual(samples.map(phoneDroneTransposition), [0, 0, 3, 3, 8, 8, 12, 12]);
  const counts = new Map(PHONE_DRONE_TRANSPOSITION_OFFSETS.map(offset => [offset, 0]));
  for (let index = 0; index < 1000; index++) {
    const offset = phoneDroneTransposition((index + .5) / 1000); counts.set(offset, counts.get(offset) + 1);
  }
  assert.deepEqual([...counts.values()], [250, 250, 250, 250]);
  assert.equal(phoneDroneTransposition(1), 12); assert.equal(phoneDroneTransposition(-1), 0);
  assert.equal(phoneDroneTransposition(NaN), 0); assert.equal(phoneDroneTransposition(Infinity), 0);
});

test('every register transposes both banks before the fixed beat offsets without changing the level or voice budget', () => {
  for (const [index, offset] of PHONE_DRONE_TRANSPOSITION_OFFSETS.entries()) {
    const f = fixture((index + .5) / 4); f.drone.update(sounding);
    const voice = f.drone.voice, metrics = f.drone.getMetrics();
    assert.equal(metrics.pitchSemitones, PHONE_DRONE_PITCH_SEMITONES + offset);
    assert.equal(metrics.basePitchSemitones, 16); assert.equal(metrics.transpositionSemitones, offset);
    assert.equal(metrics.oscillatorCount, 6); assert.equal(metrics.trimDb, 3); assert.equal(voice.drive.oversample, 'none');
    assert.equal(f.context.nodes.filter(node => node.oscillator).length, 6); assert.equal(f.context.waves, 1);
    close(voice.gain.gain.value, .032 * PHONE_DRONE_GAIN_TRIM * .75);
    for (let partial = 0; partial < 3; partial++) {
      close(voice.oscillators[partial].frequency.value, frequencies[partial] * PHONE_DRONE_PITCH_RATIO * 2 ** (offset / 12));
      close(voice.oscillators[partial].frequency.value - voice.oscillators[partial + 3].frequency.value, [1.4, 1.7, 2][partial]);
    }
    assert.deepEqual(voice.oscillators.map(node => node.frequency.value), frequencies.map((_, partial) => phoneDroneFrequency(frequencies, partial, offset)));
    assert.equal(f.draws(), 1); f.drone.destroy();
    assert.equal(f.drone.getMetrics().oscillatorCount, 0); assert.equal(f.drone.getMetrics().retiringOscillatorCount, 0);
    assert.ok(f.context.nodes.every(node => node.disconnected));
  }
});

test('one phone keeps its choice through updates, mute, scene exits and newly allocated voices', () => {
  for (const [index, offset] of PHONE_DRONE_TRANSPOSITION_OFFSETS.entries()) {
    const f = fixture((index + .5) / 4); assert.equal(f.draws(), 1);
    for (let cycle = 0; cycle < 4; cycle++) {
      f.drone.update(sounding); const voice = f.drone.voice;
      for (let packet = 0; packet < 20; packet++) f.drone.update({ ...sounding, weight: .5 });
      assert.equal(f.drone.voice, voice); assert.equal(f.drone.getMetrics().transpositionSemitones, offset);
      assert.equal(f.drone.getMetrics().pitchSemitones, 16 + offset);
      const changedFrequencies = frequencies.map(value => value * .75);
      f.drone.update({ ...sounding, frequencies: changedFrequencies });
      assert.deepEqual(voice.oscillators.map(node => node.frequency.value), changedFrequencies.map((_, partial) => phoneDroneFrequency(changedFrequencies, partial, offset)));
      f.drone.update({ active: false }); assert.equal(f.drone.voice, null);
      f.context.currentTime += .2; voice.oscillators[0].onended();
      assert.equal(f.drone.getMetrics().retiringOscillatorCount, 0);
    }
    assert.equal(f.draws(), 1); assert.equal(f.context.waves, 1);
    f.drone.destroy();
  }
});
