import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { checkPackage, packagePublicFiles } from './check-package.mjs';
import { isMain } from './is-main.mjs';
import { prepareFreshOperator, exercisePreparedOperator, assertRestartedOperator } from './smoke-operator-flow.mjs';

export function parseSmokeOptions(args, { platform = process.platform, architecture = process.arch } = {}) {
  let output = 'dist', arch = architecture, positional = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--arch') {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Use --arch arm64 or --arch x64.');
      arch = args[++index];
    } else if (!args[index].startsWith('--') && !positional) { output = args[index]; positional = true; }
    else throw new Error(`Unknown smoke option: ${args[index]}. Use [DIST-OR-ZIP] [--arch arm64|x64].`);
  }
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Mac smoke architecture must be arm64 or x64.');
  if (platform !== 'darwin') throw new Error('Native Mac package smoke requires macOS; run it on the matching Mac CI runner.');
  if (arch !== architecture) throw new Error(`Native Mac smoke requires the ${arch} runner; this Node process is ${architecture}.`);
  return { output: path.resolve(output), arch };
}

async function deadline(promise, milliseconds, description) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(description)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function launch(command, args, options) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let output = '';
  child.stdout.on('data', bytes => { output = `${output}${bytes}`.slice(-1_000_000); });
  child.stderr.on('data', bytes => { output = `${output}${bytes}`.slice(-1_000_000); });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return { child, exited, output: () => output };
}

async function capture(command, args, options = {}) {
  const process = launch(command, args, options);
  try {
    const result = await deadline(process.exited, 30_000, `${path.basename(command)} timed out.\n${process.output()}`);
    return { ...result, output: process.output() };
  } finally {
    if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill('SIGKILL');
  }
}

async function startWrapper(root, temporary) {
  const process = launch(path.join(root, 'Start-Karhutla.command'), ['--port', '0', '--no-browser'], {
    // Intentionally start outside the app folder, with no system Node or helper
    // commands on PATH. The double-click wrapper must find its own runtime.
    cwd: temporary, env: { ...globalThis.process.env, PATH: '', KARHUTLA_NO_BROWSER: '1' },
  });
  try {
    const base = await deadline(new Promise((resolve, reject) => {
      const receive = () => {
        const match = process.output().match(/Operator: (http:\/\/127\.0\.0\.1:\d+)\/operator/);
        if (match) resolve(match[1]);
      };
      process.child.stdout.on('data', receive); process.child.stderr.on('data', receive);
      process.exited.then(result => reject(new Error(`Mac wrapper exited during startup (${result.code ?? result.signal}).\n${process.output()}`)), reject);
    }), 30_000, 'Mac wrapper did not publish its operator URL.');
    return { ...process, base };
  } catch (error) {
    if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill('SIGKILL');
    await process.exited.catch(() => {});
    throw error;
  }
}

async function stopWrapper(process, signal = 'SIGTERM') {
  if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill(signal);
  try {
    const result = await deadline(process.exited, 10_000, `Mac wrapper did not save and stop.\n${process.output()}`);
    assert.equal(result.code, 0, `Mac launcher must pass ${signal} to Node for a graceful save.\n${process.output()}`);
    assert.equal(result.signal, null);
  } finally {
    if (process.child.exitCode === null && process.child.signalCode === null) {
      process.child.kill('SIGKILL');
      await process.exited.catch(() => {});
    }
  }
}

