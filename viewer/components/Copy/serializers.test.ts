import { describe, it, expect } from 'vitest';
import { sliceSection } from './sectionCopy';
import { tableToMarkdown } from './tableToMarkdown';
import { tableToCsv } from './tableToCsv';

describe('sliceSection', () => {
  it('stops at next equal/higher heading, keeps nested lower headings', () => {
    const md = '# A\nintro\n## sub\nbody\n# B\nmore';
    expect(sliceSection(md, 1)).toBe('# A\nintro\n## sub\nbody\n');
  });

  it('does NOT treat a heading-looking line inside a fence as a boundary', () => {
    const md = '# A\ntext\n```\n# notheading\n```\n## B\n# C';
    expect(sliceSection(md, 1)).toBe('# A\ntext\n```\n# notheading\n```\n## B\n');
  });

  it('runs to EOF when no further boundary', () => {
    expect(sliceSection('## only\nx', 1)).toBe('## only\nx\n');
  });
});

describe('tableToMarkdown', () => {
  it('builds a GFM table and escapes pipes', () => {
    const out = tableToMarkdown({ headers: ['a', 'b'], rows: [['1|2', 'y']] });
    expect(out).toBe('| a | b |\n| --- | --- |\n| 1\\|2 | y |');
  });
});

describe('tableToCsv', () => {
  it('quotes fields with comma / quote / newline (RFC-4180, CRLF rows)', () => {
    expect(tableToCsv({ headers: ['a'], rows: [['x,y']] })).toBe('a\r\n"x,y"');
    expect(tableToCsv({ headers: ['h'], rows: [['he said "hi"']] })).toBe('h\r\n"he said ""hi"""');
  });
});
