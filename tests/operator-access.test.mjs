import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultOperatorDataDirectory, loadOperatorCredentials } from '../app/operator-access.mjs';

test('private operator data uses the platform account folder and supports an explicit data directory', () => {
  assert.equal(defaultOperatorDataDirectory({ platform: 'darwin', homeDir: '/Users/performer', env: {} }), '/Users/performer/Library/Application Support/Karhutla');
  assert.equal(defaultOperatorDataDirectory({ platform: 'win32', homeDir: 'C:\\Users\\performer', env: { LOCALAPPDATA: 'D:\\User Data' } }), 'D:\\User Data\\Karhutla');
  assert.equal(defaultOperatorDataDirectory({ platform: 'win32', homeDir: 'C:\\Users\\performer', env: {} }), 'C:\\Users\\performer\\AppData\\Local\\Karhutla');
  assert.equal(defaultOperatorDataDirectory({ platform: 'linux', homeDir: '/home/performer', env: { XDG_DATA_HOME: '/private-data' } }), '/private-data/karhutla');
  assert.equal(defaultOperatorDataDirectory({ platform: 'linux', homeDir: '/home/performer', env: {} }), '/home/performer/.local/share/karhutla');
  assert.equal(defaultOperatorDataDirectory({ platform: 'darwin', homeDir: '/Users/performer', env: { KARHUTLA_DATA_DIR: '/tmp/rehearsal' } }), '/tmp/rehearsal');
  assert.equal(defaultOperatorDataDirectory({ platform: 'win32', homeDir: 'C:\\Users\\performer', env: { KARHUTLA_DATA_DIR: 'E:\\Rehearsal' } }), 'E:\\Rehearsal');
});

test('existing per-release credentials migrate privately and shared credentials win permanently after reset', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla account credentials '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const legacyPath = path.join(directory, 'release-a', 'data', 'remote-operator.json');
  const file = path.join(directory, 'private', 'remote-operator.json');
  await mkdir(path.dirname(legacyPath), { recursive: true });
  const legacy = { version: 1, secret: Buffer.alloc(32, 71).toString('base64url'), pin: '004201' };
  await writeFile(legacyPath, JSON.stringify(legacy), { mode: 0o600 });
  const migrated = await loadOperatorCredentials(file, { legacyPath });
  assert.deepEqual(migrated, { secret: legacy.secret, pin: legacy.pin });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), legacy);
  if (process.platform !== 'win32') {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
  }
  assert.deepEqual(await readdir(path.dirname(file)), ['remote-operator.json']);
  await writeFile(legacyPath, 'broken old release');
  assert.deepEqual(await loadOperatorCredentials(file, { legacyPath }), migrated, 'A stale or broken release cannot replace the established shared credentials.');
});

test('concurrent release migrations publish one complete account key without replacing each other', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla account migration race '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'private', 'remote-operator.json');
  const legacyA = path.join(directory, 'a.json'), legacyB = path.join(directory, 'b.json');
  await writeFile(legacyA, JSON.stringify({ version: 1, secret: Buffer.alloc(32, 81).toString('base64url'), pin: '009901' }));
  await writeFile(legacyB, JSON.stringify({ version: 1, secret: Buffer.alloc(32, 82).toString('base64url'), pin: '009902' }));
  const [a, b] = await Promise.all([loadOperatorCredentials(file, { legacyPath: legacyA }), loadOperatorCredentials(file, { legacyPath: legacyB })]);
  assert.deepEqual(a, b);
  assert.ok(['009901', '009902'].includes(a.pin));
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 1, ...a });
  assert.deepEqual(await readdir(path.dirname(file)), ['remote-operator.json']);
});

test('invalid shared or used legacy credentials fail without generating replacements', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla invalid account credentials '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'private', 'remote-operator.json');
  const legacyPath = path.join(directory, 'legacy.json');
  await writeFile(legacyPath, 'not valid JSON');
  await assert.rejects(loadOperatorCredentials(file, { legacyPath }), /saved private operator link could not be opened/);
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  assert.equal(await readFile(legacyPath, 'utf8'), 'not valid JSON');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'broken shared credentials');
  await writeFile(legacyPath, JSON.stringify({ version: 1, secret: Buffer.alloc(32).toString('base64url'), pin: '123456' }));
  await assert.rejects(loadOperatorCredentials(file, { legacyPath }), /saved private operator link could not be opened/);
  assert.equal(await readFile(file, 'utf8'), 'broken shared credentials');
  const privateValue = Buffer.alloc(32, 39).toString('base64url');
  await writeFile(file, `{"secret":"${privateValue}", not-valid-json`);
  await assert.rejects(loadOperatorCredentials(file, { legacyPath }), error => {
    assert.equal(String(error.cause).includes(privateValue), false, 'Errors must not expose JSON excerpts containing private credentials.');
    return /saved private operator link could not be opened/.test(error.message);
  });
  await rm(file);
  await rm(legacyPath);
  await mkdir(legacyPath);
  await assert.rejects(loadOperatorCredentials(file, { legacyPath }), /saved private operator link could not be opened/);
  await assert.rejects(readFile(file), { code: 'ENOENT' });
});

test('saving private credentials preserves permissions of an existing user-selected parent folder', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'karhutla selected private folder '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  if (process.platform !== 'win32') await chmod(directory, 0o755);
  const before = (await stat(directory)).mode & 0o777;
  const file = path.join(directory, 'remote-operator.json');
  await loadOperatorCredentials(file);
  await loadOperatorCredentials(file);
  assert.equal((await stat(directory)).mode & 0o777, before);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
});
