import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from 'image-size';
import { ApmError } from '../domain/errors.js';

export interface BlobMeta {
  sha256: string;
  mime: string;
  ext: string;
  byte_size: number;
  width: number | null;
  height: number | null;
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};
const EXT: Record<string, string> = {
  png: 'png', jpg: 'jpg', jpeg: 'jpg', gif: 'gif', webp: 'webp', svg: 'svg',
};

/** Relative (project-root) path for a blob. Content-addressed; path IS the hash. */
export function blobRelPath(sha256: string, ext: string): string {
  return path.posix.join('.apm', 'blobs', sha256.slice(0, 2), `${sha256}.${ext}`);
}

/** Absolute path for a blob under `projectRoot`. */
export function blobAbsPath(projectRoot: string, sha256: string, ext: string): string {
  return path.join(projectRoot, '.apm', 'blobs', sha256.slice(0, 2), `${sha256}.${ext}`);
}

/**
 * Compute sha256 + image dims and write bytes content-addressed (temp → atomic rename).
 * IO lives here, OUTSIDE any Storage.transaction. Call BEFORE the DB txn that records the row
 * (orphan-on-failure is harmless + dedups; a dangling DB reference would not be). C5: null dims tolerated.
 */
export function putBlob(projectRoot: string, bytes: Buffer): BlobMeta {
  let dim: { width?: number; height?: number; type?: string };
  try {
    dim = imageSize(bytes);
  } catch {
    throw new ApmError('E_VALIDATION', 'unrecognized image bytes');
  }
  const rawType = (dim.type ?? '').toLowerCase();
  const ext = EXT[rawType];
  const mime = MIME[ext];
  if (!ext || !mime) {
    throw new ApmError('E_VALIDATION', `unsupported image type: ${rawType || 'unknown'}`);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const abs = blobAbsPath(projectRoot, sha256, ext);
  if (!fs.existsSync(abs)) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, abs); // atomic on same filesystem
  }
  return {
    sha256, mime, ext, byte_size: bytes.length,
    width: dim.width ?? null, height: dim.height ?? null,
  };
}
