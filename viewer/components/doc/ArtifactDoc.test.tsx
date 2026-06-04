import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ArtifactDoc } from './ArtifactDoc';
import type { ArtifactView } from '@apm/types';

const art = (body: string | null): ArtifactView => ({
  id: 'ART-9', type: 'spec', title: 'My Spec', version: 2, status: 'approved',
  root: 'ART-9', supersedes: null, created_by: 'claude', created_at: '2026-01-01',
  body, work_item: 'WI-1', metadata: null,
});

describe('ArtifactDoc', () => {
  it('renders header metadata and the body through Markdown (with heading id)', () => {
    const { container, getByText } = render(<ArtifactDoc artifact={art('## Section One\n\ntext')} />);
    expect(getByText('My Spec')).toBeTruthy();
    expect(getByText('ART-9')).toBeTruthy();
    expect(container.querySelector('h2')?.getAttribute('id')).toBe('apm-section-one');
  });
  it('does not execute injected script in the body', () => {
    const { container } = render(<ArtifactDoc artifact={art('# T\n\n<script>alert(1)</script>')} />);
    expect(container.querySelector('script')).toBeNull();
  });
});
