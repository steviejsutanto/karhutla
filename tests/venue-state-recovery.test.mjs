import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SharedRoom } from '../app/shared-room.mjs';
import { PerformanceScenes } from '../app/performance-scenes.mjs';
import { scoreDurations } from '../app/scene-score.js';

const records = [{ longitude: 101.125, latitude: -1.125 }];

async function preparation(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla-venue-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const persistencePath = path.join(directory, 'performance-state.json');
  const reopen = () => new SharedRoom({ records, persistencePath }).initialize();
  return { room: await reopen(), reopen, persistencePath };
}

test('strength prepared before first Start survives restart without starting the landscape', async t => {
  const { room, reopen, persistencePath } = await preparation(t);
  await room.setStrength(.37);
  await room.persist(); // Periodic/shutdown saving must not replace the settings envelope.
  const saved = JSON.parse(await readFile(persistencePath, 'utf8'));
  assert.equal(saved.settingsOnly, true);
  assert.equal(saved.strength, .37);
  assert.equal(saved.simulation, undefined);
  const restored = await reopen();
  assert.equal(restored.strength, .37);
  assert.equal(restored.bootstrapAvailable, true);
  assert.equal(restored.sceneState().id, 'arrival');
  assert.equal(restored.sceneState().paused, true);
  assert.equal(restored.simulation.totalWater, 0);
});

test('ground timing prepared before first Start saves independently and preserves other preparation', async t => {
  const { room, reopen } = await preparation(t);
  // Ground timing alone must create a durable settings-only file.
  await room.setParameters({ fireReturnSeconds: 11, deepCoolingSeconds: 22 });
  const first = await reopen();
  assert.equal(first.simulation.parameters.fireReturnSeconds, 11);
  assert.equal(first.simulation.parameters.deepCoolingSeconds, 22);
  assert.equal(first.bootstrapAvailable, true);
  await first.setScene({ settings: { wifiName: 'Rehearsal network', programNotes: 'Prepared programme.' } });
  await first.setSoundSettings({ level: .42 });
  await first.setStrength(.28);
  await first.setParameters({ deepCoolingSeconds: 31 });
  const restored = await reopen();
  assert.equal(restored.strength, .28);
  assert.equal(restored.simulation.parameters.fireReturnSeconds, 11);
  assert.equal(restored.simulation.parameters.deepCoolingSeconds, 31);
  assert.equal(restored.sceneState().settings.wifiName, 'Rehearsal network');
  assert.equal(restored.sceneState().settings.programNotes, 'Prepared programme.');
  assert.equal(restored.soundSettings.level, .42);
  assert.equal(restored.bootstrapAvailable, true);
});

test('empty source final rain keeps its full ramp, completes Afterglow and reaches silence', async () => {
  let now = 1000;
  const room = new SharedRoom({ records: [], clock: () => now, wallClock: () => 100000 + now });
  await room.setScene({ scene: 'final-rain' });
  const durations = scoreDurations(room.scenes.settings);
  now += durations.finalRainRiseMs - 1;
  room.advance();
  assert.equal(room.sceneState().id, 'final-rain');
  assert.ok(room.sceneState().rainIntensity > .99);
  await assert.rejects(room.setScene({ scene: 'afterglow' }), /fully risen/);
  now += 1;
  room.advance();
  assert.equal(room.sceneState().id, 'afterglow');
  assert.equal(room.sceneState().elapsedMs, 0);
  assert.equal(room.sceneState().rainIntensity, 1);
  assert.equal(room.simulation.totalWater, 0);
  assert.equal(room.simulation.cells.size, 0);
  now += durations.afterglowDurationMs - 1;
  room.advance();
  assert.equal(room.sceneState().id, 'afterglow');
  now += 1;
  room.advance();
  assert.equal(room.sceneState().id, 'ended');
  assert.equal(room.sceneState().phoneGain, 0);
  assert.equal(room.sceneState().mainGain, 0);
});

test('one delayed tick finishes an empty-source finale at the same scheduled boundaries', async () => {
  let now = 1000;
  const room = new SharedRoom({ records: [], clock: () => now, wallClock: () => 100000 + now });
  await room.setScene({ scene: 'final-rain' });
  const durations = scoreDurations(room.scenes.settings);
  const endingAt = 100000 + now + durations.finalRainRiseMs + durations.afterglowDurationMs;
  now += durations.finalRainRiseMs + durations.afterglowDurationMs + 5000;
  room.advance();
  assert.equal(room.sceneState().id, 'ended');
  assert.equal(room.sceneState().startedAt, endingAt);
  assert.equal(room.sceneState().elapsedMs, 5000);
});

test('empty-source manual ending requires Final rain and its full ramp; nonempty guards remain', () => {
  const scenes = new PerformanceScenes({ now: 0, wallNow: 100000 });
  const state = (now, sourceCount = 0, outCount = 0) => ({ now, wallNow: 100000 + now, sourceCount, outCount });
  assert.throws(() => scenes.update({ scene: 'afterglow' }, state(0)), /every source fire/);
  scenes.update({ scene: 'final-rain' }, state(0));
  const duration = scoreDurations(scenes.settings).finalRainRiseMs;
  assert.throws(() => scenes.update({ scene: 'afterglow' }, state(duration - 1)), /fully risen/);
  assert.throws(() => scenes.update({ scene: 'afterglow' }, state(duration, 2, 1)), /every source fire/);
  scenes.advance(state(duration, 2, 1));
  assert.equal(scenes.id, 'final-rain');
  scenes.update({ scene: 'afterglow' }, state(duration));
  assert.equal(scenes.id, 'afterglow');
});
