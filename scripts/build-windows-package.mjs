import { readFile, writeFile, readdir, mkdir, mkdtemp, copyFile, lstat, rm, rename, access } from 'node:fs/promises';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { sha256, safePackagePath, validateRequiredFiles, checkPackage, MUTABLE_PACKAGE_FILES } from './check-package.mjs';

export const DEFAULT_NODE_VERSION = 'v24.22.2';
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFiles = new Set(['fire-snapshot.json', 'indonesia.geojson', 'indonesia-overview.geojson', 'surrounding-land.geojson', 'geography-metadata.json']);
const scriptFiles = new Set(['start-karhutla.mjs', 'check-package.mjs', 'build-windows-package.mjs', 'smoke-windows-package.mjs', 'fetch-snapshot.mjs', 'fetch-snapshot.test.mjs', 'fetch_snapshot.py', 'peat-study-preview.mjs']);

/** Positive allowlist: a new cache or production artifact cannot enter a release by accident. */
export function includeProjectFile(relative) {
  const parts = relative.split('/');
  if (parts.some(part => part.startsWith('.') || ['node_modules', 'rejected', 'natural-sources', 'output', 'dist'].includes(part))) return false;
  if (parts.length === 1) return ['package.json', 'package-lock.json', 'Start-Karhutla.cmd'].includes(relative) || /\.(?:js|mjs|html|css|svg|md)$/.test(relative);
  if (parts[0] === 'data') return parts.length === 2 && dataFiles.has(parts[1]);
  if (parts[0] === 'scripts') return parts.length === 2 && scriptFiles.has(parts[1]);
  if (parts[0] === 'audio-assets') return (parts.length === 2 || parts.length === 3 && parts[1] === 'v3') && /\.(?:mp3|json|md)$/.test(relative);
  if (relative === 'visual-assets/exports/wildfire-lofi-assets.zip') return true; // Linked download in the legacy asset preview.
  if (parts[0] === 'visual-assets') return (parts.length === 2 || parts.length === 3 && parts[1] === 'exports') && /\.(?:js|html|css|svg|png|webp|gif|txt|md)$/.test(relative);
  return false;
}

export async function listFiles(root, relative = '') {
  const result = [];
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const file = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await listFiles(root, file));
    else if (entry.isFile() || entry.isSymbolicLink()) result.push(file);
  }
  return result.sort();
}

export async function stageProjectFiles(source, destination) {
  // Only traverse the five allowed source locations, never model caches or node_modules.
  const top = await readdir(source, { withFileTypes: true });
  const candidates = top.filter(entry => entry.isFile()).map(entry => entry.name);
  for (const directory of ['data', 'scripts', 'audio-assets', 'visual-assets']) {
    candidates.push(...(await listFiles(path.join(source, directory))).map(file => `${directory}/${file}`));
  }
  const files = candidates.filter(includeProjectFile).sort();
  for (const file of files) {
    const info = await lstat(path.join(source, file));
    if (!info.isFile()) throw new Error(`Refusing non-regular source file: ${file}`);
    await mkdir(path.dirname(path.join(destination, file)), { recursive: true });
    await copyFile(path.join(source, file), path.join(destination, file));
  }
  await validateRequiredFiles(destination);
  return files;
}

export function validatePortableLock(lock) {
  if (lock.lockfileVersion !== 3 || !lock.packages) throw new Error('A version 3 npm lockfile is required.');
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name || entry.dev) continue;
    if (!name.startsWith('node_modules/') || entry.link || entry.hasInstallScript || entry.os || entry.cpu || entry.libc || !entry.integrity || !/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved || '')) {
      throw new Error(`Dependency ${name} needs a platform-specific build or unsupported install. Review the Windows packaging policy before releasing it.`);
    }
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with code ${code}.`)));
  });
}

async function npmCommand() {
  const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate); return { command: process.execPath, prefix: [candidate] }; } catch {}
  }
  if (process.platform === 'win32') throw new Error('Could not locate npm. Run the builder using npm run package:windows.');
  return { command: 'npm', prefix: [] };
}

export async function installLockedDependencies(stage, cache) {
  const lock = JSON.parse(await readFile(path.join(stage, 'package-lock.json'), 'utf8'));
  validatePortableLock(lock);
  const npm = await npmCommand();
  await run(npm.command, [...npm.prefix, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache], { cwd: stage });
  const modules = path.join(stage, 'node_modules');
  // Command shims are unused by the runtime and symlinked on Unix build hosts.
  await rm(path.join(modules, '.bin'), { recursive: true, force: true });
  for (const file of await listFiles(modules)) {
    const info = await lstat(path.join(modules, file));
    if (!info.isFile() || /\.(?:node|exe|dll|dylib|so)$/i.test(file) || /(?:^|\/)binding\.gyp$/.test(file)) throw new Error(`Dependency contains a native binary or link: ${file}`);
  }
  // On a non-Windows host, deliberately support only this checked pure-JavaScript graph.
  return Object.entries(lock.packages).filter(([name, entry]) => name && !entry.dev).map(([name, entry]) => ({ name: name.replace(/^node_modules\//, ''), version: entry.version, integrity: entry.integrity }));
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Small ZIP implementation keeps Windows builds independent of Python/7-Zip/PowerShell. */
export function readZipFile(archive, expectedPath) {
  const endMin = Math.max(0, archive.length - 65557);
  let end = archive.length - 22;
  while (end >= endMin && archive.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < endMin) throw new Error('Invalid runtime ZIP: missing central directory.');
  const count = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid runtime ZIP directory.');
    const method = archive.readUInt16LE(offset + 10);
    const expectedCrc = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20), size = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28), extraLength = archive.readUInt16LE(offset + 30), commentLength = archive.readUInt16LE(offset + 32);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name === expectedPath) {
      const local = archive.readUInt32LE(offset + 42);
      if (archive.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid runtime ZIP local header.');
      const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
      const compressed = archive.subarray(start, start + compressedSize);
      const data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
      if (!data || data.length !== size || crc32(data) !== expectedCrc) throw new Error(`Runtime ZIP is corrupt: ${name}`);
      return data;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Runtime ZIP is missing ${expectedPath}.`);
}

