import { slugify, headingHref } from '@/lib/markdown/slugify';

export interface TocEntry {
  level: number;
  text: string;
  id: string;   // bare slug
  href: string; // #apm-<slug> (matches the clobber-prefixed DOM id)
}

const FENCE = /^(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+(.*)$/;

/** Extract a TOC from markdown source (fenced-code aware). Slugs match the renderer's. */
export function extractToc(markdown: string): TocEntry[] {
  const out: TocEntry[] = [];
  let open: { char: string; len: number } | null = null;
  for (const line of markdown.split('\n')) {
    const fence = FENCE.exec(line.trimStart());
    if (fence) {
      const run = fence[1]!;
      const char = run[0]!;
      const len = run.length;
      if (!open) open = { char, len };
      else if (char === open.char && len >= open.len) open = null;
      continue;
    }
    if (open) continue;
    const h = HEADING.exec(line);
    if (h) {
      const level = h[1]!.length;
      const text = h[2]!.trim();
      out.push({ level, text, id: slugify(text), href: headingHref(text) });
    }
  }
  return out;
}
