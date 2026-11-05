import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPerformanceServer } from '../app/server.mjs';
import { prepareFreshOperator, exercisePreparedOperator, assertRestartedOperator, requestJson } from '../scripts/smoke-operator-flow.mjs';

const records = [{ longitude: 110.125, latitude: -2.125 }];
async function listen(persistencePath) {
  const instance = await createPerformanceServer({ records, snapshotVersion: 'release-smoke-fixture', port: 0,
    persistencePath, autoTick: false, clock: () => 1000, wallClock: () => 10000 });
  const address = await instance.listen();
  return { instance, base: `http://127.0.0.1:${address.port}` };
}

test('release smoke starts a truly fresh installation through normal operator actions and preserves prepared settings', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla release first use '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const persistencePath = path.join(directory, 'performance-state.json');
  let server = await listen(persistencePath);
  try {
    const preset = await prepareFreshOperator(server.base);
    await server.instance.close(); server = null;
    assert.equal(JSON.parse(await readFile(persistencePath, 'utf8')).settingsOnly, true);
    server = await listen(persistencePath);
    await assertRestartedOperator(server.base, preset, { initialized: false });
    await exercisePreparedOperator(server.base, preset);
    await server.instance.close(); server = null;
    server = await listen(persistencePath);
    await assertRestartedOperator(server.base, preset, { initialized: true });
  } finally { if (server) await server.instance.close(); }
});

test('direct cue4, cue5 and Restart initialize a fresh HTTP installation without an Initialize request', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla release direct cue '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cases = [
    { route: '/api/scene', body: { scene: 'forest-takeover' }, scene: 'forest-takeover', paused: false },
    { route: '/api/scene', body: { scene: 'final-rain' }, scene: 'final-rain', paused: false },
    { route: '/api/reset', body: {}, scene: 'arrival', paused: true },
  ];
  for (const [index, entry] of cases.entries()) {
    const server = await listen(path.join(directory, `${index}.json`));
    try {
      const preset = await prepareFreshOperator(server.base);
      const selected = await requestJson(server.base, entry.route, entry.body);
      assert.equal(selected.bootstrapAvailable, false);
      assert.equal(selected.scene.id, entry.scene); assert.equal(selected.scene.paused, entry.paused);
      assert.ok(selected.simulation.cells.length > 0, 'The first operator action prepares the cached fire landscape.');
      assert.equal((await requestJson(server.base, '/api/health')).authorityReady, true);
      assert.deepEqual(await requestJson(server.base, '/api/settings/export'), preset);
    } finally { await server.instance.close(); }
  }
});
