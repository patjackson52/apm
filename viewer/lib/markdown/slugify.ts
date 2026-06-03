/**
 * Bare heading slug (NO prefix). The sanitize schema's clobberPrefix ('apm-')
 * is applied by rehype-sanitize to the id at render, so the DOM id becomes
 * `apm-<slug>`. headingHref prepends the same prefix so TOC anchors resolve.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Anchor href matching the clobber-prefixed DOM id of a heading. */
export function headingHref(text: string): string {
  return `#apm-${slugify(text)}`;
}
