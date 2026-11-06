import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unixOnly = process.platform === 'win32' ? 'The Mac shell launcher requires a Unix host.' : false;
const macOnly = process.platform !== 'darwin' ? 'macOS extended attributes require a Mac.' : false;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const runtime = label => `#!/bin/sh\nprintf 'RUNTIME=<%s>\\n' "$0"\nprintf 'VERSION=${label}\\n'\nprintf '<%s>\\n' "$@"\nprintf 'PATH=<%s>\\n' "$PATH"\nexit 7\n`;
const firstRuntime = runtime('first');

async function fixture(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'karhutla runtime approval '));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  return { temporary, cache: path.join(temporary, 'user Library', 'Application Support', 'Karhutla', 'RuntimeCache') };
}

async function release(temporary, name, bytes = firstRuntime) {
  const root = path.join(temporary, name);
  await mkdir(path.join(root, 'runtime/bin'), { recursive: true });
  await mkdir(path.join(root, 'scripts'));
  await copyFile(path.join(workspace, 'Start-Karhutla.command'), path.join(root, 'Start-Karhutla.command'));
  await chmod(path.join(root, 'Start-Karhutla.command'), 0o755);
  await writeFile(path.join(root, 'scripts/start-karhutla.mjs'), '// Isolated launcher fixture.');
  await writeFile(path.join(root, 'runtime/bin/node'), bytes, { mode: 0o755 });
  return root;
}

async function capture(command, args, options = {}) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
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

function launch(root, cache, args = []) {
  return capture(path.join(root, 'Start-Karhutla.command'), args, {
    cwd: os.tmpdir(), env: { ...process.env, PATH: '', KARHUTLA_USE_BUNDLED_NODE: '1', KARHUTLA_RUNTIME_CACHE: cache },
  });
}

test('fresh Mac release folders reuse the same untouched approved runtime and forward the new release path', { skip: unixOnly }, async t => {
  const { temporary, cache } = await fixture(t);
  const first = await release(temporary, 'old release with spaces');
  const next = await release(temporary, 'newly extracted update');
  const cached = path.join(cache, digest(firstRuntime), 'node');
  const initial = await launch(first, cache, ['--port', '0', '--no-browser']);
  assert.equal(initial.code, 7, initial.output);
  assert.ok(initial.output.includes(`RUNTIME=<${cached}>`), initial.output);
  assert.equal(await readFile(cached, 'utf8'), firstRuntime);
  // First-open approval belongs to this persistent file. Updating its inode or
  // metadata would defeat reuse even if its executable bytes stayed identical.
  await utimes(cached, new Date('2001-01-01T00:00:00Z'), new Date('2001-01-01T00:00:00Z'));
  const before = await lstat(cached, { bigint: true });
  const updated = await launch(next, cache, ['--port', '0', '--no-browser', 'value with spaces', 'literal $(no-command)']);
  const after = await lstat(cached, { bigint: true });
  assert.equal(updated.code, 7, updated.output);
  assert.ok(updated.output.includes(`RUNTIME=<${cached}>`), updated.output);
  assert.ok(updated.output.includes(`<${path.join(next, 'scripts/start-karhutla.mjs')}>`), updated.output);
  assert.match(updated.output, /<value with spaces>\n<literal \$\(no-command\)>/);
  assert.match(updated.output, /PATH=<>/);
  assert.equal(after.ino, before.ino, 'An update must retain the approved executable inode.');
  assert.equal(after.mtimeNs, before.mtimeNs, 'An update must leave cached executable metadata alone.');
});

