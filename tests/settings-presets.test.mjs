import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SharedRoom } from '../app/shared-room.mjs';
import { createPerformanceServer } from '../app/server.mjs';
import { validateSettingsPreset } from '../app/settings-presets.mjs';

const records = [{ longitude: 110.125, latitude: -2.125 }];
const clone = value => structuredClone(value);
const roomOptions = { records, snapshotVersion: 'fixture-snapshot', clock: () => 1000, wallClock: () => 10000 };
const customPreset = room => {
  const preset = room.exportSettingsPreset();
  preset.strength = .37;
  preset.parameters = { fireReturnSeconds: 7, rainResponseSeconds: 2.5, deepCoolingSeconds: 22, extinctionHoldSeconds: 3 };
  Object.assign(preset.sceneSettings, { wifiName: 'Rehearsal', wifiPassword: 'on-screen-password', programNotes: 'Local programme notes.', participationSeconds: 240, phoneFadeSeconds: 45 });
  Object.assign(preset.soundSettings, { automation: false, level: .42, localPitchIndex: 6 });
  preset.soundSettings.macros.haze = .6;
  preset.soundSettings.mixer.bells = .8;
  preset.soundSettings.phoneMixer = { overall: .8, crackle: .6, rain: 1.2, crickets: .7, birds: 1.5, drone: 1.8 };
  return preset;
};
const sceneClock = room => {
  const { settings, revision, ...clock } = room.scenes;
  return clone(clock);
};
const landscape = room => ({ simulation: room.simulation.serialize(), records: clone(room.records),
  snapshotVersion: room.snapshotVersion, epoch: room.epoch, bootstrapAvailable: room.bootstrapAvailable,
  connections: clone([...room.connections]), identities: clone([...room.participantNumbers]),
  actorRevision: room.actorRevision, lastAdvance: room.lastAdvance, scene: sceneClock(room) });
const withoutTiming = value => { const result = clone(value); delete result.simulation.parameters; return result; };

test('settings presets round-trip complete configuration without exporting or changing the running performance', async () => {
  const source = new SharedRoom(roomOptions), target = new SharedRoom(roomOptions);
  await target.bootstrap({});
  await target.setScene({ scene: 'participation' });
  await target.setScene({ action: 'pause' });
  target.connect({ clientId: 'fixture-participant' });
  const cell = target.simulation.cells.values().next().value;
  cell.heat = .45; cell.surfaceWetness = .3; cell.moisture = .2;
  target.simulation.totalWater = 123;
  target.scenes.elapsed = 12345;
  const before = landscape(target), preset = customPreset(source);
  assert.deepEqual(Object.keys(preset).sort(), ['format', 'schemaVersion', 'strength', 'parameters', 'sceneSettings', 'soundSettings'].sort());
  const imported = await target.importSettingsPreset(preset);
  assert.deepEqual(target.exportSettingsPreset(), preset);
  assert.deepEqual(withoutTiming(landscape(target)), withoutTiming(before));
  assert.equal(imported.scene.paused, true);
  assert.equal(imported.scene.id, 'participation');
  assert.equal(imported.scene.elapsedMs, 12345);
  assert.equal(imported.simulation.totalWater, 123);
  const exported = target.exportSettingsPreset();
  exported.soundSettings.mixer.bells = 2;
  exported.soundSettings.phoneMixer.birds = 0;
  exported.sceneSettings.programNotes = 'Changed outside the room';
  assert.deepEqual(target.exportSettingsPreset(), preset, 'Exported objects cannot mutate room settings.');
});

test('invalid preset values and unknown or incomplete nested settings are rejected atomically', async () => {
  const room = new SharedRoom(roomOptions);
  await room.bootstrap({});
  const valid = customPreset(room), beforePreset = room.exportSettingsPreset(), beforeLandscape = landscape(room);
  const mutations = [
    value => { value.schemaVersion = 2; },
    value => { value.format = 'performance-save'; },
    value => { value.scene = 'final-rain'; },
    value => { value.strength = 1.1; },
    value => { value.parameters.fireReturnSeconds = 0; },
    value => { value.parameters.hidden = 1; },
    value => { delete value.parameters.rainResponseSeconds; },
    value => { value.sceneSettings.programNotes = null; },
    value => { value.sceneSettings.arrivalSeconds = Infinity; },
    value => { value.sceneSettings.paused = false; },
    value => { delete value.sceneSettings.wifiName; },
    value => { value.soundSettings.level = -1; },
    value => { value.soundSettings.automation = undefined; },
    value => { value.soundSettings.localPitchIndex = 35; },
    value => { value.soundSettings.macros.haze = 1.1; },
    value => { value.soundSettings.macros.unknown = 0; },
    value => { delete value.soundSettings.macros.rain; },
    value => { value.soundSettings.mixer.bells = 2.1; },
    value => { value.soundSettings.mixer.unknown = 0; },
    value => { delete value.soundSettings.mixer.bells; },
    value => { value.soundSettings.phoneMixer = null; },
    value => { value.soundSettings.phoneMixer.drone = Infinity; },
    value => { value.soundSettings.phoneMixer.overall = -1; },
    value => { value.soundSettings.phoneMixer.birds = 2.1; },
    value => { value.soundSettings.phoneMixer.extra = 1; },
    value => { delete value.soundSettings.phoneMixer.crickets; },
    value => { value.soundSettings = null; },
  ];
  for (const mutate of mutations) {
    const invalid = clone(valid); mutate(invalid);
    assert.throws(() => validateSettingsPreset(invalid), { status: 400 });
    await assert.rejects(room.importSettingsPreset(invalid), { status: 400 });
    assert.deepEqual(room.exportSettingsPreset(), beforePreset);
    assert.deepEqual(landscape(room), beforeLandscape);
  }
});

