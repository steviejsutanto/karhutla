import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { SharedRoom } from '../app/shared-room.mjs';
import { RainSimulation, BRUSH_RADIUS, CELL_SIZE } from '../app/simulation.js';
import { COUNTRY_BOUNDS, countryPosition } from '../app/national-space.mjs';
import { createPerformanceServer } from '../app/server.mjs';
import { SharedConnection } from '../app/shared-client.js';

const westFire = [100.125, -.125], eastFire = [136.125, -3.125];
const records = [westFire, eastFire].map(([longitude, latitude]) => ({ longitude, latitude }));
const screenFor = ([longitude, latitude]) => [(longitude - 94) / 48, (7 - latitude) / 19];
const area = Math.PI * (BRUSH_RADIUS / CELL_SIZE) ** 2;
const close = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} differs from ${expected}`);

async function fixture(options = {}) {
  const time = { now: 0 };
  const room = new SharedRoom({ records, clock: () => time.now, ...options });
  await room.initialize();
  if (room.bootstrapAvailable) await room.bootstrap({ state: null, strength: .5 });
  await room.setScene({ scene: 'participation' });
  return { room, time };
}
const join = (room, clientId) => room.connect({ clientId, scope: 'indonesia' });
function hold(room, welcome, seq, position, holding = true, extras = {}) {
  return room.hold(welcome.connectionId, { type: 'hold', epoch: room.epoch, seq, holding, start: seq === 0, space: 'country', position, ...extras });
}

test('country coordinates preserve the full archipelago rectangle and sea without island assignment', async () => {
  assert.deepEqual(countryPosition([.5, .5]), [118, -2.5]);
  assert.deepEqual(countryPosition([0, 1]), [94, -12]);
  assert.deepEqual(countryPosition([1, 0]), [141.9999, 6.9999]);
  assert.equal(countryPosition([1.1, 0]), null);
  const { room } = await fixture();
  const first = join(room, 'national-a'), second = join(room, 'national-b');
  assert.deepEqual(first.assignment, { id: 'indonesia', name: 'Indonesia' });
  assert.deepEqual(first.assignment, second.assignment);
  for (const welcome of [first, second]) {
    hold(room, welcome, 0, screenFor(westFire));
    assert.deepEqual(room.connections.get(welcome.connectionId).position, westFire);
    hold(room, welcome, 1, screenFor(eastFire));
    assert.deepEqual(room.connections.get(welcome.connectionId).position, eastFire);
  }
  assert.throws(() => hold(room, first, 2, [.5, .5], true, { space: 'region' }), /whole-country/);
  assert.throws(() => room.connect({ clientId: 'bad-scope', scope: 'somewhere' }), /Unknown audience scope/);
});

test('opposite islands cool independently under the same national phone scope', async () => {
  const { room, time } = await fixture();
  const first = join(room, 'first'), second = join(room, 'second');
  hold(room, first, 0, screenFor(westFire));
  hold(room, second, 0, screenFor(eastFire));
  time.now = 100; room.advance();
  assert.ok(room.simulation.sample(...westFire).surfaceWetness > 0);
  assert.ok(room.simulation.sample(...eastFire).surfaceWetness > 0);
  hold(room, second, 1, screenFor(eastFire), false);
  let seq = 1;
  for (let tick = 3; tick <= 600; tick++) {
    time.now = tick * 50;
    if (tick % 10 === 0) hold(room, first, seq++, screenFor(westFire));
    room.advance();
  }
  assert.equal(room.simulation.sample(...westFire).extinguished, true);
  assert.equal(room.simulation.sample(...eastFire).extinguished, false);
  const field = room.phoneState(first.connectionId).region.spatial;
  assert.deepEqual(field.patches.map(row => row[4]), [true, false]);
  for (const row of field.patches) {
    const cell = room.simulation.sample(row[1], row[2]);
    close(row[5], Math.round(cell.surfaceWetness * 10000) / 10000);
    close(row[6], Math.round(cell.moisture * 10000) / 10000);
  }
});

test('national overlap keeps one fixed water budget per participant and land clipping never spills into sea', async () => {
  const { room, time } = await fixture();
  const first = join(room, 'overlap-a'), second = join(room, 'overlap-b');
  hold(room, first, 0, screenFor(westFire)); hold(room, second, 0, screenFor(westFire));
  time.now = 1000; room.advance();
  close(room.simulation.totalWater, area);
  const control = new RainSimulation().seed(records).step(1, [{ path: [westFire], strength: 1, constraint: room.national.constraint }]);
  for (const [key, cell] of control.cells) close(room.simulation.cells.get(key).moisture, cell.moisture);
  for (const [key, cell] of room.simulation.cells) if (cell.surfaceWetness > 0) assert.ok(room.national.cells.has(key));
});

test('rain entirely over sea stays in place and cannot teleport water or cool a remote island', async () => {
  const { room, time } = await fixture();
  const welcome = join(room, 'sea');
  const sea = [141.125, 5.125];
  hold(room, welcome, 0, screenFor(sea));
  assert.deepEqual(room.connections.get(welcome.connectionId).position, sea);
  assert.deepEqual(room.national.constraint.project(sea), sea);
  time.now = 1000; room.advance();
  assert.equal(room.simulation.totalWater, 0, 'No applied water is credited when no Indonesian land intersects the brush.');
  assert.equal(room.simulation.sample(...westFire).heat, 1);
  assert.equal(room.simulation.sample(...eastFire).heat, 1);
  assert.equal([...room.simulation.cells.values()].some(cell => cell.moisture > 0), false);
});

test('national summaries reuse one sparse field across phones and refresh source membership', async () => {
  const { room } = await fixture();
  const first = join(room, 'field-a'), second = join(room, 'field-b');
  const summaries = new Map();
  const a = room.phoneState(first.connectionId, summaries), b = room.phoneState(second.connectionId, summaries);
  assert.equal(a.region, b.region); assert.equal(summaries.size, 1);
  assert.equal(a.simulation, undefined); assert.equal(a.participants, undefined); assert.equal(a.focus, null);
  assert.equal(a.region.spatial.format, 'country-v1'); assert.deepEqual(a.region.spatial.bounds, COUNTRY_BOUNDS);
  assert.equal(a.region.spatial.landKeys, undefined);
  assert.equal(a.region.spatial.patches.length, 2); assert.equal(a.region.spatial.patches[0].length, 7);
  room.seed([records[1]], 'new-source');
  const fresh = room.phoneState(first.connectionId).region.spatial;
  assert.equal(fresh.patches.length, 1); assert.deepEqual(fresh.patches[0].slice(1, 3), eastFire);
  assert.equal(room.national.layout('new-source').snapshotVersion, 'new-source');
});

test('national use preserves stable identity and the legacy island view across persistence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wildfire-national-'));
  try {
    const persistencePath = path.join(directory, 'performance.json');
    const first = await fixture({ persistencePath });
    const legacy = first.room.connect({ clientId: 'same-phone' });
    assert.notEqual(legacy.assignment.id, 'indonesia');
    const country = join(first.room, 'same-phone');
    assert.equal(country.participantNumber, legacy.participantNumber);
    assert.equal(first.room.connections.size, 1);
    await first.room.persist();
    const saved = JSON.parse(await readFile(persistencePath, 'utf8'));
    assert.equal(saved.schemaVersion, 1); assert.equal(saved.identities[0][2], legacy.assignment.id);
    const second = await fixture({ persistencePath });
    const countryAgain = join(second.room, 'same-phone');
    assert.equal(countryAgain.participantNumber, country.participantNumber);
    assert.equal(countryAgain.assignment.id, 'indonesia');
    const legacyAgain = second.room.connect({ clientId: 'same-phone' });
    assert.deepEqual(legacyAgain.assignment, legacy.assignment);
    assert.equal(second.room.phoneState(legacyAgain.connectionId).region.spatial.format, 'land-rows-v1');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

class Peer {
  constructor(url) {
    this.packets = []; this.waiters = [];
    this.socket = new WebSocket(url);
    this.socket.on('message', raw => {
      const packet = JSON.parse(raw); this.packets.push(packet);
      for (const waiter of [...this.waiters]) if (waiter.predicate(packet)) waiter.resolve(packet);
    });
    this.socket.on('error', error => { for (const waiter of [...this.waiters]) waiter.reject(error); });
  }
  wait(predicate) {
    const present = this.packets.find(predicate); if (present) return Promise.resolve(present);
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => { clearTimeout(timer); this.waiters = this.waiters.filter(item => item !== waiter); callback(value); };
      const waiter = { predicate, resolve: value => finish(resolve, value), reject: error => finish(reject, error) };
      const timer = setTimeout(() => waiter.reject(new Error('Timed out waiting for national protocol packet.')), 1500);
      this.waiters.push(waiter);
    });
  }
}

test('HTTP national layout and real WebSocket scope expose the country protocol without resetting state', async t => {
  const instance = await createPerformanceServer({ port: 0, persistencePath: null, records, autoTick: false });
  const peers = [];
  t.after(async () => { for (const peer of peers) peer.socket.terminate(); await instance.close(); });
  await instance.room.bootstrap({ state: null, strength: .5 });
  await instance.room.setScene({ scene: 'participation' });
  const address = await instance.listen(), base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${base}/api/study-region?region=indonesia`);
  assert.equal(response.status, 200);
  const layout = await response.json();
  assert.equal(layout.id, 'indonesia'); assert.equal(layout.format, 'country-v1'); assert.equal(layout.patches.length, 2);
  assert.equal(layout.landKeys.length, instance.room.national.cells.size);
  const peer = new Peer(`ws://127.0.0.1:${address.port}/ws?role=participant&scope=indonesia&clientId=national-network`); peers.push(peer);
  const welcome = await peer.wait(packet => packet.type === 'welcome');
  const summary = await peer.wait(packet => packet.type === 'summary');
  assert.equal(welcome.assignment.id, 'indonesia'); assert.equal(summary.region.spatial.format, 'country-v1');
  peer.socket.send(JSON.stringify({ type: 'hold', epoch: welcome.epoch, seq: 0, start: true, holding: true, space: 'country', position: screenFor(eastFire) }));
  const ack = await peer.wait(packet => packet.type === 'ack'); assert.equal(ack.holding, true);
  const actor = instance.room.wireState().participants.find(item => item.id === 'national-network');
  assert.equal(actor.regionId, 'indonesia'); assert.deepEqual(actor.position, eastFire);
});

