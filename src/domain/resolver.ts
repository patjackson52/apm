export interface Candidate {
  workItemId: string;
  priority: number;
  createdAt: string;
  depsAllComplete: boolean;
  hasPendingStep: boolean;        // has a dispatchable pending main step (or review_gate with a pending child)
  blockedByHumanGate: boolean;    // has an open human_gate blocker
  requiredCaps: string[];         // capabilities the pending step requires
  leaseHolderAgent: string | null;
  leaseLive: boolean;             // a non-expired active lease exists
}

export interface Caller { agent: string; capabilities: string[]; match: 'any' | 'all'; }

export type Resolution =
  | { status: 'dispatched'; workItemId: string }
  | { status: 'idle'; reason: 'deps_pending' | 'all_leased' | 'capability_mismatch' | 'awaiting_human'; retryAfter: number }
  | { status: 'drained' };

function capsMatch(required: string[], caller: Caller): boolean {
  if (required.length === 0) return true;
  const have = new Set(caller.capabilities);
  return caller.match === 'all' ? required.every((c) => have.has(c)) : required.some((c) => have.has(c));
}

export type ListResolution =
  | { status: 'dispatchable'; workItemIds: string[] }
  | { status: 'idle'; reason: 'deps_pending' | 'all_leased' | 'capability_mismatch' | 'awaiting_human'; retryAfter: number }
  | { status: 'drained' };

/** Returns ranked list of all dispatchable candidates (for claim-walk dispatch). */
export function selectCandidates(candidates: Candidate[], caller: Caller, _now: string): ListResolution {
  if (candidates.length === 0) return { status: 'drained' };

  const dispatchable: Candidate[] = [];
  let sawDeps = false, sawLeased = false, sawCaps = false, sawHuman = false;

  for (const c of candidates) {
    if (c.blockedByHumanGate) { sawHuman = true; continue; }
    if (!c.hasPendingStep) continue;
    if (!c.depsAllComplete) { sawDeps = true; continue; }
    if (c.leaseLive && c.leaseHolderAgent !== caller.agent) { sawLeased = true; continue; }
    if (!capsMatch(c.requiredCaps, caller)) { sawCaps = true; continue; }
    dispatchable.push(c);
  }

  if (dispatchable.length > 0) {
    dispatchable.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.workItemId.localeCompare(b.workItemId));
    return { status: 'dispatchable', workItemIds: dispatchable.map((c) => c.workItemId) };
  }

  if (sawDeps) return { status: 'idle', reason: 'deps_pending', retryAfter: 30 };
  if (sawLeased) return { status: 'idle', reason: 'all_leased', retryAfter: 30 };
  if (sawCaps) return { status: 'idle', reason: 'capability_mismatch', retryAfter: 60 };
  if (sawHuman) return { status: 'idle', reason: 'awaiting_human', retryAfter: 0 };
  return { status: 'drained' };
}

/** Pure dispatch decision over pre-computed candidates. `now` reserved for future time-based ranking. */
export function selectCandidate(candidates: Candidate[], caller: Caller, now: string): Resolution {
  if (candidates.length === 0) return { status: 'drained' };

  const dispatchable: Candidate[] = [];
  let sawDeps = false, sawLeased = false, sawCaps = false, sawHuman = false, sawPending = false;

  for (const c of candidates) {
    if (c.blockedByHumanGate) { sawHuman = true; continue; }
    if (!c.hasPendingStep) continue;
    sawPending = true;
    if (!c.depsAllComplete) { sawDeps = true; continue; }
    if (c.leaseLive && c.leaseHolderAgent !== caller.agent) { sawLeased = true; continue; }
    if (!capsMatch(c.requiredCaps, caller)) { sawCaps = true; continue; }
    dispatchable.push(c);
  }

  if (dispatchable.length > 0) {
    dispatchable.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.workItemId.localeCompare(b.workItemId));
    return { status: 'dispatched', workItemId: dispatchable[0].workItemId };
  }

  // nothing dispatchable now — choose the most informative idle reason
  if (sawDeps) return { status: 'idle', reason: 'deps_pending', retryAfter: 30 };
  if (sawLeased) return { status: 'idle', reason: 'all_leased', retryAfter: 30 };
  if (sawCaps) return { status: 'idle', reason: 'capability_mismatch', retryAfter: 60 };
  if (sawHuman) return { status: 'idle', reason: 'awaiting_human', retryAfter: 0 };
  return { status: 'drained' };
}
