import test from 'node:test';
import assert from 'node:assert/strict';
import { soundLibrary, soundAssetUrl, ambianceSources } from '../app/sound-library.js';

const asset = (id = 'dry-fire') => ({ id, title: 'Dry fire', kind: 'forest', file: `audio-assets/v3/${id}.mp3`, sha256: 'a'.repeat(64), durationSeconds: 45 });
test('sound library exposes only local audio files and rejects ambiguous source identities', () => {
  const library = { assets: [asset()], defaultForest: 'dry-fire' };
  assert.equal(soundLibrary(library).defaultForest, 'dry-fire');
  assert.equal(soundAssetUrl(asset()), '/audio-assets/v3/dry-fire.mp3?v=aaaaaaaaaaaa');
  for (const file of ['https://other.example/sound.mp3', 'audio-assets/v3/../private.mp3', 'audio-assets/v3/source.wav', 'audio-assets/v3/nested/fire.mp3']) {
    assert.throws(() => soundLibrary({ assets: [{ ...asset(), file }] }));
  }
  assert.throws(() => soundLibrary({ assets: [asset(), asset()] }));
  assert.throws(() => soundLibrary({ assets: [{ ...asset(), sha256: 'bad' }] }));
});

test('sound library falls back to an existing forest choice without mutating the manifest', () => {
  const manifest = { defaultForest: 'missing', assets: [{ ...asset('rain'), kind: 'rain' }, asset('fire')] };
  const before = structuredClone(manifest);
  assert.equal(soundLibrary(manifest).defaultForest, 'fire');
  assert.deepEqual(manifest, before);
  assert.equal(soundLibrary({ assets: [] }).defaultForest, null);
});

test('the active palette resolves endpoint order and compact phone sources from verified entries', () => {
  const typed = (id, kind) => ({ ...asset(id), kind });
  const cricket = { ...typed('insects', 'crickets'), mobile: { file: 'audio-assets/v3/insects-phone.mp3', sha256: 'b'.repeat(64), durationSeconds: 15 } };
  const rain = { ...typed('soft-rain', 'rain'), mobile: { file: 'audio-assets/v3/rain-phone.mp3', sha256: 'c'.repeat(64), durationSeconds: 18 } };
  const library = soundLibrary({ assets: [asset('embers'), asset('flames'), typed('veil', 'haze'), typed('drift', 'haze'), typed('phone', 'phone-crackle'), cricket, typed('chorus', 'crickets'), rain],
    morphs: { forest: ['embers', 'flames'], haze: ['veil', 'drift'] }, aftermath: ['insects', 'chorus'], phone: { crackle: 'phone', crickets: 'insects', rain: 'soft-rain' } });
  const before = structuredClone(library), palette = ambianceSources(library);
  assert.deepEqual(palette.variations.forest, [
    { url: '/audio-assets/v3/embers.mp3?v=aaaaaaaaaaaa', at: 0 },
    { url: '/audio-assets/v3/flames.mp3?v=aaaaaaaaaaaa', at: 1 },
  ]);
  assert.equal(palette.variations.haze.length, 2);
  assert.equal(palette.variations.crickets.length, 2);
  assert.equal(palette.phone.crackle, '/audio-assets/v3/phone.mp3?v=aaaaaaaaaaaa');
  assert.equal(palette.phone.crickets, '/audio-assets/v3/insects-phone.mp3?v=bbbbbbbbbbbb');
  assert.equal(palette.phone.rain, '/audio-assets/v3/rain-phone.mp3?v=cccccccccccc');
  assert.equal(palette.phone.quench, undefined, 'Water-on-fire quench sounds remain exclusive to Main');
  assert.deepEqual(library, before);
});

test('palette mappings reject missing, duplicated or mismatched layers and never accept direct URLs', () => {
  const assets = [asset('embers'), asset('flames'), { ...asset('rain'), kind: 'rain' }];
  for (const ids of [['embers', 'rain'], ['embers', 'missing'], ['embers', 'embers'], ['https://example.com/audio.mp3', 'flames'], ['embers']]) {
    const palette = ambianceSources(soundLibrary({ assets, morphs: { forest: ids }, phone: { crackle: 'rain' } }));
    assert.deepEqual(palette, { variations: {}, phone: {}, mainQuench: [], mainBlob: [], residueSources: {}, phoneCricketLayers: [] });
  }
  assert.throws(() => soundLibrary({ assets: [{ ...asset(), mobile: { file: 'https://example.com/a.mp3', sha256: 'a'.repeat(64), durationSeconds: 15 } }] }));
});