test('a changed Node binary receives its own cache entry without replacing the previously approved runtime', { skip: unixOnly }, async t => {
  const { temporary, cache } = await fixture(t);
  const nextRuntime = runtime('next');
  const first = await release(temporary, 'first release');
  const next = await release(temporary, 'new Node release', nextRuntime);
  const old = path.join(cache, digest(firstRuntime), 'node');
  const fresh = path.join(cache, digest(nextRuntime), 'node');
  assert.equal((await launch(first, cache)).code, 7);
  const before = await lstat(old, { bigint: true });
  const updated = await launch(next, cache);
  assert.equal(updated.code, 7, updated.output);
  assert.ok(updated.output.includes(`RUNTIME=<${fresh}>`), updated.output);
  assert.match(updated.output, /VERSION=next/);
  assert.equal(await readFile(fresh, 'utf8'), nextRuntime);
  assert.equal(await readFile(old, 'utf8'), firstRuntime);
  assert.equal((await lstat(old, { bigint: true })).ino, before.ino);
});

test('the default cache lives in the current user Library and supports a home folder with spaces', { skip: unixOnly }, async t => {
  const { temporary } = await fixture(t);
  const root = await release(temporary, 'release using default cache');
  const userHome = path.join(temporary, 'test user home with spaces');
  const env = { ...process.env, PATH: '', HOME: userHome, KARHUTLA_USE_BUNDLED_NODE: '1' };
  delete env.KARHUTLA_RUNTIME_CACHE;
  const cached = path.join(userHome, 'Library', 'Application Support', 'Karhutla', 'RuntimeCache', digest(firstRuntime), 'node');
  const result = await capture(path.join(root, 'Start-Karhutla.command'), [], { cwd: os.tmpdir(), env });
  assert.equal(result.code, 7, result.output);
  assert.ok(result.output.includes(`RUNTIME=<${cached}>`), result.output);
  assert.equal(await readFile(cached, 'utf8'), firstRuntime);
});

test('a changed cached executable is rejected without executing or replacing it', { skip: unixOnly }, async t => {
  const { temporary, cache } = await fixture(t);
  const root = await release(temporary, 'release');
  const cached = path.join(cache, digest(firstRuntime), 'node');
  assert.equal((await launch(root, cache)).code, 7);
  const changed = '#!/bin/sh\nprintf "TAMPERED_EXECUTED\\n"\nexit 0\n';
  await writeFile(cached, changed);
  const result = await launch(root, cache);
  assert.equal(result.code, 1, result.output);
  assert.doesNotMatch(result.output, /TAMPERED_EXECUTED/);
  assert.equal(await readFile(cached, 'utf8'), changed, 'Do not silently repair or overwrite an unexpected cached binary.');
});

test('a non-executable cached runtime is rejected without changing its permissions', { skip: unixOnly }, async t => {
  const { temporary, cache } = await fixture(t);
  const root = await release(temporary, 'release');
  const cached = path.join(cache, digest(firstRuntime), 'node');
  assert.equal((await launch(root, cache)).code, 7);
  await chmod(cached, 0o644);
  const result = await launch(root, cache);
  assert.equal(result.code, 1, result.output);
  assert.equal((await lstat(cached)).mode & 0o777, 0o644);
});

test('cached executable and hash-directory symlinks cannot redirect the launcher', { skip: unixOnly }, async t => {
  const { temporary, cache } = await fixture(t);
  const root = await release(temporary, 'release');
  const hashDirectory = path.join(cache, digest(firstRuntime));
  const target = path.join(temporary, 'outside runtime');
  await writeFile(target, firstRuntime, { mode: 0o755 });
  await mkdir(hashDirectory, { recursive: true });
  const cached = path.join(hashDirectory, 'node');
  await symlink(target, cached);
  const executableLink = await launch(root, cache);
  assert.equal(executableLink.code, 1, executableLink.output);
  assert.equal((await lstat(cached)).isSymbolicLink(), true);
  assert.equal(await readFile(target, 'utf8'), firstRuntime);
  await rm(hashDirectory, { recursive: true });
  const outside = path.join(temporary, 'outside directory');
  await mkdir(outside);
  await copyFile(target, path.join(outside, 'node'));
  await symlink(outside, hashDirectory, 'dir');
  const directoryLink = await launch(root, cache);
  assert.equal(directoryLink.code, 1, directoryLink.output);
  assert.equal((await lstat(hashDirectory)).isSymbolicLink(), true);
});

