import { realpath } from 'node:fs/promises';
import path from 'node:path';

const EXT_CONTENT_TYPE: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const FORBIDDEN_SEGMENTS = new Set(['.git', '.apm']);

export type Resolved =
  | { ok: true; absPath: string; contentType: string }
  | { ok: false };

const FAIL: Resolved = { ok: false };

/**
 * Pure, fail-closed path jail for /api/files (PLAN.md M2 checklist).
 *
 * Order matters: cheap canonicalization + allowlist rejects run before any
 * fs access; then realpath resolves symlinks; then the prefix assert is the
 * authoritative backstop that defeats `..`, absolute paths, and symlink
 * escape together. Returns the realpath'd absolute path so the route can
 * open it through a descriptor bound to the real inode (TOCTOU mitigation).
 */
export async function resolveSafePath(root: string, requested: string): Promise<Resolved> {
  // 1. Canonicalize input (value arrives already %-decoded once from searchParams).
  if (!requested) return FAIL;
  // Reject NUL / control chars and any residual percent (blocks double-encoding).
  if (/[\x00-\x1f]/.test(requested) || requested.includes('%')) return FAIL;
  const norm = path.normalize(requested);
  if (path.isAbsolute(norm)) return FAIL;
  if (norm.split(/[\\/]/).some((seg) => seg === '..')) return FAIL;

  // 2. Extension allowlist (raster images only; .svg deliberately excluded).
  const ext = path.extname(norm).toLowerCase();
  const contentType = EXT_CONTENT_TYPE[ext];
  if (!contentType) return FAIL;

  // 3-4. Resolve against root, then realpath (resolves symlinks).
  const candidate = path.resolve(root, norm);
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    return FAIL;
  }

  // 5. Prefix assert against the realpath'd root.
  if (real !== root && !real.startsWith(root + path.sep)) return FAIL;

  // 6. Dotset / sensitive-file denylist (belt-and-suspenders over the ext allowlist).
  const rel = path.relative(root, real);
  const segments = rel.split(path.sep);
  if (segments.some((seg) => FORBIDDEN_SEGMENTS.has(seg))) return FAIL;
  const base = path.basename(real);
  if (base === '.env' || base.endsWith('.db')) return FAIL;

  // 7. Done.
  return { ok: true, absPath: real, contentType };
}

let cachedRoot: Promise<string> | undefined;

/** The viewer -> project binding. Resolved + realpath'd once, then memoized. */
export function resolveProjectRoot(): Promise<string> {
  if (!cachedRoot) {
    const raw = path.resolve(process.env.APM_PROJECT_ROOT ?? process.cwd());
    cachedRoot = realpath(raw);
  }
  return cachedRoot;
}
