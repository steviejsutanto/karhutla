import { spawn } from 'node:child_process';

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

export function browserInvocation(url, { platform = process.platform, env = process.env } = {}) {
  validateOperatorUrl(url);
  if (platform === 'win32') return windowsStartInvocation(url, [], { env });
  return { command: platform === 'darwin' ? '/usr/bin/open' : 'xdg-open', args: [url], options: { shell: false } };
}

/** Report a usable URL if the opener cannot start, exits unsuccessfully or stalls. */
export async function openBrowser(url, { platform = process.platform, env = process.env, spawnImpl = spawn,
  onFallback = message => console.log(message), timeoutMs = 10000 } = {}) {
  validateOperatorUrl(url);
  return new Promise(resolve => {
    let settled = false, timer;
    const finish = (opened, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!opened) onFallback(`Open this address in your browser: ${url}`, error);
      resolve(opened);
    };
    try {
      const invocation = browserInvocation(url, { platform, env });
      const child = spawnImpl(invocation.command, invocation.args, { ...invocation.options, env, detached: true, stdio: 'ignore' });
      child.once('error', error => finish(false, error));
      child.once('close', (code, signal) => finish(code === 0, code === 0 ? null : new Error(`Browser opener exited ${signal || code}.`)));
      timer = setTimeout(() => finish(false, new Error('Browser opener did not finish.')), timeoutMs);
      child.unref?.();
    } catch (error) { finish(false, error); }
  });
}
