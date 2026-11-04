import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { includeProjectFile, validatePortableLock, writeZip, readZipFile, officialRuntimeHash, bundleRuntime, crc32, parseBuildOptions, createPackageManifest } from './scripts/build-windows-package.mjs';
import { safePackagePath, checkPackage } from './scripts/check-package.mjs';
import { launcherOptions, assertPortAvailable } from './scripts/start-karhutla.mjs';

test('release allowlist includes the app and finished media without state, masters or machine files', () => {
  for (const file of ['server.mjs', 'settings-presets.mjs', 'WINDOWS.md', 'Start-Karhutla.cmd', 'scripts/fetch-snapshot.mjs', 'scripts/start-karhutla.mjs', 'scripts/fetch-snapshot.test.mjs', 'data/fire-snapshot.json', 'data/indonesia.geojson', 'audio-assets/v3/rain-storm-v23.mp3', 'audio-assets/v3/manifest.json', 'audio-assets/ATTRIBUTION.md', 'visual-assets/surface-heat-atlas.webp', 'visual-assets/exports/rainfall.gif', 'visual-assets/exports/wildfire-lofi-assets.zip']) assert.equal(includeProjectFile(file), true, file);
  for (const file of ['data/performance-state.json', 'data/performance-state.json.bak', 'data/raw-noaa20-24h.csv', '.env', '.audio-model-cache/model.safetensors', '.playwright-cli/snapshot.yaml', 'output/review.json', 'dist/package.zip', 'node_modules/ws/index.js', 'audio-assets/v3/haze-master.wav', 'audio-assets/v3/rejected/haze.mp3', 'audio-assets/v3/natural-sources/rain.mp3', 'audio-assets/v3/wildfire-medium-assets.zip']) assert.equal(includeProjectFile(file), false, file);
});

