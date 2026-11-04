import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SharedRoom, HOLD_LEASE_MS, MAX_PATH_POINTS } from './shared-room.mjs';
import { DEFAULT_SOUND_SETTINGS, finalRainIntegral } from './performance-scenes.mjs';
import { RainSimulation, BRUSH_RADIUS, CELL_SIZE, DEFAULT_PARAMETERS, PARAMETER_LIMITS, MOISTURE_UPTAKE_SECONDS, MOISTURE_RETENTION_SECONDS } from './simulation.js';
import { REGION_DEFINITIONS, RegionCatalog, regionCellKey, normalizedPositionValid } from './regions.mjs';

const position = [110.125, -2.125];
const records = [{ longitude: position[0], latitude: position[1] }];
const area = Math.PI * (BRUSH_RADIUS / CELL_SIZE) ** 2;
const close = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} differs from ${expected}`);

async function fixture(options = {}, bootstrap = true) {
  const time = { now: 0, wall: 100000 };
  const room = new SharedRoom({ records, snapshotVersion: 'fixture', ...options, clock: () => time.now, wallClock: () => time.wall });
  await room.initialize();
  if (bootstrap && room.bootstrapAvailable) await room.bootstrap({ state: null, strength: 0.5 });
  if (bootstrap) await room.setScene({ scene: 'participation' });
  return { room, time };
}

function join(room, id = 'phone', role = 'participant') {
  return room.connect({ clientId: id, role });
}

function hold(room, welcome, seq = 0, holding = true, extras = {}) {
  return room.hold(welcome.connectionId, { type: 'hold', epoch: room.epoch, seq, holding, start: seq === 0, position: welcome.role === 'participant' ? [.5, .5] : position, ...(welcome.role === 'participant' ? { space: 'region' } : {}), ...extras });
}

test('a new authority seeds fire but requires an operator bootstrap before accepting holds', async () => {
  const { room, time } = await fixture({}, false);
  const welcome = join(room);
  assert.equal(welcome.bootstrapAvailable, true);
  assert.equal(room.simulation.sample(...position).heat, 1);
  assert.throws(() => hold(room, welcome), /restore or start/);
  time.now = 10000; room.advance();
  assert.equal(room.simulation.totalWater, 0);
  await room.bootstrap({ state: null, strength: 0.5 });
  await room.setScene({ scene: 'participation' });
  assert.equal(room.bootstrapAvailable, false);
  assert.throws(() => hold(room, welcome, 0, true, { epoch: welcome.epoch }), /performance changed/);
  assert.equal(hold(room, welcome).holding, true);
  await assert.rejects(room.bootstrap({ state: null }), /already been initialized/);
});

test('public room snapshots copy the complete main mixer without disabling automation', async () => {
  const { room } = await fixture();
  const phone = join(room, 'mixer-phone');
  const patch = { mixer: { haze: 0, forest: 1.5, lowDrone: 2 }, localPitchIndex: 34 };
  const result = await room.setSoundSettings(patch);
  const expected = { ...DEFAULT_SOUND_SETTINGS.mixer, ...patch.mixer };
  assert.equal(result.soundSettings.automation, true);
  assert.equal(result.soundSettings.localPitchIndex, 34);
  assert.deepEqual(result.soundSettings.mixer, expected);
  const states = [result, room.wireState(), room.phoneState(phone.connectionId), room._envelope()];
  for (const state of states) {
    assert.deepEqual(state.soundSettings.mixer, expected);
    state.soundSettings.mixer.haze = 2;
    state.soundSettings.macros.haze = 0;
  }
  patch.mixer.forest = 0;
  assert.deepEqual(room.soundSettingsState().mixer, expected);
  assert.deepEqual(room.soundSettingsState().macros, DEFAULT_SOUND_SETTINGS.macros);
  const beforeInvalid = room.soundSettingsState();
  await assert.rejects(room.setSoundSettings({ automation: false, mixer: { haze: 1, unknown: 1 } }), /mixer/);
  assert.deepEqual(room.soundSettingsState(), beforeInvalid, 'Invalid mixer patches are atomic.');
  await room.setSoundSettings({ mixer: { chimes: .4 } });
  assert.deepEqual(room.soundSettingsState().mixer, { ...expected, chimes: .4 });
  assert.equal(room.soundSettingsState().automation, true);
  const fresh = new SharedRoom();
  assert.deepEqual(fresh.soundSettingsState().mixer, DEFAULT_SOUND_SETTINGS.mixer);
});

test('old full and settings-only room saves gain unity mixer levels and retain existing sound choices', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wildfire-legacy-mixer-'));
  try {
    for (const settingsOnly of [true, false]) {
      const persistencePath = path.join(directory, `${settingsOnly ? 'settings' : 'show'}.json`);
      const first = await fixture({ persistencePath }, !settingsOnly);
      await first.room.setSoundSettings({ automation: false, macros: { rain: .6 }, level: .3, localPitchIndex: 9 });
      const saved = JSON.parse(await readFile(persistencePath, 'utf8'));
      delete saved.soundSettings.mixer;
      await writeFile(persistencePath, JSON.stringify(saved));
      const { room } = await fixture({ persistencePath }, false);
      assert.equal(room.bootstrapAvailable, settingsOnly);
      assert.deepEqual(room.soundSettingsState(), { ...saved.soundSettings, mixer: DEFAULT_SOUND_SETTINGS.mixer });
      await room.setSoundSettings({ mixer: { rain: .25, outDrone: 2 } });
      assert.equal(room.soundSettingsState().automation, false);
      const current = JSON.parse(await readFile(persistencePath, 'utf8'));
      assert.deepEqual(current.soundSettings, room.soundSettingsState());
      const { room: again } = await fixture({ persistencePath }, false);
      assert.deepEqual(again.soundSettingsState(), room.soundSettingsState());
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('browser bootstrap validates the full state and preserves its water and timing', async () => {
  const local = new RainSimulation({ deepCoolingSeconds: 120 }).seed(records).step(8, [{ from: position, to: position, strength: 0.5 }]);
  const { room } = await fixture({}, false);
  await assert.rejects(room.bootstrap({ state: { broken: true } }), /invalid/);
  assert.equal(room.bootstrapAvailable, true);
  await room.bootstrap({ state: local.serialize(), strength: 0.75 });
  close(room.simulation.totalWater, local.totalWater);
  assert.equal(room.strength, 0.75);
  assert.equal(room.simulation.parameters.deepCoolingSeconds, 120);
});

test('two independent assigned participants add water at server strength only', async () => {
  const { room, time } = await fixture();
  const first = join(room, 'first'), second = join(room, 'second');
  hold(room, first, 0, true, { strength: 1000 });
  hold(room, second);
  time.now = 1000; room.advance();
  close(room.simulation.totalWater, area);
  const state = room.wireState();
  assert.equal(state.joinedCount, 2);
  assert.equal(state.activeCount, 2);
  assert.notEqual(first.assignment.id, second.assignment.id);
  for (const actor of state.participants) assert.ok(room.simulation.sample(...actor.position).moisture > 0);
});

test('packet frequency and long motion cannot mint extra water', async () => {
  const first = await fixture(), second = await fixture();
  const stationary = join(first.room), moving = join(second.room);
  hold(first.room, stationary);
  hold(second.room, moving);
  for (let index = 1; index <= 10; index += 1) {
    first.time.now = index * 100;
    second.time.now = index * 100;
    hold(second.room, moving, index, true, { position: index % 2 ? [1, 0] : [0, 1], path: [[.25, .75], [.75, .25]] });
    first.room.advance(); second.room.advance();
  }
  close(first.room.simulation.totalWater, area * 0.5);
  close(first.room.simulation.totalWater, second.room.simulation.totalWater);
});

test('fifty continuing phones share one physics step for a burst inside the 20 Hz interval', async () => {
  const { room, time } = await fixture();
  const phones = Array.from({ length: 50 }, (_, index) => join(room, `batched-${index}`));
  for (const phone of phones) hold(room, phone, 0, true, { start: true });
  let steps = 0;
  const step = room.simulation.step.bind(room.simulation);
  room.simulation.step = (...arguments_) => { steps += 1; return step(...arguments_); };
  for (let seq = 1; seq <= 9; seq += 1) {
    for (const [index, phone] of phones.entries()) {
      time.now = ((seq - 1) * phones.length + index + 1) / 10;
      const ack = hold(room, phone, seq, true, { start: false, position: [seq / 10, .5] });
      assert.equal(ack.holding, true);
    }
  }
  assert.equal(steps, 0, '450 continuing messages queue motion without 450 full physics passes.');
  assert.equal(room.lastAdvance, 0);
  assert.equal(room.actorState().activeCount, 50, 'Acknowledged actor motion is available before the physics tick.');
  time.now = 50; room.advance();
  assert.equal(steps, 1);
  close(room.simulation.totalWater, area * .5 * .05 * phones.length, 1e-7);
});

test('a continuing update advances physics when the next 50 ms step is due', async () => {
  const { room, time } = await fixture();
  const phone = join(room); hold(room, phone);
  time.now = 49; hold(room, phone, 1, true, { position: [.7, .5] });
  assert.equal(room.lastAdvance, 0);
  time.now = 50; hold(room, phone, 2, true, { position: [.8, .5] });
  assert.equal(room.lastAdvance, 50);
  close(room.simulation.totalWater, area * .5 * .05);
});

test('batched motion stays bounded, retains its interval origin, and cannot increase the water budget', async () => {
  const stationary = await fixture(), moving = await fixture();
  const stillPhone = join(stationary.room), movingPhone = join(moving.room);
  hold(stationary.room, stillPhone); hold(moving.room, movingPhone);
  const actor = moving.room.connections.get(movingPhone.connectionId);
  const origin = [...actor.position];
  for (let seq = 1; seq <= 9; seq += 1) {
    stationary.time.now = moving.time.now = seq * 5;
    const position = seq % 2 ? [1, 0] : [0, 1];
    hold(moving.room, movingPhone, seq, true, { position, path: Array.from({ length: MAX_PATH_POINTS }, (_, index) => [index / (MAX_PATH_POINTS - 1), seq % 2]) });
    assert.ok(actor.pendingPath.length <= MAX_PATH_POINTS + 2);
    assert.deepEqual(actor.pendingPath[0], origin);
    assert.deepEqual(actor.pendingPath.at(-1), actor.position);
  }
  stationary.time.now = moving.time.now = 50;
  stationary.room.advance(); moving.room.advance();
  close(stationary.room.simulation.totalWater, area * .5 * .05);
  close(moving.room.simulation.totalWater, stationary.room.simulation.totalWater);
});

test('sub-tick release includes queued and final motion then stops at its exact timestamp', async () => {
  const { room, time } = await fixture();
  const phone = join(room); hold(room, phone);
  const actor = room.connections.get(phone.connectionId), origin = [...actor.position];
  let appliedPath;
  const step = room.simulation.step.bind(room.simulation);
  room.simulation.step = (seconds, strokes) => { appliedPath = strokes[0]?.path; return step(seconds, strokes); };
  time.now = 10; hold(room, phone, 1, true, { position: [.75, .5] });
  assert.equal(room.simulation.totalWater, 0);
  time.now = 25; hold(room, phone, 2, false, { position: [1, .5] });
  assert.equal(room.lastAdvance, 25);
  assert.deepEqual(appliedPath[0], origin);
  assert.deepEqual(appliedPath.at(-1), actor.position);
  close(room.simulation.totalWater, area * .5 * .025);
  time.now = 100; room.advance();
  close(room.simulation.totalWater, area * .5 * .025);
});

test('sub-tick starts and disconnects flush time before changing who contributes', async () => {
  const { room, time } = await fixture();
  const first = join(room, 'boundary-first'), second = join(room, 'boundary-second');
  time.now = 10; hold(room, first, 0, true, { start: true });
  assert.equal(room.simulation.totalWater, 0, 'A start does not receive the preceding idle interval.');
  time.now = 25; hold(room, second, 0, true, { start: true });
  close(room.simulation.totalWater, area * .5 * .015);
  time.now = 40; hold(room, first, 1, false);
  close(room.simulation.totalWater, area * .5 * .045);
  time.now = 45; room.disconnect(second.connectionId);
  close(room.simulation.totalWater, area * .5 * .05);
  time.now = 100; room.advance();
  close(room.simulation.totalWater, area * .5 * .05);
});

test('actor snapshots retain two or three completed short presses even when every release precedes the next snapshot', async () => {
  for (const count of [2, 3]) {
    const { room, time } = await fixture();
    const phone = room.connect({ clientId: `short-taps-${count}`, role: 'participant', scope: 'indonesia' });
    const initial = room.actorState().participants.find(actor => actor.id === `short-taps-${count}`);
    assert.equal(initial.pressSerial, 0);
    assert.equal(initial.pressPosition, null);
    let seq = 0, expectedPosition;
    for (let tap = 0; tap < count; tap++) {
      time.now += 10;
      hold(room, phone, seq++, true, { start: true, space: 'country', position: [.25 + tap * .125, .5] });
      expectedPosition = [...room.connections.get(phone.connectionId).position];
      time.now += 10;
      // The released pointer can finish elsewhere. The actor must retain the
      // accepted press source, rather than this later release location.
      hold(room, phone, seq++, false, { start: false, space: 'country', position: [.8, .7] });
    }
    const actor = room.actorState().participants.find(actor => actor.id === `short-taps-${count}`);
    assert.equal(actor.holding, false);
    assert.equal(actor.pressSerial, count);
    assert.deepEqual(actor.pressPosition, expectedPosition);
    assert.notDeepEqual(actor.pressPosition, actor.position);
    actor.pressPosition[0] = 0;
    assert.deepEqual(room.actorState().participants.find(value => value.id === actor.id).pressPosition, expectedPosition,
      'Public press positions must not expose the authority’s mutable array.');
  }
});

test('accepted press serials advance for new starts but never for renewals, moves, releases, or rejected packets', async () => {
  const { room, time } = await fixture();
  const phone = join(room, 'press-serial');
  const actor = () => room.actorState().participants.find(value => value.id === 'press-serial');
  hold(room, phone, 0, true, { start: true });
  const firstPosition = actor().pressPosition;
  assert.equal(actor().pressSerial, 1);
  time.now = 10;
  hold(room, phone, 1, true, { start: false, position: [.65, .4] });
  time.now = 20;
  hold(room, phone, 2, true, { start: false, position: [.7, .3] });
  assert.equal(actor().pressSerial, 1);
  assert.deepEqual(actor().pressPosition, firstPosition);
  const revision = room.actorState().actorRevision;
  hold(room, phone, 3, true, { start: true, position: [.7, .3] });
  assert.equal(actor().pressSerial, 2, 'An explicit accepted start is a fresh gesture even before a release snapshot.');
  assert.ok(room.actorState().actorRevision > revision, 'A fresh start at the same point must still be broadcast.');
  const secondPosition = actor().pressPosition;
  assert.throws(() => hold(room, phone, 3, true, { start: true }), /sequence is stale/);
  assert.throws(() => hold(room, phone, -1, true, { start: true }), /sequence is stale/);
  assert.throws(() => hold(room, phone, 4, true, { start: true, position: [Infinity, .5] }), /outside/);
  assert.equal(actor().pressSerial, 2);
  assert.deepEqual(actor().pressPosition, secondPosition);
  hold(room, phone, 4, false, { start: false });
  assert.equal(actor().pressSerial, 2);
  assert.deepEqual(actor().pressPosition, secondPosition);
  // Older clients omit start after a release. Their accepted holding edge
  // still represents one new physical gesture.
  hold(room, phone, 5, true, { start: false, position: [.3, .5] });
  assert.equal(actor().pressSerial, 3);
});

test('reset and reconnect expose a zero press baseline without replaying the prior gesture position', async () => {
  const { room } = await fixture();
  const original = join(room, 'press-baseline');
  hold(room, original, 0, true, { start: true, position: [.3, .6] });
  assert.equal(room.actorState().participants[0].pressSerial, 1);
  await room.reset();
  let actor = room.actorState().participants[0];
  assert.equal(actor.pressSerial, 0);
  assert.equal(actor.pressPosition, null);
  assert.equal(actor.holding, false);
  await room.setScene({ scene: 'participation' });
  hold(room, original, 0, true, { start: true, position: [.7, .4] });
  assert.equal(room.actorState().participants[0].pressSerial, 1);
  const replacement = join(room, 'press-baseline');
  assert.equal(replacement.participantNumber, original.participantNumber);
  actor = room.actorState().participants[0];
  assert.equal(actor.pressSerial, 0);
  assert.equal(actor.pressPosition, null);
  assert.equal(actor.holding, false);
});

test('batching never renews an expired lease even inside a partial physics interval', async () => {
  for (const renewalAt of [HOLD_LEASE_MS, HOLD_LEASE_MS + 1]) {
    const { room, time } = await fixture();
    const phone = join(room); hold(room, phone, 0, true, { start: true });
    time.now = HOLD_LEASE_MS - 10; room.advance();
    time.now = renewalAt;
    assert.throws(() => hold(room, phone, 1, true, { start: false }), /hold expired/);
    assert.equal(room.actorState().activeCount, 0);
    close(room.simulation.totalWater, area * .5 * HOLD_LEASE_MS / 1000);
    assert.equal(hold(room, phone, 2, true, { start: true }).holding, true);
    time.now += 10; hold(room, phone, 3, false);
    close(room.simulation.totalWater, area * .5 * (HOLD_LEASE_MS / 1000 + .01));
  }
});

test('release and disconnect integrate only the exact elapsed held interval', async () => {
  const { room, time } = await fixture();
  const welcome = join(room);
  hold(room, welcome);
  time.now = 425; hold(room, welcome, 1, false, { position: [.8, .5] });
  time.now = 10000; room.advance();
  close(room.simulation.totalWater, area * 0.5 * 0.425);
  hold(room, welcome, 2);
  time.now = 10250; room.disconnect(welcome.connectionId);
  time.now = 15000; room.advance();
  close(room.simulation.totalWater, area * 0.5 * (0.425 + 0.25));
});

test('lease expiry splits a long delayed tick and stops exactly at the deadline', async () => {
  const { room, time } = await fixture();
  const welcome = join(room);
  hold(room, welcome);
  time.now = 10000; room.advance();
  close(room.simulation.totalWater, area * 0.5 * HOLD_LEASE_MS / 1000);
  assert.equal(room.wireState().activeCount, 0);
});

test('a renewal extends the lease without adding a packet-based water allocation', async () => {
  const { room, time } = await fixture();
  const welcome = join(room);
  hold(room, welcome);
  time.now = 500; hold(room, welcome, 1);
  time.now = 10000; room.advance();
  close(room.simulation.totalWater, area * 0.5 * 2.5);
});

test('an expired hold cannot resurrect from a late renewal and needs an explicit fresh start', async () => {
  for (const tickBeforeRenewal of [false, true]) {
    const { room, time } = await fixture();
    const welcome = join(room);
    hold(room, welcome, 0, true, { start: true });
    time.now = HOLD_LEASE_MS + 500;
    if (tickBeforeRenewal) room.advance();
    assert.throws(() => hold(room, welcome, 1, true, { start: false }), /hold expired/);
    assert.equal(room.wireState().activeCount, 0);
    close(room.simulation.totalWater, area * 0.5 * HOLD_LEASE_MS / 1000);
    // An explicit release clears the gesture, but cannot authorize a delayed
    // heartbeat that arrives afterwards. Only the next physical press does.
    hold(room, welcome, 2, false);
    assert.throws(() => hold(room, welcome, 3, true, { start: false }), /hold expired/);
    assert.throws(() => hold(room, welcome, 3), /hold expired/);
    const ack = hold(room, welcome, 4, true, { start: true });
    assert.equal(ack.holding, true);
    time.now += 500;
    assert.equal(hold(room, welcome, 5, true, { start: false }).holding, true);
    close(room.simulation.totalWater, area * 0.5 * (HOLD_LEASE_MS / 1000 + 0.5));
  }
});

test('reconnecting replaces the old connection, keeps its number, and starts released', async () => {
  const { room, time } = await fixture();
  const old = join(room);
  hold(room, old);
  const replaced = []; room.on('replaced', id => replaced.push(id));
  time.now = 300;
  const next = join(room);
  assert.deepEqual(replaced, [old.connectionId]);
  assert.equal(next.participantNumber, old.participantNumber);
  assert.notEqual(next.connectionId, old.connectionId);
  assert.equal(room.wireState().activeCount, 0);
  room.disconnect(old.connectionId);
  assert.equal(room.wireState().joinedCount, 1);
  assert.throws(() => hold(room, old, 1), /no longer active/);
  time.now = 3000; room.advance();
  close(room.simulation.totalWater, area * 0.5 * 0.3);
  assert.equal(hold(room, next, 0).holding, true);
});

test('stale sequences and malformed paths are rejected without extending the lease', async () => {
  const { room, time } = await fixture();
  const welcome = join(room);
  hold(room, welcome, 5);
  time.now = 500;
  assert.throws(() => hold(room, welcome, 5), /sequence is stale/);
  assert.throws(() => hold(room, welcome, 6, true, { path: Array(MAX_PATH_POINTS + 1).fill(position) }), /at most/);
  assert.throws(() => hold(room, welcome, 6, true, { position: [Infinity, -2] }), /outside the assigned screen/);
  assert.throws(() => hold(room, welcome, 6, true, { position: [50, -2] }), /outside the assigned screen/);
  time.now = 5000; room.advance();
  close(room.simulation.totalWater, area);
  assert.equal(room.wireState().activeCount, 0);
});

test('rate limiting never prevents a release, and simultaneous packets add no elapsed time', async () => {
  const { room, time } = await fixture();
  const welcome = join(room);
  for (let seq = 0; seq < 20; seq += 1) hold(room, welcome, seq);
  assert.throws(() => hold(room, welcome, 20), /Too many/);
  assert.equal(hold(room, welcome, 21, false).holding, false);
  time.now = 1000; room.advance();
  assert.equal(room.simulation.totalWater, 0);
});

test('reset changes epoch, clears all held state, and rejects pre-reset packets', async () => {
  const { room, time } = await fixture();
  const welcome = join(room);
  hold(room, welcome);
  const oldEpoch = room.epoch;
  time.now = 500; room.advance();
  await room.reset();
  assert.notEqual(room.epoch, oldEpoch);
  assert.equal(room.simulation.totalWater, 0);
  assert.equal(room.wireState().activeCount, 0);
  assert.throws(() => hold(room, welcome, 99, true, { epoch: oldEpoch }), /performance changed/);
  time.now = 3000; room.advance();
  assert.equal(room.simulation.totalWater, 0);
  await room.setScene({ scene: 'participation' });
  assert.equal(hold(room, welcome, 0).holding, true);
});

test('operator mouse contributes but is excluded from audience counts and cannot be displaced by a participant', async () => {
  const { room, time } = await fixture();
  const operator = join(room, 'local', 'operator');
  assert.equal(operator.participantNumber, 0);
  hold(room, operator);
  time.now = 500; room.advance();
  close(room.simulation.totalWater, area * 0.25);
  assert.equal(room.wireState().joinedCount, 0);
  assert.equal(room.wireState().activeCount, 0);
  assert.equal(room.wireState().participants[0].holding, true);
  assert.throws(() => join(room, 'local', 'participant'), /local operator/);
});

test('strength changes flush the preceding interval at its old strength', async () => {
  const { room, time } = await fixture();
  const welcome = join(room);
  hold(room, welcome);
  time.now = 500; await room.setStrength(1);
  time.now = 1000; room.advance();
  close(room.simulation.totalWater, area * 0.75);
  await assert.rejects(room.setStrength(-1), /between zero and one/);
});

test('wire state is compact, rounded, detached, and includes validated timing parameters', async () => {
  const { room, time } = await fixture();
  const welcome = join(room); hold(room, welcome);
  time.now = 123; room.advance();
  await room.setParameters({ deepCoolingSeconds: 150 });
  const state = room.wireState();
  assert.equal(state.simulation.wireFormat, 'compact-v1');
  assert.equal(state.simulation.sourceRecords, undefined);
  assert.equal(state.simulation.parameters.deepCoolingSeconds, 150);
  assert.ok(Array.isArray(state.simulation.cells[0]));
  assert.equal(state.simulation.cells[0].length, 8);
  const wet = state.simulation.cells.find(cell => cell[3] > 0);
  assert.ok(wet);
  assert.notEqual(wet[3], room.simulation.sample(wet[0], wet[1]).moisture);
  state.simulation.parameters.deepCoolingSeconds = 15;
  assert.equal(room.simulation.parameters.deepCoolingSeconds, 150);
  await assert.rejects(room.setParameters({ unknown: 100 }), /invalid/);
});

test('atomic persistence restores full precision and parameters, never active participants or holds', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wildfire-room-'));
  const persistencePath = path.join(directory, 'performance-state.json');
  try {
    const first = await fixture({ persistencePath });
    const welcome = join(first.room, 'must-not-be-persisted'); hold(first.room, welcome);
    first.time.now = 325; first.room.advance();
    await first.room.setParameters({ deepCoolingSeconds: 135 });
    await first.room.persist();
    const raw = await readFile(persistencePath, 'utf8');
    assert.equal(raw.includes('must-not-be-persisted'), false);
    assert.equal(raw.includes('"holding":'), false);
    const payload = JSON.parse(raw);
    const second = await fixture({ persistencePath }, false);
    assert.equal(second.room.bootstrapAvailable, false);
    assert.equal(second.room.wireState().joinedCount, 0);
    assert.equal(second.room.wireState().activeCount, 0);
    close(second.room.simulation.totalWater, payload.simulation.totalWater);
    assert.equal(second.room.simulation.parameters.deepCoolingSeconds, 135);
    assert.notEqual(second.room.epoch, first.room.epoch);
    second.time.now = 5000; second.room.advance();
    close(second.room.simulation.totalWater, payload.simulation.totalWater);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('invalid persisted state leaves the bootstrap choice available', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wildfire-room-invalid-'));
  const persistencePath = path.join(directory, 'performance-state.json');
  try {
    await writeFile(persistencePath, '{bad JSON');
    const { room } = await fixture({ persistencePath }, false);
    assert.equal(room.bootstrapAvailable, true);
    assert.equal(room.simulation.sample(...position).heat, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('region masks partition Indonesian land patches and every screen position maps to its assigned land', () => {
  const catalog = new RegionCatalog(records), seen = new Set();
  for (const region of catalog.regions.values()) {
    assert.ok(region.cells.size > 0);
    for (const key of region.cells.keys()) { assert.equal(seen.has(key), false); seen.add(key); }
    for (let y = 0; y <= 10; y += 1) for (let x = 0; x <= 10; x += 1) {
      const geographic = catalog.map(region.id, [x / 10, y / 10]);
      assert.ok(region.cells.has(regionCellKey(...geographic)));
    }
  }
  for (const input of [[-0.01, .5], [1.01, .5], [Infinity, 0], [0], ['0', 0], null]) assert.equal(normalizedPositionValid(input), false);
});

test('new audience members balance across island groups while reconnects keep their assignment and number', async () => {
  const { room } = await fixture();
  const welcomes = Array.from({ length: REGION_DEFINITIONS.length * 2 }, (_, index) => join(room, `balanced-${index}`));
  const counts = new Map();
  for (const welcome of welcomes) counts.set(welcome.assignment.id, (counts.get(welcome.assignment.id) || 0) + 1);
  assert.equal(counts.size, REGION_DEFINITIONS.length);
  assert.deepEqual([...counts.values()], Array(REGION_DEFINITIONS.length).fill(2));
  assert.equal(welcomes[0].assignment.id, 'kalimantan', 'Tie-breaking prioritizes a region with current source fires.');
  const returning = welcomes[0];
  hold(room, returning);
  room.disconnect(returning.connectionId);
  const rejoined = join(room, 'balanced-0');
  assert.deepEqual(rejoined.assignment, returning.assignment);
  assert.equal(rejoined.participantNumber, returning.participantNumber);
  assert.equal(room.phoneState(rejoined.connectionId).own.holding, false);
});

test('audience cannot forge geographic positions or choose a different region', async () => {
  const { room, time } = await fixture();
  const welcome = join(room);
  assert.throws(() => hold(room, welcome, 0, true, { space: 'geographic', position }), /assigned-region/);
  assert.throws(() => hold(room, welcome, 0, true, { position }), /outside the assigned screen/);
  assert.throws(() => hold(room, welcome, 0, true, { position: [1.001, .5] }), /outside the assigned screen/);
  assert.throws(() => hold(room, welcome, 0, true, { path: [[.5, 1.001]] }), /valid positions/);
  hold(room, welcome, 0, true, { regionId: 'papua', assignment: { id: 'papua' }, position: [0, 0] });
  time.now = 500; room.advance();
  const actor = room.wireState().participants[0];
  assert.equal(actor.regionId, welcome.assignment.id);
  assert.deepEqual(actor.position, room.regions.map(welcome.assignment.id, [0, 0]));
});

test('clipped regional brushes conserve applied water at all screen corners and never spill into another region', async () => {
  const { room } = await fixture({ records: [] });
  const welcomes = Array.from({ length: REGION_DEFINITIONS.length }, (_, index) => join(room, `corners-${index}`));
  for (const welcome of welcomes) for (const screen of [[0, 0], [1, 0], [0, 1], [1, 1], [.5, .5]]) {
    const simulation = new RainSimulation();
    const region = room.regions.regions.get(welcome.assignment.id);
    const geographic = room.regions.map(region.id, screen);
    simulation.step(.001, [{ path: [geographic], strength: .5, constraint: region.constraint }]);
    close(simulation.totalWater, area * .5 * .001);
    let moisture = 0;
    for (const [key, cell] of simulation.cells) {
      assert.ok(region.cells.has(key), `${region.id} spilled into ${key}`);
      moisture += cell.moisture;
    }
    // At this very short interval no patch saturates. Exact infiltration thus
    // recovers the total applied rate, independently of the budget counter.
    close(moisture / (MOISTURE_RETENTION_SECONDS / MOISTURE_UPTAKE_SECONDS * -Math.expm1(-.001 / MOISTURE_RETENTION_SECONDS)), area * .5, 1e-7);
  }
});

test('sweeps between separate land branches stay assigned and share the stationary time budget', async () => {
  const { room } = await fixture({ records: [] });
  const catalog = room.regions;
  for (const region of catalog.regions.values()) {
    const simulation = new RainSimulation();
    const path = [[0, 0], [1, 1], [0, 1], [1, 0]].map(point => catalog.map(region.id, point));
    simulation.step(.01, [{ path, strength: .5, constraint: region.constraint }]);
    close(simulation.totalWater, area * .5 * .01);
    for (const key of simulation.cells.keys()) assert.ok(region.cells.has(key), `${region.id} sweep spilled into ${key}`);
  }
});

test('participants sharing one region overlap additively without a second brush per participant', async () => {
  const { room, time } = await fixture();
  const welcomes = Array.from({ length: REGION_DEFINITIONS.length + 1 }, (_, index) => join(room, `overlap-${index}`));
  const first = welcomes[0], second = welcomes.at(-1);
  assert.equal(first.assignment.id, second.assignment.id);
  hold(room, first, 0, true, { pointers: [[0, 0], [1, 1]], strength: 100 });
  hold(room, second);
  time.now = 10; room.advance();
  const region = room.regions.regions.get(first.assignment.id);
  const control = new RainSimulation().seed(records).step(.01, [{ path: [room.regions.map(region.id, [.5, .5])], strength: 1, constraint: region.constraint }]);
  close(room.simulation.totalWater, control.totalWater);
  for (const [key, cell] of control.cells) close(room.simulation.cells.get(key).moisture, cell.moisture);
});

test('phone summaries contain only the assigned region and own control state, with reusable regional calculation', async () => {
  const { room, time } = await fixture();
  const welcomes = Array.from({ length: REGION_DEFINITIONS.length + 1 }, (_, index) => join(room, `summary-${index}`));
  hold(room, welcomes[0]);
  time.now = 100; room.advance();
  const summaries = new Map();
  const first = room.phoneState(welcomes[0].connectionId, summaries);
  const sameRegion = room.phoneState(welcomes.at(-1).connectionId, summaries);
  assert.equal(first.type, 'summary');
  assert.equal(first.simulation, undefined);
  assert.equal(first.participants, undefined);
  assert.equal(first.region.cells, undefined);
  assert.equal(first.own.holding, true);
  assert.equal(sameRegion.own.holding, false);
  assert.equal(first.region, sameRegion.region);
  assert.equal(summaries.size, 1);
  assert.equal(first.region.activeCount, 1);
  assert.equal(first.region.fireCells, 1);
  assert.equal(first.joinedCount, welcomes.length);
  const { scene, ...regional } = first;
  assert.ok(JSON.stringify(regional).length < 1300, 'Regional state stays compact independently of the shared score.');
  const { programNotes, ...scoreSettings } = scene.settings;
  assert.equal(typeof programNotes, 'string');
  assert.ok(JSON.stringify({ ...first, scene: { ...scene, settings: scoreSettings } }).length < 3100,
    'The shared score stays compact independently of editable program-note length.');
});

test('all phone assignments share exact global source-fire progress without another scan per phone', async () => {
  const sourceRecords = [
    { longitude: 110.125, latitude: -2.125 },
    { longitude: 110.625, latitude: -2.125 },
    { longitude: 101.125, latitude: -1.125 },
  ];
  const { room } = await fixture({ records: sourceRecords });
  const first = join(room, 'global-progress-kalimantan');
  const second = join(room, 'global-progress-sumatra');
  const national = room.connect({ clientId: 'global-progress-country', scope: 'indonesia' });
  assert.equal(first.assignment.id, 'kalimantan');
  assert.equal(second.assignment.id, 'sumatra');
  const otherRegionFire = room.simulation.cells.get(regionCellKey(101.125, -1.125));
  Object.assign(otherRegionFire, { heat: 0, moisture: 1, extinguished: true });
  // Rounded zero heat is not an authoritative extinction report.
  Object.assign(room.simulation.cells.get(regionCellKey(110.125, -2.125)), { heat: .00001, moisture: .2 });
  room.simulation.cells.get(regionCellKey(110.625, -2.125)).moisture = .6;
  let globalScans = 0;
  room.national.fireKeys[Symbol.iterator] = function* () { globalScans++; yield* Set.prototype.values.call(this); };
  const summaries = new Map();
  const before = JSON.stringify(room.simulation.serialize());
  const a = room.phoneState(first.connectionId, summaries);
  const b = room.phoneState(second.connectionId, summaries);
  const country = room.phoneState(national.connectionId, summaries);
  assert.equal(a.region.extinguishedCells, 0);
  assert.equal(b.region.extinguishedCells, 1);
  assert.deepEqual(a.fireProgress, { sourceCount: 3, outCount: 1 });
  assert.equal(a.fireProgress, b.fireProgress);
  assert.equal(a.fireProgress, country.fireProgress);
  assert.deepEqual(a.soundCondition, { stage: 2, steps: 8, sourceCount: 3, outCount: 1, heat: .3333, moisture: .6, surfaceWetness: 0 });
  assert.equal(a.soundCondition, b.soundCondition);
  assert.equal(a.soundCondition, country.soundCondition);
  assert.ok(JSON.stringify(a.soundCondition).length < 160, 'Global sound needs only a compact condition.');
  assert.equal(globalScans, 1);
  assert.equal(summaries.size, 3, 'The broadcast cache still contains only region entries.');
  assert.equal(JSON.stringify(room.simulation.serialize()), before, 'Progress reads do not change cooling or water.');
  for (const key of room.national.fireKeys) Object.assign(room.simulation.cells.get(key), { heat: 0, extinguished: true });
  const next = room.phoneState(first.connectionId);
  assert.deepEqual(next.fireProgress, { sourceCount: 3, outCount: 3 });
  assert.deepEqual(next.soundCondition, { stage: 8, steps: 8, sourceCount: 3, outCount: 3, heat: 0, moisture: .6, surfaceWetness: 0 });
  assert.notEqual(next.soundCondition, a.soundCondition, 'A fresh broadcast reads a fresh global condition.');
});

test('phone global sound has nine discrete stages and reserves pure crickets for exact completion', async () => {
  const sourceRecords = Array.from({ length: 16 }, (_, index) => ({ longitude: 110.125 + index * .25, latitude: -2.125 }));
  const { room } = await fixture({ records: sourceRecords });
  const phone = join(room, 'sound-stages');
  const fires = [...room.national.fireKeys].map(key => room.simulation.cells.get(key));
  const stages = new Set();
  for (let outCount = 0; outCount <= fires.length; outCount++) {
    if (outCount) Object.assign(fires[outCount - 1], { heat: 0, extinguished: true });
    const condition = room.phoneState(phone.connectionId).soundCondition;
    assert.equal(condition.stage, Math.floor(outCount * 8 / fires.length));
    assert.equal(condition.steps, 8);
    assert.equal(condition.sourceCount, fires.length);
    assert.equal(condition.outCount, outCount);
    assert.equal(condition.heat, (fires.length - outCount) / fires.length);
    assert.ok(Number.isInteger(condition.stage) && condition.stage >= 0 && condition.stage <= 8);
    assert.equal(condition.stage === 8, outCount === fires.length);
    stages.add(condition.stage);
  }
  assert.deepEqual([...stages], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('phone fire progress counts the current snapshot and excludes historic extinguished fires', async () => {
  const { room } = await fixture();
  const phone = join(room, 'refresh-progress');
  const historic = room.simulation.cells.get(regionCellKey(...position));
  Object.assign(historic, { heat: 0, moisture: 1, extinguished: true });
  assert.deepEqual(room.phoneState(phone.connectionId).fireProgress, { sourceCount: 1, outCount: 1 });
  const freshPosition = [101.125, -1.125];
  room.seed([{ longitude: freshPosition[0], latitude: freshPosition[1] }], 'replacement-source');
  assert.equal(historic.hasFire, true);
  assert.equal(historic.extinguished, true);
  assert.equal(room.simulation.cells.size, 2, 'The simulation retains historical cells.');
  assert.deepEqual(room.phoneState(phone.connectionId).fireProgress, { sourceCount: 1, outCount: 0 });
  const fresh = room.simulation.cells.get(regionCellKey(...freshPosition));
  Object.assign(fresh, { heat: .7, moisture: .3, surfaceWetness: 0 });
  // Rain may create non-source land cells, which must not dilute the bed.
  Object.assign(room.simulation._cell(111.125, -2.125), { heat: 0, moisture: 1 });
  assert.deepEqual(room.phoneState(phone.connectionId).soundCondition,
    { stage: 0, steps: 8, sourceCount: 1, outCount: 0, heat: .7, moisture: .3, surfaceWetness: 0 });
  Object.assign(fresh, { heat: 0, extinguished: true });
  assert.deepEqual(room.phoneState(phone.connectionId).fireProgress, { sourceCount: 1, outCount: 1 });
  assert.deepEqual(room.phoneState(phone.connectionId).soundCondition,
    { stage: 8, steps: 8, sourceCount: 1, outCount: 1, heat: 0, moisture: .3, surfaceWetness: 0 });
  room.seed([], 'empty-source');
  assert.deepEqual(room.phoneState(phone.connectionId).fireProgress, { sourceCount: 0, outCount: 0 });
  assert.deepEqual(room.phoneState(phone.connectionId).soundCondition,
    { stage: 0, steps: 8, sourceCount: 0, outCount: 0, heat: 0, moisture: 0, surfaceWetness: 0 });
});

test('persisted hashed identities preserve assignments and numbers across server restart without restoring presence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wildfire-identities-'));
  try {
    const persistencePath = path.join(directory, 'performance-state.json');
    const first = await fixture({ persistencePath });
    const original = join(first.room, 'persistent-phone');
    hold(first.room, original);
    first.time.now = 100;
    await first.room.persist();
    const raw = await readFile(persistencePath, 'utf8');
    assert.equal(raw.includes('persistent-phone'), false);
    assert.equal(raw.includes('"holding":'), false);
    const second = await fixture({ persistencePath });
    assert.equal(second.room.wireState().joinedCount, 0);
    const restored = join(second.room, 'persistent-phone');
    assert.deepEqual(restored.assignment, original.assignment);
    assert.equal(restored.participantNumber, original.participantNumber);
    assert.equal(second.room.phoneState(restored.connectionId).own.holding, false);
    const newcomer = join(second.room, 'new-phone');
    assert.ok(newcomer.participantNumber > restored.participantNumber);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('stationary assigned-region holds reach lasting out at default and minimum timing with exact half-strength water', async () => {
  const catalog = new RegionCatalog();
  const minimum = Object.fromEntries(Object.entries(PARAMETER_LIMITS).map(([key, value]) => [key, value.min]));
  for (const region of catalog.regions.values()) for (const [parameters, strength, duration] of [[DEFAULT_PARAMETERS, .5, 24.7], [minimum, .5, 5.5], [minimum, .1, 12.1]]) {
    const geographic = catalog.map(region.id, [.5, .5]);
    const { room, time } = await fixture({ records: [{ longitude: geographic[0], latitude: geographic[1] }] });
    await room.setParameters(parameters);
    await room.setStrength(strength);
    const welcome = join(room);
    assert.equal(welcome.assignment.id, region.id);
    hold(room, welcome, 0, true, { start: true });
    let seq = 1;
    for (let tick = 1; tick <= Math.round(duration * 20); tick++) {
      time.now = tick * 50;
      if (tick % 10 === 0) hold(room, welcome, seq++, true, { start: false });
      room.advance();
      if (tick === 1) assert.equal(room.simulation.sample(...geographic).extinguished, false, 'A tap is not extinction');
      if (tick === 40) assert.ok(room.simulation.sample(...geographic).surfaceWetness > (strength === .1 ? .3 : .58));
    }
    close(room.simulation.totalWater, area * strength * duration, 1e-7);
    assert.equal(room.simulation.sample(...geographic).extinguished, true, `${region.id} did not go out in ${duration}s`);
    const summary = room.phoneState(welcome.connectionId).region;
    assert.equal(summary.heat, 0);
    assert.equal(summary.fireCells, 1);
    assert.equal(summary.extinguishedCells, 1);
    hold(room, welcome, seq++, false);
    time.now += 86400000;
    room.advance();
    assert.equal(room.simulation.sample(...geographic).extinguished, true);
  }
});

test('renewal and frame subdivisions preserve actual out timing as well as the water budget', async () => {
  const geographic = new RegionCatalog().map('kalimantan', [.5, .5]);
  const scenarios = [];
  for (const [tickMs, renewMs] of [[50, 500], [25, 100], [500, 500]]) {
    const { room, time } = await fixture({ records: [{ longitude: geographic[0], latitude: geographic[1] }] });
    const welcome = join(room);
    hold(room, welcome, 0, true, { start: true });
    let seq = 1;
    for (let now = tickMs; now <= 22000; now += tickMs) {
      time.now = now;
      if (now % renewMs === 0) hold(room, welcome, seq++, true, { start: false, path: [[.5, .5], [.5, .5]] });
      room.advance();
    }
    scenarios.push({ cell: room.simulation.sample(...geographic), water: room.simulation.totalWater, actorRevision: room.actorRevision });
    time.now = 22200; hold(room, welcome, seq++, true, { start: false });
    time.now = 24000; hold(room, welcome, seq++, true, { start: false });
    time.now = 24500; room.advance();
    assert.equal(room.simulation.sample(...geographic).extinguished, false);
    time.now = 24600; room.advance();
    assert.equal(room.simulation.sample(...geographic).extinguished, true);
  }
  for (const actual of scenarios.slice(1)) {
    close(actual.water, scenarios[0].water, 1e-7);
    assert.equal(actual.actorRevision, scenarios[0].actorRevision);
    for (const name of ['surfaceWetness', 'moisture', 'heat', 'settledFor']) close(actual.cell[name], scenarios[0].cell[name]);
  }
});

test('legacy room saves gain faster minimum timing without resetting geographic state or stable identities', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wildfire-legacy-physics-'));
  try {
    const persistencePath = path.join(directory, 'performance-state.json');
    const first = await fixture({ persistencePath });
    const original = join(first.room, 'legacy-physics-phone');
    hold(first.room, original);
    first.time.now = 1000;
    await first.room.persist();
    const legacy = JSON.parse(await readFile(persistencePath, 'utf8'));
    legacy.simulation.schemaVersion = 2;
    legacy.simulation.parameters = { fireReturnSeconds: 3, rainResponseSeconds: 1, deepCoolingSeconds: 15, extinctionHoldSeconds: 0 };
    await writeFile(persistencePath, JSON.stringify(legacy));
    const second = await fixture({ persistencePath });
    assert.deepEqual(second.room.simulation.parameters, { fireReturnSeconds: 3, rainResponseSeconds: .5, deepCoolingSeconds: 2, extinctionHoldSeconds: 0 });
    assert.deepEqual(second.room.simulation.serialize().cells, legacy.simulation.cells);
    assert.deepEqual(second.room.simulation.sourceRecords, legacy.simulation.sourceRecords);
    close(second.room.simulation.totalWater, legacy.simulation.totalWater);
    assert.equal(second.room.wireState().activeCount, 0);
    const restored = join(second.room, 'legacy-physics-phone');
    assert.deepEqual(restored.assignment, original.assignment);
    assert.equal(restored.participantNumber, original.participantNumber);
    await second.room.persist();
    const current = JSON.parse(await readFile(persistencePath, 'utf8'));
    assert.equal(current.simulation.schemaVersion, 3);
    const third = await fixture({ persistencePath });
    assert.deepEqual(third.room.simulation.serialize(), second.room.simulation.serialize());
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('ongoing audience gestures keep cooling into forest takeover and clear only when the fifth cue starts', async () => {
  const { room, time } = await fixture();
  const phone = join(room, 'continuing-rain');
  hold(room, phone);
  time.now = 200; room.advance();
  const before = room.simulation.totalWater;
  await room.setScene({ scene: 'forest-takeover' });
  assert.equal(room.wireState().activeCount, 1); assert.equal(room.sceneState().audienceEnabled, true);
  time.now = 400; room.advance();
  close(room.simulation.totalWater - before, before * .6);
  assert.equal(room.strength, .5, 'The scene reduction leaves the operator’s saved rain strength intact.');
  assert.equal(hold(room, phone, 1, true, { start: false }).holding, true, 'Continuing the gesture does not require a new press.');
  await room.setScene({ action: 'pause' });
  assert.equal(room.wireState().activeCount, 0);
  assert.throws(() => hold(room, phone, 2, true), /Participation and Forest takeover/);
  await room.setScene({ action: 'resume' });
  assert.throws(() => hold(room, phone, 2, true, { start: false }), /press again/i);
  assert.equal(hold(room, phone, 3, true, { start: true }).holding, true);
  await room.setScene({ scene: 'final-rain' });
  assert.equal(room.sceneState().cue, 5); assert.equal(room.sceneState().pendingFinalRain, false);
  assert.equal(room.sceneState().elapsedMs, 0); assert.equal(room.wireState().activeCount, 0);
  assert.throws(() => hold(room, phone, 4, true), /Participation and Forest takeover/);
});

test('new texture and forest settings are copied in all room snapshots', async () => {
  const { room } = await fixture();
  const phone = join(room, 'timing-copy');
  const settings = { forestRiseSeconds: 60, finalRainRiseSeconds: 90, residueMorphSeconds: 12, residueFadeSeconds: 40 };
  await room.setScene({ settings });
  for (const state of [room.wireState(), room.phoneState(phone.connectionId), room._envelope()]) {
    const copy = state.scene?.settings || state.sceneSettings;
    for (const [key, value] of Object.entries(settings)) assert.equal(copy[key], value);
    copy.forestRiseSeconds = 1; copy.finalRainRiseSeconds = 10; copy.residueMorphSeconds = 1; copy.residueFadeSeconds = 1;
  }
  for (const [key, value] of Object.entries(settings)) assert.equal(room.sceneState().settings[key], value);
});

test('finale ground cooling follows the configured 10 to 180 second rain rise for both phones and projection', async () => {
  const sources = [{ longitude: 101.125, latitude: -1.125 }, ...records, { longitude: 136.125, latitude: -3.125 }];
  for (const duration of [10, 60, 180]) {
    const { room, time } = await fixture({ records: sources });
    const phone = join(room, `finale-${duration}`);
    await room.setParameters({ deepCoolingSeconds: duration === 60 ? 240 : 2, extinctionHoldSeconds: duration === 60 ? 60 : 0 });
    await room.setScene({ scene: 'final-rain', settings: { finalRainRiseSeconds: duration } });
    const entry = room.simulation.serialize();
    assert.equal(room.sceneState().audienceEnabled, false);
    for (const fraction of [.25, .5, .75, .99]) {
      time.now = duration * fraction * 1000; time.wall = 100000 + time.now; room.advance();
      const progress = room.sceneState().finalRainProgress;
      for (const record of sources) {
        const cell = room.simulation.sample(record.longitude, record.latitude);
        close(cell.heat, 1 - progress); close(cell.moisture, progress); close(cell.surfaceWetness, progress);
        assert.equal(cell.extinguished, false, 'Even the fastest participation settings cannot extinguish ahead of the rain envelope.');
      }
      assert.equal(room.globalSound().fireProgress.outCount, 0);
      close(room.simulation.totalWater, sources.length * finalRainIntegral(time.now, duration * 1000) / 1000);
      assert.deepEqual(room.wireState().soundCondition, room.phoneState(phone.connectionId).soundCondition);
      const sampled = room.simulation.serialize(); room.wireState(); room.phoneState(phone.connectionId); room.sceneState();
      assert.deepEqual(room.simulation.serialize(), sampled, 'Reading every display adds neither cooling nor water.');
    }
    time.now = duration * 1000; time.wall = 100000 + time.now; room.advance();
    assert.equal(room.sceneState().id, 'afterglow');
    assert.equal(room.globalSound().fireProgress.outCount, sources.length);
    for (const record of sources) {
      const cell = room.simulation.sample(record.longitude, record.latitude);
      assert.equal(cell.heat, 0); assert.equal(cell.moisture, 1); assert.equal(cell.extinguished, true);
    }
    assert.deepEqual(room.simulation.sourceRecords, entry.sourceRecords);
    assert.deepEqual(room.simulation.parameters, entry.parameters);
    close(room.simulation.totalWater, sources.length * duration / 2);
    assert.equal(room.simulation.finalRainCooling, null);
  }
});

test('live finale duration edits preserve cooled ground and reentry captures a fresh field without adding water', async () => {
  const { room, time } = await fixture();
  await room.setScene({ scene: 'final-rain' });
  time.now = 30000; time.wall += 30000; room.advance();
  const halfway = room.simulation.serialize();
  await room.setScene({ settings: { finalRainRiseSeconds: 120 } });
  assert.deepEqual(room.simulation.serialize(), halfway, 'Lengthening the rise cannot reheat the ground or undo absorbed water.');
  time.now = 40000; time.wall += 10000; room.advance();
  close(room.simulation.sample(...position).heat, .5);
  await room.setScene({ settings: { finalRainRiseSeconds: 60 } });
  const advanced = room.simulation.sample(...position), water = room.simulation.totalWater;
  close(advanced.heat, 1 - room.sceneState().finalRainProgress);
  assert.ok(advanced.heat < .5, 'Shortening the rise applies its current shared progress.');
  await room.setScene({ action: 'pause' });
  const paused = room.simulation.serialize();
  time.now += 20000; time.wall += 20000; room.advance();
  assert.deepEqual(room.simulation.serialize(), paused);
  await room.setScene({ action: 'resume' });
  await room.setScene({ scene: 'final-rain' });
  assert.deepEqual(room.simulation.serialize(), paused, 'Reentry begins at the current condition without a cell reset.');
  assert.equal(room.sceneState().elapsedMs, 0);
  time.now += 30000; time.wall += 30000; room.advance();
  close(room.simulation.sample(...position).heat, advanced.heat / 2);
  close(room.simulation.totalWater, water + finalRainIntegral(30000) / 1000);
  await room.setScene({ scene: 'forest-takeover' });
  assert.equal(room.simulation.finalRainCooling, null);
});

test('shortening an active finale past its current age starts the release immediately without extra rainfall', async () => {
  const { room, time } = await fixture();
  await room.setScene({ scene: 'final-rain' });
  time.now = 30000; time.wall += 30000; room.advance();
  const water = room.simulation.totalWater;
  await room.setScene({ settings: { finalRainRiseSeconds: 10 } });
  assert.equal(room.sceneState().id, 'afterglow'); assert.equal(room.sceneState().elapsedMs, 0);
  assert.equal(room.sceneState().rainIntensity, 1);
  assert.equal(room.simulation.sample(...position).extinguished, true);
  assert.equal(room.simulation.totalWater, water);
  time.now += 1000; time.wall += 1000; room.advance();
  assert.equal(room.sceneState().elapsedMs, 1000);
  assert.equal(room.simulation.totalWater, water);
});
