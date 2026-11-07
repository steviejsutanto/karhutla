import { spawn } from 'node:child_process';
import { lstat, mkdir, open, readFile, readlink, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export function validateOperatorUrl(value) {
  const match = typeof value === 'string' && value.match(/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/operator$/);
  if (!match || Number(match[1]) > 65535) throw new Error('Only the local Karhutla operator address can be opened automatically.');
  return value;
}

function cmdArgument(value) {
  // CMD expands percent signs even within quotes. Paths and URLs used here
  // never need quotes, percent expansion, control characters or a trailing slash.
  if (typeof value !== 'string' || !value || /["%\r\n\0]/.test(value) || value.endsWith('\\')) throw new Error('Unsupported Windows launch argument.');
  return `"${value}"`;
}

/** Shared by the real URI launch and a native CMD/start argument probe in CI. */
export function windowsStartInvocation(target, args = [], { env = process.env, wait = false } = {}) {
  const command = `start "" /b ${wait ? '/wait ' : ''}${[target, ...args].map(cmdArgument).join(' ')}`;
  return {
    command: env.ComSpec || env.COMSPEC || String.raw`C:\Windows\System32\cmd.exe`,
    args: ['/d', '/e:on', '/v:off', '/s', '/c', command],
    // Node's normal Windows argv quoting uses backslashes before quotes. CMD
    // has different escaping rules and must receive the command text verbatim.
    options: { shell: false, windowsVerbatimArguments: true, windowsHide: true },
  };
}

export function browserInvocation(url, { platform = process.platform, env = process.env, remoteSound = false, homeDir = os.homedir() } = {}) {
  validateOperatorUrl(url);
  if (remoteSound) {
    if (platform !== 'darwin') throw new Error('Remote sound browser mode is available on macOS only.');
    if (typeof homeDir !== 'string' || !path.posix.isAbsolute(homeDir)) throw new Error('The Chrome profile needs an absolute user home directory.');
    // A separate user-data directory creates a separate Chrome instance. A new
    // window in everyday Chrome would inherit its existing startup switches.
    const profile = path.posix.join(homeDir, 'Library/Application Support/Karhutla/Chrome');
    return { command: '/usr/bin/open', args: ['-n', '-a', 'Google Chrome', '--args',
      `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', url],
    options: { shell: false } };
  }
  if (platform === 'win32') return windowsStartInvocation(url, [], { env });
  return { command: platform === 'darwin' ? '/usr/bin/open' : 'xdg-open', args: [url], options: { shell: false } };
}

function projectionUrl(operatorUrl, automatic = false) {
  return validateOperatorUrl(operatorUrl).replace(/\/operator$/, `/projection${automatic ? '?fullscreen=1' : ''}`);
}

/** The projection inherits only the validated Operator's loopback host and port. */
export function projectionBrowserInvocation(operatorUrl, { platform = process.platform, homeDir = os.homedir() } = {}) {
  const url = projectionUrl(operatorUrl, true);
  if (platform !== 'darwin') throw new Error('Fullscreen projection browser mode is available on macOS only.');
  if (typeof homeDir !== 'string' || !path.posix.isAbsolute(homeDir)) throw new Error('The Chrome profile needs an absolute user home directory.');
  // Its own profile carries only this local site's automatic-fullscreen grant.
  // The page uses the same in-app requestFullscreen control as the manual button.
  const profile = path.posix.join(homeDir, 'Library/Application Support/Karhutla/Chrome Projection');
  return { command: '/usr/bin/open', args: ['-n', '-a', 'Google Chrome', '--args', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--new-window', url], options: { shell: false } };
}

const objectValue = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const projectionParts = ['Library', 'Application Support', 'Karhutla', 'Chrome Projection'];

async function directoryChain(homeDir, parts, create = false) {
  let directory = homeDir;
  for (const part of parts) {
    directory = path.join(directory, part);
    let info;
    try { info = await lstat(directory); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) return false;
      try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      info = await lstat(directory);
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The dedicated Projection Chrome folders must be regular directories, not symbolic links.');
  }
  return true;
}

async function projectionPreferences(file) {
  let info;
  try { info = await lstat(file); } catch (error) { if (error.code === 'ENOENT') return { bytes: null, preferences: {} }; throw error; }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Projection Chrome Preferences must be a regular file, not a symbolic link.');
  if (info.size > 16 * 1024 * 1024) throw new Error('Projection Chrome Preferences is unexpectedly large and was left unchanged.');
  const bytes = await readFile(file, 'utf8');
  let preferences;
  try { preferences = JSON.parse(bytes); } catch { throw new Error('Projection Chrome Preferences is not valid JSON and was left unchanged.'); }
  if (!objectValue(preferences)) throw new Error('Projection Chrome Preferences must contain a JSON object and was left unchanged.');
  return { bytes, preferences };
}

function fullscreenExceptions(preferences, create = false) {
  let parent = preferences;
  for (const key of ['profile', 'content_settings', 'exceptions', 'automatic_fullscreen']) {
    if (parent[key] === undefined) {
      if (!create) return undefined;
      parent[key] = {};
    }
    if (!objectValue(parent[key])) throw new Error('Projection Chrome fullscreen preferences have an invalid structure and were left unchanged.');
    parent = parent[key];
  }
  return parent;
}

async function assertProjectionClosed(profile) {
  const locks = [];
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try { locks.push({ name, info: await lstat(path.join(profile, name)) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!locks.length) return;
  // Chrome can leave its hostname-PID symlink after a crash. Only a lock from
  // this machine whose process definitely no longer exists is safe to regard
  // as stale; Chrome itself will clean those lock artifacts on its next start.
  const lock = locks.find(entry => entry.name === 'SingletonLock');
  if (lock?.info.isSymbolicLink()) {
    const value = await readlink(path.join(profile, 'SingletonLock'));
    const prefix = `${os.hostname()}-`, pid = value.startsWith(prefix) ? value.slice(prefix.length) : '';
    if (/^[1-9]\d*$/.test(pid) && Number.isSafeInteger(Number(pid))) {
      try { process.kill(Number(pid), 0); }
      catch (error) { if (error.code === 'ESRCH') return; }
    }
  }
  throw new Error('Quit the dedicated Projection Chrome windows before updating their fullscreen permission. Stop this server with Ctrl+C, then relaunch with --remote-sound.');
}

async function acquireProjectionSetup(file) {
  const claim = { version: 1, hostname: os.hostname(), pid: process.pid, token: randomUUID() };
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Never reclaim by pathname: two stale-lock reclaimers could otherwise
    // remove each other's new claim and overwrite independent grants.
    throw new Error(`Another Projection fullscreen setup is running or a previous setup left a lock. Close other Karhutla launchers before retrying. If all launchers are closed, remove only this stale setup lock, then retry: ${file}`);
  }
  try {
    await handle.writeFile(`${JSON.stringify(claim)}\n`, 'utf8');
    await handle.sync();
    return { handle, token: claim.token };
  } catch (error) {
    try { await handle.close(); } finally { await unlink(file); }
    throw error;
  }
}

async function releaseProjectionSetup(file, token) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`The Projection setup lock changed and was left in place: ${file}`);
  let owner;
  try { owner = JSON.parse(await readFile(file, 'utf8')); } catch { throw new Error(`The Projection setup lock changed and was left in place: ${file}`); }
  if (owner?.token !== token) throw new Error(`The Projection setup lock changed and was left in place: ${file}`);
  await unlink(file);
}

/** Grant in-app fullscreen only to this loopback origin in the Projection profile. */
export async function prepareProjectionProfile(operatorUrl, { platform = process.platform, homeDir = os.homedir() } = {}) {
  validateOperatorUrl(operatorUrl);
  if (platform !== 'darwin') throw new Error('Fullscreen projection browser mode is available on macOS only.');
  if (typeof homeDir !== 'string' || !path.isAbsolute(homeDir)) throw new Error('The Projection Chrome profile needs an absolute user home directory.');
  const profile = path.join(homeDir, ...projectionParts), defaults = path.join(profile, 'Default'), file = path.join(defaults, 'Preferences');
  const key = `${new URL(operatorUrl).origin},*`;
  const exists = await directoryChain(homeDir, [...projectionParts, 'Default']);
  const initial = exists ? await projectionPreferences(file) : { bytes: null, preferences: {} };
  if (fullscreenExceptions(initial.preferences)?.[key]?.setting === 1) return { profile, origin: new URL(operatorUrl).origin, changed: false };
  await assertProjectionClosed(profile);
  await directoryChain(homeDir, [...projectionParts, 'Default'], true);
  const lockFile = path.join(profile, '.karhutla-fullscreen-setup.lock');
  const setup = await acquireProjectionSetup(lockFile);
  const temporary = path.join(defaults, `.karhutla-preferences-${randomUUID()}.tmp`);
  try {
    await assertProjectionClosed(profile);
    const current = await projectionPreferences(file);
    if (fullscreenExceptions(current.preferences)?.[key]?.setting === 1) return { profile, origin: new URL(operatorUrl).origin, changed: false };
    const exceptions = fullscreenExceptions(current.preferences, true);
    exceptions[key] = { setting: 1, last_modified: String((BigInt(Date.now()) + 11644473600000n) * 1000n) };
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(current.preferences)}\n`, 'utf8');
      await handle.sync();
    } finally { await handle?.close(); }
    await assertProjectionClosed(profile);
    const latest = await projectionPreferences(file);
    if (latest.bytes !== current.bytes) throw new Error('Projection Chrome Preferences changed during setup and were left unchanged. Quit Projection Chrome before relaunching.');
    await rename(temporary, file);
    return { profile, origin: new URL(operatorUrl).origin, changed: true };
  } finally {
    try { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    finally {
      try { await setup.handle.close(); }
      finally { await releaseProjectionSetup(lockFile, setup.token); }
    }
  }
}

function manualUrls(operatorUrl) {
  return `Operator: ${operatorUrl}\nProjection: ${projectionUrl(operatorUrl)}`;
}

function launchBrowser(createInvocation, { env, spawnImpl, onFallback, timeoutMs }, fallbackMessage) {
  return new Promise(resolve => {
    let settled = false, timer;
    const finish = (opened, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!opened) onFallback(fallbackMessage, error);
      resolve(opened);
    };
    try {
      const invocation = createInvocation();
      const child = spawnImpl(invocation.command, invocation.args, { ...invocation.options, env, detached: true, stdio: 'ignore' });
      child.once('error', error => finish(false, error));
      child.once('close', (code, signal) => finish(code === 0, code === 0 ? null : new Error(`Browser opener exited ${signal || code}.`)));
      timer = setTimeout(() => finish(false, new Error('Browser opener did not finish.')), timeoutMs);
      child.unref?.();
    } catch (error) { finish(false, error); }
  });
}

/** Report usable URLs if the opener cannot start, exits unsuccessfully or stalls. */
export async function openBrowser(url, { platform = process.platform, env = process.env, remoteSound = false, homeDir = os.homedir(), spawnImpl = spawn,
  onFallback = message => console.log(message), timeoutMs = 10000 } = {}) {
  validateOperatorUrl(url);
  const fallback = remoteSound
    ? `Chrome could not open in remote sound mode. Check that Google Chrome is installed and can open. Stop this server with Ctrl+C, then relaunch with --remote-sound. For manual use:\n${manualUrls(url)}`
    : `Open this address in your browser: ${url}`;
  return launchBrowser(() => browserInvocation(url, { platform, env, remoteSound, homeDir }),
    { env, spawnImpl, onFallback, timeoutMs }, fallback);
}

/** A separate, silent Projection window; the Operator remains the audio owner. */
export async function openProjection(operatorUrl, { platform = process.platform, env = process.env, homeDir = os.homedir(), spawnImpl = spawn,
  onFallback = message => console.log(message), timeoutMs = 10000, prepareProfile = prepareProjectionProfile } = {}) {
  validateOperatorUrl(operatorUrl);
  const fallback = `Projection could not open in-app fullscreen in Chrome. Check that Google Chrome is installed and can open. Stop this server with Ctrl+C, then relaunch with --remote-sound. For manual use:\n${manualUrls(operatorUrl)}`;
  try {
    const invocation = projectionBrowserInvocation(operatorUrl, { platform, homeDir });
    await prepareProfile(operatorUrl, { platform, homeDir });
    return launchBrowser(() => invocation, { env, spawnImpl, onFallback, timeoutMs }, fallback);
  } catch (error) {
    onFallback(`${fallback}\nDetails: ${error.message}`, error);
    return false;
  }
}
