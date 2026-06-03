import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IdChip } from './IdChip';

describe('IdChip', () => {
  it('renders the id with a title', () => {
    render(<IdChip id="WI-3" />);
    const el = screen.getByText('WI-3');
    expect(el).toHaveAttribute('title', 'WI-3');
    expect(el.className).toMatch(/t_work/);
  });
  it('uses neutral tint for an unknown prefix', () => {
    render(<IdChip id="ZZ-9" />);
    expect(screen.getByText('ZZ-9').className).toMatch(/t_neutral/);
  });
});
