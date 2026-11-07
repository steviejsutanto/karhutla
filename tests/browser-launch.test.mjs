import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { access, lstat, mkdir, mkdtemp, readdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { browserInvocation, projectionBrowserInvocation, prepareProjectionProfile, windowsStartInvocation, openBrowser, openProjection, validateOperatorUrl } from '../scripts/open-browser.mjs';

const url = 'http://127.0.0.1:4173/operator';

test('automatic browser opening accepts only the generated local operator URL', () => {
  for (const value of [url, 'http://127.0.0.1:65535/operator']) assert.equal(validateOperatorUrl(value), value);
  for (const value of ['https://example.org', 'file:///C:/Windows/notepad.exe', 'javascript:alert(1)', 'http://127.0.0.1:0/operator',
    'http://127.0.0.1:65536/operator', 'http://localhost:4173/operator', `${url}?x=1`, `${url}#fragment`, `${url}&calc`, `${url}\r\ncalc`,
    'http://127.0.0.1:4173/%6fperator', 'http://user@127.0.0.1:4173/operator', 'http://127.0.0.1:4173/operator/../operator']) {
    assert.throws(() => browserInvocation(value, { platform: 'win32' }), /local Karhutla/);
    assert.throws(() => browserInvocation(value, { platform: 'darwin', remoteSound: true, homeDir: '/Users/Performance' }), /local Karhutla/);
    assert.throws(() => projectionBrowserInvocation(value, { platform: 'darwin', homeDir: '/Users/Performance' }), /local Karhutla/);
  }
});

test('Windows browser command preserves CMD quotes and disables environment expansions', () => {
  const commandPath = String.raw`C:\Windows\System32\cmd.exe`;
  const invocation = browserInvocation(url, { platform: 'win32', env: { ComSpec: commandPath } });
  assert.equal(invocation.options.windowsVerbatimArguments, true);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.command, commandPath);
  const fallback = browserInvocation(url, { platform: 'win32', env: {} }).command;
  assert.equal(fallback, commandPath);
  assert.equal([...fallback].filter(character => character.charCodeAt(0) === 92).length, 3, 'The fallback path contains one backslash per separator.');
  assert.ok(invocation.args.includes('/d'));
  assert.ok(invocation.args.includes('/v:off'));
  assert.equal(invocation.args.at(-1), `start "" /b "${url}"`);
  for (const value of ['bad"target', 'bad%PATH%', 'bad\ntarget']) assert.throws(() => windowsStartInvocation(value), /Unsupported/);
});

test('Mac and Linux browser openers receive one literal URI argument', () => {
  assert.deepEqual(browserInvocation(url, { platform: 'darwin' }), { command: '/usr/bin/open', args: [url], options: { shell: false } });
  assert.deepEqual(browserInvocation(url, { platform: 'linux' }), { command: 'xdg-open', args: [url], options: { shell: false } });
});

test('remote sound opens a separate Mac Chrome instance with literal local profile and autoplay arguments', () => {
  const homeDir = "/Users/Performance Desk '$(never-run);";
  const invocation = browserInvocation(url, { platform: 'darwin', remoteSound: true, homeDir });
  assert.equal(invocation.command, '/usr/bin/open');
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(invocation.args, ['-n', '-a', 'Google Chrome', '--args',
    `--user-data-dir=${homeDir}/Library/Application Support/Karhutla/Chrome`,
    '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', url]);
  for (const platform of ['win32', 'linux']) {
    assert.throws(() => browserInvocation(url, { platform, remoteSound: true, homeDir }), /macOS only/);
  }
  for (const homeDir of ['', 'relative/user', null]) {
    assert.throws(() => browserInvocation(url, { platform: 'darwin', remoteSound: true, homeDir }), /absolute user home/);
  }
});

