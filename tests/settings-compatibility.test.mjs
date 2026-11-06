import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SharedRoom } from '../app/shared-room.mjs';
import { RainSimulation } from '../app/simulation.js';
import { validateSettingsPreset } from '../app/settings-presets.mjs';

// Pin the complete 1.0.3 export shape and its .50 / 60-second defaults rather
// than deriving the legacy shape from the current release's defaults. These
// are synthetic fixtures and contain no private exported Wi-Fi information.
const version103Preset = () => ({
  format: 'wildfire-settings', schemaVersion: 1, strength: .5,
  parameters: { fireReturnSeconds: 4, rainResponseSeconds: 1.5, deepCoolingSeconds: 10, extinctionHoldSeconds: 4 },
  sceneSettings: {
    wifiName: '', wifiPassword: '', programNotes: 'A saved 1.0.3 programme.',
    arrivalSeconds: 60, instructionsSeconds: 60, participationSeconds: 600,
    forestTakeoverSeconds: 60, soundTransitionSeconds: 12, forestRiseSeconds: 30,
    finalRainRiseSeconds: 60, residueMorphSeconds: 8, residueFadeSeconds: 20,
    projectionFadeSeconds: 30, rainCricketOverlapSeconds: 30, paCricketOnlySeconds: 12,
    cricketHandoffSeconds: 12, phoneOnlySeconds: 15, phoneFadeSeconds: 60,
  },
  soundSettings: {
    automation: true, level: .55, localPitchIndex: null,
    macros: { haze: .35, forest: .5, ash: .25, rain: .15, moisture: .2 },
    mixer: { haze: 1, forest: 1, ash: 1, rain: 1, moisture: 1, crickets: 1,
      chimes: 1, outDrone: 1, lowDrone: 1, bells: 1.6, quench: 1, blob: 1, dragAsh: 1 },
  },
});
const customVersion103Preset = () => {
  const preset = version103Preset();
  preset.strength = .28;
  Object.assign(preset.parameters, { fireReturnSeconds: 13, rainResponseSeconds: 3.5, deepCoolingSeconds: 31, extinctionHoldSeconds: 7 });
  Object.assign(preset.sceneSettings, { wifiName: 'Fixture Wi-Fi', wifiPassword: 'fixture-only', programNotes: 'Programme\nSecond paragraph — retained.', finalRainRiseSeconds: 143, participationSeconds: 713, phoneOnlySeconds: 0 });
  Object.assign(preset.soundSettings, { automation: false, level: .32, localPitchIndex: 34 });
  Object.assign(preset.soundSettings.macros, { haze: 0, rain: .85, moisture: 1 });
  Object.assign(preset.soundSettings.mixer, { haze: 0, forest: .42, bells: 2, crickets: .73, dragAsh: .16 });
  return preset;
};
const migratedPreset = preset => {
  const migrated = structuredClone(preset);
  Object.assign(migrated.soundSettings.mixer, { orangutan: 1, orangutanTail: 1 });
  migrated.soundSettings.phoneMixer = { overall: 1, crackle: 1, rain: 1, crickets: 1, birds: 1, drone: 1 };
  return migrated;
};
const records = [{ longitude: 101.125, latitude: -1.125 }];
const options = { records, snapshotVersion: 'compatibility-fixture', clock: () => 1000, wallClock: () => 10000, persistencePath: null };

test('complete 1.0.3 presets gain new wildlife and phone mixer defaults while retaining old choices', async () => {
  for (const preset of [version103Preset(), customVersion103Preset()]) {
    const before = structuredClone(preset), expected = migratedPreset(preset);
    assert.deepEqual(validateSettingsPreset(preset), expected);
    assert.deepEqual(preset, before, 'Validation does not rewrite the old settings file.');
    const target = new SharedRoom(options);
    await target.setSoundSettings({ mixer: { orangutan: .2, orangutanTail: 1.8 }, phoneMixer: { overall: .1, birds: 2, drone: 0 }, level: .9 });
    await target.importSettingsPreset(preset);
    assert.deepEqual(target.exportSettingsPreset(), expected,
      'New wildlife and phone channels get release defaults, not unrelated destination settings.');
    assert.equal(target.bootstrapAvailable, true);
    assert.equal(target.sceneState().id, 'arrival');
    assert.equal(target.sceneState().paused, true);
    assert.equal(target.simulation.totalWater, 0);
  }
});

