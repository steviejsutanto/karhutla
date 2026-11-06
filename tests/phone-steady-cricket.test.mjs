import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ambianceSources, soundLibrary } from '../app/sound-library.js';
import { PHONE_CRICKET_RATE } from '../app/phone-crickets.js';
const load = path => readFile(new URL(`../${path}`, import.meta.url));
const json = async path => JSON.parse(await load(path));

test('new phone cricket material comes from a verified new generated master and one coherent note grid', async () => {
  const integration = await json('audio-assets/v3/cricket-steady-phone-v34-integration.json');
  const [row] = integration.assets, provenance = await json(row.provenanceFile);
  assert.equal(row.id, 'cricket-steady-phone-v34'); assert.equal(row.generated, true); assert.equal(row.fieldRecording, false);
  assert.equal(row.channels, 1); assert.equal(row.sampleRate, 32000); assert.ok(row.bytes < 250000 && row.durationSeconds < 20);
  assert.equal(createHash('sha256').update(await load(row.file)).digest('hex'), row.sha256);
  assert.equal(provenance.sourceGeneration.generated, true);
  assert.equal(provenance.sourceGeneration.model, 'Stable Audio 3 Medium');
  const generation = await json(`audio-assets/v3/${provenance.sourceMaster.file.replace('-master.wav', '-generation.json')}`);
  assert.equal(generation.master.sha256, provenance.sourceMaster.sha256);
  // Float masters are archived separately and are intentionally absent from
  // a clean checkout; verify their bytes too when the local archive is present.
  const raw = await load(`audio-assets/v3/${provenance.sourceMaster.file}`).catch(error => {
    if (error.code !== 'ENOENT') throw error; return null;
  });
  if (raw) assert.equal(createHash('sha256').update(raw).digest('hex'), provenance.sourceMaster.sha256);
  assert.equal(provenance.sourceMaster.sha256, provenance.sourceGeneration.master.sha256);
  assert.equal(provenance.sourceMasterUnchanged, true);
  assert.equal(provenance.runtimePlaybackRate, PHONE_CRICKET_RATE);
  assert.equal(provenance.events.length, 16);
  assert.equal(new Set(provenance.events.map(event => event.sourceCenterSeconds)).size, 16,
    'Individual natural notes are selected across the new master rather than copying a single identical pulse.');
  assert.ok(provenance.events.every(event => event.runtimeWindowSeconds < .12 && Math.abs(event.jitterSeconds) <= .003));
  const v = provenance.validation;
  assert.equal(v.noteCount, 16); assert.equal(v.nonFiniteSamples, 0); assert.ok(v.peakAmplitude < .9);
  assert.ok(v.runtimeMedianIntervalSeconds > 1.15 && v.runtimeMedianIntervalSeconds < 1.25);
  assert.ok(v.intervalCoefficientOfVariation < .01, 'The encoded note cadence stays steady with tiny natural timing variation.');
  assert.ok(Math.abs(provenance.nativePreparedLoopSeconds / PHONE_CRICKET_RATE - 19.2) < .001);
});

test('the new active phone cricket mapping uses one native layer and preserves Main perspectives', async () => {
  const catalog = soundLibrary(await json('audio-assets/v3/manifest.json')), palette = ambianceSources(catalog);
  assert.equal(catalog.phone.crickets, 'cricket-steady-phone-v34');
  assert.deepEqual(catalog.phone.cricketLayers, []);
  assert.deepEqual(palette.phoneCricketLayers, [], 'No independently phased phone perspectives can compete with the steady pulse.');
  assert.match(palette.phone.crickets, /cricket-steady-phone-v34\.mp3\?v=[a-f0-9]{12}$/);
  assert.deepEqual(catalog.cricketLayers, ['cricket-near', 'cricket-mid', 'cricket-far']);
  assert.equal(palette.cricketLayers.length, 3);
});
