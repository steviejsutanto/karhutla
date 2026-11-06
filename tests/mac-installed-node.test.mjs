import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unixOnly = process.platform === 'win32' ? 'The Mac shell launcher requires a Unix host.' : false;
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

async function fixture(t, { bundled = true } = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'karhutla installed Node '));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'release with spaces');
  const bin = path.join(temporary, 'installed programs with spaces');
  const cache = path.join(temporary, 'isolated runtime cache');
  const probeLog = path.join(temporary, 'installed runtime probes');
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(bin);
  await copyFile(path.join(workspace, 'Start-Karhutla.command'), path.join(root, 'Start-Karhutla.command'));
  await chmod(path.join(root, 'Start-Karhutla.command'), 0o755);
  await writeFile(path.join(root, 'scripts/start-karhutla.mjs'),
    `console.log('ACTUAL_NODE_SCRIPT'); console.log(JSON.stringify({ entry: process.argv[1], args: process.argv.slice(2), executable: process.execPath })); process.exit(23);\n`);
  if (bundled) {
    await mkdir(path.join(root, 'runtime/bin'), { recursive: true });
    await writeFile(path.join(root, 'runtime/bin/node'), '#!/bin/sh\nprintf "BUNDLED_RUNTIME\\n"\nexit 7\n', { mode: 0o755 });
  }
  return { temporary, root, bin, cache, probeLog };
}

async function installedStub(fixture, { probeStatus = 0, launchStatus = 17 } = {}) {
  const node = path.join(fixture.bin, 'node');
  await writeFile(node, `#!/bin/sh
if [ "$1" = '-e' ]; then
  printf 'probe\\n' >> ${quote(fixture.probeLog)}
  exit ${probeStatus}
fi
printf 'INSTALLED_RUNTIME=<%s>\\n' "$0"
printf '<%s>\\n' "$@"
exit ${launchStatus}
`, { mode: 0o755 });
  return node;
}

async function launch(fixture, args = [], overrides = {}) {
  const env = { ...process.env, PATH: fixture.bin, KARHUTLA_RUNTIME_CACHE: fixture.cache, ...overrides };
  if (!Object.hasOwn(overrides, 'KARHUTLA_USE_BUNDLED_NODE')) delete env.KARHUTLA_USE_BUNDLED_NODE;
  const child = spawn(path.join(fixture.root, 'Start-Karhutla.command'), args, {
    cwd: os.tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', bytes => { output += bytes; });
  child.stderr.on('data', bytes => { output += bytes; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timer));
  return { ...result, output };
}

test('compatible installed Node wins over the bundle, preserving arguments and its exit status', { skip: unixOnly }, async t => {
  const fixtureData = await fixture(t);
  const node = await installedStub(fixtureData);
  const args = ['--port', '0', '--no-browser', 'value with spaces', 'literal $(no-command)'];
  const result = await launch(fixtureData, args);
  assert.equal(result.code, 17, result.output);
  assert.ok(result.output.includes(`INSTALLED_RUNTIME=<${node}>`), result.output);
  assert.ok(result.output.includes(`<${path.join(fixtureData.root, 'scripts/start-karhutla.mjs')}>`), result.output);
  assert.match(result.output, /<--port>\n<0>\n<--no-browser>\n<value with spaces>\n<literal \$\(no-command\)>/);
  assert.equal((await readFile(fixtureData.probeLog, 'utf8')).trim(), 'probe');
  assert.doesNotMatch(result.output, /BUNDLED_RUNTIME|Preparing a reusable/);
  await assert.rejects(lstat(fixtureData.cache), { code: 'ENOENT' });
});

test('installed Node also starts a checkout with no bundled runtime or cache', { skip: unixOnly }, async t => {
  const fixtureData = await fixture(t, { bundled: false });
  await installedStub(fixtureData);
  const result = await launch(fixtureData);
  assert.equal(result.code, 17, result.output);
  assert.match(result.output, /INSTALLED_RUNTIME/);
  await assert.rejects(lstat(fixtureData.cache), { code: 'ENOENT' });
});

test('a real installed Node symlink passes the version check and executes the release script', { skip: unixOnly }, async t => {
  const fixtureData = await fixture(t);
  await symlink(process.execPath, path.join(fixtureData.bin, 'node'));
  const args = ['--port', '0', '--no-browser', 'value with spaces'];
  const result = await launch(fixtureData, args);
  assert.equal(result.code, 23, result.output);
  assert.match(result.output, /ACTUAL_NODE_SCRIPT/);
  const detail = JSON.parse(result.output.split('\n').find(line => line.startsWith('{')));
  assert.equal(detail.entry, path.join(fixtureData.root, 'scripts/start-karhutla.mjs'));
  assert.deepEqual(detail.args, args);
  assert.equal(detail.executable, process.execPath);
  await assert.rejects(lstat(fixtureData.cache), { code: 'ENOENT' });
});

for (const [description, probeStatus] of [['older', 1], ['broken', 49]]) {
  test(`${description} PATH Node is probed but never used to launch the performance`, { skip: unixOnly }, async t => {
    const fixtureData = await fixture(t);
    await installedStub(fixtureData, { probeStatus, launchStatus: 51 });
    const result = await launch(fixtureData);
    assert.ok([7, 23].includes(result.code), result.output);
    // A Mac may have another compatible Node at a common installation path;
    // otherwise the bundled runtime handles this release. The rejected PATH
    // candidate must never be used to start the performance in either case.
    assert.match(await readFile(fixtureData.probeLog, 'utf8'), /probe/);
    assert.doesNotMatch(result.output, /INSTALLED_RUNTIME/);
    assert.match(result.output, /BUNDLED_RUNTIME|ACTUAL_NODE_SCRIPT/);
  });
}

test('an application error from installed Node is returned without retrying with bundled Node', { skip: unixOnly }, async t => {
  const fixtureData = await fixture(t);
  await installedStub(fixtureData, { launchStatus: 39 });
  const result = await launch(fixtureData);
  assert.equal(result.code, 39, result.output);
  assert.match(result.output, /INSTALLED_RUNTIME/);
  assert.doesNotMatch(result.output, /BUNDLED_RUNTIME|Preparing a reusable/);
  await assert.rejects(lstat(fixtureData.cache), { code: 'ENOENT' });
});

test('the explicit bundled-runtime preference skips installed Node and its version probe', { skip: unixOnly }, async t => {
  const fixtureData = await fixture(t);
  await installedStub(fixtureData);
  const result = await launch(fixtureData, [], { KARHUTLA_USE_BUNDLED_NODE: '1' });
  assert.equal(result.code, 7, result.output);
  assert.match(result.output, /BUNDLED_RUNTIME/);
  assert.doesNotMatch(result.output, /INSTALLED_RUNTIME/);
  await assert.rejects(lstat(fixtureData.probeLog), { code: 'ENOENT' });
  assert.equal((await lstat(fixtureData.cache)).isDirectory(), true);
});
