import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { readFile, stat, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './is-main.mjs';

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export const MUTABLE_PACKAGE_FILES = new Set(['data/fire-snapshot.json']);
export const PUBLIC_PRESET_FILES = new Set(['presets/current-performance.json', 'presets/README.md']);

export function safePackagePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe package path: ${value}`);
  }
  return value;
}

export async function packagePublicFiles(root) {
  const server = await readFile(path.join(root, 'app/server.mjs'), 'utf8');
  const publicFiles = new Map();
  // Every literal entry in the HTTP server's static-file map must travel with it.
  for (const match of server.matchAll(/\['(\/[^']*)',\s*\['([^']+)'/g)) publicFiles.set(match[1], match[2]);
  const exportLoop = server.match(/for \(const name of \[([^\]]+)\]\) \{[\s\S]*?staticFiles\.set\(`\/visual-assets\/exports\//);
  if (exportLoop) for (const match of exportLoop[1].matchAll(/'([^']+)'/g)) publicFiles.set(`/visual-assets/exports/${match[1]}`, `visual-assets/exports/${match[1]}`);
  for (const catalog of ['audio-assets/manifest.json', 'audio-assets/v3/manifest.json']) {
    const manifest = JSON.parse(await readFile(path.join(root, catalog), 'utf8'));
    publicFiles.set(`/${catalog}`, catalog);
    for (const asset of [...manifest.assets ?? [], ...manifest.archived ?? []]) {
      for (const entry of [asset, asset.mobile].filter(Boolean)) {
        if (typeof entry.file === 'string' && entry.file.endsWith('.mp3')) publicFiles.set(`/${entry.file}`, entry.file);
      }
    }
  }
  return [...publicFiles].map(([url, file]) => ({ url, file: safePackagePath(file) })).sort((a, b) => a.url.localeCompare(b.url, 'en'));
}

export async function packageCatalogFiles(root) {
  const required = new Set(), media = [];
  for (const catalog of ['audio-assets/manifest.json', 'audio-assets/v3/manifest.json']) {
    const manifest = JSON.parse(await readFile(path.join(root, catalog), 'utf8'));
    required.add(catalog);
    for (const asset of [...manifest.assets ?? [], ...manifest.archived ?? []]) {
      for (const entry of [asset, asset.mobile].filter(Boolean)) {
        if (typeof entry.file === 'string' && entry.file.endsWith('.mp3')) {
          required.add(safePackagePath(entry.file));
          media.push({ file: entry.file, sha256: entry.sha256, bytes: entry.bytes });
        }
        if (entry.provenanceFile) required.add(safePackagePath(entry.provenanceFile));
        if (entry.generationBatchRecord) {
          const batch = entry.generationBatchRecord.startsWith('audio-assets/') ? entry.generationBatchRecord : `${path.posix.dirname(catalog)}/${entry.generationBatchRecord}`;
          required.add(safePackagePath(batch));
        }
      }
    }
  }
  return { required: [...required].sort(), media };
}

export async function validateCatalogIntegrity(root) {
  const { media } = await packageCatalogFiles(root);
  for (const entry of media) {
    const filename = path.join(root, entry.file);
    if (entry.sha256 && (await sha256(filename)) !== entry.sha256) throw new Error(`Audio catalog checksum does not match its recording: ${entry.file}`);
    if (entry.bytes != null && (await stat(filename)).size !== entry.bytes) throw new Error(`Audio catalog size does not match its recording: ${entry.file}`);
  }
  return media.length;
}

