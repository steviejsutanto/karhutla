import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import QRCode from 'qrcode';
import { createPerformanceServer } from '../app/server.mjs';
import { wireCellKey } from '../app/wire-state.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const position = [110.125, -2.125];
const records = [{ longitude: position[0], latitude: position[1] }];

function requestFrom(instance, remoteAddress, url) {
  return new Promise(resolve => {
    let status;
    instance.server.emit('request', { method: 'GET', url, headers: {}, socket: { remoteAddress } }, {
      setHeader() {},
      writeHead(code) { status = code; },
      end(body) { resolve({ status, body: JSON.parse(body) }); },
    });
  });
}

function operatorUpgradeFrom(instance, remoteAddress) {
  return new Promise(resolve => {
    const socket = { remoteAddress, on() {}, once() {}, setNoDelay() {}, destroy() {}, end: resolve };
    instance.server.emit('upgrade', { method: 'GET', url: '/ws?role=operator&clientId=changing-host',
      headers: {}, socket }, socket, Buffer.alloc(0));
  });
}

test('session and QR targets follow interface changes after listening without replacing the published network', async t => {
  const first = '192.168.11.110', current = '192.168.10.101';
  const interfaces = { en0: [{ address: first, family: 'IPv4', internal: false }] };
  const instance = await createPerformanceServer({ port: 0, lanEnabled: true, rootDir,
    persistencePath: null, autoTick: false, records, networkInterfaces: interfaces });
  t.after(() => instance.close());
  const { port } = await instance.listen();
  const base = `http://127.0.0.1:${port}`;
  const published = instance.network, addresses = published.addresses, ownAddresses = published.ownAddresses;
  const session = async () => (await fetch(`${base}/api/session`)).json();
  assert.equal((await session()).joinUrl, `http://${first}:${port}/join`);

  interfaces.en0[0].address = current;
  const updated = await session();
  assert.deepEqual(updated.joinUrls, [`http://${current}:${port}/join`]);
  assert.equal(updated.networkAvailable, true);
  assert.equal(instance.network, published); assert.equal(published.addresses, addresses); assert.equal(published.ownAddresses, ownAddresses);
  assert.deepEqual(addresses, [current]); assert.equal(ownAddresses.has(first), false); assert.equal(ownAddresses.has(current), true);

  const qrOptions = { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 280 };
  // Exercise QR refresh directly, without a preceding session request.
  interfaces.en0[0].address = first;
  assert.equal(await (await fetch(`${base}/api/qr.svg`)).text(), await QRCode.toString(`http://${first}:${port}/join`, qrOptions));
  interfaces.en0[0].address = current;
  const qr = await (await fetch(`${base}/api/qr.svg?view=peat`)).text();
  assert.equal(qr, await QRCode.toString(`http://${current}:${port}/study/phone`, qrOptions));
  assert.notEqual(qr, await QRCode.toString(`http://${first}:${port}/study/phone`, qrOptions));
  assert.deepEqual(addresses, [current]);

  delete interfaces.en0;
  const unavailable = await session();
  assert.equal(unavailable.networkAvailable, false);
  assert.deepEqual(unavailable.joinUrls, [`http://127.0.0.1:${port}/join`]);
  assert.deepEqual(addresses, []); assert.equal(ownAddresses.has(current), false);
  assert.equal(ownAddresses.has('127.0.0.1'), true);
});

test('operator HTTP and WebSocket checks use current host addresses without waiting for session refresh', async t => {
  const first = '192.168.11.110', current = '192.168.10.101';
  const interfaces = { en0: [{ address: first, family: 'IPv4', internal: false }] };
  const instance = await createPerformanceServer({ port: 0, lanEnabled: true, rootDir,
    persistencePath: null, autoTick: false, records, networkInterfaces: interfaces });
  t.after(() => instance.close());
  await instance.listen();
  const endpoint = '/api/study-region?region=indonesia';
  assert.equal((await requestFrom(instance, first, endpoint)).status, 200);
  interfaces.en0[0].address = current;
  assert.equal((await requestFrom(instance, first, endpoint)).status, 403);
  assert.equal((await requestFrom(instance, current, endpoint)).status, 200);
  assert.equal((await requestFrom(instance, `::ffff:${current}`, endpoint)).status, 200);

  interfaces.en0[0].address = first;
  assert.match(await operatorUpgradeFrom(instance, current), /^HTTP\/1\.1 403 Forbidden/);
  assert.match(await operatorUpgradeFrom(instance, first), /^HTTP\/1\.1 400 Bad Request/,
    'The current host passes authorization and reaches ordinary WebSocket header validation.');
  interfaces.en0[0].address = current;
  assert.match(await operatorUpgradeFrom(instance, first), /^HTTP\/1\.1 403 Forbidden/);
  assert.match(await operatorUpgradeFrom(instance, current), /^HTTP\/1\.1 400 Bad Request/);
  assert.match(await operatorUpgradeFrom(instance, `::ffff:${current}`), /^HTTP\/1\.1 400 Bad Request/);
  delete interfaces.en0;
  assert.equal((await requestFrom(instance, current, endpoint)).status, 403);
  assert.equal((await requestFrom(instance, '127.0.0.1', endpoint)).status, 200, 'Loopback operator access remains available without LAN.');
});

