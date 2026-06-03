import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Markdown } from './Markdown';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>',
    })),
  },
}));

describe('Markdown wiring (WI-29)', () => {
  it('renders a mermaid fence as a diagram, not raw code', async () => {
    const body = '```mermaid\ngraph TD; A-->B\n```';
    const { container } = render(<Markdown body={body} />);
    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull());
    expect(container.querySelector('code.language-mermaid')).toBeNull();
  });

  it('routes a local image through /api/files', () => {
    const { container } = render(<Markdown body={'![cap](assets/a.png)'} />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/api/files?path=assets%2Fa.png');
  });

  it('drops a remote image to alt text', () => {
    const { container } = render(<Markdown body={'![cap](https://e/a.png)'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('cap');
  });

  it('still renders a normal fenced code block inside <pre>', () => {
    const { container } = render(<Markdown body={'```js\nconst x = 1;\n```'} />);
    expect(container.querySelector('pre')).not.toBeNull();
    expect(container.querySelector('code')).not.toBeNull();
  });
});