test('Projection requests in-app fullscreen at the validated Operator port without a browser fullscreen or autoplay override', () => {
  const homeDir = "/Users/Performance Desk '$(never-run);";
  for (const port of [1, 4173, 54981, 65535]) {
    const operatorUrl = `http://127.0.0.1:${port}/operator`;
    const invocation = projectionBrowserInvocation(operatorUrl, { platform: 'darwin', homeDir });
    assert.deepEqual(invocation, { command: '/usr/bin/open', args: ['-n', '-a', 'Google Chrome', '--args',
      `--user-data-dir=${homeDir}/Library/Application Support/Karhutla/Chrome Projection`,
      '--no-first-run', '--no-default-browser-check', '--new-window', `http://127.0.0.1:${port}/projection?fullscreen=1`],
    options: { shell: false } });
    const operator = browserInvocation(operatorUrl, { platform: 'darwin', remoteSound: true, homeDir });
    assert.notEqual(invocation.args.find(value => value.startsWith('--user-data-dir=')),
      operator.args.find(value => value.startsWith('--user-data-dir=')), 'Distinct profiles prevent Projection from becoming an Operator tab.');
    assert.equal(operator.args.includes('--start-fullscreen'), false, 'Operator keeps its normal window.');
    assert.equal(invocation.args.includes('--start-fullscreen'), false, 'The app control enters DOM fullscreen after readiness.');
    assert.equal(invocation.args.some(value => value.startsWith('--autoplay-policy=')), false, 'Projection is not granted host-audio autoplay.');
  }
  for (const platform of ['win32', 'linux']) {
    assert.throws(() => projectionBrowserInvocation(url, { platform, homeDir }), /macOS only/);
  }
  for (const homeDir of ['', 'relative/user', null]) {
    assert.throws(() => projectionBrowserInvocation(url, { platform: 'darwin', homeDir }), /absolute user home/);
  }
  assert.throws(() => projectionBrowserInvocation('http://127.0.0.1:4173/projection', { platform: 'darwin', homeDir }), /local Karhutla operator/);
});

function mockChild(action) {
  return () => {
    const child = new EventEmitter(); child.unref = () => {};
    queueMicrotask(() => action(child));
    return child;
  };
}

test('opener reports success only after a successful exit', async () => {
  const fallback = [];
  const result = await openBrowser(url, { spawnImpl: mockChild(child => child.emit('close', 0)), onFallback: value => fallback.push(value) });
  assert.equal(result, true); assert.deepEqual(fallback, []);
});

test('remote sound opener passes the dedicated Chrome invocation without opening or modifying real user profiles', async () => {
  const invocations = [], fallback = [], env = { TEST_LAUNCH: 'isolated' };
  const spawnImpl = (command, args, options) => {
    invocations.push({ command, args, options });
    return mockChild(child => child.emit('close', 0))();
  };
  assert.equal(await openBrowser(url, { platform: 'darwin', remoteSound: true, homeDir: '/Users/Isolated Desk', env, spawnImpl,
    onFallback: value => fallback.push(value) }), true);
  assert.equal(invocations.length, 1);
  assert.deepEqual(invocations[0], { command: '/usr/bin/open', args: ['-n', '-a', 'Google Chrome', '--args',
    '--user-data-dir=/Users/Isolated Desk/Library/Application Support/Karhutla/Chrome',
    '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', url],
  options: { shell: false, env, detached: true, stdio: 'ignore' } });
  assert.deepEqual(fallback, []);
});

test('Projection opener prepares its local permission before launching one separate in-app fullscreen target', async () => {
  const invocations = [], fallback = [], env = { TEST_LAUNCH: 'isolated' };
  let prepared = false;
  const prepareProfile = async (operatorUrl, options) => {
    assert.equal(operatorUrl, url);
    assert.deepEqual(options, { platform: 'darwin', homeDir: '/Users/Isolated Desk' });
    prepared = true;
  };
  const spawnImpl = (command, args, options) => {
    assert.equal(prepared, true, 'Chrome must not start before permission preparation completes.');
    invocations.push({ command, args, options });
    return mockChild(child => child.emit('close', 0))();
  };
  assert.equal(await openProjection(url, { platform: 'darwin', homeDir: '/Users/Isolated Desk', env, spawnImpl, prepareProfile,
    onFallback: value => fallback.push(value) }), true);
  assert.equal(invocations.length, 1);
  assert.deepEqual(invocations[0], { command: '/usr/bin/open', args: ['-n', '-a', 'Google Chrome', '--args',
    '--user-data-dir=/Users/Isolated Desk/Library/Application Support/Karhutla/Chrome Projection',
    '--no-first-run', '--no-default-browser-check', '--new-window', 'http://127.0.0.1:4173/projection?fullscreen=1'],
  options: { shell: false, env, detached: true, stdio: 'ignore' } });
  assert.deepEqual(fallback, []);
});

test('spawn errors, nonzero exits and stalled openers retain a usable manual URL exactly once', async () => {
  for (const spawnImpl of [() => { throw new Error('spawn failed'); }, mockChild(child => {
    child.emit('error', new Error('missing opener')); child.emit('close', -2);
  }), mockChild(child => child.emit('close', 1)), mockChild(() => {})]) {
    const fallback = [];
    assert.equal(await openBrowser(url, { spawnImpl, onFallback: value => fallback.push(value), timeoutMs: 10 }), false);
    assert.deepEqual(fallback, [`Open this address in your browser: ${url}`]);
  }
});

