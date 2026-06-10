import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StoredBody } from './StoredBody';

describe('StoredBody', () => {
  it('renders the body and the name@version', () => {
    render(<StoredBody name="implementation" version={2} body="Do the work carefully." />);
    expect(screen.getByText('Do the work carefully.')).toBeTruthy();
    expect(screen.getByText('implementation@2')).toBeTruthy();
    expect(screen.getByText('Stored prompt body')).toBeTruthy();
    expect(screen.getByText('Editable · shared')).toBeTruthy();
  });

  it('renders the body through the sanitized markdown renderer (no script sink)', () => {
    const { container } = render(
      <StoredBody name="p" version={1} body={'# Title\n\n<script>alert(1)</script>'} />,
    );
    expect(container.querySelector('script')).toBeNull();
  });

  it('shows the clamp toggle only when clampBody is set', () => {
    const { container, rerender } = render(<StoredBody name="p" version={1} body="x" />);
    expect(container.querySelector('.stored__more')).toBeNull();
    rerender(<StoredBody name="p" version={1} body="x" clampBody />);
    expect(container.querySelector('.stored__more')).not.toBeNull();
  });
});
