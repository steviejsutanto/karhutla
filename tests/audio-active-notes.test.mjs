import test from 'node:test';
import assert from 'node:assert/strict';
import { measureActiveNoteRms, prepareRecording, recordingPreparation } from '../app/audio-loudness.js';
const make = (padding = 0) => {
  const data = new Float32Array(2000 + padding * 2);
  for (let index = 0; index < 2000; index++) data[padding + index] = .06 * Math.sin(2 * Math.PI * index / 20);
  return { sampleRate: 10000, length: data.length, numberOfChannels: 1, getChannelData: () => data };
};

test('phone cricket rest length cannot increase the active note preparation level', () => {
  const tight = make(), sparse = make(10000);
  prepareRecording(tight, { phoneCrickets: true }); prepareRecording(sparse, { phoneCrickets: true });
  const a = recordingPreparation(tight), b = recordingPreparation(sparse);
  assert.ok(Math.abs(a.gain - b.gain) < 1e-12);
  assert.ok(Math.abs(measureActiveNoteRms(tight) - .085) < 1e-7);
  assert.ok(Math.abs(measureActiveNoteRms(sparse) - .085) < 1e-7);
  assert.ok(b.after.rms < a.after.rms / 3, 'Longer quiet gaps stay quiet instead of boosting each note.');
  assert.equal(b.phoneCrickets, true); assert.ok(b.after.peak < .95);
});

test('phone cricket preparation leaves Main and natural-rain preparation unchanged', () => {
  for (const options of [{ mode: 'operator' }, { mode: 'phone', naturalRain: true }]) {
    const reference = make(10000), flagged = make(10000);
    prepareRecording(reference, options); prepareRecording(flagged, { ...options, phoneCrickets: true });
    assert.deepEqual(flagged.getChannelData(0), reference.getChannelData(0));
    assert.equal(recordingPreparation(flagged).phoneCrickets, undefined);
  }
});

test('active-note measurement is bounded for silence and bad samples are rejected before preparation', () => {
  const data = new Float32Array(2000), silent = { sampleRate: 32000, numberOfChannels: 1, getChannelData: () => data };
  assert.equal(measureActiveNoteRms(silent), 0); prepareRecording(silent, { phoneCrickets: true });
  assert.equal(recordingPreparation(silent).gain, 1);
  data[10] = NaN; assert.throws(() => prepareRecording(silent, { phoneCrickets: true }), /invalid audio samples/);
});
