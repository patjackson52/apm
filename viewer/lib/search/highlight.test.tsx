import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { highlight } from './highlight';

describe('highlight', () => {
  it('wraps a case-insensitive match in <mark>, rest plain text', () => {
    const { container } = render(<div>{highlight('Hello World', 'world')}</div>);
    const mark = container.querySelector('mark');
    expect(mark?.textContent).toBe('World');
    expect(container.textContent).toBe('Hello World');
  });
  it('renders markup in the text literally (no XSS)', () => {
    const { container } = render(<div>{highlight('<script>alert(1)</script> needle', 'needle')}</div>);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });
  it('empty q returns the text unchanged', () => {
    const { container } = render(<div>{highlight('abc', '')}</div>);
    expect(container.querySelector('mark')).toBeNull();
    expect(container.textContent).toBe('abc');
  });
});
