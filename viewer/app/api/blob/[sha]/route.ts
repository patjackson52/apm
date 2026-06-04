import { readFile } from 'node:fs/promises';
import { resolveBlob, resolveProjectRoot } from '@/lib/files/resolveBlob';

export async function GET(_req: Request, ctx: { params: Promise<{ sha: string }> }): Promise<Response> {
  const { sha } = await ctx.params;
  const root = await resolveProjectRoot();
  const r = await resolveBlob(root, sha);
  if (!r.ok) return new Response(null, { status: 404 });
  const buf = await readFile(r.absPath);
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': r.contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"${sha}"`,
    },
  });
}
