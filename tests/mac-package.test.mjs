import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { bundleMacRuntime, parseMacBuildOptions, readTarGzFiles, verifyMacExecutable } from '../scripts/build-mac-package.mjs';
import { includeProjectFile, writeZip, createPackageManifest } from '../scripts/build-windows-package.mjs';
import { checkPackage } from '../scripts/check-package.mjs';
import { parseSmokeOptions } from '../scripts/smoke-mac-package.mjs';
import { isMain } from '../scripts/is-main.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unixOnly = process.platform === 'win32' ? 'Unix executable modes and .command execution require a Unix host.' : false;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function executable(arch, fileType = 2) {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
  bytes.writeUInt32LE(fileType, 12);
  return bytes;
}

function tarGz(entries) {
  const blocks = [];
  for (const { name, bytes, type = '0', mode = 0o644 } of entries) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    const octal = (value, length) => `${value.toString(8).padStart(length - 1, '0')}\0`;
    header.write(octal(mode, 8), 100); header.write(octal(0, 8), 108); header.write(octal(0, 8), 116);
    header.write(octal(bytes.length, 12), 124); header.write(octal(0, 12), 136);
    header.fill(32, 148, 156); header.write(type, 156); header.write('ustar\0', 257); header.write('00', 263);
    const checksum = [...header].reduce((sum, value) => sum + value, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

function zipModes(archive) {
  let end = archive.length - 22;
  while (end >= 0 && archive.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0);
  const count = archive.readUInt16LE(end + 10), modes = new Map();
  let offset = archive.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    assert.equal(archive.readUInt32LE(offset), 0x02014b50);
    const nameLength = archive.readUInt16LE(offset + 28), extraLength = archive.readUInt16LE(offset + 30), commentLength = archive.readUInt16LE(offset + 32);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    modes.set(name, { creator: archive.readUInt16LE(offset + 4) >>> 8, mode: archive.readUInt32LE(offset + 38) >>> 16 });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return modes;
}

test('Mac targets select only their launcher and exclude private state and production materials', () => {
  for (const platform of ['macos-arm64', 'macos-x64']) {
    for (const file of ['Start-Karhutla.command', 'app/server.mjs', 'docs/mac.md', 'scripts/build-mac-package.mjs', 'scripts/smoke-mac-package.mjs', 'tests/mac-package.test.mjs']) {
      assert.equal(includeProjectFile(file, { platform }), true, `${platform}: ${file}`);
    }
    for (const file of ['Start-Karhutla.cmd', 'data/performance-state.json', 'data/performance-state.json.backup', '.env', '.env.local',
      '.audio-model-cache/model.safetensors', '.playwright-cli/review.yaml', 'output/local-save.json', 'audio-assets/v3/rejected/take.mp3',
      'audio-assets/v3/natural-sources/source.mp3', 'audio-assets/v3/master.wav', 'dist/karhutla-macos-arm64.zip']) {
      assert.equal(includeProjectFile(file, { platform }), false, `${platform}: ${file}`);
    }
  }
  assert.equal(includeProjectFile('Start-Karhutla.command'), false, 'Windows packages select the Windows wrapper.');
});

test('Mac build and smoke options reject unsupported and mismatched architectures', () => {
  for (const arch of ['arm64', 'x64']) {
    assert.equal(parseMacBuildOptions(['--arch', arch]).arch, arch);
    assert.equal(parseSmokeOptions(['folder with spaces', '--arch', arch], { platform: 'darwin', architecture: arch }).arch, arch);
  }
  for (const args of [['--arch', 'ia32'], ['--arch'], ['--unknown'], ['--out']]) assert.throws(() => parseMacBuildOptions(args));
  assert.throws(() => parseSmokeOptions(['--arch', 'x64'], { platform: 'darwin', architecture: 'arm64' }), /native|runner/i);
  assert.throws(() => parseSmokeOptions([], { platform: 'win32', architecture: 'x64' }), /requires macOS/);
  assert.throws(() => parseSmokeOptions(['--arch', 'ia32'], { platform: 'darwin', architecture: 'arm64' }), /arm64 or x64/);
});

test('Mac executable validation distinguishes arm64 and Intel executables from invalid binaries and libraries', () => {
  for (const arch of ['arm64', 'x64']) {
    assert.doesNotThrow(() => verifyMacExecutable(executable(arch), arch));
    assert.throws(() => verifyMacExecutable(executable(arch === 'arm64' ? 'x64' : 'arm64'), arch), /architecture|arm64|x64/i);
    assert.throws(() => verifyMacExecutable(executable(arch, 6), arch), /executable|Mach-O/i);
    assert.throws(() => verifyMacExecutable(Buffer.from('MZ Windows executable'), arch), /executable|Mach-O/i);
  }
});

test('Mac runtime tar reader verifies member integrity and rejects links and unsafe requested paths', () => {
  const archive = tarGz([{ name: 'node/bin/node', bytes: executable('arm64'), mode: 0o755 }, { name: 'node/LICENSE', bytes: Buffer.from('license') }]);
  const files = readTarGzFiles(archive, ['node/bin/node', 'node/LICENSE']);
  const get = name => files instanceof Map ? files.get(name) : files[name];
  assert.deepEqual(get('node/bin/node'), executable('arm64')); assert.equal(get('node/LICENSE').toString(), 'license');
  assert.throws(() => readTarGzFiles(archive, ['node/MISSING']), /missing/i);
  assert.throws(() => readTarGzFiles(archive, ['../outside']), /unsafe|path/i);
  const linked = tarGz([{ name: 'node/bin/node', bytes: Buffer.alloc(0), type: '2' }]);
  assert.throws(() => readTarGzFiles(linked, ['node/bin/node']), /regular|link|type/i);
  const damaged = Buffer.from(archive); damaged[Math.floor(damaged.length / 2)] ^= 255;
  assert.throws(() => readTarGzFiles(damaged, ['node/bin/node']));
});

test('both Mac runtime bundles enforce official checksums and selected CPU architecture', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'karhutla Mac runtime '));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  for (const arch of ['arm64', 'x64']) {
    const version = 'v24.22.2', directory = `node-${version}-darwin-${arch}`;
    const archiveBytes = tarGz([{ name: `${directory}/bin/node`, bytes: executable(arch), mode: 0o755 },
      { name: `${directory}/LICENSE`, bytes: Buffer.from('Official runtime license fixture') }]);
    const archive = path.join(temporary, `${directory}.tar.gz`), checksums = path.join(temporary, `${arch}-SHASUMS256.txt`);
    await writeFile(archive, archiveBytes);
    const stage = path.join(temporary, arch); await mkdir(stage);
    await writeFile(checksums, `${'0'.repeat(64)}  ${directory}.tar.gz\n`);
    const options = { arch, runtimeVersion: version, runtimeArchive: archive, runtimeChecksums: checksums };
    await assert.rejects(bundleMacRuntime(stage, temporary, options), /checksum mismatch/i);
    await writeFile(checksums, `${hash(archiveBytes)}  ${directory}.tar.gz\n`);
    const bundled = await bundleMacRuntime(stage, temporary, options);
    assert.equal(bundled.platform, 'darwin'); assert.equal(bundled.architecture, arch);
    assert.equal(bundled.archiveSha256, hash(archiveBytes));
    assert.deepEqual(await readFile(path.join(stage, 'runtime/bin/node')), executable(arch));
    assert.equal(await readFile(path.join(stage, 'runtime/LICENSE'), 'utf8'), 'Official runtime license fixture');
    if (process.platform !== 'win32') assert.ok((await stat(path.join(stage, 'runtime/bin/node'))).mode & 0o111);
    const wrong = tarGz([{ name: `${directory}/bin/node`, bytes: executable(arch === 'arm64' ? 'x64' : 'arm64') },
      { name: `${directory}/LICENSE`, bytes: Buffer.from('license') }]);
    await writeFile(archive, wrong); await writeFile(checksums, `${hash(wrong)}  ${directory}.tar.gz\n`);
    await assert.rejects(bundleMacRuntime(stage, temporary, options), /architecture|arm64|x64/i);
  }
});

