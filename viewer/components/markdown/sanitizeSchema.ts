import { defaultSchema } from 'rehype-sanitize';
import type { Options } from 'rehype-sanitize';

// Tightened allowlist for UNTRUSTED agent markdown (PLAN 22-26).
export const schema: Options = {
  ...defaultSchema,
  tagNames: [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
    'strong', 'em', 'del', 'code', 'pre', 'a', 'br', 'span',
    'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  attributes: {
    a: ['href', 'title'],
    code: ['className'],
    span: ['className'],
    th: ['align'],
    td: ['align'],
  },
  protocols: { href: ['https'] }, // https + relative/# only; strips javascript:/data:/http:/mailto:
  clobberPrefix: 'apm-',
  allowComments: false,
};
