import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';

/** Image extensions the file endpoint will serve. Allowlist (never a denylist). */
export const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};
export function contentTypeFor(ext: string): string {
  return MIME[ext.toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolve a request `path` to a real file inside `projectRoot`, or null if it is
 * disallowed/escaping. Defends path traversal, absolute paths, symlink escape, and
 * in-root symlinks pointing at non-image (e.g. secret) files. SECURITY-CRITICAL.
 */
export function resolveFilePath(projectRoot: string, rel: string | null | undefined): string | null {
  if (!rel || rel.includes('\0') || path.isAbsolute(rel) || rel.startsWith('~')) return null;
  if (!ALLOWED_EXT.has(path.extname(rel).toLowerCase())) return null; // cheap pre-reject on requested ext
  try {
    const abs = path.resolve(projectRoot, rel);
    const rp = fs.realpathSync(abs);              // resolves all symlinks (file + intermediate dirs)
    const rpRoot = fs.realpathSync(projectRoot);
    if (rp !== rpRoot && !rp.startsWith(rpRoot + path.sep)) return null; // jail (path.sep avoids /rootX bug)
    if (!ALLOWED_EXT.has(path.extname(rp).toLowerCase())) return null;   // re-check RESOLVED ext (symlink→secret)
    if (!fs.statSync(rp).isFile()) return null;   // no dirs/sockets; no directory listing
    return rp;
  } catch {
    return null; // missing path / realpath error → treat as not found
  }
}

/** Serve an allowlisted image file, or 404 for any rejection (no info leak). */
export function serveFile(projectRoot: string, rel: string | null | undefined, res: http.ServerResponse): void {
  const p = resolveFilePath(projectRoot, rel);
  if (!p) { res.writeHead(404); res.end(); return; }
  const ext = path.extname(p).toLowerCase();
  const headers: Record<string, string> = {
    'Content-Type': contentTypeFor(ext),
    'X-Content-Type-Options': 'nosniff',
  };
  if (ext === '.svg') headers['Content-Security-Policy'] = "default-src 'none'; sandbox";
  res.writeHead(200, headers);
  res.end(fs.readFileSync(p));
}