test('portable lock check fails closed when a dependency needs native or platform-specific installation', () => {
  const entry = { version: '1.0.0', resolved: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz', integrity: 'sha512-example' };
  const lock = value => ({ lockfileVersion: 3, packages: { '': {}, 'node_modules/example': { ...entry, ...value } } });
  assert.doesNotThrow(() => validatePortableLock(lock({})));
  for (const value of [{ hasInstallScript: true }, { os: ['darwin'] }, { cpu: ['arm64'] }, { libc: ['glibc'] }, { link: true }, { integrity: null }, { resolved: 'file:../example' }]) assert.throws(() => validatePortableLock(lock(value)), /platform-specific|unsupported/);
});

test('archive writer is deterministic, round-trips binary data and rejects damaged CRC', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'karhutla-zip-test-'));
  try {
    await mkdir(path.join(temp, 'assets'));
    const content = Buffer.from([0, 255, 1, 0, 2, 99, 0, 128]);
    await writeFile(path.join(temp, 'assets/file.bin'), content);
    await writeFile(path.join(temp, 'hello.txt'), 'karhutla');
    await writeZip(temp, ['hello.txt', 'assets/file.bin'], path.join(temp, 'first.zip'), 'package');
    await writeZip(temp, ['assets/file.bin', 'hello.txt'], path.join(temp, 'second.zip'), 'package');
    const zip = await readFile(path.join(temp, 'first.zip'));
    assert.deepEqual(zip, await readFile(path.join(temp, 'second.zip')));
    assert.deepEqual(readZipFile(zip, 'package/assets/file.bin'), content);
    assert.equal(readZipFile(zip, 'package/hello.txt').toString(), 'karhutla');
    assert.throws(() => readZipFile(zip, 'missing'), /missing/);
    const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt32LE(0, central + 16);
    assert.throws(() => readZipFile(zip, 'package/assets/file.bin'), /corrupt/);
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('runtime bundling rejects checksum mismatches and retains the verified runtime license', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'karhutla-runtime-test-'));
  try {
    const version = 'v24.22.2', folder = `node-${version}-win-x64`;
    await mkdir(path.join(temp, folder));
    await writeFile(path.join(temp, folder, 'node.exe'), 'MZfixture executable');
    await writeFile(path.join(temp, folder, 'LICENSE'), 'Fixture runtime license');
    const zip = path.join(temp, `${folder}.zip`), checksums = path.join(temp, 'SHASUMS256.txt');
    await writeZip(temp, [`${folder}/node.exe`, `${folder}/LICENSE`], zip);
    const archiveHash = createHash('sha256').update(await readFile(zip)).digest('hex');
    const stage = path.join(temp, 'stage');
    await mkdir(stage);
    await writeFile(checksums, `${'0'.repeat(64)}  ${folder}.zip\n`);
    await assert.rejects(bundleRuntime(stage, temp, { runtimeVersion: version, runtimeArchive: zip, runtimeChecksums: checksums }), /checksum mismatch/);
    await assert.rejects(access(path.join(stage, 'runtime/node.exe')));
    await writeFile(checksums, `${archiveHash}  ${folder}.zip\n`);
    const result = await bundleRuntime(stage, temp, { runtimeVersion: version, runtimeArchive: zip, runtimeChecksums: checksums });
    assert.equal(result.archiveSha256, archiveHash);
    assert.equal(await readFile(path.join(stage, 'runtime/LICENSE'), 'utf8'), 'Fixture runtime license');
    assert.throws(() => officialRuntimeHash('bad checksum', `${folder}.zip`), /do not contain/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('launcher validates ports and detects occupied listeners without closing them', async () => {
  assert.deepEqual(launcherOptions(['--port', '0', '--no-browser'], {}), { port: 0, browser: false });
  for (const port of ['-1', '65536', 'abc', '1;calc']) assert.throws(() => launcherOptions(['--port', port], {}), /PORT/);
  assert.throws(() => launcherOptions(['--unknown'], {}), /Unknown option/);
  const occupied = net.createServer(socket => socket.end('still running'));
  await new Promise(resolve => occupied.listen(0, '0.0.0.0', resolve));
  try {
    await assert.rejects(assertPortAvailable(occupied.address().port), { code: 'EADDRINUSE' });
    assert.equal(occupied.listening, true);
  } finally { await new Promise(resolve => occupied.close(resolve)); }
});

test('startup accepts legitimately refreshed observations while strict release verification still detects changes', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'karhutla-manifest-test-'));
  try {
    const fixture = { 'package.json': JSON.stringify({ version: '1.0.0' }), 'package-lock.json': '{}', 'Start-Karhutla.cmd': 'launcher', 'scripts/start-karhutla.mjs': '// launcher', 'server.mjs': '// test fixture', 'data/fire-snapshot.json': '{"records":[]}', 'audio-assets/manifest.json': '{"assets":[]}', 'audio-assets/v3/manifest.json': '{"assets":[]}', 'runtime/node.exe': 'MZfixture', 'runtime/LICENSE': 'license' };
    for (const [file, content] of Object.entries(fixture)) {
      await mkdir(path.dirname(path.join(temp, file)), { recursive: true });
      await writeFile(path.join(temp, file), content);
    }
    await createPackageManifest(temp, { version: 'v24.22.2' }, []);
    await checkPackage(temp);
    await writeFile(path.join(temp, 'data/fire-snapshot.json'), '{"records":[],"fetchedAt":"new-observation-set"}');
    await checkPackage(temp, { verifyMutable: false });
    await assert.rejects(checkPackage(temp), /verification failed: data\/fire-snapshot/);
    await writeFile(path.join(temp, 'server.mjs'), '// corrupted app file');
    await assert.rejects(checkPackage(temp, { verifyMutable: false }), /verification failed: server/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('package paths and build options reject escapes and incomplete arguments', () => {
  assert.equal(safePackagePath('runtime/node.exe'), 'runtime/node.exe');
  for (const file of ['../secret', '/absolute', 'C:/secret', 'a\\b', 'a//b', './a']) assert.throws(() => safePackagePath(file), /Unsafe/);
  assert.deepEqual(parseBuildOptions(['--runtime-version', 'v24.22.2', '--out', 'dist', '--force']), { runtimeVersion: 'v24.22.2', out: 'dist', force: true });
  assert.throws(() => parseBuildOptions(['--out']), /incomplete/);
});