class Peer {
  constructor(url) {
    this.messages = [];
    this.rawMessages = [];
    this.cells = new Map();
    this.waiters = new Set();
    this.socket = new WebSocket(url);
    this.socket.on('error', error => {
      for (const waiter of [...this.waiters]) waiter.finish(error);
    });
    this.socket.on('message', raw => {
      let message = JSON.parse(raw.toString());
      this.rawMessages.push(message);
      if (message.type === 'state') {
        if (!message.simulation.delta) this.cells.clear();
        for (const key of message.simulation.removed || []) this.cells.delete(key);
        for (const row of message.simulation.cells) this.cells.set(wireCellKey(row), row);
        message = { ...message, simulation: { ...message.simulation, cells: [...this.cells.values()] } };
      }
      this.messages.push(message);
      for (const waiter of [...this.waiters]) {
        if (this.messages.length > waiter.after && waiter.predicate(message)) waiter.finish(null, message);
      }
    });
  }

  mark() { return this.messages.length; }

  waitFor(predicate, { after = 0, timeout = 1800 } = {}) {
    const existing = this.messages.slice(after).find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate, after,
        finish: (error, message) => {
          clearTimeout(timer);
          this.waiters.delete(waiter);
          error ? reject(error) : resolve(message);
        },
      };
      const timer = setTimeout(() => waiter.finish(new Error('Timed out waiting for a WebSocket message.')), timeout);
      this.waiters.add(waiter);
    });
  }

  state(predicate = () => true, options) {
    return this.waitFor(message => ['state', 'summary'].includes(message.type) && predicate(message), options);
  }

  actors(predicate = () => true, options) {
    return this.waitFor(message => message.type === 'actors' && predicate(message), options);
  }

  async hold(epoch, seq, holding, extra = {}) {
    const after = this.mark();
    this.socket.send(JSON.stringify({ type: 'hold', epoch, seq, holding, start: true, space: 'region', position: [.5, .5], path: [[.5, .5]], ...extra }));
    return this.waitFor(message => message.type === 'ack' && message.seq === seq && message.epoch === epoch, { after });
  }

  async reject(payload, { binary = false } = {}) {
    const after = this.mark();
    this.socket.send(typeof payload === 'string' ? payload : JSON.stringify(payload), { binary });
    return this.waitFor(message => message.type === 'error', { after });
  }

  terminate() { this.socket.terminate(); }
}