export async function writeZip(root, files, output, prefix = '') {
  const handle = await openOutput(output);
  const central = [];
  let position = 0;
  try {
    for (const relative of files.slice().sort()) {
      safePackagePath(relative);
      const name = Buffer.from(prefix ? `${prefix}/${relative}` : relative);
      const data = await readFile(path.join(root, relative));
      const compressed = deflateRawSync(data, { level: 9 });
      const crc = crc32(data);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
      local.writeUInt16LE(33, 12); // 1980-01-01, fixed timestamps for repeatable release archives.
      local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
      const directory = Buffer.alloc(46);
      directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10);
      directory.writeUInt16LE(33, 14); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(position, 42);
      central.push(directory, name);
      await writeAll(handle, local); await writeAll(handle, name); await writeAll(handle, compressed);
      position += local.length + name.length + compressed.length;
      if (position >= 0xffffffff) throw new Error('Package is too large for this ZIP writer.');
    }
    const directorySize = central.reduce((sum, buffer) => sum + buffer.length, 0);
    for (const buffer of central) await writeAll(handle, buffer);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(position, 16);
    await writeAll(handle, end);
  } finally { await handle.close(); }
}
async function openOutput(file) { const { open } = await import('node:fs/promises'); return open(file, 'w'); }
async function writeAll(handle, data) {
  let offset = 0;
  while (offset < data.length) {
    const { bytesWritten } = await handle.write(data.subarray(offset));
    if (!bytesWritten) throw new Error('Could not finish writing the package ZIP.');
    offset += bytesWritten;
  }
}

export function officialRuntimeHash(checksums, filename) {
  const line = checksums.split(/\r?\n/).map(value => value.trim()).find(value => value.endsWith(` ${filename}`) || value.endsWith(` *${filename}`));
  const match = line?.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
  if (!match || match[2] !== filename) throw new Error(`Official checksums do not contain ${filename}.`);
  return match[1].toLowerCase();
}

async function download(url, destination) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

export async function bundleRuntime(stage, temporary, options) {
  const version = options.runtimeVersion || DEFAULT_NODE_VERSION;
  if (!/^v24\.\d+\.\d+$/.test(version)) throw new Error('Use an exact supported Node 24 LTS version, such as v24.22.2.');
  const directory = `node-${version}-win-x64`, filename = `${directory}.zip`;
  const sourceUrl = `https://nodejs.org/dist/${version}/${filename}`;
  const archivePath = options.runtimeArchive || path.join(temporary, filename);
  const checksumsPath = options.runtimeChecksums || path.join(temporary, 'SHASUMS256.txt');
  if (!options.runtimeChecksums) await download(`https://nodejs.org/dist/${version}/SHASUMS256.txt`, checksumsPath);
  if (!options.runtimeArchive) await download(sourceUrl, archivePath);
  const expected = officialRuntimeHash(await readFile(checksumsPath, 'utf8'), filename);
  const actual = await sha256(archivePath);
  if (actual !== expected) throw new Error(`Official Node runtime checksum mismatch. Expected ${expected}, received ${actual}.`);
  const archive = await readFile(archivePath);
  await mkdir(path.join(stage, 'runtime'), { recursive: true });
  for (const name of ['node.exe', 'LICENSE']) await writeFile(path.join(stage, 'runtime', name), readZipFile(archive, `${directory}/${name}`));
  const executable = await readFile(path.join(stage, 'runtime/node.exe'));
  if (executable.subarray(0, 2).toString() !== 'MZ') throw new Error('The downloaded runtime is not a Windows executable.');
  await copyFile(checksumsPath, path.join(stage, 'runtime/SHASUMS256.txt'));
  return { name: 'Node.js', version, platform: 'win32', architecture: 'x64', sourceUrl, archiveSha256: actual, license: 'runtime/LICENSE' };
}

