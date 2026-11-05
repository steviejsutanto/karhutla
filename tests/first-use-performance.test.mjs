import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SharedRoom } from '../app/shared-room.mjs';
import { RainSimulation } from '../app/simulation.js';

const records = [{ longitude: 101.125, latitude: -1.125 }, { longitude: 136.125, latitude: -3.125 }];
function freshRoom(options = {}) {
  const time = { now: 1000, wall: 100000 };
  const room = new SharedRoom({ records, snapshotVersion: 'cached-fixture', clock: () => time.now, wallClock: () => time.wall, persistencePath: null, ...options });
  return { room, time };
}
async function prepare(room) {
  const preset = room.exportSettingsPreset();
  preset.strength = .37;
  Object.assign(preset.parameters, { fireReturnSeconds: 9, deepCoolingSeconds: 22 });
  Object.assign(preset.sceneSettings, { wifiName: 'Prepared Wi-Fi', wifiPassword: 'Prepared password', programNotes: 'Prepared programme.', arrivalSeconds: 2, finalRainRiseSeconds: 30 });
  preset.soundSettings.level = .42;
  preset.soundSettings.mixer.bells = .71;
  preset.soundSettings.macros.haze = .63;
  await room.importSettingsPreset(preset);
  return preset;
}
function snapshot(room) {
  return { preset: room.exportSettingsPreset(), simulation: room.simulation.serialize(),
    scene: structuredClone({ ...room.scenes }), bootstrapAvailable: room.bootstrapAvailable,
    epoch: room.epoch, snapshotVersion: room.snapshotVersion, actorRevision: room.actorRevision };
}

test('first-use Start, scene cues 1–5, Restart and Reset initialize cached ground and retain prepared settings', async () => {
  const cases = [
    [{ action: 'resume' }, 'arrival', false],
    [{ action: 'restart' }, 'arrival', true],
    [{ scene: 'arrival' }, 'arrival', false],
    [{ scene: 'instructions' }, 'instructions', false],
    [{ scene: 'participation' }, 'participation', false],
    [{ scene: 'forest-takeover' }, 'forest-takeover', false],
    [{ scene: 'final-rain' }, 'final-rain', false],
    [null, 'arrival', true],
  ];
  for (const [command, id, paused] of cases) {
    const { room, time } = freshRoom();
    const preset = await prepare(room), oldEpoch = room.epoch;
    const audience = room.connect({ clientId: `first-${id}-${paused}`, scope: 'indonesia' });
    assert.equal(room.bootstrapAvailable, true);
    const result = command ? await room.setScene(command) : await room.reset();
    assert.equal(result.bootstrapAvailable, false, JSON.stringify(command));
    assert.equal(result.scene.id, id); assert.equal(result.scene.paused, paused);
    assert.equal(result.scene.elapsedMs, 0);
    assert.equal(result.snapshotVersion, 'cached-fixture');
    assert.equal(room.simulation.sourceRecords.length, records.length);
    assert.equal(room.simulation.totalWater, 0);
    assert.notEqual(room.epoch, oldEpoch);
    assert.equal(room.connections.get(audience.connectionId).number, audience.participantNumber);
    assert.deepEqual(room.exportSettingsPreset(), preset);
    if (command?.action === 'resume') {
      time.now += 2000; time.wall += 2000; room.advance();
      assert.equal(room.sceneState().id, 'instructions', 'Start uses the prepared opening duration.');
    }
    if (id === 'forest-takeover' || id === 'participation') {
      room.hold(audience.connectionId, { type: 'hold', epoch: room.epoch, seq: 0, holding: true, start: true, space: 'country', position: [.5, .5] });
      assert.equal(room.connections.get(audience.connectionId).holding, true);
    }
    if (id === 'final-rain') {
      time.now += 1000; time.wall += 1000; room.advance();
      assert.ok(room.simulation.totalWater > 0, 'Direct scene 5 initializes its real automatic rainfall.');
    }
  }
});

test('reads, preparation, pause and end preserve migration until a deliberate performance action', async () => {
  const { room } = freshRoom();
  await prepare(room);
  room.wireState(); room.sceneState(); room.soundSettingsState(); room.exportSettingsPreset();
  await room.setStrength(.4);
  await room.setParameters({ fireReturnSeconds: 11 });
  await room.setSoundSettings({ level: .6 });
  await room.setScene({ settings: { wifiName: 'Edited before starting' } });
  await room.setScene({ action: 'pause' });
  await room.setScene({ scene: 'ended' });
  await room.setScene({ action: 'finish' });
  assert.equal(room.bootstrapAvailable, true);
  const previous = new RainSimulation().seed(records);
  previous.cells.values().next().value.moisture = .7;
  previous.totalWater = 15;
  await room.bootstrap({ state: previous.serialize(), strength: .4 });
  assert.equal(room.bootstrapAvailable, false);
  assert.equal(room.simulation.totalWater, 15, 'Explicit old-browser restore remains available before first Start/cue.');
  assert.equal(room.soundSettings.level, .6);

  const fresh = freshRoom().room;
  await fresh.setScene({ scene: 'ended' });
  await fresh.setScene({ action: 'resume' });
  assert.equal(fresh.sceneState().id, 'arrival', 'First Start opens a fresh show even after a pre-show End click.');
  await assert.rejects(fresh.bootstrap({ state: previous.serialize() }), /already been initialized/);
});

