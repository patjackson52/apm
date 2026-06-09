import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClientOnly } from './ClientOnly';

describe('ClientOnly', () => {
  it('renders children after hydration', () => {
    render(<ClientOnly fallback={<i>fb</i>}><b>kid</b></ClientOnly>);
    expect(screen.getByText('kid')).toBeTruthy();
  });

  it('renders the fallback during SSR / first render', () => {
    const html = renderToStaticMarkup(<ClientOnly fallback={<i>fb</i>}><b>kid</b></ClientOnly>);
    expect(html).toContain('fb');
    expect(html).not.toContain('kid');
  });
});
