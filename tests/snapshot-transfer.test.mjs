import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createPerformanceServer } from '../app/server.mjs';
import { MAX_FIRE_SNAPSHOT_BYTES } from '../app/fire-snapshot.mjs';

const host = '127.0.0.1', remote = '192.168.10.122';
const sourceURL = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv';
function snapshot(positions = [[110.125, -2.125]], fetchedAt = '2026-11-07T12:00:00Z') {
  const observedAt = '2026-11-07T11:00:00Z';
  return {
    schemaVersion: 1,
    source: { name: 'NASA FIRMS — NOAA-20 VIIRS Collection 2', url: sourceURL, sensor: 'VIIRS NOAA-20',
      rawFile: 'data/raw-noaa20-24h.csv', rawSha256: 'a'.repeat(64) },
    fetchedAt, observationStart: positions.length ? observedAt : null, observationEnd: positions.length ? observedAt : null,
    windowLabel: 'NASA rolling 24-hour snapshot',
    geographicFilter: { country: 'Indonesia', iso3: 'IDN', method: 'point-in-polygon', boundary: 'data/indonesia.geojson',
      boundarySource: 'Natural Earth 1:10m', approximate: true, prefilterBbox: [94.5, -11.5, 141.5, 6.5] },
    counts: { downloadedRows: positions.length, boundingBoxRows: positions.length, outsideCountryRows: 0, invalidRows: 0, duplicateRows: 0, retainedRows: positions.length },
    notes: ['Synthetic transfer fixture.'],
    records: positions.map(([longitude, latitude], index) => ({ id: `transfer-${index}`, latitude, longitude, observedAt,
      frp: 2, satellite: 'NOAA-20', instrument: 'VIIRS' })),
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
      end(value) {
        const content = String(value || '');
        resolve({ status, headers: responseHeaders, body: responseHeaders['content-type']?.startsWith('application/json') ? JSON.parse(content) : content });
      },
    });
  });
}
const post = (body, headers = {}) => ({ method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });
async function fixture(t, options = {}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'karhutla snapshot transfer '));
  const initial = options.initial ?? snapshot();
  await mkdir(path.join(rootDir, 'data'));
  if (initial) await writeFile(path.join(rootDir, 'data/fire-snapshot.json'), JSON.stringify(initial));
  const instances = [];
  const serverOptions = { rootDir, port: 0, lanEnabled: true, autoTick: false, remoteOperatorPath: null,
    persistencePath: path.join(rootDir, 'data/performance-state.json'), clock: () => 1000, wallClock: () => 1700000000000,
    networkInterfaces: { en0: [{ address: '192.168.10.101', family: 'IPv4', internal: false }] }, ...options };
  delete serverOptions.initial;
  const restart = async () => { const value = await createPerformanceServer(serverOptions); instances.push(value); return value; };
  t.after(async () => { for (const value of instances) await value.close(); await rm(rootDir, { recursive: true, force: true }); });
  const instance = await restart();
  return { instance, rootDir, initial, restart };
}
async function pairedHeaders(instance) {
  const { pin } = (await requestFrom(instance, host, '/api/operator/remote')).body;
  const result = await requestFrom(instance, remote, '/api/operator/pair', post({ pin }));
  assert.equal(result.status, 200);
  return { cookie: result.headers['set-cookie'].split(';')[0], 'x-wildfire-role': 'operator' };
}
function roomState(room) {
  return { preset: room.exportSettingsPreset(), mainSound: room.mainSoundState(), simulation: room.simulation.serialize(),
    scene: room.sceneState(), records: structuredClone(room.records), epoch: room.epoch, snapshotVersion: room.snapshotVersion,
    bootstrapAvailable: room.bootstrapAvailable, actorRevision: room.actorRevision };
}
async function prepare(instance) {
  const preset = instance.room.exportSettingsPreset();
  preset.strength = .37;
  Object.assign(preset.parameters, { fireReturnSeconds: 9, deepCoolingSeconds: 22 });
  Object.assign(preset.sceneSettings, { wifiName: 'Offline room', wifiPassword: 'offline password', programNotes: 'Prepared programme.', arrivalSeconds: 17, finalRainRiseSeconds: 40 });
  preset.soundSettings.level = .42;
  preset.soundSettings.mixer.bells = .71;
  preset.soundSettings.macros.haze = .63;
  await instance.room.importSettingsPreset(preset);
  await instance.room.setScene({ scene: 'participation' });
  return preset;
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function waitFor(predicate) {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the snapshot operation.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return predicate();
}

test('paired phone imports offline data into a fresh paused landscape, preserves all settings and survives restart', async t => {
  const { instance, rootDir, restart } = await fixture(t);
  const headers = await pairedHeaders(instance), preset = await prepare(instance);
  const soundRequest = instance.room.requestMainSound({ enabled: true });
  instance.room.reportMainSound({ requestId: soundRequest.requestId, state: 'ready', activated: true });
  const mainSound = instance.room.mainSoundState();
  const participant = instance.room.connect({ clientId: 'snapshot-holder', role: 'operator' });
  instance.room.hold(participant.connectionId, { type: 'hold', epoch: instance.room.epoch, seq: 0, holding: true, start: true, position: [110.125, -2.125] });
  instance.room.simulation.cells.values().next().value.moisture = .8;
  instance.room.simulation.totalWater = 42;
  const oldEpoch = instance.room.epoch;
  const next = snapshot([[101.125, -1.125], [136.125, -3.125]]);
  const result = await requestFrom(instance, remote, '/api/snapshot/import', post(next, headers));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.snapshot, next);
  assert.equal(result.body.state.scene.id, 'arrival'); assert.equal(result.body.state.scene.paused, true);
  assert.equal(result.body.state.bootstrapAvailable, false);
  assert.notEqual(result.body.state.epoch, oldEpoch);
  assert.equal(result.body.state.snapshotVersion, next.fetchedAt);
  assert.deepEqual(result.body.state.mainSound, mainSound, 'Import preserves the host browser playback request and readiness.');
  assert.deepEqual(instance.room.exportSettingsPreset(), preset);
  assert.equal(instance.room.simulation.cells.size, 2, 'Prior source and wet cells are removed.');
  assert.equal(instance.room.simulation.totalWater, 0);
  assert.ok([...instance.room.simulation.cells.values()].every(cell => cell.heat === 1 && cell.moisture === 0));
  assert.equal(instance.room.connections.get(participant.connectionId).holding, false);
  assert.throws(() => instance.room.hold(participant.connectionId, { type: 'hold', epoch: oldEpoch, seq: 1, holding: true, position: [110.125, -2.125] }), /performance changed/i);
  assert.deepEqual(JSON.parse(await readFile(path.join(rootDir, 'data/fire-snapshot.json'), 'utf8')), next);
  await instance.close();
  const restored = await restart();
  assert.deepEqual(restored.room.records, next.records);
  assert.equal(restored.room.bootstrapAvailable, false);
  assert.equal(restored.room.sceneState().id, 'arrival'); assert.equal(restored.room.sceneState().paused, true);
  assert.deepEqual(restored.room.exportSettingsPreset(), preset);
  assert.equal(restored.room.simulation.cells.size, 2);
});

