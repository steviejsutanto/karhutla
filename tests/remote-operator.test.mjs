import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import QRCode from 'qrcode';
import { createPerformanceServer } from '../app/server.mjs';

const host = '127.0.0.1';
const remote = '192.168.10.122';
const interfaces = () => ({ en0: [{ address: '192.168.10.101', family: 'IPv4', internal: false }] });

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
      end(value) {
        const content = String(value || '');
        resolve({ status, headers: responseHeaders, body: responseHeaders['content-type']?.startsWith('application/json') ? JSON.parse(content) : content });
      },
    });
  });
}
const post = (body, headers = {}) => ({ method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });

async function fixture(t, options = {}) {
  const instance = await createPerformanceServer({ port: 0, persistencePath: null, autoTick: false,
    records: [{ longitude: 110.125, latitude: -2.125 }], clock: () => 1000, wallClock: () => 1700000000000,
    lanEnabled: true, networkInterfaces: interfaces(), ...options });
  t.after(() => instance.close());
  return instance;
}

async function pair(instance) {
  const links = (await requestFrom(instance, host, '/api/operator/remote')).body;
  const token = new URLSearchParams(new URL(links.url).hash.slice(1)).get('remote');
  const paired = await requestFrom(instance, remote, '/api/operator/pair', post({ token }));
  assert.equal(paired.status, 200);
  return { links, token, cookie: paired.headers['set-cookie'].split(';')[0], paired };
}

test('private operator links and QR stay on the host and track current Wi-Fi addresses', async t => {
  const networkInterfaces = interfaces();
  const instance = await fixture(t, { networkInterfaces });
  const { links, token } = await pair(instance);
  assert.equal(links.enabled, true);
  assert.equal(new URL(links.url).pathname, '/operator');
  assert.equal(token.length, 43);
  assert.deepEqual(links.urls, [links.url]);
  assert.match(links.pin, /^\d{6}$/);
  assert.equal(new URL(links.remoteUrl).pathname, '/operator-remote');
  assert.equal(new URL(links.remoteUrl).hash, '');
  assert.deepEqual(links.remoteUrls, [links.remoteUrl]);
  const svg = await requestFrom(instance, host, '/api/qr.svg?view=operator');
  assert.equal(svg.status, 200);
  assert.equal(svg.body, await QRCode.toString(links.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 280 }));
  assert.equal(svg.headers['cache-control'], 'no-store');

  for (const url of ['/api/operator/remote', '/api/qr.svg?view=operator']) {
    assert.equal((await requestFrom(instance, remote, url)).status, 403);
    assert.equal((await requestFrom(instance, host, url, { headers: { 'x-wildfire-role': 'participant' } })).status, 403);
    assert.equal((await requestFrom(instance, host, url, { headers: { referer: 'http://127.0.0.1:4173/projection' } })).status, 403);
    assert.equal((await requestFrom(instance, host, url, { headers: { origin: 'https://another-site.invalid' } })).status, 403);
  }
  const publicSession = await requestFrom(instance, remote, '/api/session');
  assert.equal(publicSession.body.operatorAllowed, false);
  assert.equal(publicSession.body.localOperator, false);
  assert.equal(JSON.stringify(publicSession.body).includes(token), false);
  networkInterfaces.en0[0].address = '192.168.11.20';
  const moved = (await requestFrom(instance, host, '/api/operator/remote')).body;
  assert.equal(new URL(moved.url).hostname, '192.168.11.20');
  assert.equal(new URL(moved.url).hash, new URL(links.url).hash);
  delete networkInterfaces.en0;
  assert.deepEqual((await requestFrom(instance, host, '/api/operator/remote')).body, { enabled: false, url: null, urls: [], pin: links.pin, remoteUrl: null, remoteUrls: [] });
  assert.equal((await requestFrom(instance, host, '/api/qr.svg?view=operator')).status, 409);
});

