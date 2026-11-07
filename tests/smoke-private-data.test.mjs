import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

async function launcher(script, helper) {
  const location = new URL(`../scripts/${script}`, import.meta.url);
  // Expose only the private launch helper from the actual smoke script. Keep
  // its imports and subprocess behavior intact, resolving them from the source.
  const source = (await readFile(location, 'utf8')).replace(/from '(\.\/[^']+)'/g, (_match, specifier) => `from '${new URL(specifier, location).href}'`);
  const module = await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport { ${helper} };\n`).toString('base64')}`);
  return module[helper];
}

const shellQuote = value => `'${value.replace(/'/g, `'\\''`)}'`;
async function fakePackage(directory) {
  await mkdir(path.join(directory, 'scripts'), { recursive: true });
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  const script = path.join(directory, 'scripts/start-karhutla.mjs');
  await writeFile(script, `import { writeFileSync } from 'node:fs';\nwriteFileSync(new URL('../observed-data-dir.json', import.meta.url), JSON.stringify(process.env.KARHUTLA_DATA_DIR));\nconsole.log('Operator: http://127.0.0.1:49123/operator');\nsetInterval(() => {}, 1000);\n`);
  const wrapper = path.join(directory, 'Start-Karhutla.command');
  await writeFile(wrapper, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(script)} "$@"\n`);
  await chmod(wrapper, 0o755);
  if (process.platform === 'win32') {
    await mkdir(path.join(directory, 'runtime'));
    await copyFile(process.execPath, path.join(directory, 'runtime/node.exe'));
  }
  return directory;
}

for (const [name, script, helper] of [
  ['Windows', 'smoke-windows-package.mjs', 'startRuntime'],
  ['Mac', 'smoke-mac-package.mjs', 'startWrapper'],
]) test(`${name} smoke children use one temporary credential folder across package updates`, { skip: name === 'Mac' && process.platform === 'win32' }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), `karhutla ${name} private smoke `));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const oldDataDirectory = process.env.KARHUTLA_DATA_DIR;
  process.env.KARHUTLA_DATA_DIR = path.join(temporary, 'Inherited user credentials must stay untouched');
  t.after(() => { if (oldDataDirectory === undefined) delete process.env.KARHUTLA_DATA_DIR; else process.env.KARHUTLA_DATA_DIR = oldDataDirectory; });
  const start = await launcher(script, helper);
  const expected = path.join(temporary, 'Isolated operator access');
  for (const version of ['Previous package', 'Separately downloaded update']) {
    const root = await fakePackage(path.join(temporary, version));
    const running = await start(root, temporary);
    try {
      assert.equal(running.base, 'http://127.0.0.1:49123');
      assert.equal(JSON.parse(await readFile(path.join(root, 'observed-data-dir.json'), 'utf8')), expected);
    } finally {
      running.child.kill('SIGTERM');
      await running.exited;
    }
  }
});