test('same fetch timestamp with changed records resets the epoch once and export never reconciles the landscape', async t => {
  const { instance, rootDir } = await fixture(t);
  await prepare(instance);
  const before = roomState(instance.room);
  const external = snapshot([[101.125, -1.125]]);
  await writeFile(path.join(rootDir, 'data/fire-snapshot.json'), JSON.stringify(external));
  const exported = await requestFrom(instance, host, '/api/snapshot/export');
  assert.equal(exported.status, 200);
  assert.match(exported.headers['content-disposition'], /karhutla-fire-snapshot-2026-11-07\.json/);
  assert.deepEqual(exported.body, external);
  assert.deepEqual(roomState(instance.room), before, 'Exporting never applies an externally replaced file.');
  const imported = await requestFrom(instance, host, '/api/snapshot/import', post(external));
  assert.equal(imported.status, 200); assert.notEqual(imported.body.state.epoch, before.epoch);
  assert.equal(imported.body.state.snapshotVersion, before.snapshotVersion);
  const epoch = instance.room.epoch;
  for (let index = 0; index < 3; index++) assert.deepEqual((await requestFrom(instance, host, '/api/snapshot')).body, external);
  assert.equal(instance.room.epoch, epoch, 'Ordinary source reads cannot undo or repeatedly reset an import.');
  const layout = (await requestFrom(instance, host, '/api/study-region?region=indonesia')).body;
  assert.equal(layout.fireKeys.length, 1); assert.equal(layout.patches[0][1], 101.125);
});

