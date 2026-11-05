import { readFile, writeFile, mkdir, mkdtemp, copyFile, chmod, rm } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { sha256, safePackagePath } from './check-package.mjs';
import { DEFAULT_NODE_VERSION, stageProjectFiles, installLockedDependencies, officialRuntimeHash, download, parseBuildOptions, assertReleaseDestination, publishStagedPackage } from './build-windows-package.mjs';
import { isMain } from './is-main.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function macArchitecture(value = process.arch) {
  if (!['arm64', 'x64'].includes(value)) throw new Error('Mac architecture must be arm64 (Apple Silicon) or x64 (Intel).');
  return value;
}

/** Extract only named regular members in memory, never paths supplied by an archive. */
export function readTarGzFiles(archive, expectedPaths) {
  const expected = new Set(expectedPaths.map(safePackagePath));
  const result = new Map();
  const tar = gunzipSync(archive, { maxOutputLength: 512 * 1024 * 1024 });
  const text = buffer => buffer.toString('utf8').replace(/\0.*$/s, '');
  const octal = (buffer, label) => {
    const value = text(buffer).trim();
    if (!/^[0-7]+$/.test(value)) throw new Error(`Invalid runtime TAR ${label}.`);
    return Number.parseInt(value, 8);
  };
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const expectedChecksum = octal(header.subarray(148, 156), 'checksum');
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i];
    if (checksum !== expectedChecksum) throw new Error('Runtime TAR header checksum mismatch.');
    const size = octal(header.subarray(124, 136), 'member size');
    const prefix = text(header.subarray(345, 500)), name = text(header.subarray(0, 100));
    const filename = prefix ? `${prefix}/${name}` : name;
    const start = offset + 512, end = start + size;
    if (!Number.isSafeInteger(size) || end > tar.length) throw new Error('Runtime TAR is truncated.');
    if (expected.has(filename)) {
      const type = header[156];
      if (type !== 0 && type !== 48) throw new Error(`Runtime TAR member is not a regular file: ${filename}`);
      if (result.has(filename)) throw new Error(`Duplicate runtime TAR member: ${filename}`);
      result.set(filename, tar.subarray(start, end));
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  for (const filename of expected) if (!result.has(filename)) throw new Error(`Runtime TAR is missing ${filename}.`);
  return result;
}

export function verifyMacExecutable(executable, architecture) {
  const arch = macArchitecture(architecture);
  if (executable.length < 32 || executable.readUInt32LE(0) !== 0xfeedfacf || executable.readUInt32LE(12) !== 2) throw new Error('The downloaded runtime is not a 64-bit Mach-O executable for macOS.');
  const cpu = executable.readUInt32LE(4), expected = arch === 'arm64' ? 0x0100000c : 0x01000007;
  if (cpu !== expected) throw new Error(`Mac runtime architecture mismatch: expected ${arch}, received CPU type 0x${cpu.toString(16)}.`);
  return arch;
}

export async function bundleMacRuntime(stage, temporary, options = {}) {
  const architecture = macArchitecture(options.arch);
  const version = options.runtimeVersion || DEFAULT_NODE_VERSION;
  if (!/^v24\.\d+\.\d+$/.test(version)) throw new Error('Use an exact supported Node 24 LTS version, such as v24.22.2.');
  const directory = `node-${version}-darwin-${architecture}`, filename = `${directory}.tar.gz`;
  const sourceUrl = `https://nodejs.org/dist/${version}/${filename}`;
  const archivePath = options.runtimeArchive || path.join(temporary, filename);
  const checksumsPath = options.runtimeChecksums || path.join(temporary, 'SHASUMS256.txt');
  if (!options.runtimeChecksums) await download(`https://nodejs.org/dist/${version}/SHASUMS256.txt`, checksumsPath);
  if (!options.runtimeArchive) await download(sourceUrl, archivePath);
  const expected = officialRuntimeHash(await readFile(checksumsPath, 'utf8'), filename);
  const actual = await sha256(archivePath);
  if (actual !== expected) throw new Error(`Official Node runtime checksum mismatch. Expected ${expected}, received ${actual}.`);
  const executablePath = `${directory}/bin/node`, licensePath = `${directory}/LICENSE`;
  const members = readTarGzFiles(await readFile(archivePath), [executablePath, licensePath]);
  const executable = members.get(executablePath);
  verifyMacExecutable(executable, architecture);
  await mkdir(path.join(stage, 'runtime/bin'), { recursive: true });
  await writeFile(path.join(stage, 'runtime/bin/node'), executable, { mode: 0o755 });
  await chmod(path.join(stage, 'runtime/bin/node'), 0o755);
  await writeFile(path.join(stage, 'runtime/LICENSE'), members.get(licensePath), { mode: 0o644 });
  await copyFile(checksumsPath, path.join(stage, 'runtime/SHASUMS256.txt'));
  await chmod(path.join(stage, 'runtime/SHASUMS256.txt'), 0o644);
  return { name: 'Node.js', version, platform: 'darwin', architecture, sourceUrl, archiveSha256: actual, license: 'runtime/LICENSE' };
}

export function parseMacBuildOptions(args) {
  const shared = [];
  let arch;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--arch') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Incomplete build option: --arch');
      arch = macArchitecture(args[++i]);
    } else shared.push(args[i]);
  }
  return { ...parseBuildOptions(shared), ...(arch ? { arch } : {}) };
}

export async function buildMacPackage(options = {}) {
  if (process.platform === 'win32') throw new Error('Build Mac release ZIPs on macOS or Linux so executable permissions can be preserved.');
  const arch = macArchitecture(options.arch), platform = `macos-${arch}`;
  const output = path.resolve(options.out || path.join(workspace, 'dist'));
  const pkg = JSON.parse(await readFile(path.join(workspace, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(pkg.version)) throw new Error('Use a valid, filename-safe project version before packaging.');
  const name = `karhutla-${pkg.version}-${platform}`;
  await assertReleaseDestination(output, name, options.force);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'karhutla-mac-package-'));
  const stage = path.join(temporary, name);
  try {
    await mkdir(stage);
    const files = await stageProjectFiles(workspace, stage, { platform });
    console.log(`Staged ${files.length} project and finished asset files for ${platform}.`);
    const runtime = await bundleMacRuntime(stage, temporary, { ...options, arch });
    const dependencies = await installLockedDependencies(stage, path.join(temporary, 'npm-cache'));
    return await publishStagedPackage({ stage, temporary, output, name, runtime, dependencies, force: options.force });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (isMain(import.meta)) {
  try { await buildMacPackage(parseMacBuildOptions(process.argv.slice(2))); }
  catch (error) { console.error(`Mac package failed: ${error.message}`); process.exitCode = 1; }
}
