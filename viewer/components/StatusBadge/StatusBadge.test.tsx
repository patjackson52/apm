import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the label + accessible status for each status', () => {
    render(<StatusBadge status="completed" />);
    const el = screen.getByLabelText(/status: completed/i);
    expect(el).toHaveTextContent('Completed');
  });
  it('hides the dot when showDot=false', () => {
    const { container } = render(<StatusBadge status="active" showDot={false} />);
    expect(container.querySelector('span[aria-hidden="true"]')).toBeNull();
  });
});
