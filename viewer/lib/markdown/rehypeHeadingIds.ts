import { slugify } from './slugify';

type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function textOf(n: HastNode): string {
  if (n.type === 'text') return n.value ?? '';
  return (n.children ?? []).map(textOf).join('');
}

function walk(n: HastNode, fn: (n: HastNode) => void): void {
  fn(n);
  (n.children ?? []).forEach((c) => walk(c, fn));
}

/**
 * rehype plugin (runs BEFORE rehype-sanitize) that gives every heading a
 * bare-slug `id`. rehype-sanitize then validates the id against the allowlist
 * and applies its clobberPrefix, so the DOM id is `apm-<slug>`. Generating the
 * id pre-sanitize is the whole point: the React component override must NOT
 * derive ids from (untrusted) heading text post-sanitize.
 */
export function rehypeHeadingIds() {
  return (tree: HastNode): void => {
    walk(tree, (n) => {
      if (n.type === 'element' && n.tagName && HEADINGS.has(n.tagName)) {
        n.properties = n.properties ?? {};
        if (!n.properties.id) n.properties.id = slugify(textOf(n));
      }
    });
  };
}