test('Main blob banks resolve only unique verified local blob assets and never become a phone source', () => {
  const assets = ['a', 'b', 'c', 'd'].map(id => ({ ...asset(id), kind: 'blob' }));
  const library = soundLibrary({ assets, main: { blob: ['a', 'b', 'c', 'd'] }, phone: { blob: 'a', rain: 'b' } });
  const palette = ambianceSources(library);
  assert.equal(palette.mainBlob.length, 4); assert.deepEqual(palette.phone, {});
  assert.ok(palette.mainBlob.every(entry => entry.url.startsWith('/audio-assets/v3/')));
  for (const ids of [['a', 'a'], ['a', 'missing'], ['a', 'https://example.com/blob.mp3'], ['a', 'b', 'c', 'd', 'e']]) {
    assert.deepEqual(ambianceSources(soundLibrary({ assets, main: { blob: ids } })).mainBlob, []);
  }
  assert.deepEqual(ambianceSources(soundLibrary({ assets: [{ ...asset('a'), kind: 'rain' }], main: { blob: ['a'] } })).mainBlob, []);
});

test('residue banks resolve four independent verified choices per class without changing global endpoint morphs', () => {
  const kinds = ['ash', 'moisture', 'haze'];
  const residueVariations = Object.fromEntries(kinds.map(kind => [kind, Array.from({ length: 4 }, (_, index) => `${kind}-${index}`)]));
  const assets = kinds.flatMap(kind => residueVariations[kind].map((id, index) => ({ ...asset(id), kind,
    sha256: String(index + 1).repeat(64), mobile: { file: `audio-assets/v3/${id}-mobile.mp3`, sha256: 'b'.repeat(64), durationSeconds: 18 } })));
  const morphs = Object.fromEntries(kinds.map(kind => [kind, residueVariations[kind].slice(0, 2)]));
  const library = soundLibrary({ assets, morphs, residueVariations });
  const before = structuredClone(library), palette = ambianceSources(library);
  for (const kind of kinds) {
    assert.deepEqual(palette.residueSources[kind], residueVariations[kind].map((id, index) => ({
      id, url: `/audio-assets/v3/${id}.mp3?v=${String(index + 1).repeat(12)}`,
    })), `${kind} keeps its four verified full-length Main sources in order`);
    assert.equal(new Set(palette.residueSources[kind].map(entry => entry.url)).size, 4);
    assert.deepEqual(palette.variations[kind], palette.residueSources[kind].slice(0, 2).map(({ url }, at) => ({ url, at })));
  }
  assert.deepEqual(library, before);
});

test('invalid residue banks cannot introduce missing, duplicate, remote, oversized or cross-class sources', () => {
  const kinds = ['ash', 'moisture', 'haze'];
  const residueVariations = Object.fromEntries(kinds.map(kind => [kind, Array.from({ length: 4 }, (_, index) => `${kind}-${index}`)]));
  const assets = kinds.flatMap(kind => residueVariations[kind].map(id => ({ ...asset(id), kind })));
  const morphs = Object.fromEntries(kinds.map(kind => [kind, residueVariations[kind].slice(0, 2)]));
  for (const kind of kinds) {
    const foreign = residueVariations[kinds.find(candidate => candidate !== kind)][0];
    for (const invalid of [[`${kind}-0`, `${kind}-0`], [`${kind}-0`, 'missing'], [`${kind}-0`, foreign],
      [`${kind}-0`, 'https://outside.example/ash.mp3'], Array.from({ length: 7 }, (_, index) => `${kind}-${index}`), 'not-a-bank']) {
      const palette = ambianceSources(soundLibrary({ assets, morphs, residueVariations: { ...residueVariations, [kind]: invalid } }));
      assert.equal(palette.residueSources[kind], undefined, `${kind} rejects ${JSON.stringify(invalid)}`);
      for (const other of kinds.filter(candidate => candidate !== kind)) assert.equal(palette.residueSources[other].length, 4);
      assert.equal(palette.variations[kind].length, 2, 'An invalid extra bank cannot remove the verified global morph');
    }
  }
});

