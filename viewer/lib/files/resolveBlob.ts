import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveProjectRoot } from './resolvePath';

// Raster only — SVG deliberately excluded for parity with viewer/lib/files/resolvePath.ts (avoids the SVG script surface).
const EXT_CONTENT_TYPE: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp',
};

export type ResolvedBlob = { ok: true; absPath: string; contentType: string } | { ok: false };

/** Resolve a 64-hex sha to its content-addressed blob under <root>/.apm/blobs/<2>/<sha>.<ext>. */
export async function resolveBlob(root: string, sha: string): Promise<ResolvedBlob> {
  if (!/^[0-9a-f]{64}$/.test(sha)) return { ok: false };
  const dir = path.join(root, '.apm', 'blobs', sha.slice(0, 2));
  let names: string[];
  try { names = await readdir(dir); } catch { return { ok: false }; }
  const name = names.find((n) => n.startsWith(sha + '.') && EXT_CONTENT_TYPE[path.extname(n).toLowerCase()]);
  if (!name) return { ok: false };
  const candidate = path.join(dir, name);
  let real: string;
  let realRoot: string;
  try { [real, realRoot] = await Promise.all([realpath(candidate), realpath(root)]); } catch { return { ok: false }; }
  const blobsDir = path.join(realRoot, '.apm', 'blobs');
  if (real !== path.join(blobsDir, sha.slice(0, 2), name) && !real.startsWith(blobsDir + path.sep)) return { ok: false };
  if (!(await stat(real)).isFile()) return { ok: false };
  const contentType = EXT_CONTENT_TYPE[path.extname(real).toLowerCase()];
  if (!contentType) return { ok: false };
  return { ok: true, absPath: real, contentType };
}

export { resolveProjectRoot };
