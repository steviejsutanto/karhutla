import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createPerformanceServer } from '../app/server.mjs';

const host = '127.0.0.1', remote = '192.168.10.122';
const post = (body, headers = {}) => ({ method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });
function snapshot(positions = [[110.125, -2.125]]) {
  return {
    schemaVersion: 1,
    source: { name: 'NASA FIRMS — NOAA-20 VIIRS Collection 2', sensor: 'VIIRS NOAA-20',
      url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv' },
    fetchedAt: '2026-11-07T12:00:00Z', observationStart: '2026-11-07T11:00:00Z', observationEnd: '2026-11-07T11:00:00Z',
    windowLabel: 'NASA rolling 24-hour snapshot',
    geographicFilter: { country: 'Indonesia', iso3: 'IDN', method: 'point-in-polygon', boundary: 'data/indonesia.geojson',
      boundarySource: 'Natural Earth 1:10m', approximate: true, prefilterBbox: [94.5, -11.5, 141.5, 6.5] },
    counts: { downloadedRows: positions.length, boundingBoxRows: positions.length, outsideCountryRows: 0, invalidRows: 0, duplicateRows: 0, retainedRows: positions.length },
    notes: ['Synthetic controls fixture.'],
    records: positions.map(([longitude, latitude], index) => ({ id: `controls-${index}`, latitude, longitude,
      observedAt: '2026-11-07T11:00:00Z', satellite: 'NOAA-20', instrument: 'VIIRS' })),
  };
}
function requestFrom(instance, address, url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise(resolve => {
    let status;
    const responseHeaders = {};
    instance.server.emit('request', {
      method, url, headers: { host: '127.0.0.1:4173', ...headers }, socket: { remoteAddress: address },
      async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); },
    }, {
      setHeader(name, value) { responseHeaders[name.toLowerCase()] = value; },
      writeHead(code, values = {}) { status = code; for (const [name, value] of Object.entries(values)) responseHeaders[name.toLowerCase()] = value; },
      end(value) { resolve({ status, headers: responseHeaders, body: JSON.parse(String(value || '{}')) }); },
    });
  });
}
async function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for operator controls.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return predicate();
}
async function fixture(t, options = {}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'karhutla compact controls '));
  const initial = snapshot();
  await mkdir(path.join(rootDir, 'data'));
  await writeFile(path.join(rootDir, 'data/fire-snapshot.json'), JSON.stringify(initial));
  const instance = await createPerformanceServer({ rootDir, port: 0, lanEnabled: true, remoteOperatorPath: null,
    persistencePath: path.join(rootDir, 'data/performance-state.json'), autoTick: false,
    clock: () => 1000, wallClock: () => 1700000000000,
    networkInterfaces: { en0: [{ address: '192.168.10.101', family: 'IPv4', internal: false }] }, ...options });
  const sockets = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await instance.close(); await rm(rootDir, { recursive: true, force: true }); });
  const { pin } = (await requestFrom(instance, host, '/api/operator/remote')).body;
  const paired = await requestFrom(instance, remote, '/api/operator/pair', post({ pin }));
  const cookie = paired.headers['set-cookie'].split(';')[0];
  const { port } = await instance.listen();
  instance.server.prependListener('upgrade', request => Object.defineProperty(request.socket, 'remoteAddress', { value: remote }));
  let number = 0;
  const connect = async ({ role = 'operator', view = 'controls', clientId = `controls-${++number}`, headers = { cookie } } = {}) => {
    const url = new URL(`ws://127.0.0.1:${port}/ws`);
    url.searchParams.set('role', role); url.searchParams.set('clientId', clientId);
    if (view) url.searchParams.set('view', view);
    const messages = [], socket = new WebSocket(url, { headers });
    sockets.push(socket); socket.on('message', raw => messages.push(JSON.parse(raw)));
    await once(socket, 'open');
    await waitFor(() => messages.find(message => ['state', 'summary'].includes(message.type)));
    return { socket, messages, clientId };
  };
  const deny = async (role, view, headers = {}) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?role=${role}&view=${view}&clientId=denied-${++number}`, { headers });
    sockets.push(socket); socket.on('error', () => {});
    return new Promise(resolve => socket.once('unexpected-response', (_request, response) => { resolve(response.statusCode); response.resume(); socket.terminate(); }));
  };
  return { instance, rootDir, initial, cookie, connect, deny };
}

test('controls-only operators receive detached compact state without simulation or actor baseline work', async t => {
  const { instance, connect } = await fixture(t);
  let wireCalls = 0, actorCalls = 0;
  const wireState = instance.room.wireState.bind(instance.room), actorState = instance.room.actorState.bind(instance.room);
  instance.room.wireState = () => { wireCalls++; return wireState(); };
  instance.room.actorState = () => { actorCalls++; return actorState(); };
  const controls = await connect();
  assert.equal(controls.messages.find(message => message.type === 'welcome').view, 'controls');
  const state = controls.messages.find(message => message.type === 'state');
  assert.equal(state.view, 'controls'); assert.equal(state.ready, false);
  assert.equal(state.bootstrapAvailable, true);
  assert.deepEqual(Object.keys(state.simulation), ['parameters']);
  for (const key of ['participants', 'actorRevision', 'revision', 'baseRevision']) assert.equal(Object.hasOwn(state, key), false, key);
  assert.equal(wireCalls, 0); assert.equal(actorCalls, 0);
  const mark = controls.messages.length;
  instance.broadcast();
  await waitFor(() => controls.messages.length > mark);
  assert.equal(wireCalls, 0); assert.equal(actorCalls, 0, 'Ordinary broadcasts also skip full baseline/actor construction.');
  assert.equal(JSON.stringify(state).includes('cells'), false);
  const detached = instance.room.operatorControlsState();
  detached.simulation.parameters.fireReturnSeconds = 999;
  detached.soundSettings.macros.haze = 999;
  detached.mainSound.status.state = 'error';
  assert.notEqual(instance.room.simulation.parameters.fireReturnSeconds, 999);
  assert.notEqual(instance.room.soundSettings.macros.haze, 999);
  assert.notEqual(instance.room.mainSoundState().status.state, 'error');
});

test('compact controls receive action, playback, settings and snapshot updates and reconnect with current state', async t => {
  const { instance, connect, cookie } = await fixture(t);
  const controls = await connect({ clientId: 'remembered-controls' });
  const update = async (path, body, predicate, address = remote) => {
    const mark = controls.messages.length;
    assert.equal((await requestFrom(instance, address, path, post(body, { cookie }))).status, 200);
    return waitFor(() => controls.messages.slice(mark).find(message => message.type === 'state' && predicate(message)));
  };
  const started = await update('/api/scene', { scene: 'participation' }, state => state.scene.id === 'participation');
  assert.equal(started.ready, true);
  await update('/api/sound-settings', { level: .31, mixer: { bells: .6 } }, state => state.soundSettings.level === .31);
  await update('/api/strength', { strength: .27 }, state => state.strength === .27);
  await update('/api/parameters', { parameters: { fireReturnSeconds: 9 } }, state => state.simulation.parameters.fireReturnSeconds === 9);
  const requested = await update('/api/main-sound', { enabled: true }, state => state.mainSound.requestedEnabled);
  await update('/api/main-sound/status', { requestId: requested.mainSound.requestId, state: 'ready', activated: true }, state => state.mainSound.status.state === 'ready', host);
  const preset = instance.room.exportSettingsPreset(); preset.strength = .44;
  await update('/api/settings/import', preset, state => state.strength === .44);
  const before = instance.room.epoch, next = snapshot([[101.125, -1.125], [136.125, -3.125]]);
  const changed = await update('/api/snapshot/import', next, state => state.epoch !== before);
  assert.equal(changed.scene.id, 'arrival'); assert.equal(changed.scene.paused, true);
  assert.equal(changed.soundCondition.sourceCount, 2);
  assert.deepEqual(Object.keys(changed.simulation), ['parameters']);
  const closed = once(controls.socket, 'close'); controls.socket.close(); await closed;
  const reconnected = await connect({ clientId: controls.clientId });
  const current = reconnected.messages.find(message => message.type === 'state');
  assert.equal(current.epoch, changed.epoch); assert.equal(current.strength, .44);
  assert.equal(current.mainSound.status.state, 'ready');
});

test('control sockets omit actor and bell streams while default display and phone transports retain them', async t => {
  const { instance, connect, cookie } = await fixture(t);
  await requestFrom(instance, host, '/api/scene', post({ scene: 'participation' }));
  const controls = await connect(), projection = await connect({ role: 'projection', view: null });
  const main = await connect({ view: null }), phone = await connect({ role: 'participant', view: null });
  const defaultState = projection.messages.find(message => message.type === 'state');
  assert.ok(Array.isArray(defaultState.simulation.cells));
  assert.ok(Array.isArray(defaultState.participants));
  assert.equal(phone.messages.find(message => message.type === 'summary').mainSound, undefined);
  const phoneWelcome = phone.messages.find(message => message.type === 'welcome');
  phone.socket.send(JSON.stringify({ type: 'hold', epoch: instance.room.epoch, seq: 0, holding: true, start: true, space: 'region', position: [.5, .5] }));
  await waitFor(() => phone.messages.find(message => message.type === 'ack'));
  await waitFor(() => projection.messages.find(message => message.type === 'actors' && message.activeCount === 1));
  assert.ok(phoneWelcome.participantNumber > 0);
  const key = [...instance.room.national.fireKeys][0];
  instance.room.simulation.cells.get(key).extinguished = true;
  main.socket.send(JSON.stringify({ type: 'bell', epoch: instance.room.epoch, eventId: 'controls-test-bell', key,
    position: [.5, .5], radiusDegrees: .85, wallAt: Date.now() }));
  await waitFor(() => projection.messages.find(message => message.type === 'bell'));
  await requestFrom(instance, host, '/api/strength', post({ strength: .41 }, { cookie }));
  const compact = await waitFor(() => controls.messages.find(message => message.type === 'state' && message.strength === .41));
  assert.equal(compact.joinedCount, 1); assert.equal(compact.activeCount, 1);
  assert.equal(controls.messages.some(message => ['actors', 'bell'].includes(message.type)), false);
});

test('controls view requires operator authorization and follows private-device revocation', async t => {
  const { instance, connect, deny, cookie } = await fixture(t);
  assert.equal(await deny('operator', 'controls'), 403);
  assert.equal(await deny('projection', 'controls', { cookie }), 400);
  assert.equal(await deny('participant', 'controls', { cookie }), 400);
  assert.equal(await deny('operator', 'unknown', { cookie }), 400);
  const controls = await connect();
  const closed = once(controls.socket, 'close');
  assert.equal((await requestFrom(instance, host, '/api/operator/remote/renew', post({}))).status, 200);
  assert.equal((await closed)[0], 4003);
  assert.equal(await deny('operator', 'controls', { cookie }), 403);
});

test('snapshot info is compact committed metadata and never reads or reconciles an externally changed file', async t => {
  let reads = 0;
  const { instance, rootDir, initial, cookie } = await fixture(t, { snapshotRead: async file => { reads++; return JSON.parse(await readFile(file, 'utf8')); } });
  const current = await requestFrom(instance, remote, '/api/snapshot/info', { headers: { cookie } });
  assert.equal(current.status, 200);
  assert.deepEqual(current.body, { fetchedAt: initial.fetchedAt, observationStart: initial.observationStart, observationEnd: initial.observationEnd, recordCount: 1 });
  assert.equal(Object.hasOwn(current.body, 'records'), false);
  const epoch = instance.room.epoch;
  await writeFile(path.join(rootDir, 'data/fire-snapshot.json'), JSON.stringify(snapshot([[101.125, -1.125], [136.125, -3.125]])));
  assert.deepEqual((await requestFrom(instance, host, '/api/snapshot/info')).body, current.body);
  assert.equal(reads, 0); assert.equal(instance.room.epoch, epoch);
  assert.equal((await requestFrom(instance, remote, '/api/snapshot/info')).status, 403);
  assert.equal((await requestFrom(instance, host, '/api/snapshot/info', { headers: { 'x-wildfire-role': 'projection' } })).status, 403);
  assert.equal((await requestFrom(instance, host, '/api/snapshot/info', { headers: { origin: 'https://elsewhere.invalid' } })).status, 403);
  assert.equal((await requestFrom(instance, host, '/api/snapshot/info', post({}))).status, 405);
  const next = snapshot([[101.125, -1.125], [136.125, -3.125]]);
  assert.equal((await requestFrom(instance, host, '/api/snapshot/import', post(next))).status, 200);
  assert.equal((await requestFrom(instance, host, '/api/snapshot/info')).body.recordCount, 2);
});
