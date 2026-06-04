import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VersionTimeline } from './VersionTimeline';
import type { ArtifactView } from '@apm/types';

const v = (id: string, version: number): ArtifactView => ({
  id, type: 'spec', title: 't', version, status: 'draft', root: 'R',
  supersedes: null, created_by: 'a', created_at: '2026-01-0' + version + 'T00:00:00Z',
  body: null, work_item: 'WI-1', metadata: null,
});

describe('VersionTimeline', () => {
  it('lists versions, marks current, and fires onSelect', () => {
    const onSelect = vi.fn();
    render(<VersionTimeline versions={[v('A2', 2), v('A1', 1)]} currentId="A2" onSelect={onSelect} />);
    const rows = screen.getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.getAttribute('aria-current')).toBe('true');
    fireEvent.click(rows[1]!);
    expect(onSelect).toHaveBeenCalledWith('A1');
  });
  it('renders nothing for a single version', () => {
    const { container } = render(<VersionTimeline versions={[v('A1', 1)]} currentId="A1" onSelect={() => {}} />);
    expect(container.querySelector('nav')).toBeNull();
  });
});
