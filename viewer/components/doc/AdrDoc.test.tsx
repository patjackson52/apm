import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdrDoc } from './AdrDoc';
import type { ArtifactView } from '@apm/types';

const adr: ArtifactView = {
  id: 'ADR-2', type: 'adr', title: 'Use SQLite', version: 1, status: 'accepted',
  root: 'ADR-2', supersedes: null, created_by: 'p', created_at: '2026-02-03T00:00:00Z',
  body: '## Context\n\nWe need storage.', work_item: 'WI-1',
};

describe('AdrDoc', () => {
  it('renders ADR header + body via Markdown', () => {
    const { container } = render(<AdrDoc adr={adr} />);
    expect(screen.getByText('Use SQLite')).toBeTruthy();
    expect(container.querySelector('h2')?.getAttribute('id')).toBe('apm-context');
  });
});
