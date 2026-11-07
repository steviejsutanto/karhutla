import os from 'node:os';
import path from 'node:path';
import { chmod, link, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomBytes, randomInt } from 'node:crypto';

export function defaultOperatorDataDirectory({ platform = process.platform, homeDir = os.homedir(), env = process.env } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (env.KARHUTLA_DATA_DIR?.trim()) return paths.resolve(env.KARHUTLA_DATA_DIR);
  if (platform === 'darwin') return paths.join(homeDir, 'Library', 'Application Support', 'Karhutla');
  if (platform === 'win32') return paths.join(env.LOCALAPPDATA || paths.join(homeDir, 'AppData', 'Local'), 'Karhutla');
  return paths.join(env.XDG_DATA_HOME || paths.join(homeDir, '.local', 'share'), 'karhutla');
}

export function createOperatorCredentials(previousPin) {
  let pin;
  do { pin = String(randomInt(1000000)).padStart(6, '0'); } while (pin === previousPin);
  return { secret: randomBytes(32).toString('base64url'), pin };
}

async function readOperatorCredentials(file) {
  const content = await readFile(file, 'utf8');
  let saved;
  try { saved = JSON.parse(content); }
  catch { throw new Error('The saved private operator link is not valid JSON.'); }
  if (!saved || saved.version !== 1 || typeof saved.secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(saved.secret)
    || Buffer.from(saved.secret, 'base64url').toString('base64url') !== saved.secret
    || (saved.pin !== undefined && (typeof saved.pin !== 'string' || !/^\d{6}$/.test(saved.pin)))) throw new Error('The saved private operator link is invalid.');
  return { secret: saved.secret, pin: saved.pin };
}

function withOperatorPin(credentials) {
  if (credentials.pin !== undefined) return credentials;
  // The same old random key always receives the same PIN, including when two
  // releases migrate it at once. Remembered cookies keep their original key.
  const bytes = createHash('sha256').update('karhutla/operator-pin/v1\0').update(credentials.secret).digest();
  return { secret: credentials.secret, pin: String(bytes.readUIntBE(0, 6) % 1000000).padStart(6, '0') };
}

async function secureOperatorDirectory(file) {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
}

export async function saveOperatorCredentials(file, credentials, exclusive = false) {
  await secureOperatorDirectory(file);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(12).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ version: 1, ...credentials })}\n`, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    // Publish a completed private file. Initial publication must not replace
    // credentials another release has already imported or created.
    if (exclusive) await link(temporary, file);
    else await rename(temporary, file);
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

async function restoreOperatorCredentials(file) {
  const saved = await readOperatorCredentials(file);
  const credentials = withOperatorPin(saved);
  if (saved.pin === undefined) await saveOperatorCredentials(file, credentials);
  else {
    await secureOperatorDirectory(file);
    if (process.platform !== 'win32') await chmod(file, 0o600);
  }
  return credentials;
}

export async function loadOperatorCredentials(file, { legacyPath = null } = {}) {
  if (file === null) return createOperatorCredentials();
  try {
    try { return await restoreOperatorCredentials(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    let credentials;
    if (legacyPath && path.resolve(legacyPath) !== path.resolve(file)) {
      try { credentials = withOperatorPin(await readOperatorCredentials(legacyPath)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    credentials ||= createOperatorCredentials();
    try { await saveOperatorCredentials(file, credentials, true); return credentials; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return await restoreOperatorCredentials(file);
  } catch (error) {
    throw new Error(`The saved private operator link could not be opened at ${file}. Check that the file and any previous installation's data/remote-operator.json are readable and valid, and the private data folder is writable.`, { cause: error });
  }
}