for (const route of ['/api/snapshot', '/api/snapshot/export']) {
  test(`a delayed snapshot read cannot replace a completed same-timestamp import with its old data (${route})`, { timeout: 5000 }, async t => {
    const captured = deferred(), resume = deferred();
    let delayNext = false;
    const { instance, rootDir, initial } = await fixture(t, { snapshotRead: async file => {
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (delayNext) { delayNext = false; captured.resolve(); await resume.promise; }
      return value;
    } });
    t.after(() => resume.resolve());
    const preset = await prepare(instance);
    delayNext = true;
    const reading = requestFrom(instance, host, route);
    await captured.promise;
    const next = snapshot([[101.125, -1.125], [136.125, -3.125]], initial.fetchedAt);
    const imported = await requestFrom(instance, host, '/api/snapshot/import', post(next));
    assert.equal(imported.status, 200);
    const committed = roomState(instance.room);
    const sourcePath = path.join(rootDir, 'data/fire-snapshot.json');
    const savedSource = await readFile(sourcePath, 'utf8'), savedState = await readFile(instance.room.persistencePath, 'utf8');
    resume.resolve();
    const result = await reading;
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, next, 'An old read finishing after import must return the newer committed snapshot.');
    assert.deepEqual(roomState(instance.room), committed, 'The delayed read must preserve the imported epoch and landscape.');
    assert.deepEqual(instance.room.exportSettingsPreset(), preset);
    assert.equal(await readFile(sourcePath, 'utf8'), savedSource);
    assert.equal(await readFile(instance.room.persistencePath, 'utf8'), savedState);
  });

  test(`a delayed snapshot read error cannot hide a refresh that committed while the read was pending (${route})`, { timeout: 5000 }, async t => {
    const captured = deferred(), resume = deferred();
    let delayNext = false;
    const next = snapshot([[136.125, -3.125]], '2026-11-08T12:00:00Z');
    const { instance, rootDir } = await fixture(t, {
      snapshotRead: async file => {
        const value = JSON.parse(await readFile(file, 'utf8'));
        if (delayNext) {
          delayNext = false; captured.resolve(); await resume.promise;
          throw new Error('Synthetic delayed read failure.');
        }
        return value;
      },
      snapshotRefresh: async () => next,
    });
    t.after(() => resume.resolve());
    const preset = await prepare(instance);
    delayNext = true;
    const reading = requestFrom(instance, host, route);
    await captured.promise;
    assert.equal((await requestFrom(instance, host, '/api/snapshot/refresh', post({}))).status, 200);
    const committed = roomState(instance.room);
    const sourcePath = path.join(rootDir, 'data/fire-snapshot.json');
    const savedSource = await readFile(sourcePath, 'utf8'), savedState = await readFile(instance.room.persistencePath, 'utf8');
    resume.resolve();
    const result = await reading;
    assert.equal(result.status, 200, 'The newer committed cache remains available despite failure of an obsolete read.');
    assert.deepEqual(result.body, next);
    assert.deepEqual(roomState(instance.room), committed);
    assert.deepEqual(instance.room.exportSettingsPreset(), preset);
    assert.equal(await readFile(sourcePath, 'utf8'), savedSource);
    assert.equal(await readFile(instance.room.persistencePath, 'utf8'), savedState);
  });
}

