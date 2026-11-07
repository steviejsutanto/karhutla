import net from 'node:net';
import { access, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { checkPackage, validateRequiredFiles } from './check-package.mjs';
import { isMain } from './is-main.mjs';
import { openBrowser } from './open-browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function launcherOptions(args, env = process.env, { platform = process.platform } = {}) {
  let port = env.PORT || '4173', browser = env.KARHUTLA_NO_BROWSER !== '1', remoteSound = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--no-browser') browser = false;
    else if (args[i] === '--remote-sound') remoteSound = true;
    else if (args[i] === '--port') port = args[++i];
    else throw new Error(`Unknown option: ${args[i]}. Use --port NUMBER, --no-browser or --remote-sound (Mac).`);
  }
  if (typeof port !== 'string' || !/^\d+$/.test(port) || Number(port) > 65535) throw new Error('PORT must be a whole number from 0 to 65535.');
  if (remoteSound && platform !== 'darwin') throw new Error('--remote-sound is available on macOS only.');
  return { port: Number(port), browser, ...(remoteSound ? { remoteSound: true } : {}) };
}

export async function assertPortAvailable(port) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, '0.0.0.0', resolve);
  });
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}

export async function startKarhutla(options) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Karhutla needs Node.js 22 or newer. Use the release ZIP for your computer with its included runtime.');
  if (options.remoteSound && process.platform !== 'darwin') throw new Error('--remote-sound is available on macOS only.');
  try { await assertPortAvailable(options.port); }
  catch (error) {
    if (error.code === 'EADDRINUSE') throw new Error(`Port ${options.port} is already in use. Karhutla was not started. If it is already running, use its existing window; otherwise close the app using that port or choose another with --port NUMBER.`);
    throw error;
  }
  let bundled = false;
  try { await access(path.join(root, 'package-manifest.json')); bundled = true; } catch {}
  if (bundled) {
    console.log('Checking the performance package…');
    await checkPackage(root, { verifyMutable: false });
  } else await validateRequiredFiles(root, { platform: process.platform === 'darwin' ? `macos-${process.arch}` : 'windows-x64' });
  const writeTest = path.join(root, 'data', `.karhutla-write-${randomUUID()}`);
  try { const handle = await open(writeTest, 'wx'); await handle.close(); await unlink(writeTest); }
  catch { throw new Error(`Karhutla cannot save in this folder. Extract the ZIP into a writable folder such as Documents, then run ${process.platform === 'darwin' ? 'Start-Karhutla.command' : 'Start-Karhutla.cmd'} there.`); }
  let createPerformanceServer;
  try { ({ createPerformanceServer } = await import('../app/server.mjs')); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') throw new Error('A program dependency is missing. Extract a fresh release ZIP, or run npm ci once when working from a Git checkout.');
    throw error;
  }
  const instance = await createPerformanceServer({ port: options.port, lanEnabled: true });
  let address;
  try { address = await instance.listen(); }
  catch (error) {
    // Do not close/persist this unstarted instance: another process may own its save.
    if (error.code === 'EADDRINUSE') throw new Error(`Port ${options.port} became occupied. Karhutla was not started; no other program was stopped.`);
    throw error;
  }
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Karhutla did not pass its startup check.');
  } catch (error) { await instance.close(); throw error; }
  console.log(`\nKarhutla is ready. Keep this window open while performing.\nOperator: ${base}/operator\nProjection: ${base}/projection`);
  if (instance.network.addresses.length) console.log(`Audience: http://${instance.network.addresses[0]}:${address.port}/audience`);
  else console.log('Connect this computer and audience phones to the same Wi-Fi or Ethernet network.');
  console.log('Press Ctrl+C in this window to stop and save.');
  if (options.remoteSound) console.log(options.browser
    ? 'Opening the Karhutla Chrome profile for remote sound control. Main sound waits for Enable on Operator or the remote controller.'
    : 'Browser opening is disabled. Remote sound needs the host Operator in Chrome launched with --remote-sound; opening the URL in an ordinary browser may still require a host click.');
  if (options.browser) void openBrowser(`${base}/operator`, { remoteSound: options.remoteSound === true });
  return instance;
}

if (isMain(import.meta)) {
  try {
    const instance = await startKarhutla(launcherOptions(process.argv.slice(2)));
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      try { await instance.close(); process.exit(0); }
      catch (error) { console.error(`Could not finish saving: ${error.message}`); process.exit(1); }
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    if (process.platform !== 'win32') process.once('SIGHUP', stop);
  } catch (error) {
    console.error(`\nKarhutla could not start: ${error.message}`);
    process.exitCode = 1;
    // Finder launches in Terminal, whose profile may close the window on exit.
    if (process.env.KARHUTLA_PAUSE_ON_ERROR === '1' && process.stdin.isTTY) {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try { await prompt.question('Press Return to close this window. '); }
      finally { prompt.close(); }
    }
  }
}
