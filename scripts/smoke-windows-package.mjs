import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkPackage, packagePublicFiles } from './check-package.mjs';

const output = path.resolve(process.argv[2] || 'dist');
const folders = (await readdir(output, { withFileTypes: true })).filter(item => item.isDirectory() && /^karhutla-[\w.+-]+-windows-x64$/.test(item.name));
assert.equal(folders.length, 1, 'Use a dist folder with exactly one unpacked Windows package.');
const root = path.join(output, folders[0].name);
const verified = await checkPackage(root);
if (process.platform === 'win32') {
  // Exercise the actual double-click wrapper with no system Node on PATH. An
  // invalid port exits before starting a server; the newline answers its pause.
  await new Promise((resolve, reject) => {
    const wrapper = spawn(process.env.ComSpec || 'C:\Windows\System32\cmd.exe', ['/d', '/s', '/c', 'call Start-Karhutla.cmd --port invalid'], {
      cwd: root, env: { ...process.env, PATH: '' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => { wrapper.kill(); reject(new Error(`Windows CMD launcher did not exit.\n${output}`)); }, 15000);
    wrapper.stdout.on('data', chunk => { output += chunk; });
    wrapper.stderr.on('data', chunk => { output += chunk; });
    wrapper.once('error', error => { clearTimeout(timer); reject(error); });
    wrapper.once('exit', code => {
      clearTimeout(timer);
      try {
        assert.equal(code, 1, `CMD must preserve the startup failure code.\n${output}`);
        assert.match(output, /PORT must be a whole number/, 'CMD must run the bundled runtime and display the launcher error.');
        resolve();
      } catch (error) { reject(error); }
    });
    wrapper.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    wrapper.stdin.end('\r\n');
  });
}
const runtime = process.platform === 'win32' ? path.join(root, 'runtime/node.exe') : process.execPath;
const child = spawn(runtime, [path.join(root, 'scripts/start-karhutla.mjs'), '--port', '0', '--no-browser'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '', timer;
const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
try {
  const base = await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Package startup timed out.\n${log}`)), 30000);
    const receive = chunk => {
      log += chunk.toString();
      const match = log.match(/Operator: (http:\/\/127\.0\.0\.1:\d+)\/operator/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    };
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Package exited during startup (${code}).\n${log}`)); });
  });
  const request = async (route, body) => {
    const response = await fetch(`${base}${route}`, body === undefined ? { signal: AbortSignal.timeout(5000) } : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wildfire-Role': 'operator' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200, `${route} returned ${response.status}`);
    return response;
  };
  assert.equal((await (await request('/api/health')).json()).status, 'ok');
  for (const route of ['/operator', '/projection', '/audience', '/api/qr.svg?view=audience', '/data/indonesia.geojson', '/visual-assets/surface-heat-atlas.webp']) {
    assert.ok((await (await request(route)).arrayBuffer()).byteLength > 0, `${route} must not be empty`);
  }
  const publicFiles = await packagePublicFiles(root);
  for (const { url, file } of publicFiles) {
    const bytes = Buffer.from(await (await request(url)).arrayBuffer());
    assert.deepEqual(bytes, await readFile(path.join(root, file)), `${url} must serve its packaged file`);
  }
  const preset = await (await request('/api/settings/export')).json();
  preset.strength = .37; preset.soundSettings.level = .42; preset.sceneSettings.participationSeconds = 333;
  const before = await (await request('/api/scene')).json();
  const imported = await (await request('/api/settings/import', preset)).json();
  assert.equal(imported.scene.id, before.id); assert.equal(imported.scene.paused, before.paused);
  assert.deepEqual(await (await request('/api/settings/export')).json(), preset);
  console.log(`Package smoke passed: ${verified.files} verified files, ${publicFiles.length} unchanged public URLs, all catalog recordings, pages, QR and settings round-trip (${process.platform === 'win32' ? 'CMD wrapper and bundled Windows runtime' : 'host runtime; Windows execution checked in CI'}).`);
} finally {
  clearTimeout(timer);
  child.kill('SIGTERM');
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}
