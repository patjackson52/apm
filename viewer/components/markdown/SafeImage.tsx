import type { ComponentProps } from 'react';

/**
 * Inline-image renderer for untrusted agent markdown (PLAN.md M2).
 *
 * Only LOCAL relative paths are allowed; they are routed through the
 * path-jailed /api/files endpoint. Remote (`http(s):`/protocol-relative),
 * `data:`/`blob:`/`javascript:`, and absolute (`/...`) srcs are dropped to
 * an alt-text span (mirrors SafeAnchor's reject-shape). The server route is
 * the authoritative jail; this client check only avoids a doomed request.
 */
function isLocalRelative(src: string): boolean {
  if (!src) return false;
  if (src.startsWith('//')) return false; // protocol-relative
  if (src.startsWith('/')) return false; // absolute path
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return false; // any scheme (http, data, blob, javascript, ...)
  return true;
}

export function SafeImage({ src, alt }: ComponentProps<'img'>) {
  const text = typeof alt === 'string' ? alt : '';
  if (typeof src !== 'string' || !isLocalRelative(src)) {
    return <span>{text}</span>;
  }
  return (
    // next/image is intentionally avoided: images are served only through the
    // path-jailed /api/files route; an optimizer loader would bypass that jail.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/files?path=${encodeURIComponent(src)}`}
      alt={text}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}
