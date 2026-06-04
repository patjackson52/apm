import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const useBlockers = vi.fn();
const useGates = vi.fn();
vi.mock('@/lib/api/hooks', () => ({ useBlockers: () => useBlockers(), useGates: () => useGates() }));

import { BlockersGates } from './BlockersGates';

beforeEach(() => { useBlockers.mockReset(); useGates.mockReset(); });

describe('BlockersGates', () => {
  it('renders blocker + gate rows as plain text with links', () => {
    useBlockers.mockReturnValue({ data: [{ id: 'BLK-1', work_item: 'WI-3', type: 'missing_dependency', reason: 'dep WI-2 incomplete', status: 'open', question: null, options: [], resolution: null, answer: null, choice: null, answered_by: null, answered_at: null, resolved_at: null, current_step: null }], isLoading: false, isError: false });
    useGates.mockReturnValue({ data: [{ id: 'HG-1', work_item: 'WI-4', type: 'human_gate', reason: 'approve?', status: 'open', question: 'Approve the design?', options: ['yes', 'no'], resolution: null, answer: null, choice: null, answered_by: null, answered_at: null, resolved_at: null, current_step: 'design_review' }], isLoading: false, isError: false });
    render(<BlockersGates />);
    expect(screen.getByText('dep WI-2 incomplete')).toBeTruthy();
    expect(screen.getByText('Approve the design?')).toBeTruthy();
    expect(screen.getByText('[yes, no]')).toBeTruthy();
  });
  it('shows empty states', () => {
    useBlockers.mockReturnValue({ data: [], isLoading: false, isError: false });
    useGates.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(<BlockersGates />);
    expect(screen.getByText('No blockers.')).toBeTruthy();
    expect(screen.getByText('No open gates.')).toBeTruthy();
  });
});
