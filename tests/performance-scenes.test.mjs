import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SharedRoom } from '../app/shared-room.mjs';
import { RainSimulation, CELL_SIZE } from '../app/simulation.js';
import { PerformanceScenes, DEFAULT_SCENE_SETTINGS, DEFAULT_SOUND_SETTINGS, soundSettingsPatch, sceneSettingsPatch, restoreSceneSettings, FINAL_RAIN_RAMP_MS, FINAL_RAIN_RELEASE_MS, finalRainIntegral } from '../app/performance-scenes.mjs';
import { computeSceneScore, DEFAULT_SCORE_SETTINGS, SCENE_DURATION_LIMITS, audienceRainStrength } from '../app/scene-score.js';

const records = [{ longitude: 101.125, latitude: -1.125 }, { longitude: 136.125, latitude: -3.125 }];
const key = record => `${Math.floor(record.longitude / CELL_SIZE)},${Math.floor(record.latitude / CELL_SIZE)}`;
async function fixture(options = {}) {
  const time = { now: 0, wall: 100_000 };
  const room = new SharedRoom({ records, clock: () => time.now, wallClock: () => time.wall, persistencePath: null, ...options });
  await room.bootstrap();
  const advance = milliseconds => { time.now += milliseconds; time.wall += milliseconds; room.advance(); };
  return { room, time, advance };
}
const hold = (room, welcome, seq = 0) => room.hold(welcome.connectionId, { type: 'hold', epoch: room.epoch, seq, holding: true, start: true, space: 'country', position: [.5, .5] });

test('only entry from the opening cues can reveal QR during participation, including authoritative late joins', async () => {
  const { room, advance } = await fixture();
  await room.setScene({ scene: 'participation' });
  assert.equal(room.sceneState().participationOpening, true);
  advance(6000); assert.equal(room.wireState().scene.participationOpening, true);
  await room.setScene({ scene: 'forest-takeover' }); await room.setScene({ scene: 'participation' });
  assert.equal(room.sceneState().participationOpening, false);
  assert.equal(room.wireState().scene.participationOpening, false, 'A refreshed or newly joined display receives the same return semantics.');
  advance(6000); assert.equal(room.sceneState().participationOpening, false);
  await room.setScene({ scene: 'participation' }); assert.equal(room.sceneState().participationOpening, false);
  await room.setScene({ scene: 'instructions' }); await room.setScene({ scene: 'participation' });
  assert.equal(room.sceneState().participationOpening, true);
  await room.setScene({ action: 'restart' }); await room.setScene({ action: 'resume' }); advance(120000);
  assert.equal(room.sceneState().id, 'participation'); assert.equal(room.sceneState().participationOpening, true);
});

test('show starts in paused Arrival and rain is gated by the participation cues', async () => {
  const { room, advance } = await fixture();
  const phone = room.connect({ clientId: 'show-phone', scope: 'indonesia' });
  assert.equal(room.sceneState().id, 'arrival'); assert.equal(room.sceneState().paused, true);
  assert.equal(room.sceneState().cue, 1); assert.equal(room.sceneState().mix.mainHaze, 1);
  assert.throws(() => hold(room, phone), /Participation/);
  await room.setScene({ scene: 'instructions' });
  assert.equal(room.sceneState().cue, 2); assert.equal(room.sceneState().phoneGain, 0);
  assert.throws(() => hold(room, phone), /Participation/);
  await room.setScene({ scene: 'participation' });
  hold(room, phone); advance(200);
  const water = room.simulation.totalWater, elapsed = room.sceneState().elapsedMs;
  await room.setScene({ action: 'pause' });
  assert.equal(room.wireState().activeCount, 0);
  assert.throws(() => hold(room, phone, 1), /Participation/);
  const ground = room.simulation.serialize(); advance(10_000);
  assert.deepEqual(room.simulation.serialize(), ground);
  assert.equal(room.sceneState().elapsedMs, elapsed);
  await room.setScene({ action: 'resume' }); advance(1000);
  assert.equal(room.simulation.totalWater, water, 'Resuming never restores an old gesture.');
  await room.setScene({ scene: 'ended' });
  assert.throws(() => hold(room, phone, 2), /Participation/);
});

test('global rain uses current source cell physics and additive measured water', () => {
  const a = new RainSimulation().seed(records), b = new RainSimulation().seed(records);
  const keys = new Set(records.map(key));
  a.stepGlobalRain(5, keys); for (let i = 0; i < 100; i++) b.stepGlobalRain(.05, keys);
  assert.ok(Math.abs(a.totalWater - 10) < 1e-8);
  for (const source of records) {
    const cell = a.cells.get(key(source)), comparison = b.cells.get(key(source));
    assert.ok(cell.moisture > .9 && cell.surfaceWetness > .5);
    assert.ok(cell.heat > 0 && cell.heat < 1 && !cell.extinguished, 'Heavy rain still needs real cooling and settlement.');
    for (const field of ['heat', 'moisture', 'surfaceWetness', 'settledFor']) assert.ok(Math.abs(cell[field] - comparison[field]) < 1e-8);
  }
});

test('finale cools every source before main blackout, a phone-only hold, and the final phone retreat', async () => {
  const { room, advance } = await fixture();
  const phone = room.connect({ clientId: 'finale-phone', scope: 'indonesia' });
  await room.setScene({ scene: 'final-rain' });
  assert.equal(room.sceneState().globalRain, true);
  await assert.rejects(room.setScene({ scene: 'afterglow' }), /every source fire/);
  advance(1000);
  assert.equal(room.sceneState().id, 'final-rain');
  assert.equal(room.globalSound().fireProgress.outCount, 0);
  assert.ok([...room.simulation.cells.values()].every(cell => cell.moisture > 0 && cell.moisture < .02 && cell.heat > .99), 'Rain begins gently rather than instantly soaking every source.');
  for (let i = 0; i < 2000 && room.sceneState().id === 'final-rain'; i++) advance(50);
  const scene = room.sceneState();
  assert.equal(scene.id, 'afterglow'); assert.equal(scene.fade, 1); assert.equal(scene.globalRain, false);
  assert.equal(room.globalSound().fireProgress.outCount, 2);
  for (const cell of room.simulation.cells.values()) assert.ok(cell.extinguished && cell.heat === 0 && cell.settledFor >= room.simulation.parameters.extinctionHoldSeconds);
  assert.deepEqual(room.wireState().soundCondition, room.phoneState(phone.connectionId).soundCondition);
  advance(15_000); assert.equal(room.sceneState().fade, .5);
  await room.setScene({ action: 'pause' }); advance(90_000); assert.equal(room.sceneState().fade, .5);
  assert.equal(room.sceneState().phoneGain, 1);
  await room.setScene({ action: 'resume' }); advance(15_000);
  assert.equal(room.sceneState().phase, 'pa-crickets');
  assert.equal(room.sceneState().fade, 0); assert.equal(room.sceneState().mainGain, 1);
  assert.equal(room.sceneState().mainFieldGain, 0); assert.equal(room.sceneState().rainIntensity, 0);
  assert.equal(room.sceneState().mix.phoneCrickets, 0);
  advance(4000); assert.equal(room.sceneState().mix.mainCrickets, 1);
  advance(8000); assert.equal(room.sceneState().phase, 'cricket-handoff');
  advance(12000); assert.equal(room.sceneState().phase, 'phone-only');
  assert.equal(room.sceneState().mainGain, 0); assert.equal(room.sceneState().mix.phoneCrickets, 1);
  assert.equal(room.sceneState().phoneVisualGain, 0); assert.equal(room.sceneState().phoneGain, 1);
  advance(14_999); assert.equal(room.sceneState().phase, 'phone-only');
  advance(1); assert.equal(room.sceneState().phase, 'phone-fade'); assert.equal(room.sceneState().phoneGain, 1);
  advance(59_999); assert.equal(room.sceneState().id, 'afterglow');
  advance(1); assert.equal(room.sceneState().id, 'ended'); assert.equal(room.sceneState().fade, 0);
  assert.equal(room.sceneState().phoneGain, 0);
});

