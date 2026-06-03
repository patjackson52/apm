import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Markdown } from './Markdown';
import { headingHref } from '@/lib/markdown/slugify';

describe('Markdown heading ids (WI-31)', () => {
  it('renders a clobber-prefixed id that matches headingHref (pre-sanitize plugin + allowlist)', () => {
    const { container } = render(<Markdown body={'## Hello World'} docCopy={false} />);
    const h2 = container.querySelector('h2');
    expect(h2?.getAttribute('id')).toBe('apm-hello-world');
    expect(headingHref('Hello World')).toBe('#apm-hello-world');
  });

  it('does not let an injected id/attribute survive (sanitizer owns the id)', () => {
    // A heading whose text would not change the safe slug; ensure no script/attr injection.
    const { container } = render(<Markdown body={'# A <b>x</b>'} docCopy={false} />);
    const h1 = container.querySelector('h1');
    expect(h1?.getAttribute('id')).toMatch(/^apm-[a-z0-9-]*$/);
    expect(container.querySelector('script')).toBeNull();
  });
});