test('invalid, oversized, unpaired and display-page transfers leave disk, room and settings unchanged', async t => {
  const { instance, rootDir } = await fixture(t);
  await prepare(instance);
  const before = roomState(instance.room), sourceBefore = await readFile(path.join(rootDir, 'data/fire-snapshot.json'), 'utf8');
  const savedBefore = await readFile(instance.room.persistencePath, 'utf8');
  const next = snapshot([[136.125, -3.125]]);
  const invalid = structuredClone(next); invalid.records[0].longitude = 200;
  const cases = [
    [host, post({ format: 'wildfire-settings' }), 400], [host, post(invalid), 400], [host, post('invalid JSON'), 400],
    [host, post(' '.repeat(MAX_FIRE_SNAPSHOT_BYTES + 1)), 413], [remote, post(next), 403],
    [host, post(next, { origin: 'https://another-site.invalid' }), 403],
    [host, post(next, { 'x-wildfire-role': 'projection' }), 403], [host, post(next, { 'x-wildfire-role': 'participant' }), 403],
    [host, post(next, { referer: 'http://127.0.0.1:4173/audience' }), 403],
    [host, { method: 'POST', body: next }, 415],
  ];
  for (const [address, options, status] of cases) assert.equal((await requestFrom(instance, address, '/api/snapshot/import', options)).status, status);
  for (const headers of [{ 'x-wildfire-role': 'projection' }, { referer: 'http://127.0.0.1:4173/projection' }, { origin: 'https://another-site.invalid' }]) {
    assert.equal((await requestFrom(instance, host, '/api/snapshot/export', { headers })).status, 403);
  }
  assert.equal((await requestFrom(instance, remote, '/api/snapshot/export')).status, 403);
  assert.equal((await requestFrom(instance, host, '/api/snapshot/export', post({}))).status, 405);
  assert.equal((await requestFrom(instance, host, '/api/snapshot/import')).status, 405);
  assert.deepEqual(roomState(instance.room), before);
  assert.equal(await readFile(path.join(rootDir, 'data/fire-snapshot.json'), 'utf8'), sourceBefore);
  assert.equal(await readFile(instance.room.persistencePath, 'utf8'), savedBefore);
});

test('snapshot and state save failures preserve the old cache and running landscape without temporary leftovers', async t => {
  const { instance, rootDir } = await fixture(t);
  await prepare(instance);
  const before = roomState(instance.room), sourcePath = path.join(rootDir, 'data/fire-snapshot.json');
  const sourceBefore = await readFile(sourcePath, 'utf8');
  const actualSave = instance.room.persistencePath;
  const blockedSave = path.join(rootDir, 'data/blocked-state');
  await mkdir(blockedSave);
  instance.room.persistencePath = blockedSave;
  try {
    const result = await requestFrom(instance, host, '/api/snapshot/import', post(snapshot([[136.125, -3.125]])));
    assert.equal(result.status, 500);
    assert.deepEqual(roomState(instance.room), before);
    assert.equal(await readFile(sourcePath, 'utf8'), sourceBefore);
    assert.equal((await readdir(path.join(rootDir, 'data'))).some(name => /\.(?:tmp|bak)$/.test(name)), false);
  } finally { instance.room.persistencePath = actualSave; }
});

test('imports initialize first use and accept zero detections without restoring an old landscape', async t => {
  const { instance } = await fixture(t);
  assert.equal(instance.room.bootstrapAvailable, true);
  const result = await requestFrom(instance, host, '/api/snapshot/import', post(snapshot([])));
  assert.equal(result.status, 200); assert.equal(result.body.state.bootstrapAvailable, false);
  assert.equal(instance.room.national.fireKeys.size, 0); assert.equal(instance.room.simulation.cells.size, 0);
  await assert.rejects(instance.room.bootstrap({ state: null }), /already been initialized/);
});

