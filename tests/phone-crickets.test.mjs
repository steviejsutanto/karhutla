import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PhoneCricketPhrases, PHONE_CRICKET_RATE, PHONE_CRICKET_LEVEL, PHONE_CRICKET_ENTRANCE_SECONDS } from '../app/phone-crickets.js';
import { PHONE_RAIN_TRIM } from '../app/phone-tap-rain.js';
import { PhoneDroneAudio, PHONE_DRONE_PITCH_RATIO, PHONE_DRONE_GAIN_TRIM } from '../app/phone-drone.js';

class Parameter {
  constructor() { this.events = []; this.value = 1; }
  cancelScheduledValues(at) { this.events = this.events.filter(event => event.at < at); }
  setValueAtTime(value, at) { this.events.push({ value, at, ramp: false }); }
  linearRampToValueAtTime(value, at) { this.events.push({ value, at, ramp: true }); }
  at(time) {
    let from = this.value, start = 0;
    for (const event of [...this.events].sort((a, b) => a.at - b.at)) {
      if (time < event.at) return event.ramp ? from + (event.value - from) * Math.max(0, (time - start) / (event.at - start)) : from;
      from = event.value; start = event.at;
    }
    return from;
  }
}
function fixture() {
  const context = { currentTime: 0 }, parameter = new Parameter();
  return { context, parameter, phrases: new PhoneCricketPhrases({ context, parameter }) };
}

test('phone balances retain rain and cricket trims while the drone rises a major third at its existing level', () => {
  assert.ok(Math.abs(12 * Math.log2(PHONE_DRONE_PITCH_RATIO / 2) - 4) < 1e-12);
  assert.ok(Math.abs(20 * Math.log10(PHONE_RAIN_TRIM) + 4.5) < 1e-12);
  assert.ok(Math.abs(20 * Math.log10(PHONE_DRONE_GAIN_TRIM) - 3) < 1e-12);
  assert.ok(Math.abs(20 * Math.log10(PHONE_DRONE_GAIN_TRIM / 10 ** (4.5 / 20)) + 1.5) < 1e-12);
  assert.ok(Math.abs(20 * Math.log10(PHONE_CRICKET_LEVEL / .04) + 8.5) < 1e-12);
  assert.equal(PHONE_CRICKET_RATE, .76, 'Restore previous pitch; rhythm edits live in the recording rather than stretching notes.');
});

test('crickets enter smoothly over four seconds then remain continuous with no long master mutes', () => {
  const { context, parameter, phrases } = fixture();
  assert.equal(parameter.value, 0); phrases.update(false); assert.equal(parameter.events.length, 0);
  phrases.update(true);
  assert.equal(parameter.at(0), 0); assert.ok(parameter.at(.125) < .003);
  assert.ok(Math.abs(parameter.at(2) - .5) < 1e-12);
  assert.equal(parameter.at(PHONE_CRICKET_ENTRANCE_SECONDS), 1);
  const events = structuredClone(parameter.events);
  for (let now = 4; now <= 90; now += .16) { context.currentTime = now; phrases.update(true); assert.equal(parameter.at(now), 1); }
  assert.deepEqual(parameter.events, events, 'Repeated state packets do not restart the entrance or insert silent windows.');
  assert.equal(phrases.getMetrics().continuous, true);
});

test('mute/suspension removes the old entrance and a fresh activation eases in from zero', () => {
  const { context, parameter, phrases } = fixture(); phrases.update(true);
  context.currentTime = 2; phrases.update(false); assert.equal(parameter.at(2), 0);
  context.currentTime = 200; phrases.update(true);
  assert.equal(parameter.at(200), 0); assert.ok(Math.abs(parameter.at(202) - .5) < 1e-12); assert.equal(parameter.at(204), 1);
});

test('all shipped phone cricket derivatives preserve sources, shorten notes and slow spacing separately', async () => {
  const catalog = JSON.parse(await readFile(new URL('../audio-assets/v3/manifest.json', import.meta.url), 'utf8'));
  for (const id of ['cricket-far', 'cricket-mid', 'cricket-near']) {
    const row = catalog.assets.find(asset => asset.id === id), mobile = row.mobile;
    assert.match(mobile.file, /mobile-rhythm-v30\.mp3$/);
    assert.equal(mobile.channels, 1); assert.equal(mobile.sampleRate, 32000);
    assert.ok(mobile.durationSeconds <= 20); assert.ok(mobile.bytes < 250000);
    const bytes = await readFile(new URL(`../${mobile.file}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), mobile.sha256);
    const provenance = JSON.parse(await readFile(new URL(`../${mobile.provenanceFile}`, import.meta.url), 'utf8'));
    assert.equal(provenance.originalRecordingSha256, row.sha256); assert.equal(provenance.generated, false);
    assert.ok(provenance.validation.events >= 80, 'Retain a continuous field of individual calls.');
    assert.ok(provenance.validation.medianTargetIntervalSeconds >= provenance.validation.medianSourceIntervalSeconds * 1.24);
    assert.ok(provenance.validation.medianTargetNoteSeconds < provenance.validation.medianSourceNoteSeconds * .66);
    assert.equal(provenance.validation.nonFiniteSamples, 0); assert.ok(provenance.validation.peakAmplitude < .9);
  }
});