test('scene rain completes its rise then recedes through the rain/cricket overlap after an early all-out', () => {
  const scene = new PerformanceScenes({ now: 0, wallNow: 100_000 });
  scene.update({ scene: 'final-rain' }, { now: 0, wallNow: 100_000 });
  const samples = Array.from({ length: 61 }, (_, i) => scene.state(i * FINAL_RAIN_RAMP_MS / 60, 100_000 + i * FINAL_RAIN_RAMP_MS / 60).rainIntensity);
  assert.equal(samples[0], 0); assert.equal(samples[30], .5); assert.equal(samples.at(-1), 1);
  assert.ok(samples.every((value, index) => !index || value > samples[index - 1]));
  assert.ok(samples[1] < .00005 && 1 - samples.at(-2) < .00005, 'Both ends of the ramp ease in very gently.');
  scene.advance({ now: FINAL_RAIN_RAMP_MS / 2, wallNow: 130_000, sourceCount: 2, outCount: 2 });
  const middle = scene.state(FINAL_RAIN_RAMP_MS / 2, 130_000);
  assert.equal(middle.id, 'final-rain');
  assert.equal(middle.rainIntensity, .5, 'All-out cannot interrupt the rising handoff.');
  assert.equal(middle.rainIntensity, middle.finalRainProgress, 'Water, visual intensity and the sound score use one progress value.');
  assert.throws(() => scene.update({ scene: 'afterglow' }, { now: FINAL_RAIN_RAMP_MS / 2, wallNow: 130_000, sourceCount: 2, outCount: 2 }), /fully risen/);
  scene.advance({ now: FINAL_RAIN_RAMP_MS, wallNow: 160_000, sourceCount: 2, outCount: 2 });
  assert.equal(scene.state(FINAL_RAIN_RAMP_MS, 160_000).id, 'afterglow');
  assert.equal(scene.state(FINAL_RAIN_RAMP_MS, 160_000).rainIntensity, 1);
  assert.ok(Math.abs(scene.state(FINAL_RAIN_RAMP_MS + FINAL_RAIN_RELEASE_MS / 2, 161_000).rainIntensity - Math.SQRT1_2) < 1e-12);
  assert.equal(scene.state(FINAL_RAIN_RAMP_MS + FINAL_RAIN_RELEASE_MS, 162_000).rainIntensity, 0);
});

test('rain follows editable cricket overlap timing independently of the projection fade', () => {
  for (const rainCricketOverlapSeconds of [10, 30, 180]) {
    const projectionFadeSeconds = 30;
    const scene = new PerformanceScenes({ now: 0, wallNow: 0, settings: { rainCricketOverlapSeconds, projectionFadeSeconds } });
    scene.update({ scene: 'final-rain' }, { now: 0, wallNow: 0 });
    scene.advance({ now: FINAL_RAIN_RAMP_MS, wallNow: FINAL_RAIN_RAMP_MS, sourceCount: 2, outCount: 2 });
    assert.equal(scene.state(FINAL_RAIN_RAMP_MS, FINAL_RAIN_RAMP_MS).rainIntensity, 1);
    const early = scene.state(FINAL_RAIN_RAMP_MS + 2000, FINAL_RAIN_RAMP_MS + 2000);
    assert.ok(early.rainIntensity > .9, 'Heavy rain cannot disappear two seconds into the handoff.');
    assert.equal(early.rainIntensity, early.mainFieldGain);
    const middleTime = FINAL_RAIN_RAMP_MS + rainCricketOverlapSeconds * 500, middle = scene.state(middleTime, middleTime);
    assert.ok(Math.abs(middle.rainIntensity - Math.SQRT1_2) < 1e-12);
    assert.ok(Math.abs(middle.mix.mainCrickets - Math.SQRT1_2) < 1e-12);
    const endTime = FINAL_RAIN_RAMP_MS + rainCricketOverlapSeconds * 1000;
    assert.equal(scene.state(endTime, endTime).rainIntensity, 0);
    const blackoutTime = FINAL_RAIN_RAMP_MS + projectionFadeSeconds * 1000;
    assert.equal(scene.state(blackoutTime, blackoutTime).fade, 0);
    const holdTime = Math.max(endTime, blackoutTime), hold = scene.state(holdTime, holdTime);
    assert.equal(hold.phase, 'pa-crickets'); assert.equal(hold.phaseElapsedMs, 0);
    assert.equal(hold.mix.mainCrickets, 1); assert.equal(hold.mix.phoneCrickets, 0);
  }
});

test('fast participation physics cannot finish finale cooling before the rain rise, including a delayed tick', async () => {
  const sparse = await fixture(), frequent = await fixture();
  for (const { room } of [sparse, frequent]) {
    await room.setParameters({ deepCoolingSeconds: 2, extinctionHoldSeconds: 0 });
    await room.setScene({ scene: 'final-rain' });
  }
  frequent.advance(FINAL_RAIN_RAMP_MS - 1);
  assert.equal(frequent.room.globalSound().fireProgress.outCount, 0);
  assert.equal(frequent.room.sceneState().id, 'final-rain');
  frequent.advance(1);
  assert.equal(frequent.room.sceneState().id, 'afterglow');
  assert.equal(frequent.room.globalSound().fireProgress.outCount, 2);
  assert.equal(frequent.room.sceneState().elapsedMs, 0);
  sparse.advance(FINAL_RAIN_RAMP_MS + 4000); frequent.advance(4000);
  assert.deepEqual(sparse.room.sceneState(), frequent.room.sceneState());
  assert.ok(Math.abs(sparse.room.simulation.totalWater - frequent.room.simulation.totalWater) < 1e-8);
});

