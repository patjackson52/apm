import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { StatusView } from '@apm/types';
import { StatusCounts } from './StatusCounts';
import { AwaitingHuman } from './AwaitingHuman';
import { ActiveRuns } from './ActiveRuns';
import { ActiveLeases } from './ActiveLeases';

const status: StatusView = {
  work: { by_status: { draft: 19, completed: 25 } },
  ready_count: 9,
  active_leases: [{ id: 'LEASE-1', work_item: 'WI-3', agent: 'claude', session: null, status: 'active', acquired_at: '', expires_at: '', heartbeat_at: null, agent_type: null, current_step: 'design', ttl: '30m', ttl_seconds: 1800 }],
  open_blockers: [],
  awaiting_human: [{ id: 'HG-1', reason: 'need a decision' }],
  active_runs: [{ id: 'WR-1', work_item: 'WI-3', workflow: 'feature_delivery', status: 'running', current_step: 'design', started_at: '', completed_at: null }],
};

describe('dashboard panels', () => {
  it('StatusCounts shows by_status + ready', () => {
    render(<StatusCounts status={status} />);
    expect(screen.getByText('draft: 19')).toBeTruthy();
    expect(screen.getByText('ready: 9')).toBeTruthy();
  });
  it('AwaitingHuman links the gate and shows the reason', () => {
    render(<AwaitingHuman items={status.awaiting_human} />);
    expect(screen.getByText('need a decision')).toBeTruthy();
    expect(screen.getByText('HG-1')).toBeTruthy(); // HG- has no route -> plain chip
  });
  it('ActiveRuns links the work item (WR- id stays a plain chip)', () => {
    const { container } = render(<ActiveRuns runs={status.active_runs} />);
    const link = container.querySelector('a[href="/work/WI-3"]');
    expect(link).not.toBeNull();
  });
  it('ActiveLeases shows agent + work link', () => {
    render(<ActiveLeases leases={status.active_leases} />);
    expect(screen.getByText('claude')).toBeTruthy();
  });
});