test('a cache-root symlink cannot redirect installation into another directory', { skip: unixOnly }, async t => {
  const { temporary, cache } = await fixture(t);
  const root = await release(temporary, 'release');
  const outside = path.join(temporary, 'outside cache target');
  await mkdir(outside);
  await mkdir(path.dirname(cache), { recursive: true });
  await symlink(outside, cache, 'dir');
  const result = await launch(root, cache);
  assert.equal(result.code, 1, result.output);
  assert.equal((await lstat(cache)).isSymbolicLink(), true);
  await assert.rejects(lstat(path.join(outside, digest(firstRuntime))), { code: 'ENOENT' });
});

test('forced bundled mode rejects a broken runtime symlink without switching to installed Node', { skip: unixOnly }, async t => {
  const { temporary, cache } = await fixture(t);
  const root = await release(temporary, 'release');
  const bundled = path.join(root, 'runtime/bin/node');
  await rm(bundled);
  await symlink(path.join(temporary, 'missing bundled binary'), bundled);
  const systemBin = path.join(temporary, 'fake system programs');
  await mkdir(systemBin);
  await writeFile(path.join(systemBin, 'node'), '#!/bin/sh\nprintf "SYSTEM_FALLBACK_EXECUTED\\n"\nexit 0\n', { mode: 0o755 });
  const result = await capture(path.join(root, 'Start-Karhutla.command'), [], {
    cwd: os.tmpdir(), env: { ...process.env, PATH: systemBin, KARHUTLA_USE_BUNDLED_NODE: '1', KARHUTLA_RUNTIME_CACHE: cache },
  });
  assert.equal(result.code, 1, result.output);
  assert.doesNotMatch(result.output, /SYSTEM_FALLBACK_EXECUTED/);
  assert.equal((await lstat(bundled)).isSymbolicLink(), true);
  await assert.rejects(lstat(cache), { code: 'ENOENT' });
});

test('concurrent launches publish one complete runtime that both release folders can use', { skip: unixOnly }, async t => {
  const { temporary, cache } = await fixture(t);
  const first = await release(temporary, 'first simultaneous release');
  const second = await release(temporary, 'second simultaneous release');
  const cached = path.join(cache, digest(firstRuntime), 'node');
  const runs = await Promise.all([launch(first, cache), launch(second, cache)]);
  for (const result of runs) {
    assert.equal(result.code, 7, result.output);
    assert.ok(result.output.includes(`RUNTIME=<${cached}>`), result.output);
  }
  assert.equal(await readFile(cached, 'utf8'), firstRuntime);
  assert.equal((await lstat(cached)).isFile(), true);
});

test('Mac cache copy preserves file attributes and cache reuse does not reapply downloaded attributes', { skip: macOnly }, async t => {
  const { temporary, cache } = await fixture(t);
  const first = await release(temporary, 'first attributed release');
  const second = await release(temporary, 'fresh attributed update');
  const attribute = 'com.karhutla.test.runtime-origin';
  const source = path.join(first, 'runtime/bin/node');
  assert.equal((await capture('/usr/bin/xattr', ['-w', attribute, 'download-one', source])).code, 0);
  assert.equal((await launch(first, cache)).code, 7);
  const cached = path.join(cache, digest(firstRuntime), 'node');
  assert.equal((await capture('/usr/bin/xattr', ['-p', attribute, cached])).output.trim(), 'download-one');
  assert.equal((await capture('/usr/bin/xattr', ['-w', attribute, 'approved-local-copy', cached])).code, 0);
  assert.equal((await capture('/usr/bin/xattr', ['-w', attribute, 'download-two', path.join(second, 'runtime/bin/node')])).code, 0);
  assert.equal((await launch(second, cache)).code, 7);
  assert.equal((await capture('/usr/bin/xattr', ['-p', attribute, cached])).output.trim(), 'approved-local-copy');
});