test('pausing early rain freezes its envelope and water, then resumes from the same scene time', async () => {
  const { room, advance } = await fixture();
  await room.setScene({ scene: 'final-rain' }); advance(FINAL_RAIN_RAMP_MS / 4);
  const intensity = room.sceneState().rainIntensity, water = room.simulation.totalWater;
  assert.ok(intensity > 0 && intensity < .2);
  await room.setScene({ action: 'pause' });
  const ground = room.simulation.serialize();
  advance(90_000);
  assert.equal(room.sceneState().rainIntensity, intensity);
  assert.equal(room.simulation.totalWater, water); assert.deepEqual(room.simulation.serialize(), ground);
  await room.setScene({ action: 'resume' }); advance(FINAL_RAIN_RAMP_MS / 4);
  assert.equal(room.sceneState().rainIntensity, .5);
  assert.ok(Math.abs(room.simulation.totalWater - records.length * finalRainIntegral(FINAL_RAIN_RAMP_MS / 2) / 1000) < 1e-8);
  await room.reset(); advance(10_000);
  assert.equal(room.sceneState().rainIntensity, 0); assert.equal(room.simulation.totalWater, 0);
});

test('changing state-poll cadence preserves the finale elapsed-time rain budget and cooling', async () => {
  const sparse = await fixture(), frequent = await fixture();
  for (const { room } of [sparse, frequent]) {
    await room.setParameters({ deepCoolingSeconds: 240 });
    await room.setScene({ scene: 'final-rain' });
  }
  sparse.advance(FINAL_RAIN_RAMP_MS);
  for (let index = 0; index < FINAL_RAIN_RAMP_MS / 50; index++) {
    frequent.advance(50);
    frequent.room.wireState(); frequent.room.sceneState();
  }
  const expected = records.length * FINAL_RAIN_RAMP_MS / 2000;
  for (const { room } of [sparse, frequent]) assert.ok(Math.abs(room.simulation.totalWater - expected) < 1e-8);
  for (const source of records) {
    const a = sparse.room.simulation.cells.get(key(source)), b = frequent.room.simulation.cells.get(key(source));
    for (const field of ['heat', 'moisture', 'surfaceWetness']) assert.ok(Math.abs(a[field] - b[field]) < .0001, `${field} should not depend on polling.`);
  }
});

test('a live final-rain timing edit changes only future rainfall and remains independent of polling cadence', async () => {
  const sparse = await fixture(), frequent = await fixture();
  for (const { room, advance } of [sparse, frequent]) {
    await room.setParameters({ deepCoolingSeconds: 240 });
    await room.setScene({ scene: 'final-rain' }); advance(12000);
    const water = room.simulation.totalWater;
    await room.setScene({ settings: { finalRainRiseSeconds: 120 } });
    assert.equal(room.simulation.totalWater, water, 'A duration edit cannot manufacture past water.');
    assert.equal(room.sceneState().elapsedMs, 12000); assert.equal(room.sceneState().finalRainRampDurationMs, 120000);
    assert.equal(room.sceneState().rainIntensity, room.sceneState().finalRainProgress);
    await room.setScene({ action: 'pause' }); advance(20000);
    assert.equal(room.simulation.totalWater, water); assert.equal(room.sceneState().elapsedMs, 12000);
    await room.setScene({ action: 'resume' });
  }
  sparse.advance(18000);
  for (let frame = 0; frame < 360; frame++) frequent.advance(50);
  const expected = records.length * (finalRainIntegral(12000) + finalRainIntegral(30000, 120000) - finalRainIntegral(12000, 120000)) / 1000;
  for (const { room } of [sparse, frequent]) assert.ok(Math.abs(room.simulation.totalWater - expected) < 1e-8);
  assert.deepEqual(sparse.room.sceneState(), frequent.room.sceneState());
  for (const source of records) for (const field of ['heat', 'moisture', 'surfaceWetness']) assert.ok(Math.abs(sparse.room.simulation.sample(source.longitude, source.latitude)[field] - frequent.room.simulation.sample(source.longitude, source.latitude)[field]) < .0001);
});

test('empty snapshots finish the rain timeline without inventing extinguished fires', async () => {
  const { room, advance } = await fixture({ records: [] });
  await assert.rejects(room.setScene({ scene: 'afterglow' }), /every source fire/);
  await room.setScene({ scene: 'final-rain' }); advance(100_000);
  assert.equal(room.sceneState().id, 'afterglow');
  assert.deepEqual(room.globalSound().fireProgress, { sourceCount: 0, outCount: 0 });
  assert.equal(room.simulation.totalWater, 0);
  await room.setScene({ action: 'finish' }); assert.equal(room.sceneState().id, 'ended');
});

test('reset and refreshed source snapshots cancel finale without losing configured text or sound', async () => {
  const { room, advance } = await fixture();
  await room.setScene({ settings: { wifiName: 'Performance Wi-Fi', wifiPassword: 'local-only', programNotes: 'Listen together.' } });
  await room.setSoundSettings({ macros: { haze: .7 }, level: .3 });
  await room.setScene({ scene: 'final-rain' }); advance(1000);
  await room.reset();
  assert.equal(room.sceneState().id, 'arrival'); assert.equal(room.sceneState().paused, true);
  assert.equal(room.simulation.totalWater, 0); assert.equal(room.sceneState().settings.programNotes, 'Listen together.');
  assert.equal(room.soundSettingsState().macros.haze, .7);
  await room.setScene({ scene: 'final-rain' });
  room.seed([{ longitude: 112.125, latitude: -1.125 }], 'fresh');
  assert.equal(room.sceneState().id, 'arrival'); advance(1000);
  assert.equal(room.simulation.sample(112.125, -1.125).heat, 1);
});

