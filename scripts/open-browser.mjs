import { spawn } from 'node:child_process';
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

function projectionUrl(operatorUrl) {
  return validateOperatorUrl(operatorUrl).replace(/\/operator$/, '/projection');
}

/** The projection inherits only the validated Operator's loopback host and port. */
export function projectionBrowserInvocation(operatorUrl, { platform = process.platform, homeDir = os.homedir() } = {}) {
  const url = projectionUrl(operatorUrl);
  if (platform !== 'darwin') throw new Error('Fullscreen projection browser mode is available on macOS only.');
  if (typeof homeDir !== 'string' || !path.posix.isAbsolute(homeDir)) throw new Error('The Chrome profile needs an absolute user home directory.');
  // Fullscreen is a browser startup switch. Its own profile prevents an already
  // running Operator browser from swallowing it or becoming fullscreen itself.
  const profile = path.posix.join(homeDir, 'Library/Application Support/Karhutla/Chrome Projection');
  return { command: '/usr/bin/open', args: ['-n', '-a', 'Google Chrome', '--args', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--new-window', '--start-fullscreen', url], options: { shell: false } };
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
  onFallback = message => console.log(message), timeoutMs = 10000 } = {}) {
  validateOperatorUrl(operatorUrl);
  return launchBrowser(() => projectionBrowserInvocation(operatorUrl, { platform, homeDir }),
    { env, spawnImpl, onFallback, timeoutMs },
    `Projection could not open fullscreen in Chrome. Check that Google Chrome is installed and can open. Stop this server with Ctrl+C, then relaunch with --remote-sound. For manual use:\n${manualUrls(operatorUrl)}`);
}