test('Mac manifests select the correct files and cannot bless a non-executable launcher or runtime', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'karhutla Mac manifest '));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const fixtures = { 'package.json': '{"version":"1.0.2"}', 'package-lock.json': '{}', 'Start-Karhutla.command': '#!/bin/sh\n',
    'scripts/start-karhutla.mjs': '// launcher', 'app/server.mjs': '// fixture server', 'data/fire-snapshot.json': '{"records":[]}',
    'audio-assets/manifest.json': '{"assets":[]}', 'audio-assets/v3/manifest.json': '{"assets":[]}',
    'runtime/bin/node': executable('arm64'), 'runtime/LICENSE': 'license' };
  for (const [file, bytes] of Object.entries(fixtures)) {
    await mkdir(path.dirname(path.join(temporary, file)), { recursive: true }); await writeFile(path.join(temporary, file), bytes);
  }
  await chmod(path.join(temporary, 'Start-Karhutla.command'), 0o755); await chmod(path.join(temporary, 'runtime/bin/node'), 0o755);
  const runtime = { name: 'Node.js', version: 'v24.22.2', platform: 'darwin', architecture: 'arm64' };
  const manifest = await createPackageManifest(temporary, runtime, []);
  assert.equal(manifest.platform, 'macos-arm64');
  assert.equal((await checkPackage(temporary)).runtime.architecture, 'arm64');
  if (process.platform !== 'win32') {
    for (const target of ['runtime/bin/node', 'Start-Karhutla.command']) {
      await chmod(path.join(temporary, target), 0o644);
      for (const declaredMode of [undefined, 0o644]) {
        const altered = structuredClone(manifest), entry = altered.files.find(file => file.path === target);
        if (declaredMode === undefined) delete entry.mode;
        else entry.mode = declaredMode;
        await writeFile(path.join(temporary, 'package-manifest.json'), JSON.stringify(altered));
        await assert.rejects(checkPackage(temporary), /executable|permission|mode/i,
          `${target}: manifest mode ${declaredMode ?? 'omitted'} cannot override the required executable permission.`);
      }
      await chmod(path.join(temporary, target), 0o755);
    }
    await writeFile(path.join(temporary, 'package-manifest.json'), JSON.stringify(manifest));
    await checkPackage(temporary);
  }
});

