import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { SharedRoom } from '../app/shared-room.mjs';
import { createPerformanceServer } from '../app/server.mjs';

const records = [{ longitude: 110.125, latitude: -2.125 }];
const host = '127.0.0.1', remote = '192.168.10.122';
const post = (body, headers = {}) => ({ method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });
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
async function fixture(t) {
  const instance = await createPerformanceServer({ port: 0, persistencePath: null, autoTick: false, records,
    lanEnabled: true, networkInterfaces: { en0: [{ address: '192.168.10.101', family: 'IPv4', internal: false }] } });
  t.after(() => instance.close());
  const { pin } = (await requestFrom(instance, host, '/api/operator/remote')).body;
  const paired = await requestFrom(instance, remote, '/api/operator/pair', post({ pin }));
  assert.equal(paired.status, 200);
  return { instance, cookie: paired.headers['set-cookie'].split(';')[0] };
}

test('Main sound commands keep actual status separate and reject stale host reports', () => {
  const room = new SharedRoom({ records });
  assert.deepEqual(room.mainSoundState(), { revision: 0, requestId: 0, requestedEnabled: false, status: { requestId: 0, state: 'unavailable', activated: false } });
  const enable = room.requestMainSound({ enabled: true });
  assert.equal(enable.requestId, 1); assert.equal(enable.requestedEnabled, true);
  const needsGesture = room.reportMainSound({ requestId: 1, state: 'needs-gesture', activated: false });
  assert.equal(needsGesture.status.state, 'needs-gesture');
  const disable = room.requestMainSound({ enabled: false });
  assert.equal(disable.requestId, 2); assert.equal(disable.revision, 3);
  assert.deepEqual(room.reportMainSound({ requestId: 1, state: 'ready', activated: true }), disable,
    'A slow enable acknowledgement cannot restore sound after a later disable.');
  const muted = room.reportMainSound({ requestId: 2, state: 'muted', activated: true });
  assert.equal(muted.requestedEnabled, false); assert.equal(muted.status.state, 'muted');
  assert.deepEqual(room.reportMainSound({ requestId: 2, state: 'muted', activated: true }), muted,
    'Identical reports do not churn the shared status revision.');
  const repeatedDisable = room.requestMainSound({ enabled: false });
  assert.equal(repeatedDisable.status.requestId, 2);
  const confirmedDisable = room.reportMainSound({ requestId: 3, state: 'muted', activated: true });
  assert.equal(confirmedDisable.status.requestId, 3);
  assert.equal(confirmedDisable.revision, repeatedDisable.revision + 1,
    'A same-state acknowledgement still confirms the newer request.');
  const snapshot = room.wireState(); snapshot.mainSound.status.state = 'ready';
  assert.equal(room.mainSoundState().status.state, 'muted');
  for (const body of [null, [], {}, { enabled: 1 }, { enabled: true, volume: 1 }]) assert.throws(() => room.requestMainSound(body));
  for (const body of [{ requestId: 4, state: 'ready', activated: true }, { requestId: 2, state: 'playing', activated: true }, { requestId: 2, state: 'ready' }])
    assert.throws(() => room.reportMainSound(body));
  assert.deepEqual(room.mainSoundState(), confirmedDisable, 'Invalid requests are atomic.');
});

test('Main playback intent never enters phone summaries, presets or saved/restored performances', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla-main-sound-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const persistencePath = path.join(directory, 'performance.json');
  const room = new SharedRoom({ records, persistencePath });
  room.requestMainSound({ enabled: true }); room.reportMainSound({ requestId: 1, state: 'ready', activated: true });
  await room.bootstrap();
  const phone = room.connect({ clientId: 'main-sound-phone' });
  assert.equal(Object.hasOwn(room.phoneState(phone.connectionId), 'mainSound'), false);
  assert.equal(Object.hasOwn(room.exportSettingsPreset(), 'mainSound'), false);
  assert.equal(Object.hasOwn(room._envelope(), 'mainSound'), false);
  const saved = JSON.parse(await readFile(persistencePath, 'utf8'));
  assert.equal(Object.hasOwn(saved, 'mainSound'), false);
  saved.mainSound = room.mainSoundState(); await writeFile(persistencePath, JSON.stringify(saved));
  const restored = await new SharedRoom({ records, persistencePath }).initialize();
  assert.equal(restored.mainSoundState().requestedEnabled, false);
  assert.equal(restored.mainSoundState().status.activated, false);
});

