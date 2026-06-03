import { describe, it, expect } from 'vitest';
import { slugify, headingHref } from './slugify';

describe('slugify', () => {
  it('produces a bare lowercase slug (no apm- prefix)', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('  Spaced  Out  ')).toBe('spaced-out');
    expect(slugify('Mixed_CASE 123')).toBe('mixed-case-123');
  });
  it('charset is injection-safe ([a-z0-9-] only)', () => {
    expect(slugify('<script>alert(1)</script>')).toMatch(/^[a-z0-9-]*$/);
    expect(slugify('a"b=c')).toMatch(/^[a-z0-9-]*$/);
  });
  it('headingHref prepends the single clobber prefix', () => {
    expect(headingHref('Hello World')).toBe('#apm-hello-world');
  });
});
