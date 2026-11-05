import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Node 22 compatibility, including /var aliases and symlinked launch folders. */
export function isMain(meta, entry = process.argv[1]) {
  if (typeof meta.main === 'boolean') return meta.main;
  if (!entry || typeof meta.url !== 'string') return false;
  try { return realpathSync(path.resolve(entry)) === realpathSync(fileURLToPath(meta.url)); }
  catch { return false; }
}