test('paired remote operators request Main sound while only the local Operator reports its status', async t => {
  const { instance, cookie } = await fixture(t);
  const before = instance.room.mainSoundState();
  assert.equal((await requestFrom(instance, remote, '/api/main-sound', post({ enabled: true }))).status, 403);
  assert.equal((await requestFrom(instance, remote, '/api/main-sound')).status, 403);
  assert.equal((await requestFrom(instance, remote, '/api/session')).body.mainSound, undefined);
  for (const headers of [{ cookie, origin: 'https://elsewhere.invalid' }, { cookie, 'x-wildfire-role': 'participant' }, { cookie, 'x-wildfire-role': 'projection' }, { referer: 'http://127.0.0.1:4173/projection' }])
    assert.equal((await requestFrom(instance, remote, '/api/main-sound', post({ enabled: true }, headers))).status, 403);
  assert.deepEqual(instance.room.mainSoundState(), before);
  const requested = await requestFrom(instance, remote, '/api/main-sound', post({ enabled: true }, { cookie }));
  assert.equal(requested.status, 200); assert.equal(requested.body.requestId, 1);
  assert.equal((await requestFrom(instance, remote, '/api/main-sound/status', post({ requestId: 1, state: 'ready', activated: true }, { cookie }))).status, 403);
  assert.equal((await requestFrom(instance, host, '/api/main-sound/status', post({ requestId: 1, state: 'ready', activated: true }, { 'x-wildfire-role': 'projection' }))).status, 403);
  const acknowledged = await requestFrom(instance, host, '/api/main-sound/status', post({ requestId: 1, state: 'needs-gesture', activated: false }));
  assert.equal(acknowledged.status, 200); assert.equal(acknowledged.body.status.state, 'needs-gesture');
  assert.deepEqual((await requestFrom(instance, remote, '/api/main-sound', { headers: { cookie } })).body, acknowledged.body);
  assert.deepEqual((await requestFrom(instance, remote, '/api/session', { headers: { cookie } })).body.mainSound, acknowledged.body);
  assert.equal((await requestFrom(instance, host, '/api/main-sound/status')).status, 405);
  assert.equal((await requestFrom(instance, host, '/api/main-sound', { method: 'POST', body: { enabled: true } })).status, 415);
  assert.equal((await requestFrom(instance, host, '/api/main-sound', post({ enabled: 'yes' }))).status, 400);
  assert.equal((await requestFrom(instance, host, '/api/main-sound/status', post({ requestId: 99, state: 'ready', activated: true }))).status, 400);
});

test('Main playback requests and host acknowledgements reach connected operators and projection without phone activation', async t => {
  const { instance } = await fixture(t);
  const { port } = await instance.listen();
  const sockets = [];
  const connect = async role => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?role=${role}&clientId=main-sound-${role}`);
    const messages = [];
    socket.on('message', bytes => messages.push(JSON.parse(bytes)));
    sockets.push(socket); await once(socket, 'open');
    return { socket, messages };
  };
  t.after(() => { for (const socket of sockets) socket.terminate(); });
  const clients = await Promise.all(['operator', 'projection', 'participant'].map(connect));
  const waitFor = async (client, predicate) => {
    for (let count = 0; count < 100; count++) {
      const found = client.messages.find(predicate); if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('Expected Main sound update was not published.');
  };
  await Promise.all(clients.map(client => waitFor(client, message => ['state', 'summary'].includes(message.type))));
  await requestFrom(instance, host, '/api/main-sound', post({ enabled: true }));
  for (const client of clients.slice(0, 2))
    assert.equal((await waitFor(client, message => message.mainSound?.requestId === 1)).mainSound.requestedEnabled, true);
  await requestFrom(instance, host, '/api/main-sound/status', post({ requestId: 1, state: 'ready', activated: true }));
  for (const client of clients.slice(0, 2))
    assert.equal((await waitFor(client, message => message.mainSound?.status.state === 'ready')).mainSound.status.activated, true);
  assert.ok(clients[2].messages.every(message => !Object.hasOwn(message, 'mainSound')));
});