test('paired devices change the shared performance, while display requests and unpaired devices remain blocked', async t => {
  const instance = await fixture(t);
  const { cookie, paired } = await pair(instance);
  assert.match(paired.headers['set-cookie'], /; HttpOnly; SameSite=Strict; Path=\/; Max-Age=31536000$/);
  assert.deepEqual(paired.body, { operatorAllowed: true, localOperator: false });
  const session = (await requestFrom(instance, remote, '/api/session', { headers: { cookie } })).body;
  assert.equal(session.operatorAllowed, true);
  assert.equal(session.localOperator, false);
  const changed = await requestFrom(instance, remote, '/api/scene', post({ scene: 'participation' }, { cookie }));
  assert.equal(changed.status, 200);
  assert.equal(instance.room.sceneState().id, 'participation');
  const mixer = await requestFrom(instance, remote, '/api/sound-settings', post({ level: .31 }, { cookie }));
  assert.equal(mixer.status, 200);
  assert.equal(instance.room.soundSettingsState().level, .31);
  assert.equal((await requestFrom(instance, remote, '/api/settings/export', { headers: { cookie } })).status, 200);
  assert.equal((await requestFrom(instance, remote, '/api/study-region?region=indonesia', { headers: { cookie } })).status, 200);

  for (const headers of [{}, { cookie: `${cookie}; ${cookie}` }, { cookie, 'x-wildfire-role': 'participant' }, { cookie, 'x-wildfire-role': 'projection' },
    { cookie, referer: 'http://127.0.0.1:4173/projection' }, { cookie, origin: 'https://another-site.invalid' }]) {
    assert.equal((await requestFrom(instance, remote, '/api/scene', post({ scene: 'final-rain' }, headers))).status, 403);
  }
  assert.equal(instance.room.sceneState().id, 'participation');
  for (const url of ['/api/operator/remote', '/api/qr.svg?view=operator']) assert.equal((await requestFrom(instance, remote, url, { headers: { cookie } })).status, 403);
  assert.equal((await requestFrom(instance, remote, '/api/operator/remote/renew', post({}, { cookie }))).status, 403);
});

test('pairing validates the request, origin, token and LAN mode before issuing a cookie', async t => {
  const instance = await fixture(t);
  const { token } = await pair(instance);
  for (const [index, body] of [{}, null, [], { token: 123 }, { token: 'wrong' }, { token: 'é'.repeat(43) }].entries()) {
    const result = await requestFrom(instance, `192.168.10.${130 + index}`, '/api/operator/pair', post(body));
    assert.equal(result.status, 403);
    assert.equal(result.headers['set-cookie'], undefined);
  }
  assert.equal((await requestFrom(instance, remote, '/api/operator/pair')).status, 405);
  assert.equal((await requestFrom(instance, remote, '/api/operator/pair', { method: 'POST', body: { token } })).status, 415);
  assert.equal((await requestFrom(instance, remote, '/api/operator/pair', post({ token }, { origin: 'https://another-site.invalid' }))).status, 403);
  assert.equal((await requestFrom(instance, remote, '/api/operator/pair', post({ token }, { 'x-wildfire-role': 'projection' }))).status, 403);
  assert.equal((await requestFrom(instance, remote, '/api/operator/pair', post('invalid JSON'))).status, 400);
  assert.equal((await requestFrom(instance, remote, '/api/operator/pair', post({ token: 'x'.repeat(1025) }))).status, 413);
  const disabled = await fixture(t, { lanEnabled: false });
  const disabledLinks = (await requestFrom(disabled, host, '/api/operator/remote')).body;
  assert.match(disabledLinks.pin, /^\d{6}$/);
  assert.deepEqual(disabledLinks, { enabled: false, url: null, urls: [], pin: disabledLinks.pin, remoteUrl: null, remoteUrls: [] });
  assert.equal((await requestFrom(disabled, remote, '/api/operator/pair', post({ token }))).status, 403);
});