test('settings persist before bootstrap and after a show without ever restoring scene progression', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wildfire-scenes-'));
  try {
    const options = { records, persistencePath: `${directory}/state.json`, clock: () => 0, wallClock: () => 100_000 };
    const before = new SharedRoom(options);
    await before.setScene({ settings: { wifiName: 'Room', wifiPassword: 'pass', programNotes: 'My program.', projectionFadeSeconds: 20, rainCricketOverlapSeconds: 20, phoneOnlySeconds: 5, phoneFadeSeconds: 40, soundTransitionSeconds: 8, forestRiseSeconds: 60, finalRainRiseSeconds: 90, residueMorphSeconds: 12, residueFadeSeconds: 40 } });
    await before.setSoundSettings({ automation: false, macros: { forest: .8 }, mixer: { haze: 0, crickets: 1.5, lowDrone: 2 }, localPitchIndex: 34 });
    const start = new SharedRoom(options); await start.initialize();
    assert.equal(start.bootstrapAvailable, true); assert.equal(start.sceneState().settings.programNotes, 'My program.');
    assert.equal(start.sceneState().afterglowDurationMs, 89_000);
    assert.equal(start.sceneState().settings.rainCricketOverlapSeconds, 20);
    assert.equal(start.sceneState().rainCricketOverlapDurationMs, 20000);
    assert.equal(start.sceneState().soundTransitionDurationMs, 8000);
    assert.equal(start.sceneState().settings.forestRiseSeconds, 60);
    assert.equal(start.sceneState().settings.finalRainRiseSeconds, 90); assert.equal(start.sceneState().finalRainRampDurationMs, 90000);
    assert.equal(start.sceneState().settings.residueMorphSeconds, 12);
    assert.equal(start.sceneState().settings.residueFadeSeconds, 40);
    assert.equal(start.soundSettingsState().automation, false);
    assert.deepEqual(start.soundSettingsState(), before.soundSettingsState());
    await start.bootstrap(); await start.setScene({ scene: 'final-rain' }); await start.persist();
    const restart = new SharedRoom(options); await restart.initialize();
    assert.equal(restart.bootstrapAvailable, false); assert.equal(restart.sceneState().id, 'arrival'); assert.equal(restart.sceneState().paused, true);
    assert.equal(restart.sceneState().settings.wifiName, 'Room'); assert.equal(restart.soundSettingsState().macros.forest, .8);
    assert.deepEqual(restart.soundSettingsState(), before.soundSettingsState());
    assert.equal(restart.sceneState().afterglowDurationMs, 89_000);
    assert.equal(restart.sceneState().settings.finalRainRiseSeconds, 90);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('sound and scene patches reject unknown, unbounded, or malformed controls atomically', () => {
  assert.throws(() => soundSettingsPatch(DEFAULT_SOUND_SETTINGS, { macros: { rain: 2 } }), /macros/);
  assert.throws(() => soundSettingsPatch(DEFAULT_SOUND_SETTINGS, { macros: { unknown: .5 } }), /macros/);
  for (const localPitchIndex of [-1, 35, .5, Infinity, NaN, '10']) assert.throws(() => soundSettingsPatch(DEFAULT_SOUND_SETTINGS, { localPitchIndex }), /pitch/);
  for (const localPitchIndex of [0, 9, 10, 34, null]) assert.equal(soundSettingsPatch(DEFAULT_SOUND_SETTINGS, { localPitchIndex }).localPitchIndex, localPitchIndex);
  const settings = soundSettingsPatch(DEFAULT_SOUND_SETTINGS, { macros: { haze: .9 } });
  assert.equal(settings.automation, false); assert.equal(DEFAULT_SOUND_SETTINGS.macros.haze, .35);
  const scenes = new PerformanceScenes({ now: 0, wallNow: 100_000 });
  assert.throws(() => scenes.update({ scene: 'bogus', settings: { programNotes: 'No mutation' } }, { now: 0, wallNow: 100_000 }), /Unknown/);
  assert.notEqual(scenes.settings.programNotes, 'No mutation');
  for (const [key, limits] of Object.entries(SCENE_DURATION_LIMITS)) {
    for (const value of [limits.min - .1, limits.max + .1, Infinity, NaN, '12', null]) {
      assert.throws(() => sceneSettingsPatch(DEFAULT_SCENE_SETTINGS, { [key]: value }), new RegExp(key));
    }
    for (const value of [limits.min, limits.max]) assert.equal(sceneSettingsPatch(DEFAULT_SCENE_SETTINGS, { [key]: value })[key], value);
  }
  assert.throws(() => scenes.update({ scene: 'instructions', settings: { phoneFadeSeconds: 999 } }, { now: 0, wallNow: 100_000 }), /phoneFadeSeconds/);
  assert.equal(scenes.id, 'arrival');
});

test('main mixer patches deep merge independent bounded levels while preserving sound automation', () => {
  const unity = { haze: 1, forest: 1, ash: 1, rain: 1, moisture: 1, crickets: 1, orangutan: 1, orangutanTail: 1, chimes: 1, outDrone: 1, lowDrone: 1, bells: 1.6, quench: 1, blob: 1, dragAsh: 1 };
  assert.deepEqual(DEFAULT_SOUND_SETTINGS.mixer, unity);
  const input = { haze: 0, lowDrone: 2 };
  const first = soundSettingsPatch(DEFAULT_SOUND_SETTINGS, { mixer: input });
  const second = soundSettingsPatch(first, { mixer: { rain: .75, crickets: 1.5 } });
  assert.equal(first.automation, true);
  assert.equal(second.automation, true);
  assert.deepEqual(first.mixer, { ...unity, haze: 0, lowDrone: 2 });
  assert.deepEqual(second.mixer, { ...unity, haze: 0, lowDrone: 2, rain: .75, crickets: 1.5 });
  assert.deepEqual(second.macros, DEFAULT_SOUND_SETTINGS.macros);
  input.haze = 2;
  second.mixer.haze = 1;
  assert.equal(first.mixer.haze, 0, 'A returned mixer does not alias input patches or prior settings.');
  assert.deepEqual(DEFAULT_SOUND_SETTINGS.mixer, unity);
  const manual = soundSettingsPatch(first, { macros: { forest: .75 } });
  assert.equal(manual.automation, false);
  assert.equal(soundSettingsPatch(manual, { mixer: { chimes: 0 } }).automation, false);
  assert.equal(soundSettingsPatch(manual, { mixer: { chimes: 0 }, automation: true }).automation, true);
  const { mixer, ...legacy } = manual;
  assert.deepEqual(soundSettingsPatch(legacy, {}).mixer, unity, 'Settings created before the mixer inherit unity.');
});

test('main mixer rejects invalid keys, shapes, and values before applying any sound setting', () => {
  for (const mixer of [null, [], 1, '1', { unknown: 1 }, { __proto__: { haze: 1 } }]) {
    assert.throws(() => soundSettingsPatch(DEFAULT_SOUND_SETTINGS, { mixer }), /mixer/);
  }
  for (const key of Object.keys(DEFAULT_SOUND_SETTINGS.mixer)) {
    for (const value of [-.01, 2.01, Infinity, -Infinity, NaN, '1', null, true, undefined, {}]) {
      assert.throws(() => soundSettingsPatch(DEFAULT_SOUND_SETTINGS, { automation: false, mixer: { [key]: value } }), /mixer/);
    }
    for (const value of [0, 2]) assert.equal(soundSettingsPatch(DEFAULT_SOUND_SETTINGS, { mixer: { [key]: value } }).mixer[key], value);
  }
  assert.throws(() => soundSettingsPatch(DEFAULT_SOUND_SETTINGS, { mainMixer: { haze: 1 } }), /Unknown/);
  assert.equal(DEFAULT_SOUND_SETTINGS.automation, true);
  assert.ok(Object.entries(DEFAULT_SOUND_SETTINGS.mixer).every(([key, value]) => value === (key === 'bells' ? 1.6 : 1)));
});

test('phone mixer patches preserve authored balance and deep-merge independently of Main and automation', () => {
  const unity = { overall: 1, crackle: 1, rain: 1, crickets: 1, birds: 1, drone: 1 };
  assert.deepEqual(DEFAULT_SOUND_SETTINGS.phoneMixer, unity);
  const input = { overall: .8, birds: 1.5, crackle: 0 };
  const first = soundSettingsPatch(DEFAULT_SOUND_SETTINGS, { phoneMixer: input });
  const second = soundSettingsPatch(first, { phoneMixer: { drone: 2, crickets: .7 } });
  assert.deepEqual(first.phoneMixer, { ...unity, overall: .8, birds: 1.5, crackle: 0 });
  assert.deepEqual(second.phoneMixer, { ...first.phoneMixer, drone: 2, crickets: .7 });
  assert.deepEqual(second.mixer, DEFAULT_SOUND_SETTINGS.mixer);
  assert.deepEqual(second.macros, DEFAULT_SOUND_SETTINGS.macros);
  assert.equal(second.level, DEFAULT_SOUND_SETTINGS.level);
  assert.equal(second.automation, true, 'A live phone balance must not disable automatic score shaping.');
  input.birds = 0; second.phoneMixer.birds = 0;
  assert.equal(first.phoneMixer.birds, 1.5, 'Incoming patches and returned settings cannot mutate previous balances.');
  assert.deepEqual(DEFAULT_SOUND_SETTINGS.phoneMixer, unity);
  const manual = soundSettingsPatch(first, { macros: { forest: .2 } });
  assert.equal(soundSettingsPatch(manual, { phoneMixer: { drone: .5 } }).automation, false);
  const { phoneMixer, ...legacy } = manual;
  const migrated = soundSettingsPatch(legacy, {});
  assert.deepEqual(migrated.phoneMixer, unity, 'Earlier saved sound settings retain the authored phone mix.');
  assert.deepEqual(migrated.mixer, manual.mixer);
});

test('phone mixer validation rejects malformed or unbounded controls before changing any setting', () => {
  for (const phoneMixer of [null, [], 1, '1', { voice: 1 }, { __proto__: { birds: 1 } }]) {
    assert.throws(() => soundSettingsPatch(DEFAULT_SOUND_SETTINGS, { automation: false, phoneMixer }), /phone.*mixer/i);
  }
  for (const key of ['overall', 'crackle', 'rain', 'crickets', 'birds', 'drone']) {
    for (const value of [-.01, 2.01, Infinity, -Infinity, NaN, '1', null, true, undefined, {}]) {
      assert.throws(() => soundSettingsPatch(DEFAULT_SOUND_SETTINGS, { phoneMixer: { [key]: value } }), /phone.*mixer/i);
    }
    for (const value of [0, 2]) assert.equal(soundSettingsPatch(DEFAULT_SOUND_SETTINGS, { phoneMixer: { [key]: value } }).phoneMixer[key], value);
  }
  assert.deepEqual(DEFAULT_SOUND_SETTINGS.phoneMixer, { overall: 1, crackle: 1, rain: 1, crickets: 1, birds: 1, drone: 1 });
});

test('instruction crossfade and participation transfer use one pauseable authority clock for every role', async () => {
  const { room, advance } = await fixture();
  const phone = room.connect({ clientId: 'score-phone', scope: 'indonesia' });
  await room.setScene({ scene: 'instructions' }); advance(6000);
  assert.equal(room.sceneState().mix.mainHaze, .5); assert.equal(room.sceneState().mix.mainForest, .5);
  await room.setScene({ action: 'pause' }); advance(80_000);
  assert.equal(room.sceneState().mix.mainHaze, .5);
  await room.setScene({ action: 'resume' }); advance(6000);
  assert.equal(room.sceneState().mix.mainHaze, 0); assert.equal(room.sceneState().mix.mainForest, 1);
  await room.setScene({ scene: 'participation' }); advance(6000);
  const scene = room.sceneState();
  assert.equal(scene.mix.mainForest, .5); assert.equal(scene.mix.mainDrone, 1);
  assert.equal(scene.mix.phoneField, .5); assert.equal(scene.mix.mainChimes, .5);
  assert.equal(scene.mix.mainCrickets, 0); assert.equal(scene.mix.phoneCrickets, .5);
  assert.deepEqual(room.phoneState(phone.connectionId).scene, room.wireState().scene);
  assert.deepEqual(computeSceneScore(scene), Object.fromEntries(Object.keys(computeSceneScore(scene)).map(key => [key, scene[key]])));
});

test('configured ending boundaries are exact and pause freezes the phone retreat as well as blackout', async () => {
  const { room, advance } = await fixture();
  await room.setScene({ settings: { projectionFadeSeconds: 2, rainCricketOverlapSeconds: 2, paCricketOnlySeconds: 1, cricketHandoffSeconds: 1, phoneOnlySeconds: 0, phoneFadeSeconds: 4 } });
  for (const cell of room.simulation.cells.values()) Object.assign(cell, { heat: 0, extinguished: true });
  await room.setScene({ scene: 'afterglow' });
  advance(4000); assert.equal(room.sceneState().phase, 'phone-fade');
  assert.equal(room.sceneState().mainGain, 0); assert.equal(room.sceneState().phoneGain, 1);
  advance(1000); const score = room.sceneState();
  await room.setScene({ action: 'pause' }); advance(20_000);
  assert.equal(room.sceneState().phoneGain, score.phoneGain);
  assert.equal(room.sceneState().phoneRetreatElapsedMs, 1000);
  await room.setScene({ action: 'resume' }); advance(2999);
  assert.equal(room.sceneState().id, 'afterglow');
  advance(1); assert.equal(room.sceneState().id, 'ended');
});

test('restore migrates only exact legacy programme defaults and never custom notes', () => {
  const introduction = 'A shared landscape of fire, rain, and listening.\n\nTouch and hold the landscape to bring rain. Move slowly while holding. Together, sustained attention cools the ground beneath the flames.\n\n';
  const endings = [
    'Turn Sound on and adjust your phone’s media volume to a comfortable listening level. Keep this page open and listen as the landscape changes. Your phone joins the room with its own voice.',
    'Turn on sound, keep this page open, and listen as the landscape changes. Your phone joins the room with its own voice.',
  ];
  for (const ending of endings) {
    const legacy = introduction + ending;
    assert.equal(restoreSceneSettings(DEFAULT_SCENE_SETTINGS, { programNotes: legacy }).programNotes, DEFAULT_SCENE_SETTINGS.programNotes);
    assert.equal(restoreSceneSettings(DEFAULT_SCENE_SETTINGS, { programNotes: legacy + '\nA custom note.' }).programNotes, legacy + '\nA custom note.');
    assert.equal(sceneSettingsPatch(DEFAULT_SCENE_SETTINGS, { programNotes: legacy }).programNotes, legacy, 'Explicit operator edits are never migrated.');
  }
  const previousNotes = 'Below the ash is a participatory sound and image performance about shared attention, rain, and the heat held beneath a landscape.\n\nSatellite fire locations become a changing field of peat and embers. Together, our rain cools the ground; the sounds of fire give way to insects, then recede into silence.';
  assert.equal(restoreSceneSettings(DEFAULT_SCENE_SETTINGS, { programNotes: previousNotes }).programNotes, DEFAULT_SCENE_SETTINGS.programNotes);
  assert.equal(restoreSceneSettings(DEFAULT_SCENE_SETTINGS, { programNotes: previousNotes + '\nA custom note.' }).programNotes, previousNotes + '\nA custom note.');
  assert.doesNotMatch(DEFAULT_SCENE_SETTINGS.programNotes, /Touch and hold|Turn Sound on|Turn on sound/);
  assert.deepEqual(Object.fromEntries(Object.keys(DEFAULT_SCORE_SETTINGS).map(key => [key, DEFAULT_SCENE_SETTINGS[key]])), DEFAULT_SCORE_SETTINGS);
});


test('forest takeover restores real fire, ground and phone sound condition over its shared pauseable clock', async () => {
  const { room, advance } = await fixture();
  const phone = room.connect({ clientId: 'forest-phone', scope: 'indonesia' });
  room.simulation.stepGlobalRain(60, room.national.fireKeys);
  assert.equal(room.globalSound().fireProgress.outCount, 2);
  const initial = room.simulation.serialize(), epoch = room.epoch;
  await room.setScene({ scene: 'forest-takeover', settings: { forestRiseSeconds: 60, forestTakeoverSeconds: 120 } });
  assert.equal(room.sceneState().cue, 4); assert.equal(room.sceneState().audienceEnabled, true);
  assert.equal(room.sceneState().globalRain, false);
  assert.deepEqual(room.simulation.serialize(), initial, 'Entry does not reset cooled or extinguished ground.');
  advance(30000);
  assert.equal(room.sceneState().forestTakeoverProgress, .5);
  assert.equal(room.globalSound().fireProgress.outCount, 0);
  assert.ok(room.globalSound().soundCondition.heat > .9, 'Unattended sources really return to fire.');
  assert.ok(room.globalSound().soundCondition.moisture > .8, 'Return pressure retains remembered moisture.');
  assert.ok(room.globalSound().soundCondition.surfaceWetness < .01, 'Unattended surface rain dries normally.');
  assert.deepEqual(room.phoneState(phone.connectionId).soundCondition, room.wireState().soundCondition);
  assert.deepEqual(room.phoneState(phone.connectionId).scene, room.wireState().scene);
  await room.setScene({ action: 'pause' }); const paused = room.simulation.serialize(); advance(80000);
  assert.equal(room.sceneState().forestTakeoverProgress, .5); assert.equal(room.sceneState().audienceEnabled, false);
  assert.deepEqual(room.simulation.serialize(), paused);
  await room.setScene({ action: 'resume' }); advance(30000);
  advance(10000);
  assert.equal(room.sceneState().id, 'forest-takeover'); assert.equal(room.sceneState().forestTakeoverProgress, 1);
  assert.equal(room.sceneState().forestRestorationComplete, true);
  assert.equal(room.sceneState().forestRestorationRemainingMs, 0);
  for (const cell of room.simulation.cells.values()) {
    assert.ok(cell.heat > .999 && !cell.extinguished);
    assert.ok(cell.moisture > .6 && cell.surfaceWetness < .001, 'Ground memory is not replaced by a dry snapshot.');
  }
  assert.equal(room.simulation.totalWater, initial.totalWater); assert.deepEqual(room.simulation.sourceRecords, initial.sourceRecords);
  assert.equal(room.epoch, epoch);
  await room.setScene({ scene: 'final-rain' });
  assert.equal(room.sceneState().cue, 5); assert.equal(room.sceneState().audienceEnabled, false);
});

test('weaker takeover holds cool real ground and spend their reduced water budget at any packet cadence', async () => {
  const active = await fixture(), quiet = await fixture();
  for (const { room } of [active, quiet]) { await room.setStrength(.5); await room.setScene({ scene: 'forest-takeover' }); }
  const phone = active.room.connect({ clientId: 'cooling-rain', role: 'operator' });
  const position = [records[0].longitude, records[0].latitude];
  const water = active.room.simulation.totalWater, epoch = active.room.epoch;
  for (let seq = 0; seq < 100; seq++) {
    const ack = active.room.hold(phone.connectionId, { type: 'hold', epoch, seq, holding: true, start: seq === 0, position });
    assert.equal(ack.holding, true);
    active.advance(100);
  }
  quiet.advance(10000);
  const wet = active.room.simulation.sample(...position), dry = quiet.room.simulation.sample(...position);
  assert.ok(wet.heat < dry.heat / 2, 'Audience rain really cools returning fires.');
  assert.equal(wet.moisture, 1); assert.equal(wet.surfaceWetness, 1);
  assert.ok(active.room.simulation.totalWater > water);
  const normal = new RainSimulation().seed(records);
  normal.step(10, [{ from: position, to: position, strength: audienceRainStrength(active.room.sceneState(), active.room.strength) }]);
  assert.ok(Math.abs(active.room.simulation.totalWater - normal.totalWater) < 1e-8, 'Return pressure creates no water; the entire hold receives the scene reduction.');
  assert.equal(active.room.epoch, epoch);
  assert.equal(active.room.sceneState().audienceEnabled, true);
});

test('room snapshots publish repeated real extinction and return beyond the forest sound rise', async () => {
  const { room, advance } = await fixture();
  await room.setScene({ scene: 'forest-takeover', settings: { forestTakeoverSeconds: 120 } });
  const phone = room.connect({ clientId: 'persistent-cooling', role: 'operator' });
  const position = [records[0].longitude, records[0].latitude];
  const events = []; let outCount = 0;
  for (let seq = 0; seq < 800; seq++) {
    room.hold(phone.connectionId, { type: 'hold', epoch: room.epoch, seq, holding: true, start: seq === 0, position });
    advance(100);
    const state = room.wireState();
    if (state.fireProgress.outCount !== outCount) {
      events.push({ elapsed: state.scene.elapsedMs, outCount: state.fireProgress.outCount });
      outCount = state.fireProgress.outCount;
    }
  }
  assert.deepEqual(events.slice(0, 6).map(event => event.outCount), [1, 0, 1, 0, 1, 0]);
  assert.ok(events.filter(event => event.elapsed > 30000).length >= 4);
  assert.equal(room.sceneState().forestRestorationComplete, true);
  const ground = room.simulation.serialize();
  await room.setScene({ scene: 'final-rain' });
  assert.deepEqual(room.simulation.serialize(), ground, 'Final rain enters at the real wet and cooled field.');
  assert.equal(room.wireState().activeCount, 0);
  advance(60000);
  assert.equal(room.sceneState().id, 'afterglow');
  assert.equal(room.globalSound().fireProgress.outCount, records.length);
});

test('manual cue five immediately overrides forest takeover, resets the rain clock, and remains pauseable', async () => {
  const sparse = await fixture(), frequent = await fixture();
  for (const { room, advance } of [sparse, frequent]) {
    room.simulation.stepGlobalRain(60, room.national.fireKeys);
    await room.setScene({ scene: 'forest-takeover', settings: { finalRainRiseSeconds: 16 } }); advance(5000);
    const water = room.simulation.totalWater, ground = room.simulation.serialize();
    await room.setScene({ scene: 'final-rain' });
    assert.equal(room.sceneState().id, 'final-rain'); assert.equal(room.sceneState().pendingFinalRain, false);
    assert.equal(room.sceneState().elapsedMs, 0); assert.equal(room.sceneState().rainIntensity, 0);
    assert.equal(room.simulation.totalWater, water);
    assert.deepEqual(room.simulation.serialize(), ground, 'Final rain begins continuously from actual returning fire and moisture.');
    await room.setScene({ action: 'pause' }); const paused = room.simulation.serialize(); advance(90000);
    assert.deepEqual(room.simulation.serialize(), paused); assert.equal(room.sceneState().elapsedMs, 0);
    await room.setScene({ action: 'resume' });
  }
  sparse.advance(8000);
  for (let frame = 0; frame < 80; frame++) frequent.advance(100);
  assert.equal(sparse.room.sceneState().rainIntensity, .5);
  assert.deepEqual(sparse.room.sceneState(), frequent.room.sceneState());
  assert.ok(Math.abs(sparse.room.simulation.totalWater - 120 - 2 * finalRainIntegral(8000, 16000) / 1000) < 1e-8);
  assert.ok(Math.abs(sparse.room.simulation.totalWater - frequent.room.simulation.totalWater) < 1e-8);
});

test('reentering takeover resets its timer and snapshots current ground while reset returns to paused Arrival', async () => {
  const { room, advance } = await fixture();
  room.simulation.stepGlobalRain(60, room.national.fireKeys);
  await room.setScene({ scene: 'forest-takeover' }); advance(15000);
  const halfway = room.simulation.serialize();
  await room.setScene({ scene: 'forest-takeover' });
  assert.equal(room.sceneState().elapsedMs, 0); assert.equal(room.sceneState().autoAdvanceRemainingMs, 60000);
  assert.deepEqual(room.simulation.serialize(), halfway);
  advance(15000);
  assert.ok(room.globalSound().soundCondition.heat > .99);
  assert.ok(room.globalSound().soundCondition.moisture > .8, 'Reentry never clears retained ground moisture.');
  await room.setScene({ scene: 'final-rain' });
  await room.reset(); advance(90000);
  assert.equal(room.sceneState().id, 'arrival'); assert.equal(room.sceneState().paused, true);
  assert.equal(room.simulation.forestRestoration, null); assert.equal(room.sceneState().globalRain, false);
});

test('fractional server clocks cannot miss the restoration boundary and swallow the following rain interval', async () => {
  const { room, time, advance } = await fixture();
  time.now = 1018576.049213674; time.wall = time.now + 100000;
  await room.setScene({ scene: 'forest-takeover' });
  advance(12345.6789);
  advance(room.sceneState().autoAdvanceRemainingMs + 8000);
  assert.equal(room.sceneState().id, 'final-rain');
  assert.ok(Math.abs(room.sceneState().elapsedMs - 8000) < .000001);
  assert.ok(Math.abs(room.simulation.totalWater - records.length * finalRainIntegral(8000) / 1000) < .000001);
});

test('one delayed tick can complete restoration, the full rain handoff, and the beginning of afterglow', async () => {
  const sparse = await fixture(), frequent = await fixture();
  for (const { room } of [sparse, frequent]) {
    room.simulation.stepGlobalRain(60, room.national.fireKeys);
    await room.setParameters({ deepCoolingSeconds: 2, extinctionHoldSeconds: 0 });
    await room.setScene({ scene: 'forest-takeover', settings: { finalRainRiseSeconds: 16, forestTakeoverSeconds: 30 } });
  }
  sparse.advance(50000);
  for (let frame = 0; frame < 500; frame++) frequent.advance(100);
  assert.deepEqual(sparse.room.sceneState(), frequent.room.sceneState());
  assert.equal(sparse.room.sceneState().id, 'afterglow'); assert.equal(sparse.room.sceneState().elapsedMs, 4000);
  assert.ok(Math.abs(sparse.room.simulation.totalWater - frequent.room.simulation.totalWater) < 1e-8);
});

test('shortening a running cue timer advances from the edit time without manufacturing past rain', async () => {
  const { room, advance } = await fixture();
  room.simulation.stepGlobalRain(60, room.national.fireKeys);
  await room.setScene({ scene: 'forest-takeover' }); advance(15000);
  const water = room.simulation.totalWater, ground = room.simulation.serialize();
  await room.setScene({ settings: { forestRiseSeconds: 5, forestTakeoverSeconds: 5 } });
  assert.equal(room.sceneState().id, 'final-rain'); assert.equal(room.sceneState().elapsedMs, 0);
  assert.equal(room.sceneState().rainIntensity, 0); assert.equal(room.simulation.totalWater, water);
  assert.deepEqual(room.simulation.serialize(), ground, 'Editing the clock cannot overwrite the real ground at the new cue boundary.');
  assert.equal(room.globalSound().fireProgress.outCount, 0);
  advance(8000);
  assert.ok(Math.abs(room.simulation.totalWater - water - records.length * finalRainIntegral(8000) / 1000) < 1e-8);
});

test('the authority automatically advances 60/60/600/60-second scenes and carries delayed-tick overrun', () => {
  const scene = new PerformanceScenes({ now: 0, wallNow: 100000 });
  scene.advance({ now: 900000, wallNow: 1000000, sourceCount: 2, outCount: 0 });
  assert.equal(scene.id, 'arrival'); assert.equal(scene.state(900000, 1000000).elapsedMs, 0);
  scene.update({ action: 'resume' }, { now: 900000, wallNow: 1000000 });
  for (const [offset, id, elapsed] of [[59999, 'arrival', 59999], [60000, 'instructions', 0], [120000, 'participation', 0], [720000, 'forest-takeover', 0], [780000, 'final-rain', 0], [785000, 'final-rain', 5000]]) {
    scene.advance({ now: 900000 + offset, wallNow: 1000000 + offset, sourceCount: 2, outCount: 0 });
    const state = scene.state(900000 + offset, 1000000 + offset);
    assert.equal(state.id, id); assert.equal(state.elapsedMs, elapsed);
  }
  const delayed = new PerformanceScenes({ now: 0, wallNow: 100000 });
  delayed.update({ action: 'resume' }, { now: 0, wallNow: 100000 });
  delayed.advance({ now: 785000, wallNow: 885000, sourceCount: 2, outCount: 0 });
  assert.equal(delayed.id, 'final-rain'); assert.equal(delayed.state(785000, 885000).elapsedMs, 5000);
  assert.equal(delayed.startedAt, 880000);
});

test('automatic scene timers pause, resume and reset on every manual override including the current cue', async () => {
  const { room, advance } = await fixture();
  await room.setScene({ action: 'resume' }); advance(55000);
  await room.setScene({ action: 'pause' }); advance(90000);
  assert.equal(room.sceneState().id, 'arrival'); assert.equal(room.sceneState().autoAdvanceRemainingMs, 5000);
  await room.setScene({ action: 'resume' }); advance(5000);
  assert.equal(room.sceneState().id, 'instructions'); assert.equal(room.sceneState().elapsedMs, 0);
  await room.setScene({ scene: 'participation' }); advance(20000);
  await room.setScene({ scene: 'instructions' });
  assert.equal(room.sceneState().elapsedMs, 0); assert.equal(room.sceneState().autoAdvanceRemainingMs, 60000);
  advance(60000); assert.equal(room.sceneState().id, 'participation');
  advance(1000); await room.setScene({ scene: 'participation' });
  assert.equal(room.sceneState().elapsedMs, 0); assert.equal(room.sceneState().autoAdvanceRemainingMs, 600000);
});

test('one delayed authority tick integrates all automatic scenes, restoration and final rain like frequent ticks', async () => {
  const sparse = await fixture(), frequent = await fixture();
  for (const { room } of [sparse, frequent]) {
    room.simulation.stepGlobalRain(60, room.national.fireKeys);
    await room.setScene({ action: 'resume' });
  }
  sparse.advance(800000);
  for (let frame = 0; frame < 800; frame++) frequent.advance(1000);
  assert.deepEqual(sparse.room.sceneState(), frequent.room.sceneState());
  assert.equal(sparse.room.sceneState().id, 'final-rain'); assert.equal(sparse.room.sceneState().elapsedMs, 20000);
  const expected = 120 + records.length * finalRainIntegral(20000) / 1000;
  for (const { room } of [sparse, frequent]) assert.ok(Math.abs(room.simulation.totalWater - expected) < 1e-8);
  for (const source of records) for (const field of ['heat', 'moisture', 'surfaceWetness']) assert.ok(Math.abs(sparse.room.simulation.sample(source.longitude, source.latitude)[field] - frequent.room.simulation.sample(source.longitude, source.latitude)[field]) < .0001);
  sparse.advance(169000);
  for (let frame = 0; frame < 169; frame++) frequent.advance(1000);
  assert.deepEqual(sparse.room.sceneState(), frequent.room.sceneState());
  assert.equal(sparse.room.sceneState().id, 'ended');
});

test('automatic final rain preserves exact water and afterglow time on fractional authority clocks for every supported ramp', async () => {
  for (const seconds of [10, 16, 60, 90, 180]) {
    const { room, time, advance } = await fixture();
    time.now = 1018576.049213674; time.wall = time.now + 100000;
    await room.setScene({ scene: 'forest-takeover', settings: { finalRainRiseSeconds: seconds } });
    advance(60000 + seconds * 1000 + 4000);
    assert.equal(room.sceneState().id, 'afterglow'); assert.ok(Math.abs(room.sceneState().elapsedMs - 4000) < .000001);
    assert.ok(Math.abs(room.simulation.totalWater - records.length * seconds / 2) < .000001);
    assert.equal(room.globalSound().fireProgress.outCount, records.length);
  }
});

test('pause freezes the dark PA hold and handoff, then the authoritative timer continues from the same weights', async () => {
  const { room, advance } = await fixture();
  await room.setScene({ scene: 'final-rain' }); advance(FINAL_RAIN_RAMP_MS + 32000);
  assert.equal(room.sceneState().phase, 'pa-crickets'); assert.equal(room.sceneState().mix.mainCrickets, 1);
  for (const phaseDuration of [10000, 6000]) {
    const before = room.sceneState();
    await room.setScene({ action: 'pause' }); advance(120000);
    const after = room.sceneState();
    assert.equal(after.elapsedMs, before.elapsedMs); assert.deepEqual(after.mix, before.mix);
    assert.equal(after.rainIntensity, 0); assert.equal(after.visualGain, 0);
    await room.setScene({ action: 'resume' }); advance(phaseDuration);
  }
  assert.equal(room.sceneState().phase, 'cricket-handoff');
  assert.ok(Math.abs(room.sceneState().mix.mainCrickets - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(room.sceneState().mix.phoneCrickets - Math.SQRT1_2) < 1e-12);
});

test('automatic participation-to-forest keeps visible held rain and the automatic final cue clears it', async () => {
  const { room, advance } = await fixture();
  await room.setScene({ scene: 'participation', settings: { participationSeconds: 1, forestTakeoverSeconds: 1, forestRiseSeconds: 1 } });
  const phone = room.connect({ clientId: 'automatic-held-rain', scope: 'indonesia' });
  hold(room, phone); advance(1000);
  assert.equal(room.sceneState().id, 'forest-takeover'); assert.equal(room.wireState().activeCount, 1);
  const water = room.simulation.totalWater;
  hold(room, phone, 1); advance(1000);
  assert.equal(room.sceneState().id, 'final-rain'); assert.equal(room.sceneState().elapsedMs, 0);
  assert.equal(room.wireState().activeCount, 0); assert.ok(room.simulation.totalWater > water);
});


test('pause freezes the rain/cricket overlap at its current equal-power weights', async () => {
  const { room, advance } = await fixture();
  await room.setScene({ scene: 'final-rain' }); advance(FINAL_RAIN_RAMP_MS + FINAL_RAIN_RELEASE_MS / 2);
  const before = room.sceneState();
  assert.equal(before.phase, 'rain-cricket-overlap'); assert.equal(before.elapsedMs, 15000);
  assert.ok(Math.abs(before.mainFieldGain - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(before.mix.mainCrickets - Math.SQRT1_2) < 1e-12);
  assert.equal(before.mix.phoneCrickets, 0);
  await room.setScene({ action: 'pause' }); advance(120000);
  const paused = room.sceneState();
  for (const key of ['elapsedMs', 'rainIntensity', 'mainFieldGain', 'visualGain']) assert.equal(paused[key], before[key]);
  assert.deepEqual(paused.mix, before.mix);
  await room.setScene({ action: 'resume' }); advance(15000);
  assert.equal(room.sceneState().phase, 'pa-crickets'); assert.equal(room.sceneState().phaseElapsedMs, 0);
  assert.equal(room.sceneState().mix.mainCrickets, 1); assert.equal(room.sceneState().mainFieldGain, 0);
  assert.equal(room.sceneState().visualGain, 0); assert.equal(room.sceneState().mix.phoneCrickets, 0);
});
