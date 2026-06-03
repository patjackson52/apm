import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Mermaid } from './Mermaid';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, chart: string) => {
      if (chart.includes('BOOM')) throw new Error('parse error');
      return {
        svg:
          '<svg xmlns="http://www.w3.org/2000/svg">' +
          '<foreignObject><script>alert(1)</script></foreignObject>' +
          '<rect width="2" height="2"/></svg>',
      };
    }),
  },
}));

describe('Mermaid', () => {
  it('renders a sanitized svg for a valid diagram (no foreignObject/script)', async () => {
    const { container } = render(<Mermaid chart="graph TD; A-->B" />);
    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull());
    expect(container.innerHTML).not.toMatch(/foreignObject/i);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('rect')).not.toBeNull();
  });

  it('falls back to a <pre> with the raw source on render failure', async () => {
    const { container, getByText } = render(<Mermaid chart="BOOM not a diagram" />);
    await waitFor(() => expect(container.querySelector('pre')).not.toBeNull());
    expect(getByText('BOOM not a diagram')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
  });
});