async function fixture(t, { manualClock = false, bootstrap = true, sourceRecords = records } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wildfire-network-'));
  const peers = [];
  let time = 0;
  let instance;
  t.after(async () => {
    for (const peer of peers) peer.terminate();
    try { if (instance) await instance.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  instance = await createPerformanceServer({
    port: 0, lanEnabled: false, rootDir,
    persistencePath: path.join(directory, 'performance.json'),
    autoTick: !manualClock, records: sourceRecords, snapshotVersion: 'test',
    ...(manualClock ? { clock: () => time } : {}),
  });
  const address = await instance.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const post = async (endpoint, body = {}) => {
    const response = await fetch(`${base}/api/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  let initialState;
  if (bootstrap) {
    const result = await post('bootstrap', { state: null, strength: .5 });
    assert.equal(result.status, 200);
    initialState = result.body;
    await post('scene', { scene: 'participation' });
  }
  const connect = async (clientId, role = 'participant', scope = 'region') => {
    const peer = new Peer(`${base.replace('http:', 'ws:')}/ws?role=${role}&clientId=${clientId}&scope=${scope}`);
    peers.push(peer);
    peer.welcome = await peer.waitFor(message => message.type === 'welcome');
    return peer;
  };
  const advance = (milliseconds, { broadcastState = true } = {}) => {
    assert.ok(manualClock, 'Manual time is only used in the deterministic transport test.');
    time += milliseconds;
    instance.tick();
    if (broadcastState) instance.broadcast();
  };
  return { instance, post, connect, advance, initialState };
}

test('regional and country phone sockets receive the same compact global sound condition', { timeout: 8000 }, async t => {
  const sourceRecords = [
    { longitude: 110.125, latitude: -2.125 },
    { longitude: 110.625, latitude: -2.125 },
    { longitude: 101.125, latitude: -1.125 },
  ];
  const { instance, connect } = await fixture(t, { manualClock: true, sourceRecords });
  const first = await connect('macro-first');
  const second = await connect('macro-second');
  const country = await connect('macro-country', 'participant', 'indonesia');
  const phones = [first, second, country];
  await Promise.all(phones.map(phone => phone.state()));
  assert.notEqual(first.welcome.assignment.id, second.welcome.assignment.id);
  assert.equal(country.welcome.assignment.id, 'indonesia');
  const cells = sourceRecords.map(record => instance.room.simulation.cells.get(`${Math.floor(record.longitude / .25)},${Math.floor(record.latitude / .25)}`));
  Object.assign(cells[0], { heat: .8, moisture: .2 });
  Object.assign(cells[1], { heat: .4, moisture: .4, surfaceWetness: 0 });
  Object.assign(cells[2], { heat: 0, moisture: .6, extinguished: true });
  let marks = phones.map(phone => phone.mark());
  instance.broadcast({ forcePhone: true });
  const summaries = await Promise.all(phones.map((phone, index) => phone.state(() => true, { after: marks[index] })));
  const expected = { stage: 2, steps: 8, sourceCount: 3, outCount: 1, heat: .4, moisture: .4, surfaceWetness: 0 };
  for (const summary of summaries) assert.deepEqual(summary.soundCondition, expected);
  assert.notEqual(summaries[0].region.extinguishedCells, summaries[1].region.extinguishedCells,
    'Different local fire conditions do not change the global phone sound.');
  for (const cell of cells) Object.assign(cell, { heat: 0, extinguished: true });
  marks = phones.map(phone => phone.mark());
  instance.broadcast({ forcePhone: true });
  const complete = await Promise.all(phones.map((phone, index) => phone.state(() => true, { after: marks[index] })));
  for (const summary of complete) assert.deepEqual(summary.soundCondition,
    { stage: 8, steps: 8, sourceCount: 3, outCount: 3, heat: 0, moisture: .4, surfaceWetness: 0 });
});

test('two real phones receive only assigned summaries while display deltas retain collective rain', { timeout: 8000 }, async t => {
  const { connect, advance, initialState } = await fixture(t, { manualClock: true });
  const first = await connect('first');
  const second = await connect('second');
  const operator = await connect('operator', 'operator');
  assert.equal(first.welcome.participantNumber, 1);
  assert.equal(second.welcome.participantNumber, 2);
  assert.equal(operator.welcome.participantNumber, 0);
  assert.notEqual(first.welcome.assignment.id, second.welcome.assignment.id);
  const epoch = initialState.epoch;
  await first.hold(epoch, 1, true);
  let mark = operator.mark();
  advance(500);
  const solo = await operator.state(state => state.activeCount === 1 && state.simulation.totalWater > 0, { after: mark });
  const soloBudget = solo.simulation.totalWater;
  await second.hold(epoch, 1, true);
  mark = operator.mark();
  const phoneMark = first.mark();
  advance(500);
  const together = await operator.state(state => state.activeCount === 2, { after: mark });
  const summary = await first.state(state => state.activeCount === 2, { after: phoneMark });
  assert.equal(summary.type, 'summary');
  assert.equal(summary.assignment.id, first.welcome.assignment.id);
  assert.equal(summary.own.holding, true);
  assert.equal(summary.simulation, undefined);
  assert.equal(summary.participants, undefined);
  assert.equal(together.joinedCount, 2);
  assert.equal(together.simulation.wireFormat, 'compact-v1');
  assert.equal(together.simulation.delta, true);
  assert.deepEqual(together.participants.filter(actor => actor.holding).map(actor => actor.number), [1, 2]);
  assert.ok(Math.abs((together.simulation.totalWater - soloBudget) - 2 * soloBudget) < .001);
  assert.ok(together.simulation.cells.some(cell => cell[2] > 0 && cell[3] > 0));
  await first.hold(epoch, 2, false);
  mark = operator.mark();
  advance(500);
  const oneRemains = await operator.state(state => state.activeCount === 1, { after: mark });
  assert.deepEqual(oneRemains.participants.filter(actor => actor.holding).map(actor => actor.number), [2]);
  assert.ok(Math.abs((oneRemains.simulation.totalWater - together.simulation.totalWater) - soloBudget) < .001);
  await second.hold(epoch, 2, false);
  mark = operator.mark();
  advance(500);
  const idle = await operator.state(state => state.activeCount === 0, { after: mark });
  assert.equal(idle.simulation.totalWater, oneRemains.simulation.totalWater);
  assert.ok(first.rawMessages.every(message => message.type !== 'state'));
});

test('a connected socket that stops renewing expires after its hold lease', { timeout: 8000 }, async t => {
  const { connect, initialState } = await fixture(t);
  const audience = await connect('lease');
  const operator = await connect('lease-observer', 'operator');
  await audience.hold(initialState.epoch, 1, true);
  await operator.state(state => state.activeCount === 1);
  const afterActive = operator.mark();
  const expired = await operator.state(state => state.activeCount === 0 && state.simulation.totalWater > 0, { after: afterActive, timeout: 3500 });
  assert.equal(audience.socket.readyState, WebSocket.OPEN, 'The contribution expires even while its socket remains connected.');
  assert.equal(expired.joinedCount, 1);
  const next = await operator.state(state => state.activeCount === 0, { after: operator.mark() });
  assert.equal(next.simulation.totalWater, expired.simulation.totalWater, 'An expired lease emits no more water.');
});

test('regular renewals keep one hold alive beyond its original lease without packet bonuses', { timeout: 8000 }, async t => {
  const { connect, advance, initialState } = await fixture(t, { manualClock: true });
  const audience = await connect('renewing');
  const observer = await connect('renew-observer', 'operator');
  await audience.hold(initialState.epoch, 0, true);
  let lastState;
  for (let seq = 1; seq <= 5; seq += 1) {
    const beforeTick = observer.mark();
    advance(500);
    lastState = await observer.state(state => state.activeCount === 1, { after: beforeTick });
    await audience.hold(initialState.epoch, seq, true);
    const beforeRenewalState = observer.mark();
    advance(0);
    const renewed = await observer.state(state => state.activeCount === 1, { after: beforeRenewalState });
    assert.equal(renewed.simulation.totalWater, lastState.simulation.totalWater, 'A renewal packet adds no water without elapsed server time.');
  }
  assert.ok(lastState.simulation.totalWater > 0);
  const beforeExpiry = observer.mark();
  advance(1999);
  await observer.state(state => state.activeCount === 1, { after: beforeExpiry });
  const afterExpiry = observer.mark();
  advance(2);
  await observer.state(state => state.activeCount === 0, { after: afterExpiry });
});

test('dropping a held connection clears its rain; reconnecting keeps its number and requires a new press', { timeout: 8000 }, async t => {
  const { connect, initialState } = await fixture(t);
  const audience = await connect('returning');
  const operator = await connect('disconnect-observer', 'operator');
  await audience.hold(initialState.epoch, 1, true);
  await operator.state(state => state.activeCount === 1 && state.simulation.totalWater > 0);
  const afterDrop = operator.mark();
  audience.terminate();
  const absent = await operator.state(state => state.activeCount === 0 && state.joinedCount === 0, { after: afterDrop });
  const replacement = await connect('returning');
  assert.equal(replacement.welcome.participantNumber, audience.welcome.participantNumber);
  const returned = await replacement.state(state => state.joinedCount === 1 && state.activeCount === 0);
  assert.equal(returned.own.holding, false);
  assert.deepEqual(replacement.welcome.assignment, audience.welcome.assignment);
  assert.equal((await operator.state(state => state.joinedCount === 1 && state.activeCount === 0, { after: operator.mark() })).simulation.totalWater, absent.simulation.totalWater);
  await replacement.hold(returned.epoch, 0, true);
  await operator.state(state => state.activeCount === 1, { after: operator.mark() });
});

test('reset changes the epoch, retains participant numbers, and rejects pre-reset holds', { timeout: 8000 }, async t => {
  const { connect, post, initialState } = await fixture(t);
  const audience = await connect('reset-audience');
  const operator = await connect('reset-observer', 'operator');
  await audience.hold(initialState.epoch, 5, true);
  await operator.state(state => state.activeCount === 1 && state.simulation.totalWater > 0);
  const beforeReset = operator.mark();
  const reset = await post('reset');
  assert.equal(reset.status, 200);
  assert.notEqual(reset.body.epoch, initialState.epoch);
  assert.equal(reset.body.activeCount, 0);
  assert.equal(reset.body.simulation.totalWater, 0);
  assert.equal(reset.body.participants.find(participant => participant.id === 'reset-audience').number, audience.welcome.participantNumber);
  await operator.state(state => state.epoch === reset.body.epoch && state.activeCount === 0, { after: beforeReset });
  const error = await audience.reject({ type: 'hold', epoch: initialState.epoch, seq: 6, holding: true, position });
  assert.match(error.message, /changed|current|performance/i);
  const idle = await operator.state(state => state.epoch === reset.body.epoch, { after: operator.mark() });
  assert.equal(idle.activeCount, 0);
  assert.equal(idle.simulation.totalWater, 0);
  await post('scene', { scene: 'participation' });
  await audience.hold(reset.body.epoch, 0, true);
  const fresh = await operator.state(state => state.activeCount === 1 && state.simulation.totalWater > 0, { after: operator.mark() });
  assert.equal(fresh.epoch, reset.body.epoch);
});

test('malformed, duplicate, replayed and forged-state messages cannot resurrect released rain', { timeout: 8000 }, async t => {
  const { connect, initialState } = await fixture(t);
  const audience = await connect('invalid-input');
  const operator = await connect('invalid-observer', 'operator');
  const epoch = initialState.epoch;
  await audience.hold(epoch, 10, true);
  await operator.state(state => state.activeCount === 1 && state.simulation.totalWater > 0);
  await audience.hold(epoch, 11, false);
  const idle = await operator.state(state => state.activeCount === 0 && state.simulation.totalWater > 0, { after: operator.mark() });
  const cases = [
    '{invalid json',
    { type: 'hold', epoch, seq: 10, holding: true, position },
    { type: 'hold', epoch, seq: 11, holding: true, position },
    { type: 'hold', epoch, seq: 12, holding: 'true', position },
    { type: 'hold', epoch, seq: 12, holding: true, position: [999, 0] },
    { type: 'hold', epoch, seq: 12, holding: true, position, path: [[110, NaN]] },
    { type: 'hold', epoch: 'previous-performance', seq: 12, holding: true, position },
    { type: 'state', epoch, simulation: { totalWater: 1e9, cells: [] } },
  ];
  for (const message of cases) assert.ok((await audience.reject(message)).message);
  await audience.reject({ type: 'hold', epoch, seq: 12, holding: true, position }, { binary: true });
  const unchanged = await operator.state(state => state.activeCount === 0, { after: operator.mark() });
  assert.equal(unchanged.simulation.totalWater, idle.simulation.totalWater);
  assert.ok(unchanged.simulation.cells.length > 0, 'Client payloads cannot replace the server simulation.');
  await audience.hold(epoch, 12, true);
  await operator.state(state => state.activeCount === 1, { after: operator.mark() });
});

test('rain requires operator bootstrap and a second bootstrap cannot replace the performance', { timeout: 8000 }, async t => {
  const { connect, post } = await fixture(t, { bootstrap: false });
  const audience = await connect('before-bootstrap');
  const waiting = await audience.state(state => state.bootstrapAvailable);
  await audience.reject({ type: 'hold', epoch: waiting.epoch, seq: 0, holding: true, position });
  const started = await post('bootstrap', { state: null, strength: .5 });
  assert.equal(started.status, 200);
  const duplicate = await post('bootstrap', { state: null, strength: 1 });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.length > 0, true);
  await post('scene', { scene: 'participation' });
  await audience.hold(started.body.epoch, 0, true);
  const active = await audience.state(state => state.activeCount === 1, { after: audience.mark() });
  assert.equal(active.strength, .5);
});


test('display resync and reconnect deliver fresh baselines; idle deltas omit unchanged cells', { timeout: 8000 }, async t => {
  const { connect, advance } = await fixture(t, { manualClock: true });
  const display = await connect('sync-display', 'operator');
  const initial = await display.state();
  assert.equal(initial.simulation.delta, false);
  let mark = display.mark();
  advance(0);
  await display.state(() => true, { after: mark });
  const delta = display.rawMessages.findLast(message => message.type === 'state');
  assert.equal(delta.simulation.delta, true);
  assert.equal(delta.baseRevision, initial.revision);
  assert.equal(delta.simulation.cells.length, 0);
  mark = display.mark();
  display.socket.send(JSON.stringify({ type: 'resync' }));
  const fresh = await display.state(state => !state.simulation.delta, { after: mark });
  assert.equal(fresh.baseRevision, null);
  assert.deepEqual(fresh.simulation.cells, initial.simulation.cells);
  display.terminate();
  const replacement = await connect('sync-display', 'operator');
  const reconnected = await replacement.state();
  assert.equal(reconnected.simulation.delta, false);
  assert.deepEqual(reconnected.simulation.cells, initial.simulation.cells);
});

test('phone coordinates and supplied assignment cannot escape the server assignment', { timeout: 8000 }, async t => {
  const { connect, advance, initialState } = await fixture(t, { manualClock: true });
  const phone = await connect('bounded');
  const display = await connect('bounds-display', 'operator');
  await phone.reject({ type: 'hold', epoch: initialState.epoch, seq: 0, holding: true, position });
  await phone.reject({ type: 'hold', epoch: initialState.epoch, seq: 0, holding: true, space: 'region', position: [-1, 0] });
  await phone.hold(initialState.epoch, 1, true, { position: [1, 1], path: [[0, 0], [1, 1]], assignment: { id: 'forged' } });
  const mark = display.mark();
  advance(100);
  const state = await display.state(state => state.activeCount === 1, { after: mark });
  assert.equal(state.participants.find(actor => actor.id === 'bounded').regionId, phone.welcome.assignment.id);
});

test('operator motion receives its ack before a small actor update without waiting for simulation broadcast', { timeout: 8000 }, async t => {
  const { connect, initialState } = await fixture(t, { manualClock: true });
  const phone = await connect('actors-phone');
  const display = await connect('actors-display', 'operator');
  await display.state();
  const mark = display.mark();
  await display.hold(initialState.epoch, 0, true, { position, path: [position], space: 'geographic' });
  const actors = await display.actors(packet => packet.participants.some(actor => actor.id === 'actors-display' && actor.holding), { after: mark });
  const updates = display.rawMessages.slice(mark);
  assert.equal(updates[0].type, 'ack', 'A control acknowledgment is sent before display rendering feedback on the same socket.');
  assert.equal(updates.filter(message => message.type === 'state').length, 0, 'Actors do not trigger a simulation update.');
  assert.deepEqual(display.rawMessages.slice(0, 2).map(message => message.type), ['welcome', 'state']);
  assert.equal(actors.simulation, undefined);
  assert.equal(actors.cells, undefined);
  assert.equal(actors.joinedCount, 1);
  assert.equal(actors.activeCount, 0, 'The operator remains excluded from audience totals.');
  assert.ok(JSON.stringify(actors).length < 1000);
  assert.ok(phone.rawMessages.every(message => message.type !== 'actors' && message.type !== 'state'));
});

test('actor updates carry current movement, release, lease expiry, and participant departure', { timeout: 8000 }, async t => {
  const { instance, connect, advance, initialState } = await fixture(t, { manualClock: true });
  const display = await connect('motion-display', 'operator');
  await display.state();
  const phone = await connect('motion-phone');
  await display.actors(packet => packet.joinedCount === 1);
  await phone.hold(initialState.epoch, 0, true);
  await display.actors(packet => packet.activeCount === 1);
  let mark = display.mark();
  await phone.hold(initialState.epoch, 1, true, { position: [1, 0], path: [[.5, .5], [1, 0]] });
  const expected = instance.room.regions.map(phone.welcome.assignment.id, [1, 0]);
  const moved = await display.actors(packet => packet.participants.some(actor => actor.id === 'motion-phone' && actor.position.every((value, index) => value === expected[index])), { after: mark });
  assert.equal(moved.activeCount, 1);
  mark = display.mark();
  await phone.hold(initialState.epoch, 2, false);
  await display.actors(packet => packet.activeCount === 0, { after: mark });
  mark = display.mark();
  await phone.hold(initialState.epoch, 3, true);
  await display.actors(packet => packet.activeCount === 1, { after: mark });
  mark = display.mark();
  advance(2001, { broadcastState: false });
  const expired = await display.actors(packet => packet.activeCount === 0, { after: mark });
  assert.equal(expired.joinedCount, 1);
  mark = display.mark();
  phone.terminate();
  await display.actors(packet => packet.joinedCount === 0, { after: mark });
});

test('bursts coalesce to latest actor positions and leave the simulation delta baseline intact', { timeout: 8000 }, async t => {
  const { connect, advance, initialState } = await fixture(t, { manualClock: true });
  const display = await connect('burst-display', 'operator');
  const initial = await display.state();
  const mark = display.mark();
  for (let seq = 0; seq < 10; seq += 1) display.socket.send(JSON.stringify({ type: 'hold', epoch: initialState.epoch, seq, holding: true, start: seq === 0, position: [110 + seq / 10, -2], path: [] }));
  await display.waitFor(message => message.type === 'ack' && message.seq === 9, { after: mark });
  const latest = await display.actors(packet => packet.participants.some(actor => actor.position[0] === 110.9), { after: mark });
  const actors = display.rawMessages.slice(mark).filter(message => message.type === 'actors');
  assert.ok(actors.length <= 2, 'One burst has at most its leading update and one coalesced latest update.');
  assert.equal(latest.participants[0].holding, true);
  assert.equal(display.rawMessages.slice(mark).filter(message => message.type === 'ack').length, 10, 'Acks are never coalesced away.');
  const afterActors = display.mark();
  advance(100);
  const state = await display.state(() => true, { after: afterActors });
  assert.equal(state.baseRevision, initial.revision, 'Actor packets do not become a cell-delta baseline.');
  assert.equal(state.simulation.delta, true);
  assert.equal(state.actorRevision, latest.actorRevision);
  assert.equal(state.participants[0].position[0], 110.9);
  assert.ok(state.simulation.totalWater > 0);
});

test('reset sends the new epoch baseline before any new epoch actor motion', { timeout: 8000 }, async t => {
  const { connect, post, initialState } = await fixture(t, { manualClock: true });
  const display = await connect('epoch-display', 'operator');
  const phone = await connect('epoch-phone');
  await display.state();
  await phone.hold(initialState.epoch, 0, true);
  await display.actors(packet => packet.activeCount === 1);
  const mark = display.mark();
  const reset = await post('reset');
  await display.state(packet => packet.epoch === reset.body.epoch, { after: mark });
  await post('scene', { scene: 'participation' });
  await phone.hold(reset.body.epoch, 0, true);
  await display.actors(packet => packet.epoch === reset.body.epoch && packet.activeCount === 1, { after: mark });
  const updates = display.rawMessages.slice(mark).filter(message => message.epoch === reset.body.epoch);
  assert.equal(updates[0].type, 'state');
  assert.equal(updates[0].simulation.delta, false);
  assert.equal(updates[0].baseRevision, null);
});

test('periodic display states are built in the same turn as the latest simulation tick', { timeout: 8000 }, async t => {
  const { connect, instance } = await fixture(t);
  const display = await connect('fresh-state-display', 'operator');
  await display.state();
  const advance = instance.room.advance.bind(instance.room);
  const wireState = instance.room.wireState.bind(instance.room);
  const observations = [];
  let justAdvanced = false, steps = 0;
  instance.room.advance = (...args) => {
    advance(...args);
    steps += 1;
    justAdvanced = true;
    queueMicrotask(() => { justAdvanced = false; });
  };
  instance.room.wireState = () => {
    observations.push({ justAdvanced, steps });
    return wireState();
  };
  for (let index = 0; index < 3; index += 1) {
    const mark = display.mark();
    await display.state(() => true, { after: mark });
  }
  assert.equal(observations.length, 3);
  assert.ok(observations.every(sample => sample.justAdvanced), 'Publishing must not wait for a separate timer after the authority advances.');
  assert.equal(observations[1].steps - observations[0].steps, 2, 'State cadence remains every second 20Hz tick.');
  assert.equal(observations[2].steps - observations[1].steps, 2);
});

test('projection sockets receive full simulation, shared scene and immediate actors but cannot pour', { timeout: 8000 }, async t => {
  const { connect, instance, post, initialState } = await fixture(t, { manualClock: true });
  const projection = await connect('readonly-projection', 'projection');
  const phone = await connect('projection-phone');
  assert.equal(projection.welcome.role, 'projection');
  const baseline = await projection.state();
  assert.ok(baseline.simulation.cells.length > 0); assert.equal(baseline.scene.id, 'participation');
  assert.deepEqual(baseline.soundCondition, instance.room.phoneState(phone.welcome.connectionId).soundCondition);
  const water = instance.room.simulation.totalWater;
  const denied = await projection.reject({ type: 'hold', epoch: initialState.epoch, seq: 0, holding: true, position });
  assert.match(denied.message, /read-only/); assert.equal(instance.room.simulation.totalWater, water);
  const mark = projection.mark(); await phone.hold(initialState.epoch, 0, true);
  const actors = await projection.actors(packet => packet.activeCount === 1, { after: mark });
  assert.ok(actors.participants.some(actor => actor.id === 'projection-phone' && actor.holding));
  const changed = projection.mark(); await post('scene', { scene: 'final-rain' });
  const finale = await projection.state(packet => packet.scene.id === 'final-rain', { after: changed });
  assert.equal(finale.scene.globalRain, true); assert.equal(finale.activeCount, 0);
});

test('projection and audience page requests cannot call operator REST controls even on the host', async t => {
  const { instance } = await fixture(t, { manualClock: true });
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const endpoints = ['scene', 'sound-settings', 'reset', 'strength', 'parameters', 'bootstrap', 'snapshot/refresh'];
  for (const endpoint of endpoints) {
    const response = await fetch(`${base}/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wildfire-Role': 'projection' }, body: '{}' });
    assert.equal(response.status, 403, endpoint);
  }
  for (const page of ['/projection', '/study', '/audience']) {
    const document = await fetch(base + page);
    assert.equal(document.status, 200, page);
    assert.equal(document.headers.get('referrer-policy'), 'same-origin',
      'Same-origin browser fetches must retain the full display page path for read-only authorization.');
    const response = await fetch(`${base}/api/scene`, { method: 'POST', headers: { 'Content-Type': 'application/json', Referer: base + page }, body: JSON.stringify({ scene: 'final-rain' }) });
    assert.equal(response.status, 403, page);
  }
  assert.equal(instance.room.sceneState().id, 'participation');
  const publicScene = await (await fetch(`${base}/api/scene`)).json(); assert.equal(publicScene.id, 'participation');
});

test('operator settings broadcast identically to projection and phones and canonical audience QR follows LAN', async t => {
  const { instance, post, connect } = await fixture(t, { manualClock: true });
  const projection = await connect('settings-projection', 'projection');
  const phone = await connect('settings-phone'); await projection.state(); await phone.state();
  let a = projection.mark(), b = phone.mark();
  const changed = await post('scene', { settings: { wifiName: 'Room Wi-Fi', wifiPassword: 'shared-on-screen', programNotes: 'A shared field.' } });
  assert.equal(changed.status, 200);
  const [displayState, phoneState] = await Promise.all([projection.state(() => true, { after: a }), phone.state(() => true, { after: b })]);
  assert.deepEqual(displayState.scene.settings, phoneState.scene.settings);
  assert.equal(phoneState.scene.settings.programNotes, 'A shared field.');
  a = projection.mark(); b = phone.mark();
  const audio = await post('sound-settings', { automation: false, macros: { forest: .25, haze: .7 }, level: .3, localPitchIndex: 4 });
  assert.equal(audio.status, 200);
  const states = await Promise.all([projection.state(() => true, { after: a }), phone.state(() => true, { after: b })]);
  assert.deepEqual(states[0].soundSettings, states[1].soundSettings);
  assert.equal(states[1].soundSettings.level, .3, 'Phones receive the setting but keep their own output level in the UI.');
  const before = instance.room.soundSettingsState();
  assert.equal((await post('sound-settings', { macros: { rain: 1.5 } })).status, 400);
  assert.deepEqual(instance.room.soundSettingsState(), before);
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const session = await (await fetch(`${base}/api/session`)).json();
  assert.equal(new URL(session.audienceUrl).pathname, '/audience');
  const qr = await (await fetch(`${base}/api/qr.svg?view=audience`)).text();
  assert.equal(qr, await QRCode.toString(session.audienceUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 280 }));
});