test('release ZIP stores Unix executable modes for the Mac launcher and bundled Node', { skip: unixOnly }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'karhutla Mac ZIP '));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await mkdir(path.join(temporary, 'runtime/bin'), { recursive: true });
  await writeFile(path.join(temporary, 'runtime/bin/node'), executable('arm64')); await chmod(path.join(temporary, 'runtime/bin/node'), 0o755);
  await writeFile(path.join(temporary, 'Start-Karhutla.command'), '#!/bin/sh\n'); await chmod(path.join(temporary, 'Start-Karhutla.command'), 0o755);
  await writeFile(path.join(temporary, 'README.md'), 'readme'); await chmod(path.join(temporary, 'README.md'), 0o644);
  const zip = path.join(temporary, 'release.zip');
  await writeZip(temporary, ['README.md', 'runtime/bin/node', 'Start-Karhutla.command'], zip, 'release');
  const modes = zipModes(await readFile(zip));
  for (const file of ['runtime/bin/node', 'Start-Karhutla.command']) {
    assert.equal(modes.get(`release/${file}`).creator, 3, 'ZIP creator must be Unix so Finder restores permissions.');
    assert.equal(modes.get(`release/${file}`).mode & 0o777, 0o755);
  }
  assert.equal(modes.get('release/README.md').mode & 0o777, 0o644);
});