test('failed remote sound Chrome opening explains setup and retains manual host control without claiming autoplay', async () => {
  for (const spawnImpl of [() => { throw new Error('spawn failed'); }, mockChild(child => {
    child.emit('error', new Error('Chrome missing')); child.emit('close', -2);
  }), mockChild(child => child.emit('close', 1)), mockChild(() => {})]) {
    const fallback = [];
    assert.equal(await openBrowser(url, { platform: 'darwin', remoteSound: true, homeDir: '/Users/Isolated Desk', spawnImpl,
      onFallback: value => fallback.push(value), timeoutMs: 10 }), false);
    assert.deepEqual(fallback, [`Chrome could not open in remote sound mode. Check that Google Chrome is installed and can open. Stop this server with Ctrl+C, then relaunch with --remote-sound. For manual use:\nOperator: ${url}\nProjection: http://127.0.0.1:4173/projection`]);
  }
});

test('Projection launch failure retains both local URLs and never claims fullscreen succeeded', async () => {
  for (const spawnImpl of [() => { throw new Error('spawn failed'); }, mockChild(child => {
    child.emit('error', new Error('Chrome missing')); child.emit('close', -2);
  }), mockChild(child => child.emit('close', 1)), mockChild(() => {})]) {
    const fallback = [];
    assert.equal(await openProjection(url, { platform: 'darwin', homeDir: '/Users/Isolated Desk', spawnImpl, prepareProfile: async () => {},
      onFallback: value => fallback.push(value), timeoutMs: 10 }), false);
    assert.deepEqual(fallback, [`Projection could not open in-app fullscreen in Chrome. Check that Google Chrome is installed and can open. Stop this server with Ctrl+C, then relaunch with --remote-sound. For manual use:\nOperator: ${url}\nProjection: http://127.0.0.1:4173/projection`]);
  }
});

test('Projection preparation errors settle without spawning Chrome and retain actionable details', async () => {
  const fallback = [];
  assert.equal(await openProjection(url, { platform: 'darwin', homeDir: '/Users/Isolated Desk',
    prepareProfile: async () => { throw new Error('Quit the dedicated Projection Chrome windows first.'); },
    spawnImpl: () => { throw new Error('Must not spawn.'); }, onFallback: value => fallback.push(value) }), false);
  assert.equal(fallback.length, 1);
  assert.match(fallback[0], /Details: Quit the dedicated Projection Chrome windows first\./);
  assert.ok(fallback[0].includes(`Operator: ${url}\nProjection: http://127.0.0.1:4173/projection`));
  let prepared = false;
  assert.equal(await openProjection(url, { platform: 'linux', homeDir: '/Users/Isolated Desk',
    prepareProfile: async () => { prepared = true; }, onFallback: () => {} }), false);
  assert.equal(prepared, false, 'Platform validation precedes any profile filesystem work.');
});

async function projectionHome(t) {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'karhutla projection profile '));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const profile = path.join(homeDir, 'Library', 'Application Support', 'Karhutla', 'Chrome Projection');
  return { homeDir, profile, defaults: path.join(profile, 'Default'), file: path.join(profile, 'Default', 'Preferences') };
}

test('Projection profile grants only the exact loopback origin while preserving unrelated preferences', async t => {
  const fixture = await projectionHome(t);
  await mkdir(fixture.defaults, { recursive: true });
  const previous = { browser: { theme: 'preserve' }, untouched: [1, 2], profile: { name: 'Projection', content_settings: { exceptions: {
    notifications: { 'https://example.org:443,*': { setting: 2 } },
    automatic_fullscreen: { 'http://127.0.0.1:4185,*': { setting: 2, last_modified: '123' } },
  } } } };
  await writeFile(fixture.file, JSON.stringify(previous));
  const prepared = await prepareProjectionProfile(url, { platform: 'darwin', homeDir: fixture.homeDir });
  assert.deepEqual(prepared, { profile: fixture.profile, origin: 'http://127.0.0.1:4173', changed: true });
  const saved = JSON.parse(await readFile(fixture.file, 'utf8'));
  const granted = saved.profile.content_settings.exceptions.automatic_fullscreen['http://127.0.0.1:4173,*'];
  assert.equal(granted.setting, 1);
  assert.match(granted.last_modified, /^\d+$/);
  assert.ok(BigInt(granted.last_modified) > 11644473600000000n);
  delete saved.profile.content_settings.exceptions.automatic_fullscreen['http://127.0.0.1:4173,*'];
  assert.deepEqual(saved, previous);
  if (process.platform !== 'win32') assert.equal((await lstat(fixture.file)).mode & 0o777, 0o600);
  await assert.rejects(access(path.join(fixture.profile, '..', 'Chrome')), { code: 'ENOENT' });
  assert.deepEqual((await readdir(fixture.defaults)).sort(), ['Preferences']);
  assert.equal((await readdir(fixture.profile)).includes('.karhutla-fullscreen-setup.lock'), false);
});

