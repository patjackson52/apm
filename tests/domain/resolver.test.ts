import { describe, it, expect } from 'vitest';
import { selectCandidate, type Candidate, type Caller } from '../../src/domain/resolver.js';

const NOW = '2026-06-02T12:00:00.000Z';
function cand(p: Partial<Candidate>): Candidate {
  return {
    workItemId: 'WI-1', priority: 0, createdAt: '2026-06-02T00:00:00.000Z',
    depsAllComplete: true, hasPendingStep: true, blockedByHumanGate: false,
    requiredCaps: [], leaseHolderAgent: null, leaseLive: false, ...p,
  };
}
const caller: Caller = { agent: 'claude', capabilities: [], match: 'any' };

describe('selectCandidate', () => {
  it('dispatches the only eligible candidate', () => {
    const r = selectCandidate([cand({})], caller, NOW);
    expect(r).toEqual({ status: 'dispatched', workItemId: 'WI-1' });
  });

  it('drained when no candidates have a pending step at all', () => {
    const r = selectCandidate([], caller, NOW);
    expect(r.status).toBe('drained');
  });

  it('idle deps_pending when deps incomplete', () => {
    const r = selectCandidate([cand({ depsAllComplete: false })], caller, NOW);
    expect(r).toMatchObject({ status: 'idle', reason: 'deps_pending' });
  });

  it('idle all_leased when the only candidate is live-leased by another agent', () => {
    const r = selectCandidate([cand({ leaseLive: true, leaseHolderAgent: 'other' })], caller, NOW);
    expect(r).toMatchObject({ status: 'idle', reason: 'all_leased' });
  });

  it('dispatches a candidate the caller already holds the live lease on', () => {
    const r = selectCandidate([cand({ leaseLive: true, leaseHolderAgent: 'claude' })], caller, NOW);
    expect(r.status).toBe('dispatched');
  });

  it('idle awaiting_human when the only candidate is blocked by a human gate', () => {
    const r = selectCandidate([cand({ hasPendingStep: false, blockedByHumanGate: true })], caller, NOW);
    expect(r).toMatchObject({ status: 'idle', reason: 'awaiting_human' });
  });

  it('idle capability_mismatch when caps do not match (match=all)', () => {
    const r = selectCandidate([cand({ requiredCaps: ['security'] })], { agent: 'claude', capabilities: ['coding'], match: 'all' }, NOW);
    expect(r).toMatchObject({ status: 'idle', reason: 'capability_mismatch' });
  });

  it('ranks by priority desc then created_at then id', () => {
    const r = selectCandidate([
      cand({ workItemId: 'WI-1', priority: 1 }),
      cand({ workItemId: 'WI-2', priority: 5 }),
    ], caller, NOW);
    expect(r).toMatchObject({ status: 'dispatched', workItemId: 'WI-2' });
  });
});
