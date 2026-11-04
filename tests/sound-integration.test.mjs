import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createPerformanceServer } from '../app/server.mjs';
import { soundLibrary, ambianceSources } from '../app/sound-library.js';

test('sound prototype serves local samples, credits and controls to both phone and operator views', async t => {
  const instance = await createPerformanceServer({ port: 0, persistencePath: null, autoTick: false,
    records: [{ longitude: 110.125, latitude: -2.125 }] });
  t.after(() => instance.close());
  const { port } = await instance.listen(), base = `http://127.0.0.1:${port}`;
  for (const [route, host] of [['/study', 'study-sound'], ['/study/phone', 'phone-sound'], ['/', 'operator-sound'], ['/join', 'phone-sound']]) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes(`id="${host}"`), `${route} mounts its sound controls`);
    assert.ok(html.includes('/sound-controls.css'));
  }
  for (const route of ['/sound-engine.js', '/patch-soft-tones.js', '/phone-weather.js', '/main-quench.js', '/rain-area.js', '/sound-controls.js', '/sound-controls.css', '/visual-assets/participant-identity.js', '/visual-assets/extinction-feedback.js', '/audio-assets/ATTRIBUTION.md']) {
    assert.equal((await fetch(`${base}${route}`)).status, 200, route);
  }
  const phoneRainModule = await fetch(`${base}/phone-tap-rain.js`);
  assert.equal(phoneRainModule.status, 200, 'Phone touch rain has a static module route');
  assert.match(phoneRainModule.headers.get('content-type'), /^text\/javascript/);
  assert.equal(await phoneRainModule.text(), await readFile(new URL('../app/phone-tap-rain.js', import.meta.url), 'utf8'));
  for (const route of ['/sound-lab', '/sound-lab.js', '/sound-lab.css', '/sound-library.js', '/sound-participants.js', '/scene-score.js', '/audio-assets/v3/manifest.json']) {
    assert.equal((await fetch(`${base}${route}`)).status, 200, route);
  }
  assert.equal((await fetch(`${base}/audio-assets/v3/manifest.wav`)).status, 404);
  assert.equal((await fetch(`${base}/audio-assets/v3/private.json`)).status, 404);
  const library = soundLibrary(await (await fetch(`${base}/audio-assets/v3/manifest.json`)).json());
  assert.equal(library.version, 13);
  assert.equal(library.assets.length, 39);
  assert.equal(library.assets.filter(asset => asset.kind === 'forest').length, 3);
  const palette = ambianceSources(library);
  assert.equal(Object.keys(palette.variations).length, 6);
  assert.ok(Object.values(palette.variations).every(entries => entries.length === 2 && entries[0].at === 0 && entries[1].at === 1));
  for (const kind of ['haze', 'ash', 'rain', 'moisture', 'crickets']) assert.ok(library.assets.filter(asset => asset.kind === kind).length >= 2, `${kind} has two active endpoints`);
  assert.deepEqual(library.morphs.forest, ['fire-ground-embers', 'fire-wind-flames']);
  assert.ok(palette.phone.crackle && palette.phone.crickets && palette.phone.rain);
  assert.equal(library.phone.crackle, 'phone-branches-leaves');
  assert.deepEqual(library.phone.crackleAlternatives, ['phone-branches-dry-v20', 'phone-branches-full', 'phone-branches-leaves']);
  assert.ok(library.phone.crackleAlternatives.every(id => library.assets.find(asset => asset.id === id)?.kind === 'phone-crackle'));
  assert.equal(library.phone.rain, 'rain-natural-light');
  const phoneRain = library.assets.find(asset => asset.id === library.phone.rain);
  assert.equal(phoneRain.generated, false);
  assert.equal(phoneRain.kind, 'rain');
  assert.equal(phoneRain.mobile.durationSeconds, 18);
  assert.equal(phoneRain.mobile.channels, 1);
  assert.equal(phoneRain.mobile.sampleRate, 44100);
  assert.equal(phoneRain.mobile.bitrateKbps, 96);
  assert.ok(phoneRain.mobile.bytes <= 250000);
  assert.equal(palette.phone.rain, `/${phoneRain.mobile.file}?v=${phoneRain.mobile.sha256.slice(0, 12)}`);
  assert.equal(palette.mainQuench.length, 4); assert.equal(palette.phoneQuench, undefined);
  assert.equal(palette.mainBlob.length, 4);
  assert.deepEqual(library.main.blob, palette.mainBlob.map(entry => entry.id));
  assert.ok(palette.mainBlob.every(entry => library.assets.find(asset => asset.id === entry.id)?.kind === 'blob'));
  assert.ok(palette.mainBlob.every(entry => !Object.values(palette.phone).includes(entry.url)), 'Blob recordings remain Main-only.');
  assert.equal(palette.phone.quench, undefined);
  assert.equal(library.phone.quench, undefined); assert.deepEqual(library.main.quench, palette.mainQuench.map(entry => entry.id));
  assert.ok(palette.mainQuench.every(entry => !Object.values(palette.phone).includes(entry.url)), 'Quench playback is routed exclusively to Main');
  assert.deepEqual(Object.keys(palette.residueSources).sort(), ['ash', 'haze', 'moisture']);
  const expectedBanks = {
    ash: ['ash-fine', 'ash-scatter', 'ash-flutter-v20', 'ash-settle-v20'],
    moisture: ['moisture-seep', 'moisture-trickle', 'moisture-moss-v20', 'moisture-earth-v20'],
    haze: ['haze-light', 'haze-drift', 'haze-grass-v20', 'haze-leaves-v20', 'haze-air-v23', 'haze-float-v23'],
  };
  for (const [kind, ids] of Object.entries(expectedBanks)) {
    const entries = palette.residueSources[kind], assets = ids.map(id => library.assets.find(asset => asset.id === id));
    assert.deepEqual(library.residueVariations[kind], ids);
    assert.equal(entries.length, ids.length);
    assert.equal(new Set(entries.map(entry => entry.id)).size, ids.length);
    assert.equal(new Set(assets.map(asset => asset.sha256)).size, ids.length, `${kind} alternatives contain distinct audio, not duplicated files`);
    assert.ok(assets.every(asset => asset.kind === kind && asset.generated === true));
    assert.deepEqual(entries, assets.map(asset => ({ id: asset.id, url: `/${asset.file}?v=${asset.sha256.slice(0, 12)}` })));
    assert.deepEqual(library.morphs[kind], kind === 'haze' ? ['haze-air-v23', 'haze-float-v23'] : ids.slice(0, 2), `${kind} resolves its current global endpoints`);
  }
  assert.ok(palette.cricketLayers?.length >= 3, 'The main aftermath has distinct near, middle and far recordings');
  assert.ok(palette.cricketLayers.every(entry => library.assets.find(asset => asset.id === entry.id)?.kind === 'crickets'));
  assert.deepEqual(library.morphs.rain, ['rain-natural-light', 'rain-storm-v23']);
  assert.ok(library.assets.find(asset => asset.id === 'rain-storm-v23')?.generated, 'Finale rain uses the new generated storm');
  assert.ok(library.assets.find(asset => asset.id === 'rain-storm-v23-study2')?.generated, 'The second new storm remains available for audition');
  for (const asset of library.assets) {
    if (asset.generated) assert.equal(asset.model, 'Stable Audio 3 Medium');
    else {
      assert.equal(asset.generated, false);
      assert.match(asset.sourceUrl, /^https:\/\/freesound\.org\/people\//);
      assert.ok(asset.license && asset.licenseUrl, 'Field recordings retain their source license');
    }
    const audio = await fetch(`${base}/${asset.file}?v=${asset.sha256.slice(0, 12)}`);
    assert.equal(audio.status, 200);
    assert.match(audio.headers.get('content-type'), /^audio\/mpeg/);
    const bytes = Buffer.from(await audio.arrayBuffer());
    assert.equal(bytes.length, asset.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    assert.deepEqual(bytes, await readFile(new URL(`../${asset.file}`, import.meta.url)));
    if (asset.mobile) {
      const compact = await fetch(`${base}/${asset.mobile.file}?v=${asset.mobile.sha256.slice(0, 12)}`);
      assert.equal(compact.status, 200);
      const compactBytes = Buffer.from(await compact.arrayBuffer());
      assert.equal(compactBytes.length, asset.mobile.bytes);
      assert.equal(createHash('sha256').update(compactBytes).digest('hex'), asset.mobile.sha256);
      assert.deepEqual(compactBytes, await readFile(new URL(`../${asset.mobile.file}`, import.meta.url)));
      assert.ok(asset.mobile.bytes <= 250000 && asset.mobile.durationSeconds <= 20, 'Each phone recording stays within the compact 250 kB/20 s budget, including already-compact one-shots.');
    }
  }
  const response = await fetch(`${base}/audio-assets/manifest.json`), manifest = await response.json();
  assert.equal(response.status, 200);
  assert.ok(manifest.assets.length >= 5);
  assert.ok(manifest.assets.some(asset => asset.id === 'crickets'));
  assert.ok(manifest.assets.some(asset => asset.id === 'burning-forest' && asset.generated));
  for (const asset of manifest.assets) {
    if (asset.generated) {
      assert.match(asset.sourceUrl, /^https:\/\/huggingface\.co\/spaces\/stabilityai\//);
      assert.equal(asset.model, 'Stable Audio 3.0 Small SFX');
      assert.equal(asset.license, 'Stable Audio Community License');
      assert.equal(asset.sources.length, 3);
      assert.ok(asset.sources.every(source => source.prompt && Number.isInteger(source.seed)));
    } else {
      assert.match(asset.sourceUrl, /^https:\/\/freesound\.org\/people\//);
      assert.match(asset.license, /^CC0/);
    }
    const audio = await fetch(new URL(asset.file, `${base}/`));
    assert.equal(audio.status, 200);
    assert.match(audio.headers.get('content-type'), /^audio\/mpeg/);
    const bytes = Buffer.from(await audio.arrayBuffer());
    assert.equal(bytes.length, asset.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    assert.deepEqual(bytes, await readFile(new URL(`../${asset.file}`, import.meta.url)));
  }
  assert.equal((await fetch(`${base}/audio-assets/.source/rain.mp3`)).status, 404, 'Only the compact performance files are exposed');
});