test('fresh Projection preferences are created privately and an existing grant is untouched even with Chrome running', async t => {
  const fixture = await projectionHome(t);
  assert.equal((await prepareProjectionProfile(url, { platform: 'darwin', homeDir: fixture.homeDir })).changed, true);
  // Preserve formatting and timestamp as well as values on every later launch.
  const bytes = `${JSON.stringify(JSON.parse(await readFile(fixture.file, 'utf8')), null, 2)}\n`;
  await writeFile(fixture.file, bytes);
  const before = await lstat(fixture.file, { bigint: true });
  await writeFile(path.join(fixture.profile, 'SingletonLock'), String(process.pid));
  assert.equal((await prepareProjectionProfile(url, { platform: 'darwin', homeDir: fixture.homeDir })).changed, false);
  assert.equal(await readFile(fixture.file, 'utf8'), bytes);
  assert.equal((await lstat(fixture.file, { bigint: true })).mtimeNs, before.mtimeNs);
  assert.equal((await readdir(fixture.profile)).includes('.karhutla-fullscreen-setup.lock'), false);
});

test('a new permission is never written into a running or ambiguously locked Projection profile', async t => {
  const fixture = await projectionHome(t);
  await mkdir(fixture.defaults, { recursive: true });
  const previous = '{"browser":{"keep":true}}\n';
  await writeFile(fixture.file, previous);
  for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    await writeFile(path.join(fixture.profile, lock), 'running or unknown owner');
    await assert.rejects(prepareProjectionProfile(url, { platform: 'darwin', homeDir: fixture.homeDir }), /Quit the dedicated Projection Chrome/);
    assert.equal(await readFile(fixture.file, 'utf8'), previous);
    await rm(path.join(fixture.profile, lock));
  }
});

test('Projection setup preserves every existing setup claim, including a definitely dead local owner', async t => {
  const fixture = await projectionHome(t);
  await mkdir(fixture.defaults, { recursive: true });
  const lock = path.join(fixture.profile, '.karhutla-fullscreen-setup.lock');
  const previous = '{"browser":{"keep":true}}\n';
  await writeFile(fixture.file, previous);
  const claim = { version: 1, hostname: os.hostname(), pid: process.pid, token: '12345678-1234-1234-1234-123456789abc' };
  for (const contents of ['', '{broken', JSON.stringify(claim), JSON.stringify({ ...claim, hostname: 'another-machine' })]) {
    await writeFile(lock, contents);
    await assert.rejects(prepareProjectionProfile(url, { platform: 'darwin', homeDir: fixture.homeDir }), /remove only this stale setup lock/);
    assert.equal(await readFile(lock, 'utf8'), contents);
    assert.equal(await readFile(fixture.file, 'utf8'), previous);
  }
  // An exited real child supplies a known former PID without assuming a PID
  // ceiling or relying on platform-specific process-number behavior.
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  const contents = JSON.stringify({ ...claim, pid: child.pid });
  await writeFile(lock, contents);
  await assert.rejects(prepareProjectionProfile(url, { platform: 'darwin', homeDir: fixture.homeDir }), error =>
    error.message.includes('remove only this stale setup lock') && error.message.includes(lock));
  assert.equal(await readFile(lock, 'utf8'), contents);
  assert.equal(await readFile(fixture.file, 'utf8'), previous);
});