test('presets exported before the phone mixer gain unity without changing their other controls or running progress', async () => {
  const source = new SharedRoom(roomOptions), target = new SharedRoom(roomOptions);
  await target.bootstrap({}); await target.setScene({ scene: 'participation' }); await target.setScene({ action: 'pause' });
  target.scenes.elapsed = 12345; target.simulation.totalWater = 123;
  const preset = customPreset(source), before = landscape(target);
  delete preset.soundSettings.phoneMixer;
  const expected = { ...preset, soundSettings: { ...preset.soundSettings,
    phoneMixer: { overall: 1, crackle: 1, rain: 1, crickets: 1, birds: 1, drone: 1 } } };
  assert.deepEqual(validateSettingsPreset(preset), expected);
  await target.importSettingsPreset(preset);
  assert.deepEqual(target.exportSettingsPreset(), expected);
  assert.deepEqual(withoutTiming(landscape(target)), withoutTiming(before));
  assert.equal(Object.hasOwn(preset.soundSettings, 'phoneMixer'), false, 'Migration must not edit the original exported file.');
});

test('settings imports persist before and after bootstrap and restart in paused Arrival', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wildfire-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const started of [false, true]) {
    const persistencePath = path.join(directory, started ? 'started.json' : 'before-start.json');
    const room = new SharedRoom({ ...roomOptions, persistencePath });
    if (started) { await room.bootstrap({}); await room.setScene({ scene: 'participation' }); }
    const preset = customPreset(room);
    await room.importSettingsPreset(preset);
    const restored = await new SharedRoom({ ...roomOptions, persistencePath }).initialize();
    assert.deepEqual(restored.exportSettingsPreset(), preset);
    assert.equal(restored.bootstrapAvailable, !started);
    assert.equal(restored.sceneState().id, 'arrival');
    assert.equal(restored.sceneState().paused, true);
    assert.equal(restored.sceneState().elapsedMs, 0);
  }
});

test('a failed persistence write leaves every imported setting unapplied', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wildfire-settings-failed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const blockingFile = path.join(directory, 'file'); await writeFile(blockingFile, 'not a directory');
  const room = new SharedRoom({ ...roomOptions, persistencePath: path.join(blockingFile, 'state.json') });
  const before = room.exportSettingsPreset(), beforeLandscape = landscape(room);
  await assert.rejects(room.importSettingsPreset(customPreset(room)));
  assert.deepEqual(room.exportSettingsPreset(), before);
  assert.deepEqual(landscape(room), beforeLandscape);
  assert.equal(room.settingsImportInProgress, false);
  // Ordinary pre-show edits now persist too. Repair the simulated storage
  // failure before checking that the failed import released its edit lock.
  await rm(blockingFile);
  await room.setStrength(.25);
  assert.equal(room.strength, .25, 'A failed pre-show import releases ordinary configuration edits.');
  const restored = await new SharedRoom({ ...roomOptions, persistencePath: room.persistencePath }).initialize();
  assert.deepEqual(restored.exportSettingsPreset(), { ...before, strength: .25 });
  assert.equal(restored.bootstrapAvailable, true);
});