test('actual Unix wrapper locates its bundled runtime in paths with spaces without system Node and preserves exit codes', { skip: unixOnly }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'karhutla wrapper with spaces '));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await mkdir(path.join(temporary, 'runtime/bin'), { recursive: true }); await mkdir(path.join(temporary, 'scripts'));
  await copyFile(path.join(workspace, 'Start-Karhutla.command'), path.join(temporary, 'Start-Karhutla.command'));
  await chmod(path.join(temporary, 'Start-Karhutla.command'), 0o755);
  await writeFile(path.join(temporary, 'scripts/start-karhutla.mjs'), '// fixture launcher');
  await writeFile(path.join(temporary, 'runtime/bin/node'), '#!/bin/sh\nprintf "BUNDLED_RUNTIME\\n"\nprintf "<%s>\\n" "$@"\nprintf "PATH=<%s>\\n" "$PATH"\nexit 7\n');
  await chmod(path.join(temporary, 'runtime/bin/node'), 0o755);
  const child = spawn(path.join(temporary, 'Start-Karhutla.command'), ['--port', '0', '--no-browser', 'value with spaces'], {
    cwd: os.tmpdir(), env: { ...process.env, PATH: '', KARHUTLA_RUNTIME_CACHE: path.join(temporary, 'isolated runtime cache') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timer));
  assert.equal(code, 7, `Wrapper must preserve runtime exit status.\n${output}`);
  assert.match(output, /BUNDLED_RUNTIME/); assert.match(output, /<value with spaces>/); assert.match(output, /PATH=<>/);
  assert.ok(output.includes(`<${path.join(temporary, 'scripts/start-karhutla.mjs')}>`));
  assert.match(output, /<--port>\n<0>\n<--no-browser>/);
});

test('actual Node and shared CLI execute through a symlinked package path instead of silently skipping main', { skip: unixOnly }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'karhutla real Node alias '));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const canonical = await realpath(temporary), actual = path.join(canonical, 'actual package with spaces'), alias = path.join(canonical, 'alias package with spaces');
  await mkdir(path.join(actual, 'runtime/bin'), { recursive: true }); await mkdir(path.join(actual, 'scripts'));
  await copyFile(path.join(workspace, 'Start-Karhutla.command'), path.join(actual, 'Start-Karhutla.command'));
  await chmod(path.join(actual, 'Start-Karhutla.command'), 0o755);
  for (const file of ['start-karhutla.mjs', 'check-package.mjs', 'is-main.mjs', 'open-browser.mjs']) {
    await copyFile(path.join(workspace, 'scripts', file), path.join(actual, 'scripts', file));
  }
  // Use the real test runtime, not the synthetic shell stub in the argument
  // forwarding test. No system Node can be resolved from the child's PATH.
  await copyFile(process.execPath, path.join(actual, 'runtime/bin/node'));
  await chmod(path.join(actual, 'runtime/bin/node'), 0o755);
  await symlink(actual, alias, 'dir');
  const entry = path.join(alias, 'scripts/start-karhutla.mjs');
  assert.notEqual(entry, await realpath(entry), 'The fixture must exercise different argv and canonical module paths.');
  assert.equal(isMain({ url: pathToFileURL(path.join(actual, 'scripts/start-karhutla.mjs')).href }, entry), true,
    'The URL-only fallback canonicalizes symlinked entry paths.');
  assert.equal(isMain({ url: pathToFileURL(path.join(actual, 'scripts/check-package.mjs')).href }, entry), false);
  const child = spawn(path.join(alias, 'Start-Karhutla.command'), ['--port', 'invalid', '--no-browser'], {
    cwd: os.tmpdir(), env: { ...process.env, PATH: '', KARHUTLA_RUNTIME_CACHE: path.join(canonical, 'isolated runtime cache') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timer));
  assert.equal(code, 1, `The actual CLI must execute and preserve its validation failure through the alias.\n${output}`);
  assert.match(output, /PORT must be a whole number/);
});