test('an import serializes with saved state and rejects overlapping imports, refreshes and configuration edits', async t => {
  let downloads = 0;
  const { instance, initial } = await fixture(t, { snapshotRefresh: async () => { downloads++; throw new Error('Must not download.'); } });
  await prepare(instance);
  const before = roomState(instance.room), gate = deferred();
  instance.room.writeChain = gate.promise;
  const next = snapshot([[136.125, -3.125]]);
  const importing = requestFrom(instance, host, '/api/snapshot/import', post(next));
  await waitFor(() => instance.room.snapshotImportInProgress);
  assert.equal((await requestFrom(instance, host, '/api/snapshot/import', post(next))).status, 409);
  assert.equal((await requestFrom(instance, host, '/api/snapshot/refresh', post({}))).status, 409);
  assert.equal((await requestFrom(instance, host, '/api/strength', post({ strength: .1 }))).status, 409);
  assert.equal(downloads, 0);
  assert.deepEqual((await requestFrom(instance, host, '/api/snapshot')).body, initial);
  assert.deepEqual((await requestFrom(instance, host, '/api/snapshot/export')).body, initial);
  assert.deepEqual(roomState(instance.room), before);
  await instance.room.persist();
  gate.resolve();
  assert.equal((await importing).status, 200);
  assert.equal((await requestFrom(instance, host, '/api/strength', post({ strength: .2 }))).status, 200);
});

test('staged refresh blocks imports, shares one download and publishes cached data only after completion', async t => {
  const started = deferred(), finish = deferred();
  let downloads = 0;
  const next = snapshot([[101.125, -1.125]], '2026-11-08T12:00:00Z');
  const { instance, rootDir, initial } = await fixture(t, { snapshotRefresh: async ({ rootDir: stagedRoot }) => {
    downloads++; started.resolve(); await finish.promise;
    await mkdir(path.join(stagedRoot, 'data'));
    await writeFile(path.join(stagedRoot, 'data/raw-noaa20-24h.csv'), 'synthetic downloaded CSV');
    return next;
  } });
  await prepare(instance);
  const before = roomState(instance.room);
  const refreshing = requestFrom(instance, host, '/api/snapshot/refresh', post({}));
  await started.promise;
  const duplicate = requestFrom(instance, host, '/api/firms/refresh', post({}));
  assert.equal((await requestFrom(instance, host, '/api/snapshot/import', post(snapshot()))).status, 409);
  assert.deepEqual((await requestFrom(instance, host, '/api/snapshot')).body, initial);
  assert.deepEqual(roomState(instance.room), before);
  finish.resolve();
  assert.equal((await refreshing).status, 200); assert.equal((await duplicate).status, 200);
  assert.equal(downloads, 1);
  assert.deepEqual(instance.room.records, next.records);
  assert.equal(instance.room.sceneState().id, 'arrival');
  assert.equal(await readFile(path.join(rootDir, 'data/raw-noaa20-24h.csv'), 'utf8'), 'synthetic downloaded CSV');
  assert.equal((await readdir(path.join(rootDir, 'data'))).some(name => name.startsWith('.fire-refresh-')), false);
});

