import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { browserInvocation, windowsStartInvocation, openBrowser, validateOperatorUrl } from '../scripts/open-browser.mjs';

const url = 'http://127.0.0.1:4173/operator';

test('automatic browser opening accepts only the generated local operator URL', () => {
  for (const value of [url, 'http://127.0.0.1:65535/operator']) assert.equal(validateOperatorUrl(value), value);
  for (const value of ['https://example.org', 'file:///C:/Windows/notepad.exe', 'javascript:alert(1)', 'http://127.0.0.1:0/operator',
    'http://127.0.0.1:65536/operator', 'http://localhost:4173/operator', `${url}?x=1`, `${url}#fragment`, `${url}&calc`, `${url}\r\ncalc`,
    'http://127.0.0.1:4173/%6fperator', 'http://user@127.0.0.1:4173/operator', 'http://127.0.0.1:4173/operator/../operator']) {
    assert.throws(() => browserInvocation(value, { platform: 'win32' }), /local Karhutla/);
    assert.throws(() => browserInvocation(value, { platform: 'darwin', remoteSound: true, homeDir: '/Users/Performance' }), /local Karhutla/);
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
    assert.deepEqual(fallback, [`Chrome could not open in remote sound mode. Check that Google Chrome is installed and can open. Stop this server with Ctrl+C, then relaunch with --remote-sound. For manual host control, open: ${url}`]);
  }
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