test('phone rain accepts only a verified rain identity and never exposes Main quench sources', () => {
  const assets = [{ ...asset('rain'), kind: 'rain', mobile: { file: 'audio-assets/v3/rain-mobile.mp3', sha256: 'b'.repeat(64), durationSeconds: 18 } },
    { ...asset('quench'), kind: 'phone-quench', durationSeconds: 2 }, { ...asset('crackle'), kind: 'phone-crackle' }];
  for (const rain of ['quench', 'crackle', 'missing', 'https://outside.example/rain.mp3']) {
    const palette = ambianceSources(soundLibrary({ assets, main: { quench: ['quench'] }, phone: { rain } }));
    assert.equal(palette.phone.rain, undefined);
    assert.equal(palette.phoneQuench, undefined);
    assert.equal(palette.phone.quench, undefined);
    assert.deepEqual(palette.mainQuench.map(entry => entry.id), ['quench']);
  }
  const palette = ambianceSources(soundLibrary({ assets, main: { quench: ['quench'] }, phone: { rain: 'rain' } }));
  assert.deepEqual(palette.phone, { rain: '/audio-assets/v3/rain-mobile.mp3?v=bbbbbbbbbbbb' });
});

test('the catalog accepts the expanded local palette and enforces its forty-asset limit', () => {
  assert.equal(soundLibrary({ assets: Array.from({ length: 40 }, (_, index) => asset(`fire-${index}`)) }).assets.length, 40);
  assert.throws(() => soundLibrary({ assets: Array.from({ length: 41 }, (_, index) => asset(`fire-${index}`)) }));
});

test('cricket perspective layers resolve only unique verified insect entries and preserve the old aftermath pair', () => {
  const assets = ['near', 'mid', 'far'].map(id => ({ ...asset(id), kind: 'crickets' }));
  const manifest = { assets, cricketLayers: ['near', 'mid', 'far'], aftermath: ['near', 'far'] };
  const palette = ambianceSources(soundLibrary(manifest));
  assert.deepEqual(palette.cricketLayers.map(({ id, depth }) => ({ id, depth })), [{ id: 'near', depth: 0 }, { id: 'mid', depth: .5 }, { id: 'far', depth: 1 }]);
  assert.equal(palette.variations.crickets.length, 2);
  for (const cricketLayers of [['near', 'near'], ['near', 'missing'], ['near', 'https://example.com/a.mp3'], ['near']]) {
    assert.equal(ambianceSources(soundLibrary({ ...manifest, cricketLayers })).cricketLayers, undefined);
  }
  assert.equal(ambianceSources(soundLibrary({ assets: [...assets, asset('fire')], cricketLayers: ['near', 'fire'] })).cricketLayers, undefined);
});

test('Main quench and phone far-to-near cricket banks resolve only verified catalog IDs and keep Main audio and compact phone derivatives', () => {
  const mobile = id => ({ file: `audio-assets/v3/${id}-mobile.mp3`, sha256: 'b'.repeat(64), durationSeconds: 18 });
  const assets = ['far', 'mid', 'near'].map(id => ({ ...asset(id), kind: 'crickets', mobile: mobile(id) }));
  assets.push(...['quench-a', 'quench-b'].map(id => ({ ...asset(id), kind: 'phone-quench', durationSeconds: 2 })));
  const palette = ambianceSources(soundLibrary({ assets, phone: { quench: ['quench-a', 'quench-b'], cricketLayers: ['far', 'mid', 'near'] } }));
  assert.deepEqual(palette.mainQuench.map(entry => entry.id), ['quench-a', 'quench-b']);
  assert.deepEqual(palette.phoneCricketLayers.map(entry => [entry.id, entry.depth]), [['far', 1], ['mid', .5], ['near', 0]]);
  assert.ok(palette.phoneCricketLayers.every(entry => entry.url.includes('-mobile.mp3?v=bbbbbbbbbbbb')));
  const rejected = ambianceSources(soundLibrary({ assets, phone: { quench: ['https://outside/a.mp3', 'far'], cricketLayers: ['far', 'near', 'near'] } }));
  assert.deepEqual(rejected.mainQuench, []); assert.deepEqual(rejected.phoneCricketLayers, []);
});