test('a pending import rejects concurrent configuration edits, reset, bootstrap and another import', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wildfire-settings-concurrent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const started of [false, true]) {
    const persistencePath = path.join(directory, started ? 'started.json' : 'before-start.json');
    const room = new SharedRoom({ ...roomOptions, persistencePath });
    if (started) await room.bootstrap({});
    const before = room.exportSettingsPreset(), beforeLandscape = landscape(room), preset = customPreset(room);
    let release;
    room.writeChain = new Promise(resolve => { release = resolve; });
    const importing = room.importSettingsPreset(preset);
    const queuedSave = room.persist();
    assert.equal(room.settingsImportInProgress, true);
    try {
      for (const mutate of [
        () => room.setSoundSettings({ level: .81 }),
        () => room.setStrength(.81),
        () => room.setParameters({ fireReturnSeconds: 11 }),
        () => room.setScene({ settings: { wifiName: 'Second tab' } }),
        () => room.setScene({ scene: 'instructions' }),
        () => room.reset(),
        () => room.bootstrap({ strength: .81 }),
        () => room.importSettingsPreset({ ...preset, strength: .81 }),
      ]) await assert.rejects(mutate(), error => error.status === 409 && /import.*saved/.test(error.message));
      assert.deepEqual(room.exportSettingsPreset(), before);
      assert.deepEqual(landscape(room), beforeLandscape);
    } finally { release(); }
    await Promise.all([importing, queuedSave]);
    assert.equal(room.settingsImportInProgress, false);
    assert.deepEqual(room.exportSettingsPreset(), preset);
    assert.deepEqual((await new SharedRoom({ ...roomOptions, persistencePath }).initialize()).exportSettingsPreset(), preset,
      'An ordinary save queued during import retains the imported settings.');
    await room.setSoundSettings({ level: .81 });
    assert.equal(room.soundSettings.level, .81, 'The operator can retry a conflicting edit after import completes.');
    assert.equal((await new SharedRoom({ ...roomOptions, persistencePath }).initialize()).soundSettings.level, .81);
  }
});

test('an import cannot race a bootstrap that is already waiting for persistence', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wildfire-settings-bootstrap-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const room = new SharedRoom({ ...roomOptions, persistencePath: path.join(directory, 'state.json') });
  let release;
  room.writeChain = new Promise(resolve => { release = resolve; });
  const starting = room.bootstrap({ strength: .25 });
  try {
    await assert.rejects(room.importSettingsPreset(customPreset(room)), error => error.status === 409 && /initialized/.test(error.message));
    assert.equal(room.settingsImportInProgress, false);
  } finally { release(); }
  await starting;
  assert.equal(room.strength, .25);
  await room.importSettingsPreset(customPreset(room));
  assert.equal(room.strength, .37);
});

function fakeRequest(instance, remoteAddress, url, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise(resolve => {
    let status;
    instance.server.emit('request', { method, url, headers, socket: { remoteAddress },
      async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body); } }, {
      setHeader() {}, writeHead(code) { status = code; },
      end(value) { resolve({ status, body: JSON.parse(value) }); },
    });
  });
}

test('HTTP preset routes enforce operator, page-role and origin guards and validate before import', async t => {
  const instance = await createPerformanceServer({ ...roomOptions, port: 0, persistencePath: null, autoTick: false });
  t.after(() => instance.close());
  const exported = await fakeRequest(instance, '127.0.0.1', '/api/settings/export');
  assert.equal(exported.status, 200);
  const preset = customPreset(instance.room);
  const post = { method: 'POST', headers: { 'content-type': 'application/json', host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' }, body: JSON.stringify(preset) };
  for (const route of ['export', 'import']) {
    const options = route === 'import' ? post : { headers: post.headers };
    const request = (remote, headers) => fakeRequest(instance, remote, `/api/settings/${route}`, { ...options, headers: { ...options.headers, ...headers } });
    assert.equal((await request('192.168.255.254')).status, 403);
    assert.equal((await request('127.0.0.1', { origin: 'https://another-site.invalid' })).status, 403);
    for (const role of ['projection', 'participant']) assert.equal((await request('127.0.0.1', { 'x-wildfire-role': role })).status, 403);
    for (const page of ['projection', 'study', 'audience']) assert.equal((await request('127.0.0.1', { referer: `http://127.0.0.1:4173/${page}` })).status, 403);
  }
  assert.deepEqual(instance.room.exportSettingsPreset(), exported.body);
  const invalid = clone(preset); invalid.soundSettings.mixer.extra = 1;
  assert.equal((await fakeRequest(instance, '127.0.0.1', '/api/settings/import', { ...post, body: JSON.stringify(invalid) })).status, 400);
  assert.deepEqual(instance.room.exportSettingsPreset(), exported.body);
  const imported = await fakeRequest(instance, '127.0.0.1', '/api/settings/import', post);
  assert.equal(imported.status, 200);
  assert.equal(imported.body.strength, preset.strength);
  assert.equal(imported.body.scene.paused, true);
  assert.deepEqual((await fakeRequest(instance, '127.0.0.1', '/api/settings/export')).body, preset);
  assert.equal((await fakeRequest(instance, '127.0.0.1', '/api/settings/import')).status, 405);
  assert.equal((await fakeRequest(instance, '127.0.0.1', '/api/settings/export', post)).status, 405);
  assert.equal((await fakeRequest(instance, '127.0.0.1', '/api/settings/import', { method: 'POST', body: post.body })).status, 415);
});