test('a failed refresh save retains both the previous source files and the running performance', async t => {
  const { instance, rootDir } = await fixture(t, { snapshotRefresh: async ({ rootDir: stagedRoot }) => {
    await mkdir(path.join(stagedRoot, 'data'));
    await writeFile(path.join(stagedRoot, 'data/raw-noaa20-24h.csv'), 'replacement CSV');
    return snapshot([[136.125, -3.125]]);
  } });
  await prepare(instance);
  const rawPath = path.join(rootDir, 'data/raw-noaa20-24h.csv');
  await writeFile(rawPath, 'previous CSV');
  const before = roomState(instance.room), sourceBefore = await readFile(path.join(rootDir, 'data/fire-snapshot.json'), 'utf8');
  const originalPath = instance.room.persistencePath;
  const blocked = path.join(rootDir, 'data/blocked-state'); await mkdir(blocked); instance.room.persistencePath = blocked;
  try {
    assert.equal((await requestFrom(instance, host, '/api/snapshot/refresh', post({}))).status, 502);
    assert.equal(await readFile(path.join(rootDir, 'data/fire-snapshot.json'), 'utf8'), sourceBefore);
    assert.equal(await readFile(rawPath, 'utf8'), 'previous CSV');
    assert.deepEqual(roomState(instance.room), before);
    assert.equal((await readdir(path.join(rootDir, 'data'))).some(name => /\.(?:tmp|bak)$/.test(name) || name.startsWith('.fire-refresh-')), false);
  } finally { instance.room.persistencePath = originalPath; }
});

test('phones and projections receive a new epoch and matching current source after a same-timestamp import', { timeout: 7000 }, async t => {
  const { instance } = await fixture(t);
  const preset = await prepare(instance), oldEpoch = instance.room.epoch;
  const { port } = await instance.listen();
  const connect = async (role, clientId, scope = 'region') => {
    const messages = [], socket = new WebSocket(`ws://127.0.0.1:${port}/ws?role=${role}&clientId=${clientId}&scope=${scope}`);
    socket.on('message', raw => messages.push(JSON.parse(raw)));
    t.after(() => socket.terminate());
    await once(socket, 'open');
    await waitFor(() => messages.find(value => ['state', 'summary'].includes(value.type)));
    return { socket, messages };
  };
  const projection = await connect('projection', 'transfer-projection');
  const phone = await connect('participant', 'transfer-phone', 'indonesia');
  const next = snapshot([[101.125, -1.125], [136.125, -3.125]]);
  assert.equal((await requestFrom(instance, host, '/api/snapshot/import', post(next))).status, 200);
  const projected = await waitFor(() => projection.messages.find(value => value.type === 'state' && value.epoch !== oldEpoch));
  const handheld = await waitFor(() => phone.messages.find(value => value.type === 'summary' && value.epoch !== oldEpoch));
  assert.equal(projected.epoch, handheld.epoch);
  assert.equal(projected.simulation.delta, false);
  assert.equal(projected.simulation.cells.length, 2);
  assert.equal(handheld.region.spatial.patches.length, 2);
  assert.equal(handheld.scene.id, 'arrival'); assert.equal(handheld.scene.paused, true);
  assert.deepEqual(handheld.soundSettings, preset.soundSettings);
  assert.equal(projected.snapshotVersion, next.fetchedAt); assert.equal(handheld.snapshotVersion, next.fetchedAt);
  assert.equal(projected.soundCondition.sourceCount, 2); assert.equal(handheld.soundCondition.sourceCount, 2);
});

test('restart discards stale ground after an interrupted source/state publication while retaining prepared settings', async t => {
  const { instance, rootDir, restart } = await fixture(t);
  const preset = await prepare(instance);
  instance.room.simulation.totalWater = 42;
  await instance.room.persist();
  await instance.close();
  const next = snapshot([[136.125, -3.125]]);
  await writeFile(path.join(rootDir, 'data/fire-snapshot.json'), JSON.stringify(next));
  const restored = await restart();
  assert.deepEqual(restored.room.records, next.records);
  assert.equal(restored.room.simulation.cells.size, 1);
  assert.equal(restored.room.simulation.totalWater, 0);
  assert.deepEqual(restored.room.exportSettingsPreset(), preset);
  assert.equal(restored.room.sceneState().paused, true);
});

