import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Landing } from './landing';

describe('Landing', () => {
  it('renders the APM Viewer title', () => {
    render(<Landing />);
    expect(screen.getByRole('heading', { name: /apm viewer/i })).toBeInTheDocument();
  });
});
