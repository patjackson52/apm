import { open } from 'node:fs/promises';
import { resolveProjectRoot, resolveSafePath } from '@/lib/files/resolvePath';

/**
 * GET-only local image server for inline markdown images (PLAN.md M2 jail).
 *
 * Only this verb is exported, so Next returns 405 for any mutation. Every
 * jail rejection returns a uniform 404 (no 403/404 existence oracle). The
 * file is read through a descriptor opened on the realpath'd absolute path,
 * which binds the read to the real inode and closes the realpath->read
 * symlink-swap (TOCTOU) window. Responses are nosniff + CSP-sandboxed and
 * carry a Content-Type taken from the extension allowlist, never sniffed.
 */
export async function GET(req: Request): Promise<Response> {
  const requested = new URL(req.url).searchParams.get('path');
  if (!requested) return notFound();

  const root = await resolveProjectRoot();
  const resolved = await resolveSafePath(root, requested);
  if (!resolved.ok) return notFound();

  const fh = await open(resolved.absPath, 'r').catch(() => null);
  if (!fh) return notFound();
  try {
    const stat = await fh.stat();
    if (!stat.isFile()) return notFound();
    const buf = await fh.readFile();
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': resolved.contentType,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch {
    return notFound();
  } finally {
    await fh.close();
  }
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}