export async function createPackageManifest(stage, runtime, dependencies) {
  const pkg = JSON.parse(await readFile(path.join(stage, 'package.json'), 'utf8'));
  const files = [];
  for (const file of (await listFiles(stage)).filter(file => file !== 'package-manifest.json')) {
    const info = await lstat(path.join(stage, file));
    if (!info.isFile()) throw new Error(`Cannot package non-regular file: ${file}`);
    files.push({ path: file, bytes: info.size, sha256: await sha256(path.join(stage, file)), ...(MUTABLE_PACKAGE_FILES.has(file) ? { mutable: true } : {}) });
  }
  const manifest = { schema: 1, name: 'karhutla', version: pkg.version, platform: 'windows-x64', runtime, dependencyLockSha256: await sha256(path.join(stage, 'package-lock.json')), dependencies, statePolicy: 'Local performance-state.json is excluded; settings presets are imported explicitly.', files };
  await writeFile(path.join(stage, 'package-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function parseBuildOptions(args) {
  const options = {};
  const names = new Map([['--runtime-version', 'runtimeVersion'], ['--runtime-archive', 'runtimeArchive'], ['--runtime-checksums', 'runtimeChecksums'], ['--out', 'out']]);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force') { options.force = true; continue; }
    const name = names.get(args[i]);
    if (!name || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Unknown or incomplete build option: ${args[i]}`);
    options[name] = args[++i];
  }
  return options;
}

export async function buildWindowsPackage(options = {}) {
  const output = path.resolve(options.out || path.join(workspace, 'dist'));
  const pkg = JSON.parse(await readFile(path.join(workspace, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(pkg.version)) throw new Error('Use a valid, filename-safe project version before packaging.');
  const name = `karhutla-${pkg.version}-windows-x64`;
  const destination = path.join(output, name), zip = `${destination}.zip`;
  let exists = false;
  try { await access(destination); exists = true; } catch {}
  let zipExists = false;
  try { await access(zip); zipExists = true; } catch {}
  if ((exists || zipExists) && !options.force) throw new Error(`${destination} already exists. Use --force to rebuild that package.`);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'karhutla-package-'));
  const stage = path.join(temporary, name);
  try {
    await mkdir(stage);
    const files = await stageProjectFiles(workspace, stage);
    console.log(`Staged ${files.length} project and finished asset files.`);
    const runtime = await bundleRuntime(stage, temporary, options);
    const dependencies = await installLockedDependencies(stage, path.join(temporary, 'npm-cache'));
    await validateRequiredFiles(stage, { runtime: true });
    const manifest = await createPackageManifest(stage, runtime, dependencies);
    await checkPackage(stage);
    await mkdir(output, { recursive: true });
    const temporaryZip = path.join(temporary, `${name}.zip`);
    await writeZip(stage, [...manifest.files.map(entry => entry.path), 'package-manifest.json'], temporaryZip, name);
    const zipHash = await sha256(temporaryZip);
    // Copy across volumes before the final rename; never leave a partial ZIP at the release path.
    const pendingZip = `${zip}.partial`;
    await copyFile(temporaryZip, pendingZip);
    if (exists) await rm(destination, { recursive: true });
    await mkdir(destination);
    for (const file of [...manifest.files.map(entry => entry.path), 'package-manifest.json']) {
      await mkdir(path.dirname(path.join(destination, file)), { recursive: true });
      await copyFile(path.join(stage, file), path.join(destination, file));
    }
    if (zipExists) await rm(zip);
    await rename(pendingZip, zip);
    await writeFile(`${zip}.sha256`, `${zipHash}  ${path.basename(zip)}\n`);
    await copyFile(path.join(stage, 'package-manifest.json'), `${destination}.manifest.json`);
    console.log(`\nVerified Windows package: ${zip}\nSHA-256: ${zipHash}\nFiles: ${manifest.files.length}\nRuntime: ${runtime.version} (official checksum verified)`);
    return { directory: destination, zip, sha256: zipHash, manifest };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await buildWindowsPackage(parseBuildOptions(process.argv.slice(2))); }
  catch (error) { console.error(`Windows package failed: ${error.message}`); process.exitCode = 1; }
}