async function request(base, route, body) {
  const response = await fetch(`${base}${route}`, body === undefined ? { signal: AbortSignal.timeout(5000) } : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wildfire-Role': 'operator' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200, `${route} returned ${response.status}`);
  return response;
}

export async function smokeMacPackage({ output, arch }) {
  assert.equal(process.platform, 'darwin', 'Mac smoke must run on macOS.');
  assert.equal(process.arch, arch, 'Use a native runner matching the packaged architecture.');
  let archive = output;
  if (!(await stat(output)).isFile()) {
    const candidates = (await readdir(output)).filter(name => new RegExp(`^karhutla-[\\w.+-]+-macos-${arch}\\.zip$`).test(name));
    assert.equal(candidates.length, 1, `Use a folder with exactly one macos-${arch} release ZIP, or pass the desired ZIP directly.`);
    archive = path.join(output, candidates[0]);
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'karhutla Mac smoke '));
  let active;
  try {
    const extracted = path.join(temporary, 'Extracted performance with spaces');
    const extraction = await capture('/usr/bin/ditto', ['-x', '-k', archive, extracted]);
    assert.equal(extraction.code, 0, `Finder-compatible ZIP extraction failed.\n${extraction.output}`);
    const directories = (await readdir(extracted, { withFileTypes: true })).filter(entry => entry.isDirectory());
    assert.equal(directories.length, 1, 'The Mac archive must contain one release folder.');
    const root = path.join(extracted, directories[0].name);
    const verified = await checkPackage(root);
    const manifest = JSON.parse(await readFile(path.join(root, 'package-manifest.json'), 'utf8'));
    assert.equal(manifest.platform, `macos-${arch}`);
    assert.equal(manifest.runtime.platform, 'darwin');
    assert.equal(manifest.runtime.architecture, arch);
    for (const file of manifest.files) {
      const privatePart = file.path.split('/').some(part => part.startsWith('performance-state.json') || part === '.env' || part.startsWith('.env.')
        || ['.audio-model-cache', '.playwright-cli', 'output', 'rejected', 'natural-sources'].includes(part));
      assert.equal(privatePart || /\.wav$/i.test(file.path), false, `Private runtime state or production masters must not ship: ${file.path}`);
    }
    await assert.rejects(access(path.join(root, 'data/performance-state.json')), { code: 'ENOENT' });
    const command = path.join(root, 'Start-Karhutla.command'), runtime = path.join(root, 'runtime/bin/node');
    // Never repair permissions: this verifies the ZIP delivered to the user.
    await access(command, constants.X_OK); await access(runtime, constants.X_OK);
    const native = await capture(runtime, ['-p', 'JSON.stringify({platform:process.platform,arch:process.arch,version:process.version})'], { env: { ...process.env, PATH: '' } });
    assert.equal(native.code, 0, `Bundled Mac runtime cannot execute.\n${native.output}`);
    assert.deepEqual(JSON.parse(native.output), { platform: 'darwin', arch, version: manifest.runtime.version });

    const env = { ...process.env, PATH: '', KARHUTLA_NO_BROWSER: '1' };
    const invalid = await capture(command, ['--port', 'invalid', '--no-browser'], { cwd: temporary, env });
    assert.equal(invalid.code, 1, 'The .command wrapper must preserve startup error exit codes.');
    assert.match(invalid.output, /PORT must be a whole number/);
    const occupied = net.createServer(socket => socket.end('still running'));
    await new Promise((resolve, reject) => { occupied.once('error', reject); occupied.listen(0, '0.0.0.0', resolve); });
    try {
      const busy = await capture(command, ['--port', String(occupied.address().port), '--no-browser'], { cwd: temporary, env });
      assert.equal(busy.code, 1); assert.match(busy.output, /already in use/);
      assert.equal(occupied.listening, true, 'A busy port must never terminate the existing listener.');
    } finally { await new Promise(resolve => occupied.close(resolve)); }
    await assert.rejects(access(path.join(root, 'data/performance-state.json')), { code: 'ENOENT' });

    active = await startWrapper(root, temporary);
    assert.equal((await (await request(active.base, '/api/health')).json()).status, 'ok');
    const publicFiles = await packagePublicFiles(root);
    assert.ok(publicFiles.length >= 150, 'The complete performance, legacy routes, assets and catalog files must be present.');
    for (const { url, file } of publicFiles) {
      assert.deepEqual(Buffer.from(await (await request(active.base, url)).arrayBuffer()), await readFile(path.join(root, file)),
        `${url} must serve its packaged bytes`);
    }
    assert.ok((await (await request(active.base, '/api/qr.svg?view=audience')).text()).includes('<svg'));
    const preset = await prepareFreshOperator(active.base);
    await stopWrapper(active); active = null;
    const prepared = JSON.parse(await readFile(path.join(root, 'data/performance-state.json'), 'utf8'));
    assert.equal(prepared.settingsOnly, true, 'Preparing settings must not silently initialize the show.');
    active = await startWrapper(root, temporary);
    await assertRestartedOperator(active.base, preset, { initialized: false });
    await exercisePreparedOperator(active.base, preset);
    await stopWrapper(active); active = null;
    const saved = JSON.parse(await readFile(path.join(root, 'data/performance-state.json'), 'utf8'));
    assert.equal(saved.strength, .37); assert.equal(saved.soundSettings.level, .42);
    assert.equal(saved.sceneSettings.participationSeconds, 333);
    active = await startWrapper(root, temporary);
    await assertRestartedOperator(active.base, preset, { initialized: true });
    await stopWrapper(active, 'SIGHUP'); active = null;
    const afterHangup = JSON.parse(await readFile(path.join(root, 'data/performance-state.json'), 'utf8'));
    assert.equal(afterHangup.strength, .37); assert.equal(afterHangup.soundSettings.level, .42);
    console.log(`Mac package smoke passed: ${verified.files} verified files, ${publicFiles.length} byte-identical public URLs, executable ZIP extraction, actual .command with no system Node, fresh Start/cues4-5/Restart without manual initialization, prepared-settings persistence and SIGTERM/restart/SIGHUP (${arch}).`);
    return { files: verified.files, publicUrls: publicFiles.length, architecture: arch };
  } finally {
    if (active) await stopWrapper(active).catch(error => console.error(error.message));
    await rm(temporary, { recursive: true, force: true });
  }
}

if (isMain(import.meta)) {
  try { await smokeMacPackage(parseSmokeOptions(process.argv.slice(2))); }
  catch (error) { console.error(`Mac package smoke failed: ${error.message}`); process.exitCode = 1; }
}