test('concurrent attempts never reclaim a stale setup lock; manual removal permits sequential grants without lost updates', async t => {
  const fixture = await projectionHome(t);
  await mkdir(fixture.defaults, { recursive: true });
  const lock = path.join(fixture.profile, '.karhutla-fullscreen-setup.lock');
  const previous = '{"browser":{"keep":true}}\n';
  await writeFile(fixture.file, previous);
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  const contents = JSON.stringify({ version: 1, hostname: os.hostname(), pid: child.pid, token: '12345678-1234-1234-1234-123456789abc' });
  await writeFile(lock, contents);
  const before = await lstat(lock, { bigint: true });
  const secondUrl = 'http://127.0.0.1:4185/operator';
  const results = await Promise.allSettled([url, secondUrl].map(operatorUrl =>
    prepareProjectionProfile(operatorUrl, { platform: 'darwin', homeDir: fixture.homeDir })));
  for (const result of results) {
    assert.equal(result.status, 'rejected');
    assert.match(result.reason.message, /remove only this stale setup lock/);
  }
  assert.equal(await readFile(lock, 'utf8'), contents);
  assert.equal((await lstat(lock, { bigint: true })).mtimeNs, before.mtimeNs);
  assert.equal(await readFile(fixture.file, 'utf8'), previous);
  await rm(lock); // The user removes only the stale setup claim after closing launchers.
  for (const operatorUrl of [url, secondUrl]) {
    assert.equal((await prepareProjectionProfile(operatorUrl, { platform: 'darwin', homeDir: fixture.homeDir })).changed, true);
  }
  const saved = JSON.parse(await readFile(fixture.file, 'utf8'));
  assert.deepEqual(saved.browser, { keep: true });
  const granted = saved.profile.content_settings.exceptions.automatic_fullscreen;
  assert.deepEqual(Object.keys(granted).sort(), ['http://127.0.0.1:4173,*', 'http://127.0.0.1:4185,*']);
  for (const permission of Object.values(granted)) assert.equal(permission.setting, 1);
  await assert.rejects(access(lock), { code: 'ENOENT' });
});

test('Projection setup refuses corrupt preferences and invalid paths without replacing files', async t => {
  const fixture = await projectionHome(t);
  await mkdir(fixture.defaults, { recursive: true });
  for (const previous of ['{broken', '[]', '{"profile":null}', '{"profile":{"content_settings":{"exceptions":[]}}}']) {
    await writeFile(fixture.file, previous);
    await assert.rejects(prepareProjectionProfile(url, { platform: 'darwin', homeDir: fixture.homeDir }), /JSON|invalid structure/);
    assert.equal(await readFile(fixture.file, 'utf8'), previous);
  }
  for (const homeDir of ['', 'relative', null]) {
    await assert.rejects(prepareProjectionProfile(url, { platform: 'darwin', homeDir }), /absolute user home/);
  }
  await assert.rejects(prepareProjectionProfile(url, { platform: 'linux', homeDir: fixture.homeDir }), /macOS only/);
  await assert.rejects(prepareProjectionProfile('https://example.org/operator', { platform: 'darwin', homeDir: fixture.homeDir }), /local Karhutla/);
});

test('Projection setup refuses symlink aliases instead of modifying an unrelated browser profile', { skip: process.platform === 'win32' }, async t => {
  const fixture = await projectionHome(t), unrelated = await mkdtemp(path.join(os.tmpdir(), 'karhutla untouched chrome '));
  t.after(() => rm(unrelated, { recursive: true, force: true }));
  const untouched = path.join(unrelated, 'Preferences');
  await writeFile(untouched, '{"untouched":true}');
  await mkdir(path.dirname(fixture.profile), { recursive: true });
  await symlink(unrelated, fixture.profile, 'dir');
  await assert.rejects(prepareProjectionProfile(url, { platform: 'darwin', homeDir: fixture.homeDir }), /symbolic links/);
  await rm(fixture.profile);
  await mkdir(fixture.defaults, { recursive: true });
  await symlink(untouched, fixture.file);
  await assert.rejects(prepareProjectionProfile(url, { platform: 'darwin', homeDir: fixture.homeDir }), /symbolic link/);
  assert.equal(await readFile(untouched, 'utf8'), '{"untouched":true}');
});

test('native Windows CMD/start preserves the target and arguments without opening a GUI', { skip: process.platform !== 'win32' }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'karhutla browser path with spaces '));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const probe = path.join(temporary, 'browser argument probe.mjs'), result = path.join(temporary, 'received arguments.json');
  await writeFile(probe, "import {writeFile} from 'node:fs/promises'; await writeFile(process.argv[2],JSON.stringify(process.argv.slice(3)));\n");
  // Use the same factory/options as the real browser branch, replacing only
  // its associated-URI target with a harmless console program and waiting.
  const invocation = windowsStartInvocation(process.execPath, [probe, result, url, 'value with spaces', 'literal&(parentheses)!'], { wait: true });
  const child = spawn(invocation.command, invocation.args, { ...invocation.options, cwd: temporary, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => child.kill(), 15000);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, output);
  assert.deepEqual(JSON.parse(await readFile(result, 'utf8')), [url, 'value with spaces', 'literal&(parentheses)!']);
});
