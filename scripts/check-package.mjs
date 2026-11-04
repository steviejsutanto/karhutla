import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export const MUTABLE_PACKAGE_FILES = new Set(['data/fire-snapshot.json']);

export function safePackagePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe package path: ${value}`);
  }
  return value;
}

export async function validateRequiredFiles(root, { runtime = false } = {}) {
  const required = new Set(['package.json', 'package-lock.json', 'Start-Karhutla.cmd', 'scripts/start-karhutla.mjs', 'server.mjs', 'data/fire-snapshot.json']);
  const server = await readFile(path.join(root, 'server.mjs'), 'utf8');
  // Every literal entry in the HTTP server's static-file map must travel with it.
  for (const match of server.matchAll(/\['\/[^']*',\s*\['([^']+)'/g)) required.add(match[1]);
  const exportLoop = server.match(/for \(const name of \[([^\]]+)\]\) \{[\s\S]*?staticFiles\.set\(`\/visual-assets\/exports\//);
  if (exportLoop) for (const match of exportLoop[1].matchAll(/'([^']+)'/g)) required.add(`visual-assets/exports/${match[1]}`);
  for (const catalog of ['audio-assets/manifest.json', 'audio-assets/v3/manifest.json']) {
    const manifest = JSON.parse(await readFile(path.join(root, catalog), 'utf8'));
    required.add(catalog);
    for (const asset of manifest.assets ?? []) {
      for (const entry of [asset, asset.mobile].filter(Boolean)) {
        if (typeof entry.file === 'string' && entry.file.endsWith('.mp3')) required.add(entry.file);
      }
    }
  }
  if (runtime) { required.add('runtime/node.exe'); required.add('runtime/LICENSE'); }
  const missing = [];
  for (const file of required) {
    safePackagePath(file);
    try { if (!(await stat(path.join(root, file))).isFile()) missing.push(file); }
    catch { missing.push(file); }
  }
  if (missing.length) throw new Error(`The package is incomplete. Missing: ${missing.join(', ')}`);
  return [...required].sort();
}

export async function checkPackage(root, { verifyMutable = true } = {}) {
  const manifest = JSON.parse(await readFile(path.join(root, 'package-manifest.json'), 'utf8'));
  if (manifest.schema !== 1 || !Array.isArray(manifest.files)) throw new Error('Unsupported package manifest.');
  await validateRequiredFiles(root, { runtime: true });
  const seen = new Set();
  for (const entry of manifest.files) {
    const file = safePackagePath(entry.path);
    if (seen.has(file)) throw new Error(`Duplicate package path: ${file}`);
    seen.add(file);
    const filename = path.join(root, file);
    const info = await stat(filename);
    // Refreshing the source observations is a supported local operation. Only
    // this code-owned allowlist may bypass initial-content hashes on startup.
    if (!verifyMutable && MUTABLE_PACKAGE_FILES.has(file)) {
      if (!info.isFile()) throw new Error(`Mutable package file is missing: ${file}`);
      continue;
    }
    if (!info.isFile() || info.size !== entry.bytes || await sha256(filename) !== entry.sha256) throw new Error(`Package verification failed: ${file}. Extract a fresh copy of the release ZIP.`);
  }
  return { version: manifest.version, files: seen.size, runtime: manifest.runtime };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
    const result = await checkPackage(root);
    console.log(`Karhutla ${result.version}: verified ${result.files} files (${result.runtime.version}, Windows x64).`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