test('renewing the private link invalidates old cookies and links without changing performance settings', async t => {
  const instance = await fixture(t);
  const { cookie, token, links } = await pair(instance);
  await requestFrom(instance, remote, '/api/scene', post({ scene: 'participation' }, { cookie }));
  const before = instance.room.sceneState();
  const renewed = await requestFrom(instance, host, '/api/operator/remote/renew', post({}));
  assert.equal(renewed.status, 200);
  assert.notEqual(renewed.body.url, links.url);
  assert.equal((await requestFrom(instance, remote, '/api/operator/pair', post({ token }))).status, 403);
  assert.equal((await requestFrom(instance, remote, '/api/session', { headers: { cookie } })).body.operatorAllowed, false);
  assert.equal((await requestFrom(instance, remote, '/api/scene', post({ scene: 'final-rain' }, { cookie }))).status, 403);
  assert.deepEqual(instance.room.sceneState(), before);
  assert.equal((await requestFrom(instance, host, '/api/session')).body.operatorAllowed, true);
  const fresh = await pair(instance);
  assert.notEqual(fresh.cookie, cookie);
  const restarted = await fixture(t);
  assert.equal((await requestFrom(restarted, remote, '/api/session', { headers: { cookie: fresh.cookie } })).body.operatorAllowed, false);
});

test('paired WebSockets survive a failed link save and are immediately disconnected after a saved reset', { timeout: 7000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla remote operator socket '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const remoteOperatorPath = path.join(directory, 'remote-operator.json');
  const instance = await fixture(t, { remoteOperatorPath });
  const { cookie, links } = await pair(instance);
  const { port } = await instance.listen();
  // Exercise real WebSocket framing with the connecting address substituted to
  // represent the second device; loopback would otherwise inherit host access.
  instance.server.prependListener('upgrade', request => Object.defineProperty(request.socket, 'remoteAddress', { value: remote }));
  const base = `ws://127.0.0.1:${port}/ws?role=operator&clientId=`;
  const denied = new WebSocket(`${base}unpaired`);
  denied.on('error', () => {});
  const rejected = await new Promise(resolve => denied.on('unexpected-response', (_request, response) => { resolve(response.statusCode); response.resume(); denied.terminate(); }));
  assert.equal(rejected, 403);
  const socket = new WebSocket(`${base}paired`, { headers: { cookie } });
  t.after(() => socket.terminate());
  const messages = [];
  socket.on('message', value => messages.push(JSON.parse(value)));
  await once(socket, 'open');
  const waitFor = async predicate => {
    const deadline = Date.now() + 2000;
    while (!messages.some(predicate)) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for the shared operator state.');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return messages.find(predicate);
  };
  const welcome = await waitFor(message => message.type === 'welcome');
  assert.equal(welcome.role, 'operator');
  await waitFor(message => message.type === 'state');
  await requestFrom(instance, remote, '/api/scene', post({ scene: 'participation' }, { cookie }));
  const live = await waitFor(message => message.type === 'state' && message.scene.id === 'participation');
  socket.send(JSON.stringify({ type: 'hold', epoch: live.epoch, seq: 0, holding: true, start: true, position: [110.125, -2.125] }));
  await waitFor(message => message.type === 'ack' && message.holding);
  assert.equal(instance.room.connections.get(welcome.connectionId).holding, true);
  // A directory at the destination makes replacement fail on every platform,
  // including accounts whose privileges bypass ordinary read-only file modes.
  await rename(remoteOperatorPath, `${remoteOperatorPath}.backup`);
  await mkdir(remoteOperatorPath);
  const failed = await requestFrom(instance, host, '/api/operator/remote/renew', post({}));
  assert.equal(failed.status, 500);
  assert.match(failed.body.error, /existing link and connected controllers still work/);
  assert.equal(instance.room.connections.get(welcome.connectionId).holding, true);
  assert.equal((await requestFrom(instance, remote, '/api/session', { headers: { cookie } })).body.operatorAllowed, true);
  const retained = (await requestFrom(instance, host, '/api/operator/remote')).body;
  assert.equal(new URL(retained.url).hash, new URL(links.url).hash);
  assert.equal(retained.pin, links.pin);
  await rm(remoteOperatorPath, { recursive: true });
  await rename(`${remoteOperatorPath}.backup`, remoteOperatorPath);
  const closed = once(socket, 'close');
  await requestFrom(instance, host, '/api/operator/remote/renew', post({}));
  assert.equal(instance.room.connections.has(welcome.connectionId), false, 'Revocation stops held rain before a potentially slow close handshake.');
  assert.equal((await closed)[0], 4003);
  assert.equal(instance.room.sceneState().id, 'participation');
});