test('invalid first cues validate before initialization or settings writes', async () => {
  const { room } = freshRoom();
  await prepare(room);
  const before = snapshot(room);
  let writes = 0;
  room._writeEnvelope = async () => { writes++; };
  for (const command of [
    null, [], { scene: 'unknown' }, { action: 'unknown' },
    { scene: 'forest-takeover', action: 'resume' },
    { scene: 'final-rain', extra: true },
    { scene: 'instructions', settings: { wifiName: null } },
    { action: 'resume', settings: { finalRainRiseSeconds: 0 } },
    { action: 'restart', settings: { unknown: 1 } },
    { scene: 'afterglow' },
  ]) {
    await assert.rejects(room.setScene(command));
    assert.deepEqual(snapshot(room), before, JSON.stringify(command));
    assert.equal(writes, 0);
  }
});

test('fresh cue initialization and cached settings survive a server restart', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla-first-use-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const scene of ['forest-takeover', 'final-rain']) {
    const persistencePath = path.join(directory, `${scene}.json`);
    const initial = freshRoom({ persistencePath }).room;
    const preset = await prepare(initial);
    const prepared = await freshRoom({ persistencePath }).room.initialize();
    assert.equal(prepared.bootstrapAvailable, true, 'A settings-only install remains uninitialized.');
    assert.deepEqual(prepared.exportSettingsPreset(), preset);
    await prepared.setScene({ scene });
    const restarted = await freshRoom({ persistencePath }).room.initialize();
    assert.equal(restarted.bootstrapAvailable, false);
    assert.deepEqual(restarted.exportSettingsPreset(), preset);
    assert.equal(restarted.sceneState().id, 'arrival');
    assert.equal(restarted.sceneState().paused, true, 'Opening a saved show still requires a deliberate Start.');
  }
});

test('initialization persistence failure changes neither landscape, cue nor prepared settings and allows retry', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla-first-use-failed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const blockingFile = path.join(directory, 'file');
  await writeFile(blockingFile, 'not a directory');
  const { room } = freshRoom();
  await prepare(room);
  room.persistencePath = path.join(blockingFile, 'state.json');
  const before = snapshot(room);
  for (const operation of [() => room.setScene({ scene: 'final-rain', settings: { finalRainRiseSeconds: 45 } }), () => room.reset()]) {
    await assert.rejects(operation());
    assert.deepEqual(snapshot(room), before);
    assert.equal(room.bootstrapping, false);
  }
  room.persistencePath = path.join(directory, 'working.json');
  await room.setScene({ scene: 'final-rain', settings: { finalRainRiseSeconds: 45 } });
  assert.equal(room.bootstrapAvailable, false);
  assert.equal(room.sceneState().settings.finalRainRiseSeconds, 45);
});

test('first-use initialization rejects concurrent edits and starts its clock only after the save commits', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla-first-use-concurrent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { room, time } = freshRoom();
  const preset = await prepare(room);
  room.persistencePath = path.join(directory, 'state.json');
  let release;
  room.writeChain = new Promise(resolve => { release = resolve; });
  const starting = room.setScene({ scene: 'forest-takeover' });
  try {
    assert.equal(room.bootstrapping, true);
    for (const operation of [
      () => room.setScene({ scene: 'final-rain' }),
      () => room.setScene({ action: 'restart' }),
      () => room.setScene({ settings: { wifiName: 'Other tab' } }),
      () => room.reset(), () => room.bootstrap(),
      () => room.setStrength(.8), () => room.setParameters({ fireReturnSeconds: 22 }),
      () => room.setSoundSettings({ level: .8 }), () => room.importSettingsPreset(preset),
    ]) await assert.rejects(operation(), error => error.status === 409 && /being initialized/.test(error.message));
    assert.throws(() => room.seed([], 'different-source'), error => error.status === 409);
    time.now += 90000; time.wall += 90000; room.advance();
    assert.equal(room.bootstrapAvailable, true);
    assert.deepEqual(room.exportSettingsPreset(), preset);
    assert.equal(room.simulation.totalWater, 0);
  } finally { release(); }
  const started = await starting;
  assert.equal(started.scene.id, 'forest-takeover');
  assert.equal(started.scene.elapsedMs, 0, 'Disk waiting time does not advance or skip the opening cue.');
  assert.deepEqual(room.exportSettingsPreset(), preset);
  await room.setSoundSettings({ level: .8 });
  assert.equal(room.soundSettings.level, .8, 'Conflicting edits may be retried after successful initialization.');
});

test('a pending settings import blocks automatic initialization until prepared settings commit', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla-first-use-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { room } = freshRoom({ persistencePath: path.join(directory, 'state.json') });
  const preset = room.exportSettingsPreset(); preset.soundSettings.level = .77;
  let release;
  room.writeChain = new Promise(resolve => { release = resolve; });
  const importing = room.importSettingsPreset(preset);
  try {
    await assert.rejects(room.setScene({ action: 'resume' }), error => error.status === 409 && /import/.test(error.message));
    await assert.rejects(room.reset(), error => error.status === 409 && /import/.test(error.message));
    assert.equal(room.bootstrapAvailable, true);
  } finally { release(); }
  await importing;
  await room.setScene({ action: 'resume' });
  assert.deepEqual(room.exportSettingsPreset(), preset);
});