test('default refresh parses in a separate child while the host keeps serving and advancing the performance', { timeout: 10000 }, async t => {
  const { instance, rootDir, initial } = await fixture(t, { autoTick: true, clock: () => performance.now(), wallClock: () => Date.now() });
  const next = snapshot([[136.125, -3.125]], '2026-11-08T12:00:00Z');
  const scriptDir = path.join(rootDir, 'scripts'), marker = path.join(rootDir, 'data/child-started.json');
  const gate = path.join(rootDir, 'data/allow-child-finish');
  await mkdir(scriptDir);
  await writeFile(path.join(scriptDir, 'fetch-snapshot.mjs'), `
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export async function refreshSnapshot({rootDir, boundaryPath}) {
  await writeFile(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid, rootDir, boundaryPath}));
  const busyUntil=Date.now()+350;
  while(Date.now()<busyUntil) { Math.sqrt(Date.now()); }
  const deadline=Date.now()+5000;
  for (;;) {
    try { await readFile(${JSON.stringify(gate)}); break; } catch(error) { if(error.code!=='ENOENT') throw error; }
    if(Date.now()>deadline) throw new Error('Test child was not released.');
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  await mkdir(path.join(rootDir,'data'));
  await writeFile(path.join(rootDir,'data/raw-noaa20-24h.csv'),'isolated child CSV');
  await writeFile(path.join(rootDir,'data/fire-snapshot.json'),JSON.stringify(${JSON.stringify(next)}));
}
`);
  await prepare(instance);
  let advances = 0;
  const advance = instance.room.advance.bind(instance.room);
  instance.room.advance = (...args) => { advances++; return advance(...args); };
  const { port } = await instance.listen();
  const refreshing = requestFrom(instance, host, '/api/snapshot/refresh', post({}));
  let child;
  try {
    const deadline = Date.now() + 2500;
    while (!child) {
      try { child = JSON.parse(await readFile(marker, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      if (Date.now() > deadline) throw new Error('Refresh child did not start.');
      if (!child) await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.notEqual(child.pid, process.pid);
    assert.equal(child.boundaryPath, path.join(rootDir, 'data/indonesia.geojson'));
    assert.ok(child.rootDir.startsWith(path.join(rootDir, 'data/.fire-refresh-')));
    const before = advances;
    const health = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    assert.equal(health.status, 200); assert.equal((await health.json()).refreshing, true);
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.ok(advances > before, 'The host simulation timer keeps running while the child handles the source.');
    assert.deepEqual(JSON.parse(await readFile(path.join(rootDir, 'data/fire-snapshot.json'), 'utf8')), initial);
  } finally { await writeFile(gate, 'continue'); }
  const result = await refreshing;
  assert.equal(result.status, 200); assert.deepEqual(result.body, next);
  assert.deepEqual(instance.room.records, next.records);
  assert.equal(await readFile(path.join(rootDir, 'data/raw-noaa20-24h.csv'), 'utf8'), 'isolated child CSV');
});

test('a failed refresh child cannot replace the snapshot or reset the live room', async t => {
  const { instance, rootDir } = await fixture(t);
  await mkdir(path.join(rootDir, 'scripts'));
  await writeFile(path.join(rootDir, 'scripts/fetch-snapshot.mjs'), "export async function refreshSnapshot(){throw new Error('Synthetic child failure.');}\n");
  await prepare(instance);
  const before = roomState(instance.room), cache = await readFile(path.join(rootDir, 'data/fire-snapshot.json'), 'utf8');
  const result = await requestFrom(instance, host, '/api/snapshot/refresh', post({}));
  assert.equal(result.status, 502);
  assert.match(result.body.error, /Could not download/);
  assert.deepEqual(roomState(instance.room), before);
  assert.equal(await readFile(path.join(rootDir, 'data/fire-snapshot.json'), 'utf8'), cache);
  assert.equal((await readdir(path.join(rootDir, 'data'))).some(name => name.startsWith('.fire-refresh-')), false);
});