test('saved private link and paired cookie survive restarts and a saved reset revokes both permanently', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla permanent operator '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const remoteOperatorPath = path.join(directory, 'remote-operator.json');
  const first = await fixture(t, { remoteOperatorPath });
  const paired = await pair(first);
  const saved = JSON.parse(await readFile(remoteOperatorPath, 'utf8'));
  assert.deepEqual(saved, { version: 1, secret: paired.token, pin: paired.links.pin });
  if (process.platform !== 'win32') assert.equal((await stat(remoteOperatorPath)).mode & 0o777, 0o600);
  await first.close();
  const restarted = await fixture(t, { remoteOperatorPath });
  assert.equal((await requestFrom(restarted, host, '/api/operator/remote')).body.url, paired.links.url);
  assert.equal((await requestFrom(restarted, remote, '/api/session', { headers: { cookie: paired.cookie } })).body.operatorAllowed, true);
  assert.equal((await requestFrom(restarted, remote, '/api/operator/pair', post({ token: paired.token }))).status, 200);
  const resets = await Promise.all([
    requestFrom(restarted, host, '/api/operator/remote/renew', post({})),
    requestFrom(restarted, host, '/api/operator/remote/renew', post({})),
  ]);
  assert.deepEqual(resets.map(result => result.status).sort(), [200, 409]);
  const changed = await pair(restarted);
  assert.notEqual(changed.token, paired.token);
  assert.notEqual(changed.links.pin, paired.links.pin);
  assert.equal(JSON.parse(await readFile(remoteOperatorPath, 'utf8')).secret, changed.token);
  assert.deepEqual(await readdir(directory), ['remote-operator.json'], 'Atomic saves leave no private temporary files behind.');
  await restarted.close();
  const final = await fixture(t, { remoteOperatorPath });
  assert.equal((await requestFrom(final, host, '/api/operator/remote')).body.url, changed.links.url);
  assert.equal((await requestFrom(final, remote, '/api/session', { headers: { cookie: paired.cookie } })).body.operatorAllowed, false);
  assert.equal((await requestFrom(final, remote, '/api/operator/pair', post({ token: paired.token }))).status, 403);
  assert.equal((await requestFrom(final, remote, '/api/session', { headers: { cookie: changed.cookie } })).body.operatorAllowed, true);
});

test('simultaneous first launches publish one complete private key without replacing each other', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla operator first launch '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const remoteOperatorPath = path.join(directory, 'remote-operator.json');
  const [first, second] = await Promise.all([fixture(t, { remoteOperatorPath }), fixture(t, { remoteOperatorPath })]);
  const left = await pair(first), right = await pair(second);
  assert.equal(left.token, right.token);
  assert.equal(JSON.parse(await readFile(remoteOperatorPath, 'utf8')).secret, left.token);
  assert.deepEqual(await readdir(directory), ['remote-operator.json']);
});

test('normal saves keep the private key beside performance data and never serve or export it', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla operator private storage '));
  const instance = await fixture(t, { rootDir: directory, persistencePath: undefined });
  t.after(async () => { await instance.close(); await rm(directory, { recursive: true, force: true }); });
  const { token } = await pair(instance);
  const saved = JSON.parse(await readFile(path.join(directory, 'data/remote-operator.json'), 'utf8'));
  assert.equal(saved.secret, token);
  for (const url of ['/data/remote-operator.json', '/data/.remote-operator.json.tmp']) {
    assert.equal((await requestFrom(instance, host, url)).status, 404);
    assert.equal((await requestFrom(instance, remote, url)).status, 404);
  }
  assert.equal(JSON.stringify((await requestFrom(instance, host, '/api/settings/export')).body).includes(token), false);
  assert.equal(JSON.stringify((await requestFrom(instance, remote, '/api/session')).body).includes(token), false);
  const otherSave = path.join(directory, 'isolated', 'performance-state.json');
  const isolated = await fixture(t, { persistencePath: otherSave });
  t.after(() => isolated.close());
  const isolatedPair = await pair(isolated);
  assert.equal(JSON.parse(await readFile(path.join(directory, 'isolated/remote-operator.json'), 'utf8')).secret, isolatedPair.token);
  assert.notEqual(isolatedPair.token, token);
});

