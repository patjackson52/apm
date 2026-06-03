import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DecisionDoc } from './DecisionDoc';
import type { DecisionView } from '@apm/types';

const dec: DecisionView = {
  id: 'DEC-3', work_item: 'WI-1', question: 'Which library?',
  options: ['A', 'B'], recommendation: 'A', confidence: 87, decision: 'A',
  category: 'platform', status: 'accepted', artifact_id: null,
  created_at: '2026-01-01', decided_at: '2026-01-02',
};

describe('DecisionDoc', () => {
  it('renders structured fields as plain text', () => {
    render(<DecisionDoc decision={dec} />);
    expect(screen.getByText('Which library?')).toBeTruthy();
    expect(screen.getByText('87%')).toBeTruthy();
    expect(screen.getByText('accepted')).toBeTruthy();
    expect(screen.getByText('A', { selector: 'li' })).toBeTruthy();
  });
});
