import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Toc } from './Toc';

describe('Toc', () => {
  it('renders heading links with matching hrefs', () => {
    const { container } = render(<Toc body={'# Alpha\n## Beta Two'} />);
    const links = Array.from(container.querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#apm-alpha', '#apm-beta-two']);
    expect(links[1]!.textContent).toBe('Beta Two');
  });
  it('renders nothing when there are no headings', () => {
    const { container } = render(<Toc body={'just text'} />);
    expect(container.querySelector('nav')).toBeNull();
  });
});