test('migrated 1.0.3 imports persist, re-export completely and work with first-use scene 4 or 5', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla-settings-103-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [index, scene] of ['forest-takeover', 'final-rain'].entries()) {
    const preset = index ? customVersion103Preset() : version103Preset();
    const expected = migratedPreset(preset), persistencePath = path.join(directory, `${scene}.json`);
    const room = new SharedRoom({ ...options, persistencePath });
    await room.importSettingsPreset(preset);
    let restored = await new SharedRoom({ ...options, persistencePath }).initialize();
    assert.equal(restored.bootstrapAvailable, true);
    assert.deepEqual(restored.exportSettingsPreset(), expected);
    await restored.setScene({ scene });
    assert.equal(restored.sceneState().id, scene);
    assert.deepEqual(restored.exportSettingsPreset(), expected);
    restored = await new SharedRoom({ ...options, persistencePath }).initialize();
    assert.equal(restored.bootstrapAvailable, false);
    assert.equal(restored.sceneState().id, 'arrival');
    assert.equal(restored.sceneState().paused, true);
    assert.deepEqual(restored.exportSettingsPreset(), expected);
  }
});

test('full and settings-only 1.0.3 saves restore existing settings with wildlife and phone defaults', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla-settings-103-save-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const preset = customVersion103Preset(), expected = migratedPreset(preset);
  const simulation = new RainSimulation(preset.parameters).seed(records);
  simulation.cells.values().next().value.moisture = .36;
  simulation.cells.values().next().value.heat = .42;
  simulation.totalWater = 23;
  for (const settingsOnly of [true, false]) {
    const persistencePath = path.join(directory, settingsOnly ? 'settings.json' : 'performance.json');
    const envelope = { schemaVersion: 1, strength: preset.strength,
      sceneSettings: preset.sceneSettings, soundSettings: preset.soundSettings,
      ...(settingsOnly ? { settingsOnly: true, parameters: preset.parameters }
        : { savedAt: 10000, simulation: simulation.serialize(), identities: [['a'.repeat(64), 4, 'sumatra']] }) };
    const original = JSON.stringify(envelope);
    await writeFile(persistencePath, original);
    const room = await new SharedRoom({ ...options, persistencePath }).initialize();
    assert.deepEqual(room.exportSettingsPreset(), expected);
    assert.equal(room.bootstrapAvailable, settingsOnly);
    assert.equal(room.sceneState().id, 'arrival');
    assert.equal(room.sceneState().paused, true);
    if (!settingsOnly) {
      assert.equal(room.simulation.totalWater, 23);
      assert.equal(room.simulation.cells.values().next().value.moisture, .36);
      assert.equal(room.simulation.cells.values().next().value.heat, .42);
      assert.equal(room.participantNumbers.get('a'.repeat(64)), 4);
      assert.equal(room.connections.size, 0);
    }
    assert.equal(await readFile(persistencePath, 'utf8'), original, 'Startup migration does not rewrite the original save.');
  }
});

test('incomplete or malformed legacy mixers still reject atomically instead of receiving broad defaults', async () => {
  const room = new SharedRoom(options);
  await room.setScene({ scene: 'participation' });
  await room.setScene({ action: 'pause' });
  const before = { settings: room.exportSettingsPreset(), state: room.wireState() };
  for (const mutate of [
    preset => { delete preset.soundSettings.mixer.crickets; },
    preset => { delete preset.soundSettings.macros.haze; },
    preset => { delete preset.sceneSettings.programNotes; },
    preset => { preset.soundSettings.mixer.unknown = 1; },
    preset => { preset.soundSettings.mixer.orangutan = 1; },
    preset => { preset.soundSettings.mixer.orangutanTail = 1; },
    preset => { preset.soundSettings.mixer.bells = '1'; },
    preset => { preset.soundSettings.mixer.bells = 2.1; },
    preset => { preset.soundSettings.mixer = null; },
    preset => { preset.soundSettings.phoneMixer = { overall: 1 }; },
    preset => { preset.soundSettings.phoneMixer = { overall: 1, crackle: 1, rain: 1, crickets: 1, birds: '1', drone: 1 }; },
    preset => { preset.schemaVersion = 2; },
  ]) {
    const invalid = customVersion103Preset(); mutate(invalid);
    await assert.rejects(room.importSettingsPreset(invalid), { status: 400 });
    assert.deepEqual({ settings: room.exportSettingsPreset(), state: room.wireState() }, before);
  }
  const current = migratedPreset(customVersion103Preset());
  Object.assign(current.soundSettings.mixer, { orangutan: 0, orangutanTail: 2 });
  Object.assign(current.soundSettings.phoneMixer, { overall: 0, birds: 1.7, drone: 2 });
  await room.importSettingsPreset(current);
  assert.deepEqual(room.exportSettingsPreset(), current, 'Valid new wildlife trims also retain their exact values.');
});