test('malformed or unreadable saved private links fail clearly without replacing the original file', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla invalid operator key '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const remoteOperatorPath = path.join(directory, 'remote-operator.json');
  for (const value of ['broken JSON', JSON.stringify(null), JSON.stringify({ version: 2, secret: 'x'.repeat(43) }),
    JSON.stringify({ version: 1, secret: 'x'.repeat(42) }), JSON.stringify({ version: 1, secret: '!'.repeat(43) }),
    JSON.stringify({ version: 1, secret: 'x'.repeat(43) }),
    JSON.stringify({ version: 1, secret: Buffer.alloc(32).toString('base64url'), pin: 123456 }),
    JSON.stringify({ version: 1, secret: Buffer.alloc(32).toString('base64url'), pin: '12345' })]) {
    await writeFile(remoteOperatorPath, value);
    await assert.rejects(fixture(t, { remoteOperatorPath }), /saved private operator link could not be opened/);
    assert.equal(await readFile(remoteOperatorPath, 'utf8'), value);
  }
  await rm(remoteOperatorPath);
  await mkdir(remoteOperatorPath);
  await assert.rejects(fixture(t, { remoteOperatorPath }), /saved private operator link could not be opened/);
  assert.equal((await stat(remoteOperatorPath)).isDirectory(), true);
});

test('simple remote address serves Operator and one PIN entry remembers the device across restart', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla operator PIN '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const remoteOperatorPath = path.join(directory, 'remote-operator.json');
  const instance = await fixture(t, { remoteOperatorPath });
  const links = (await requestFrom(instance, host, '/api/operator/remote')).body;
  const operatorPage = await requestFrom(instance, host, '/operator');
  for (const url of ['/operator-remote', '/operator-remote/']) {
    const page = await requestFrom(instance, remote, url);
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.match(page.body, /operator-controls/);
    assert.equal(page.body, operatorPage.body, 'The simple address serves the static Operator page without embedding private credentials.');
  }
  const result = await requestFrom(instance, remote, '/api/operator/pair', post({ pin: links.pin }, { referer: 'http://127.0.0.1:4173/operator-remote' }));
  assert.equal(result.status, 200);
  assert.match(result.headers['set-cookie'], /HttpOnly; SameSite=Strict; Path=\/; Max-Age=31536000/);
  const cookie = result.headers['set-cookie'].split(';')[0];
  assert.equal((await requestFrom(instance, remote, '/api/scene', post({ scene: 'participation' }, { cookie }))).status, 200);
  await instance.close();
  const restarted = await fixture(t, { remoteOperatorPath });
  assert.equal((await requestFrom(restarted, host, '/api/operator/remote')).body.pin, links.pin);
  const remembered = await requestFrom(restarted, remote, '/api/session', { headers: { cookie } });
  assert.equal(remembered.body.operatorAllowed, true);
  assert.equal(Object.hasOwn(remembered.body, 'pin'), false);
  assert.equal(Object.hasOwn(remembered.body, 'remoteUrl'), false);
  assert.equal((await requestFrom(restarted, remote, '/api/operator/remote', { headers: { cookie } })).status, 403);
  const reset = await requestFrom(restarted, host, '/api/operator/remote/renew', post({}));
  assert.notEqual(reset.body.pin, links.pin);
  assert.equal((await requestFrom(restarted, remote, '/api/session', { headers: { cookie } })).body.operatorAllowed, false);
  assert.equal((await requestFrom(restarted, remote, '/api/operator/pair', post({ pin: links.pin }))).status, 403);
  assert.equal((await requestFrom(restarted, remote, '/api/operator/pair', post({ pin: reset.body.pin }))).status, 200);
});

