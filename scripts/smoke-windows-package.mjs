import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPackage, packagePublicFiles, safePackagePath } from './check-package.mjs';
import { readZipFile } from './build-windows-package.mjs';
import { isMain } from './is-main.mjs';
import { prepareFreshOperator, exercisePreparedOperator, assertRestartedOperator } from './smoke-operator-flow.mjs';

async function deadline(promise, milliseconds, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

function launch(command, args, options = {}) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let output = '';
  child.stdout.on('data', bytes => { output = `${output}${bytes}`.slice(-1_000_000); });
  child.stderr.on('data', bytes => { output = `${output}${bytes}`.slice(-1_000_000); });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return { child, exited, output: () => output };
}

async function capture(command, args, options = {}) {
  const running = launch(command, args, options);
  try { return { ...await deadline(running.exited, 30_000, `${path.basename(command)} timed out.`), output: running.output() }; }
  finally {
    if (running.child.exitCode === null && running.child.signalCode === null) {
      running.child.kill('SIGKILL'); await running.exited.catch(() => {});
    }
  }
}

async function startRuntime(root, temporary) {
  const runtime = process.platform === 'win32' ? path.join(root, 'runtime/node.exe') : process.execPath;
  const running = launch(runtime, [path.join(root, 'scripts/start-karhutla.mjs'), '--port', '0', '--no-browser'], {
    cwd: root, env: { ...process.env, ...(process.platform === 'win32' ? { PATH: '' } : {}),
      KARHUTLA_DATA_DIR: path.join(temporary, 'Isolated operator access') },
  });
  try {
    const base = await deadline(new Promise((resolve, reject) => {
      const receive = () => {
        const match = running.output().match(/Operator: (http:\/\/127\.0\.0\.1:\d+)\/operator/);
        if (match) resolve(match[1]);
      };
      running.child.stdout.on('data', receive); running.child.stderr.on('data', receive);
      running.exited.then(result => reject(new Error(`Package exited during startup (${result.code ?? result.signal}).\n${running.output()}`)), reject);
    }), 30_000, 'Package did not publish its operator URL.');
    return { ...running, base };
  } catch (error) {
    if (running.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGKILL');
    await running.exited.catch(() => {}); throw error;
  }
}

async function stopRuntime(running) {
  if (running.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGTERM');
  try {
    const result = await deadline(running.exited, 10_000, `Package did not stop.\n${running.output()}`);
    // Windows TerminateProcess does not deliver Unix signals. Settings writes
    // are awaited before each stop; restart checks verify those durable saves.
    if (process.platform !== 'win32') assert.equal(result.code, 0, running.output());
  } finally {
    if (running.child.exitCode === null && running.child.signalCode === null) {
      running.child.kill('SIGKILL'); await running.exited.catch(() => {});
    }
  }
}

async function verifyWindowsWrapper(root) {
  await new Promise((resolve, reject) => {
    const wrapper = spawn(process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', 'call Start-Karhutla.cmd --port invalid'], {
      cwd: root, env: { ...process.env, PATH: '' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => { wrapper.kill(); reject(new Error(`Windows CMD launcher did not exit.\n${output}`)); }, 15000);
    wrapper.stdout.on('data', chunk => { output += chunk; }); wrapper.stderr.on('data', chunk => { output += chunk; });
    wrapper.once('error', error => { clearTimeout(timer); reject(error); });
    wrapper.once('close', code => {
      clearTimeout(timer);
      try { assert.equal(code, 1, output); assert.match(output, /PORT must be a whole number/); resolve(); }
      catch (error) { reject(error); }
    });
    wrapper.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); }); wrapper.stdin.end('\r\n');
  });
}