export async function validatePublicPreset(root, { declared = false } = {}) {
  let directory;
  try { directory = await stat(path.join(root, 'presets')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (declared) throw new Error('The declared current performance preset is missing from the package.');
    return [];
  }
  if (!directory.isDirectory()) throw new Error('The package presets path must be a directory.');
  for (const file of PUBLIC_PRESET_FILES) {
    try { if (!(await stat(path.join(root, file))).isFile()) throw new Error('Not a file.'); }
    catch { throw new Error(`The public performance preset is incomplete. Missing: ${file}`); }
  }
  let preset;
  try {
    preset = JSON.parse(await readFile(path.join(root, 'presets/current-performance.json'), 'utf8'));
    const { validateSettingsPreset } = await import('../app/settings-presets.mjs');
    validateSettingsPreset(preset);
  } catch (error) { throw new Error(`The packaged current performance preset is invalid: ${error.message}`); }
  if (preset.sceneSettings.wifiName !== '' || preset.sceneSettings.wifiPassword !== '') throw new Error('Public performance preset Wi-Fi name and password must be blank.');
  return [...PUBLIC_PRESET_FILES];
}

/** Check the literal module declarations and asset URLs used by this unbundled app. */
export async function validateBrowserImports(root, publicFiles = null) {
  const entries = publicFiles || await packagePublicFiles(root);
  const routes = new Set(entries.map(entry => entry.url));
  const missing = [];
  let references = 0;
  for (const { url, file } of entries) {
    if (!/\.(?:html|js|mjs)$/.test(file)) continue;
    const source = await readFile(path.join(root, file), 'utf8');
    const specifiers = [];
    if (file.endsWith('.html')) {
      for (const tag of source.matchAll(/<(script|link)\b[^>]*>/gi)) {
        const attribute = tag[0].match(tag[1].toLowerCase() === 'script' ? /\bsrc\s*=\s*["']([^"']+)["']/i : /\bhref\s*=\s*["']([^"']+)["']/i);
        if (attribute) specifiers.push(attribute[1]);
      }
    } else {
      for (const match of source.matchAll(/^[ \t]*import\s+(?:[^;'"`]*?\s+from\s+)?["']([^"']+)["']/gm)) specifiers.push(match[1]);
      for (const match of source.matchAll(/^[ \t]*export\s+(?:\*\s*(?:as\s+\w+\s*)?|\{[^}]*\}\s*)from\s*["']([^"']+)["']/gm)) specifiers.push(match[1]);
      for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) specifiers.push(match[1] || match[2]);
    }
    for (const specifier of specifiers) {
      references++;
      const dependency = new URL(specifier, `http://package.invalid${url}`);
      if (dependency.origin !== 'http://package.invalid' || !routes.has(dependency.pathname)) missing.push(`${url} → ${specifier}`);
    }
  }
  if (missing.length) throw new Error(`Browser dependencies have no packaged route: ${missing.join(', ')}`);
  return references;
}

export function packageTarget(platform = 'windows-x64') {
  if (platform === 'windows-x64') return { launcher: 'Start-Karhutla.cmd', executable: 'runtime/node.exe', label: 'Windows x64' };
  if (/^macos-(?:arm64|x64)$/.test(platform)) return { launcher: 'Start-Karhutla.command', executable: 'runtime/bin/node', label: `macOS ${platform.slice(6)}` };
  throw new Error(`Unsupported package platform: ${platform}`);
}

export async function validateRequiredFiles(root, { runtime = false, platform = 'windows-x64', presetDeclared = false } = {}) {
  const target = packageTarget(platform);
  const required = new Set(['package.json', 'package-lock.json', target.launcher, 'scripts/start-karhutla.mjs', 'app/server.mjs', 'data/fire-snapshot.json']);
  const publicFiles = await packagePublicFiles(root);
  for (const entry of publicFiles) required.add(entry.file);
  for (const file of (await packageCatalogFiles(root)).required) required.add(file);
  for (const file of await validatePublicPreset(root, { declared: presetDeclared })) required.add(file);
  if (runtime) { required.add(target.executable); required.add('runtime/LICENSE'); }
  const missing = [];
  for (const file of required) {
    safePackagePath(file);
    try { if (!(await stat(path.join(root, file))).isFile()) missing.push(file); }
    catch { missing.push(file); }
  }
  if (missing.length) throw new Error(`The package is incomplete. Missing: ${missing.join(', ')}`);
  await validateBrowserImports(root, publicFiles);
  if (platform.startsWith('macos-') && process.platform !== 'win32') {
    // Launch requirements belong to the app, never to optional manifest data.
    for (const file of [target.launcher, ...(runtime ? [target.executable] : [])]) {
      const filename = path.join(root, file);
      const info = await stat(filename);
      try {
        if (!(info.mode & 0o111)) throw new Error('No execute permission bits are set.');
        await access(filename, constants.X_OK);
      } catch { throw new Error(`Required Mac package file is not executable: ${file}. Extract a fresh copy of the release ZIP with Finder or Archive Utility.`); }
    }
  }
  return [...required].sort();
}

export async function checkPackage(root, { verifyMutable = true } = {}) {
  const manifest = JSON.parse(await readFile(path.join(root, 'package-manifest.json'), 'utf8'));
  if (manifest.schema !== 1 || !Array.isArray(manifest.files)) throw new Error('Unsupported package manifest.');
  const platform = manifest.platform || 'windows-x64';
  packageTarget(platform);
  const presets = manifest.files.filter(entry => typeof entry.path === 'string' && entry.path.startsWith('presets/'));
  if (presets.some(entry => !PUBLIC_PRESET_FILES.has(entry.path))) throw new Error('The release manifest contains an unsupported preset file.');
  await validateRequiredFiles(root, { runtime: true, platform, presetDeclared: presets.length > 0 });
  if (manifest.publicFiles && JSON.stringify(manifest.publicFiles) !== JSON.stringify(await packagePublicFiles(root))) throw new Error('The package public URL map does not match its release manifest.');
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
    if (platform.startsWith('macos-') && process.platform !== 'win32' && entry.mode != null && (info.mode & 0o777) !== entry.mode) throw new Error(`Package permissions changed: ${file}. Extract a fresh copy of the release ZIP with Finder or Archive Utility.`);
  }
  return { version: manifest.version, files: seen.size, runtime: manifest.runtime, platform };
}

if (isMain(import.meta)) {
  try {
    const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
    const result = await checkPackage(root);
    console.log(`Karhutla ${result.version}: verified ${result.files} files (${result.runtime.version}, ${packageTarget(result.platform).label}).`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
