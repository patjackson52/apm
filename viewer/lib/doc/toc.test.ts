import { describe, it, expect } from 'vitest';
import { extractToc } from './toc';

describe('extractToc', () => {
  it('extracts headings with matching slug + href', () => {
    const toc = extractToc('# Alpha\n\ntext\n\n## Beta Two');
    expect(toc).toEqual([
      { level: 1, text: 'Alpha', id: 'alpha', href: '#apm-alpha' },
      { level: 2, text: 'Beta Two', id: 'beta-two', href: '#apm-beta-two' },
    ]);
  });
  it('ignores heading-looking lines inside fenced code', () => {
    const toc = extractToc('# Real\n```\n# fake\n```\n## AlsoReal');
    expect(toc.map((t) => t.text)).toEqual(['Real', 'AlsoReal']);
  });
});