test('legacy saved links gain one persistent PIN without invalidating long links or remembered cookies', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla operator PIN migration '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const remoteOperatorPath = path.join(directory, 'remote-operator.json');
  const secret = Buffer.alloc(32, 23).toString('base64url');
  await writeFile(remoteOperatorPath, JSON.stringify({ version: 1, secret }), { mode: 0o600 });
  const [first, second] = await Promise.all([fixture(t, { remoteOperatorPath }), fixture(t, { remoteOperatorPath })]);
  const left = (await requestFrom(first, host, '/api/operator/remote')).body;
  const right = (await requestFrom(second, host, '/api/operator/remote')).body;
  assert.match(left.pin, /^\d{6}$/);
  assert.equal(right.pin, left.pin, 'Simultaneous migrations agree on the same PIN.');
  assert.equal(new URLSearchParams(new URL(left.url).hash.slice(1)).get('remote'), secret);
  assert.equal((await requestFrom(first, remote, '/api/session', { headers: { cookie: `karhutla-operator=${secret}` } })).body.operatorAllowed, true);
  assert.equal((await requestFrom(first, remote, '/api/operator/pair', post({ token: secret }))).status, 200);
  assert.equal((await requestFrom(second, remote, '/api/operator/pair', post({ pin: left.pin }))).status, 200);
  assert.deepEqual(JSON.parse(await readFile(remoteOperatorPath, 'utf8')), { version: 1, secret, pin: left.pin });
  assert.deepEqual(await readdir(directory), ['remote-operator.json']);
});

test('PIN guessing locks only the requesting IP after five failures and expires after sixty seconds', async t => {
  let now = 1000;
  const instance = await fixture(t, { clock: () => now });
  const links = (await requestFrom(instance, host, '/api/operator/remote')).body;
  const wrongPin = links.pin === '000000' ? '000001' : '000000';
  for (let index = 0; index < 4; index++) {
    const result = await requestFrom(instance, remote, '/api/operator/pair', post({ pin: wrongPin }, { 'x-forwarded-for': `192.168.10.${index}` }));
    assert.equal(result.status, 403);
    assert.equal(result.headers['set-cookie'], undefined);
  }
  const blocked = await requestFrom(instance, remote, '/api/operator/pair', post({ pin: wrongPin }));
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['retry-after'], '60');
  assert.equal(blocked.body.retryAfterSeconds, 60);
  assert.equal((await requestFrom(instance, remote, '/api/operator/pair', post({ pin: links.pin }))).status, 429);
  assert.equal((await requestFrom(instance, '192.168.10.123', '/api/operator/pair', post({ pin: links.pin }))).status, 200);
  assert.equal((await requestFrom(instance, remote, '/api/session')).status, 200, 'Lockout never blocks session refresh or serving the page.');
  now += 59000;
  const waiting = await requestFrom(instance, remote, '/api/operator/pair', post({ pin: links.pin }));
  assert.equal(waiting.status, 429);
  assert.equal(waiting.headers['retry-after'], '1');
  now += 1000;
  assert.equal((await requestFrom(instance, remote, '/api/operator/pair', post({ pin: links.pin }))).status, 200);
});

test('PIN attempts retain origin and display-page restrictions and reject malformed shapes safely', async t => {
  const instance = await fixture(t);
  const { pin } = (await requestFrom(instance, host, '/api/operator/remote')).body;
  for (const headers of [{ origin: 'https://another-site.invalid' }, { 'x-wildfire-role': 'projection' }, { 'x-wildfire-role': 'participant' },
    { referer: 'http://127.0.0.1:4173/audience' }, { referer: 'http://127.0.0.1:4173/projection' }, { referer: 'http://127.0.0.1:4173/join' }]) {
    const rejected = await requestFrom(instance, remote, '/api/operator/pair', post({ pin }, headers));
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers['set-cookie'], undefined);
  }
  for (const [index, value] of [null, [], '123456', { pin: 123456 }, { pin: null }, { pin: {} }, { pin: '12345' }, { pin: '1234567' }].entries()) {
    assert.equal((await requestFrom(instance, `192.168.20.${index}`, '/api/operator/pair', post(value))).status, 403);
  }
  assert.equal((await requestFrom(instance, remote, '/api/operator/pair', post({ pin }))).status, 200, 'Rejected display and cross-origin attempts do not consume legitimate PIN attempts.');
});
