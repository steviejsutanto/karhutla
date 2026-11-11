import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERTONE_ROOT_MIDI, OVERTONE_ROOT_HZ, TONE_HARMONICS, BELL_HARMONICS,
  OVERTONE_TONE_PITCHES, OVERTONE_BELL_PITCHES, overtonePitch, overtonePitchForKey, overtoneRegisterWeights, overtonePitchAtProgress, toneRegisterProgress } from '../app/overtone-scale.js';

test('map tones and bells share the requested D-flat reference and exact integer harmonics', () => {
  assert.equal(OVERTONE_ROOT_MIDI, 37);
  assert.equal(OVERTONE_ROOT_HZ, 440 * 2 ** ((37 - 69) / 12));
  assert.deepEqual(TONE_HARMONICS, Array.from({ length: 29 }, (_, index) => index + 2));
  assert.deepEqual(BELL_HARMONICS, Array.from({ length: 10 }, (_, index) => index + 2));
  for (const pitch of [...OVERTONE_TONE_PITCHES, ...OVERTONE_BELL_PITCHES]) {
    assert.equal(pitch.frequency, OVERTONE_ROOT_HZ * pitch.harmonic);
    assert.ok(Math.abs(440 * 2 ** ((pitch.midi - 69) / 12) / pitch.frequency - 1) < 1e-12);
    assert.equal(Object.isFrozen(pitch), true);
  }
  for (const harmonic of [7, 11]) {
    const pitch = overtonePitch(harmonic), tempered = 440 * 2 ** ((Math.round(pitch.midi) - 69) / 12);
    assert.ok(Math.abs(1200 * Math.log2(pitch.frequency / tempered)) > 30, 'Natural harmonics are not quantized to tempered notes.');
  }
});

test('new pitch choices shift continuously from upper to lower registers with confirmed extinction', () => {
  for (const pitches of [OVERTONE_TONE_PITCHES, OVERTONE_BELL_PITCHES]) {
    const mean = progress => overtoneRegisterWeights(pitches, progress).reduce((sum, weight, index) => sum + weight * pitches[index].harmonic, 0);
    assert.ok(mean(0) > mean(.25) && mean(.25) > mean(.5) && mean(.5) > mean(.75) && mean(.75) > mean(1));
    assert.ok(mean(0) - mean(1) > (pitches.at(-1).harmonic - pitches[0].harmonic) * .5);
    for (const progress of [0, .25, .5, .75, 1]) {
      const weights = overtoneRegisterWeights(pitches, progress);
      assert.ok(Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
      let below = 0;
      for (let index = 0; index < pitches.length; index++) {
        assert.ok(weights[index] > 0, 'Every requested harmonic remains available.');
        assert.equal(overtonePitchAtProgress(pitches, below + weights[index] / 2, progress), pitches[index]);
        below += weights[index];
      }
    }
    for (let index = 0; index < 100; index++) {
      const sample = (index + .5) / 100;
      let previous = Infinity;
      for (let stage = 0; stage <= 100; stage++) {
        const harmonic = overtonePitchAtProgress(pitches, sample, stage / 100).harmonic;
        assert.ok(harmonic <= previous, 'A stable draw only descends as more patches go out.'); previous = harmonic;
      }
    }
    assert.equal(overtonePitchAtProgress(pitches, 0, 0), pitches[0]);
    assert.equal(overtonePitchAtProgress(pitches, 1, 1), pitches.at(-1));
  }
  for (let index = 0; index < 100; index++) {
    const key = `register-${index}`;
    assert.equal(overtonePitchForKey(key, .3), overtonePitchForKey({key, heat:0}, .3));
    assert.ok(overtonePitchForKey(key, 1).harmonic <= overtonePitchForKey(key, 0).harmonic);
  }
});

test('geographic keys keep their overtone assignment through cooling, crowd and ordering changes', () => {
  const heard = new Set();
  for (let index = 0; index < 2000; index++) {
    const key = `area-${index}`, pitch = overtonePitchForKey(key); heard.add(pitch.harmonic);
    assert.equal(overtonePitchForKey({ key, heat: 0, moisture: 1, number: 42 }), pitch);
    assert.equal(overtonePitchForKey({ key, heat: 1, moisture: 0, number: 1 }), pitch);
  }
  assert.deepEqual([...heard].sort((a, b) => a - b), TONE_HARMONICS);
  for (const value of [0, -1, 1.5, 65, NaN, Infinity]) assert.throws(() => overtonePitch(value), RangeError);
});

test('tone register reaches its lower half early and extends one octave below the former floor', () => {
  assert.equal(OVERTONE_TONE_PITCHES[0].frequency, OVERTONE_ROOT_HZ * 2);
  assert.equal(OVERTONE_TONE_PITCHES[0].frequency * 2, overtonePitch(4).frequency);
  const mean = progress => overtoneRegisterWeights(OVERTONE_TONE_PITCHES, progress).reduce((sum, weight, index) => sum + weight * OVERTONE_TONE_PITCHES[index].harmonic, 0);
  assert.ok(toneRegisterProgress(.2) < .5 && toneRegisterProgress(.21) > .5);
  assert.ok(mean(toneRegisterProgress(.25)) < mean(.5));
  assert.ok(mean(toneRegisterProgress(.5)) < mean(.5) * .65);
  const keys=Array.from({length:5000},(_,index)=>`early-range-${index}`);
  const actualMean=fraction=>keys.reduce((sum,key)=>sum+overtonePitchForKey(key,fraction).harmonic,0)/keys.length;
  assert.ok(actualMean(0)>20);
  assert.ok(actualMean(.25)<16);
  assert.ok(actualMean(.5)<11);
});
