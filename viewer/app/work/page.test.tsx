import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Page from './page';

describe('work route (skeleton)', () => {
  it('renders heading + skeleton placeholder', () => {
    const { container } = render(<Page />);
    expect(screen.getByRole('heading', { name: 'Work items' })).toBeInTheDocument();
    expect(container.querySelector('[role="presentation"]')).toBeInTheDocument();
  });
});