async function verifyWindowsBrowserParser(root, temporary) {
  // Exercise the production CMD/start argument factory without opening a GUI.
  const { windowsStartInvocation } = await import(pathToFileURL(path.join(root, 'scripts/open-browser.mjs')).href);
  const probe = path.join(temporary, 'browser parser probe.mjs'), resultFile = path.join(temporary, 'browser parser result.json');
  await writeFile(probe, "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));\n");
  const operatorUrl = 'http://127.0.0.1:49123/operator', literal = 'argument with spaces & parentheses() and exclamation!';
  const env = { ...process.env, PATH: '' };
  const invocation = windowsStartInvocation(path.join(root, 'runtime/node.exe'), [probe, resultFile, operatorUrl, literal], { env, wait: true });
  const result = await capture(invocation.command, invocation.args, { ...invocation.options, cwd: temporary, env });
  assert.equal(result.code, 0, `The native CMD/start browser argument probe failed.\n${result.output}`);
  assert.deepEqual(JSON.parse(await readFile(resultFile, 'utf8')), [operatorUrl, literal], 'Native CMD/start must preserve the exact operator URL and arguments.');
}

export async function smokeWindowsPackage(output) {
  let archive = path.resolve(output);
  if (!(await stat(archive)).isFile()) {
    const candidates = (await readdir(archive)).filter(name => /^karhutla-[\w.+-]+-windows-x64\.zip$/.test(name));
    assert.equal(candidates.length, 1, 'Use a folder with exactly one Windows package ZIP, or pass its ZIP directly.');
    archive = path.join(archive, candidates[0]);
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'karhutla Windows fresh install '));
  let active;
  try {
    const name = path.basename(archive, '.zip'), root = path.join(temporary, name), zip = await readFile(archive);
    const manifestBytes = readZipFile(zip, `${name}/package-manifest.json`), manifest = JSON.parse(manifestBytes);
    assert.equal(manifest.platform, 'windows-x64');
    for (const entry of manifest.files) {
      safePackagePath(entry.path);
      assert.doesNotMatch(entry.path, /(?:^|\/)performance-state\.json/);
      const destination = path.join(root, entry.path); await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, readZipFile(zip, `${name}/${entry.path}`));
    }
    await writeFile(path.join(root, 'package-manifest.json'), manifestBytes);
    const verified = await checkPackage(root);
    if (process.platform === 'win32') {
      await verifyWindowsWrapper(root);
      await verifyWindowsBrowserParser(root, temporary);
    }
    active = await startRuntime(root, temporary);
    const request = async route => {
      const response = await fetch(`${active.base}${route}`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200, `${route} returned ${response.status}`); return response;
    };
    const publicFiles = await packagePublicFiles(root);
    assert.ok(publicFiles.length >= 150);
    for (const { url, file } of publicFiles) {
      assert.deepEqual(Buffer.from(await (await request(url)).arrayBuffer()), await readFile(path.join(root, file)), `${url} must serve its packaged file`);
    }
    assert.ok((await (await request('/api/qr.svg?view=audience')).text()).includes('<svg'));
    const preset = await prepareFreshOperator(active.base);
    await stopRuntime(active); active = null;
    assert.equal(JSON.parse(await readFile(path.join(root, 'data/performance-state.json'), 'utf8')).settingsOnly, true);
    active = await startRuntime(root, temporary);
    await assertRestartedOperator(active.base, preset, { initialized: false });
    await exercisePreparedOperator(active.base, preset);
    await stopRuntime(active); active = null;
    active = await startRuntime(root, temporary);
    await assertRestartedOperator(active.base, preset, { initialized: true });
    await stopRuntime(active); active = null;
    console.log(`Windows package smoke passed: ${verified.files} verified files, ${publicFiles.length} byte-identical public URLs, fresh Start/cues4-5/Restart without manual initialization and prepared-settings restart persistence (${process.platform === 'win32' ? 'native CMD wrapper, real CMD/start browser argument probe and bundled Windows runtime' : 'host runtime; native Windows CMD/browser checks run in CI'}).`);
    return { files: verified.files, publicUrls: publicFiles.length };
  } finally {
    if (active) await stopRuntime(active).catch(error => console.error(error.message));
    await rm(temporary, { recursive: true, force: true });
  }
}

if (isMain(import.meta)) {
  try { await smokeWindowsPackage(process.argv[2] || 'dist'); }
  catch (error) { console.error(`Windows package smoke failed: ${error.message}`); process.exitCode = 1; }
}
