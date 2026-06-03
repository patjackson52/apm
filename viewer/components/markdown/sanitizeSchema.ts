import { defaultSchema } from 'rehype-sanitize';
import type { Options } from 'rehype-sanitize';

// Tightened allowlist for UNTRUSTED agent markdown (PLAN 22-26).
export const schema: Options = {
  ...defaultSchema,
  tagNames: [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
    'strong', 'em', 'del', 'code', 'pre', 'a', 'br', 'span',
    'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img',
  ],
  attributes: {
    a: ['href', 'title'],
    h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'],
    code: ['className'],
    span: ['className'],
    th: ['align'],
    td: ['align'],
    img: ['src', 'alt', 'title'],
  },
  protocols: { href: ['https'], src: ['https'] }, // relative + https only; SafeImage enforces local-only + /api/files jails
  clobberPrefix: 'apm-',
  allowComments: false,
};
