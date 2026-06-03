import DOMPurify from 'dompurify';

/**
 * Sanitize a Mermaid-rendered SVG string before it is inserted into the DOM.
 *
 * Untrusted-content defense (PLAN.md M2 checklist): strip every HTML-in-SVG,
 * navigation, script, and external-fetch vector. Forbid `foreignObject`
 * (the primary HTML escape), `script`, `style` (tag) + inline `style`
 * attribute (CSS url()/@import exfil), `a` (navigation), and `image`/`use`
 * (SVG2 external content). The `uponSanitizeAttribute` hook drops any
 * `href`/`xlink:href` whose value is not a `#`-prefixed in-document ref —
 * covering remote, `data:`, `javascript:`, protocol-relative, and
 * whitespace/control-char-obfuscated forms — while keeping internal marker
 * refs (`href="#arrowhead"`) so Mermaid markers still resolve. `on*` handlers
 * are stripped by DOMPurify by default; we assert that in tests.
 *
 * Pure string -> string so it is unit-testable in jsdom and reusable by
 * WI-30 copy-as-image (same sanitize before serializing the SVG to a blob).
 */

const CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['foreignObject', 'script', 'style', 'a', 'image', 'use'],
  FORBID_ATTR: ['style'],
  ALLOW_DATA_ATTR: false,
};

let hookRegistered = false;
function ensureHook(): void {
  if (hookRegistered) return;
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName === 'href' || data.attrName === 'xlink:href') {
      const value = (data.attrValue || '').trim();
      if (!value.startsWith('#')) {
        data.keepAttr = false;
      }
    }
  });
  hookRegistered = true;
}

export function sanitizeSvg(svg: string): string {
  ensureHook();
  return DOMPurify.sanitize(svg, CONFIG) as unknown as string;
}