test('national SharedConnection negotiates country scope and sends normalized country controls', t => {
  const sockets = [];
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = new URL(url); this.readyState = 1; this.handlers = new Map(); this.sent = []; sockets.push(this); }
    addEventListener(name, handler) { this.handlers.set(name, handler); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    message(packet) { this.handlers.get('message')({ data: JSON.stringify(packet) }); }
  }
  const replacement = {
    WebSocket: Socket, location: { href: 'http://127.0.0.1:4185/study/phone', protocol: 'http:' },
    localStorage: { getItem: () => 'national-client', setItem() {} },
    setInterval: () => 0,
  };
  for (const [key, value] of Object.entries(replacement)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  const connection = new SharedConnection({ role: 'participant', scope: 'indonesia' });
  const socket = sockets[0];
  assert.equal(socket.url.searchParams.get('scope'), 'indonesia');
  socket.message({ type: 'welcome', epoch: 'national-test', assignment: { id: 'indonesia', name: 'Indonesia' } });
  socket.message({ type: 'summary', epoch: 'national-test', bootstrapAvailable: false, own: { holding: false } });
  assert.equal(connection.begin([.2, .6]), true);
  assert.equal(socket.sent[0].space, 'country'); assert.deepEqual(socket.sent[0].position, [.2, .6]);
  connection.stop(); assert.equal(socket.sent.at(-1).holding, false);
});
