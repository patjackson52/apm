import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProvenanceChip } from './ProvenanceChip';

describe('ProvenanceChip', () => {
  it('links to the prompt detail page and shows name@version', () => {
    render(<ProvenanceChip name="implementation" version={2} latest={2} />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/prompts/implementation');
    expect(link.textContent).toContain('implementation@2');
  });

  it('shows an amber "v3 available" badge when latest > version', () => {
    const { container } = render(<ProvenanceChip name="impl" version={2} latest={3} />);
    expect(screen.getByText('v3 available')).toBeTruthy();
    const badge = container.querySelector('.prov-newer');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('title')).toBe('Newer stored version v3 exists');
  });

  it('hides the badge when latest equals version', () => {
    const { container } = render(<ProvenanceChip name="impl" version={2} latest={2} />);
    expect(container.querySelector('.prov-newer')).toBeNull();
  });
});
