import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkPackage } from './check-package.mjs';

const output = path.resolve(process.argv[2] || 'dist');
const folders = (await readdir(output, { withFileTypes: true })).filter(item => item.isDirectory() && /^karhutla-[\w.+-]+-windows-x64$/.test(item.name));
assert.equal(folders.length, 1, 'Use a dist folder with exactly one unpacked Windows package.');
const root = path.join(output, folders[0].name);
const verified = await checkPackage(root);
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
  const catalog = JSON.parse(await readFile(path.join(root, 'audio-assets/v3/manifest.json'), 'utf8'));
  for (const asset of catalog.assets) for (const variant of [asset, asset.mobile].filter(Boolean)) {
    if (variant.file?.endsWith('.mp3')) await request(`/${variant.file}`);
  }
  const preset = await (await request('/api/settings/export')).json();
  preset.strength = .37; preset.soundSettings.level = .42; preset.sceneSettings.participationSeconds = 333;
  const before = await (await request('/api/scene')).json();
  const imported = await (await request('/api/settings/import', preset)).json();
  assert.equal(imported.scene.id, before.id); assert.equal(imported.scene.paused, before.paused);
  assert.deepEqual(await (await request('/api/settings/export')).json(), preset);
  console.log(`Package smoke passed: ${verified.files} verified files, all catalog recordings, pages, QR and settings round-trip (${process.platform === 'win32' ? 'bundled Windows runtime' : 'host runtime; Windows execution checked in CI'}).`);
} finally {
  clearTimeout(timer);
  child.kill('SIGTERM');
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}
