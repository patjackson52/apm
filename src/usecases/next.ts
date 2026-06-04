import type { Ctx } from '../cli/run.js';
import { repos } from '../storage/repos.js';
import { selectCandidates, type Candidate, type Caller } from '../domain/resolver.js';
import { buildContract, type ContextRef } from '../domain/contract.js';
import { stepById } from '../domain/workflow.js';
import type { Tx } from '../storage/storage.js';
import { resolveCurrent } from './session.js';
import { parseTtlSeconds } from './lease.js';
import { globalFleetPolicy } from '../domain/policy.js';

export interface NextArgs {
  agent: string;
  capabilities: string[];
  match: 'any' | 'all';
  acquire?: boolean;
  session?: string;
  ttl?: string;
}

/** Why the queue is empty + a snapshot of the backlog, so callers can tell
 *  "project complete" from "work planned but not yet activated". */
export interface DrainCounts { draft: number; ready: number; active: number; blocked: number; completed: number; cancelled: number; running_runs: number; }
export type DrainReason = 'complete' | 'backlog';

export type NextResult =
  | { status: 'dispatched'; data: any; session?: string; stale?: boolean }
  | { status: 'idle'; reason: string; data: { status: 'idle'; reason: string; retry_after: number }; session?: string }
  | { status: 'drained'; reason: DrainReason; counts: DrainCounts; data: { status: 'drained'; reason: DrainReason; counts: DrainCounts }; session?: string };

export function nextExitCode(r: NextResult): number {
  if (r.status === 'dispatched') return 0;
  if (r.status === 'drained') return 3;
  return r.reason === 'awaiting_human' ? 20 : 10;
}

function addSeconds(iso: string, secs: number): string {
  return new Date(new Date(iso).getTime() + secs * 1000).toISOString();
}

// SQLITE error classifiers — used so the claim-walk never lets a busy/unique throw escape.
const isBusy = (e: any) => e?.code === 'SQLITE_BUSY' || e?.code === 'SQLITE_BUSY_SNAPSHOT' || /SQLITE_BUSY/i.test(String(e?.message));
const isUnique = (e: any) => e?.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE/i.test(String(e?.message));
// Date.now()/Math.random() are FORBIDDEN in this codebase. Derive deterministic jitter from the agent id.
const jitter = (agent: string) => 25 + (agent.length % 10);

/** Result of the PHASE 1 deferred peek. Pure read; no writes. */
type RankedResult =
  | { kind: 'dispatchable'; workItemIds: string[] }
  | { kind: 'idle'; reason: string; retryAfter: number }
  | { kind: 'drained'; reason: DrainReason; counts: DrainCounts };

/** Snapshot the backlog + classify why the queue is empty. Pure read (no event append). */
function buildDrainResult(tx: Tx): { reason: DrainReason; counts: DrainCounts } {
  const byStatus = tx.all<{ status: string; c: number }>('SELECT status, COUNT(*) c FROM work_items GROUP BY status');
  const at = (s: string) => byStatus.find((row) => row.status === s)?.c ?? 0;
  const running_runs = tx.get<{ c: number }>("SELECT COUNT(*) c FROM workflow_runs WHERE status='running'")?.c ?? 0;
  const counts: DrainCounts = {
    draft: at('draft'), ready: at('ready'), active: at('active'), blocked: at('blocked'),
    completed: at('completed'), cancelled: at('cancelled'), running_runs,
  };
  const reason: DrainReason = (counts.draft + counts.ready + counts.active + counts.blocked) > 0 ? 'backlog' : 'complete';
  return { reason, counts };
}

/**
 * PHASE 1 — peek + rank in a DEFERRED (read) tx. Builds the Candidate[] from
 * running runs / deps / blockers / pending step / lease state, then ranks via
 * selectCandidates. Returns a ranked list of work-item ids (claim targets) or a
 * terminal idle/drained classification. Performs NO writes.
 */
function buildRankedCandidates(tx: Tx, args: NextArgs): RankedResult {
  const r = repos(tx);
  const now = tx.now();

  // Work items with a running workflow run, ranked by priority then age.
  const runningItems = tx.all<{ id: string; priority: number; created_at: string; run_id: string }>(
    `SELECT wi.id, wi.priority, wi.created_at, r.id AS run_id
     FROM work_items wi
     JOIN workflow_runs r ON r.work_item_id = wi.id AND r.status = 'running'
     ORDER BY wi.priority DESC, wi.created_at, wi.id`,
  );

  const candidates: Candidate[] = [];

  for (const row of runningItems) {
    const workItemId = row.id;
    const runId = row.run_id;

    // Deps: all depends_on targets must be completed
    const depIds = r.links.dependsOn(workItemId);
    let depsAllComplete = true;
    for (const depId of depIds) {
      const dep = r.workItems.byId(depId);
      if (dep && dep.status !== 'completed') { depsAllComplete = false; break; }
    }

    // Blockers: any open human_gate?
    const openBlockers = r.blockers.openForWorkItem(workItemId);
    const blockedByHumanGate = openBlockers.some((b: any) => b.blocker_type === 'human_gate');

    // Pending main step
    const mainPending = r.stepRuns.mainPending(runId);
    let hasPendingStep = false;
    let requiredCaps: string[] = [];

    if (mainPending && !blockedByHumanGate) {
      const runRow = r.runs.byId(runId);
      const defRow = runRow ? r.defs.byId(runRow.workflow_definition_id) : null;
      if (defRow) {
        const def = JSON.parse(defRow.definition_json);
        const stepDef = def.steps?.find((s: any) => s.id === mainPending.step_id);
        if (stepDef) {
          requiredCaps = stepDef.requires?.capabilities ?? [];
          if (stepDef.type === 'review_gate') {
            // hasPendingStep true only if at least one pending reviewer child
            const children = r.stepRuns.reviewerChildren(mainPending.id);
            hasPendingStep = children.some((c: any) => c.status === 'pending' || c.status === 'running');
          } else {
            hasPendingStep = true;
          }
        }
      } else {
        hasPendingStep = true;
      }
    }

    // Lease state
    const liveLease = tx.get<{ agent_id: string; id: string; expires_at: string }>(
      "SELECT id, agent_id, expires_at FROM leases WHERE work_item_id=? AND status='active' AND expires_at > ? LIMIT 1",
      workItemId, now,
    );
    const leaseLive = !!liveLease;
    const leaseHolderAgent = liveLease?.agent_id ?? null;

    candidates.push({
      workItemId,
      priority: row.priority,
      createdAt: row.created_at,
      depsAllComplete,
      hasPendingStep,
      blockedByHumanGate,
      requiredCaps,
      leaseLive,
      leaseHolderAgent,
    });
  }

  const caller: Caller = { agent: args.agent, capabilities: args.capabilities, match: args.match };
  const res = selectCandidates(candidates, caller, now);

  if (res.status === 'drained') {
    const { reason, counts } = buildDrainResult(tx);
    return { kind: 'drained', reason, counts };
  }
  if (res.status === 'idle') {
    return { kind: 'idle', reason: res.reason, retryAfter: res.retryAfter };
  }
  return { kind: 'dispatchable', workItemIds: res.workItemIds };
}

/**
 * Assemble the dispatch payload for one work item. Loads the running run, the
 * pending main step, the workflow def + step def, builds the required-context
 * refs and the agent contract. The lease (or null in peek mode) is passed in —
 * this function performs no lease insert. Returns null if the run/step/def
 * disappeared since the peek (caller should treat as drained/skip).
 */
function buildDispatchPayload(
  tx: Tx,
  workItemId: string,
  session: string | undefined,
  args: NextArgs,
  lease: { id: string; expires_at: string } | null,
): any | null {
  const r = repos(tx);

  const runRow = tx.all<any>(
    "SELECT * FROM workflow_runs WHERE work_item_id=? AND status='running' LIMIT 1",
    workItemId,
  )[0];
  if (!runRow) return null;

  const mainPending = r.stepRuns.mainPending(runRow.id);
  if (!mainPending) return null;

  const defRow = r.defs.byId(runRow.workflow_definition_id);
  if (!defRow) return null;

  const def = JSON.parse(defRow.definition_json);
  const stepDef = stepById(def, mainPending.step_id);
  if (!stepDef) return null;

  // Required context: current artifacts for each required artifact type
  const requiredContext: ContextRef[] = [];
  for (const artType of stepDef.requires?.artifacts ?? []) {
    const art = r.artifacts.currentByTypeForWorkItem(workItemId, artType);
    if (art) {
      requiredContext.push({ id: art.id, version: art.version, type: art.type, title: art.title, one_line: art.title });
    }
  }

  const sessionForContract = session ?? '<session>';
  const contract = buildContract(stepDef, requiredContext, { workItem: workItemId, run: runRow.id, session: sessionForContract });

  return {
    status: 'dispatched',
    work_item: workItemId,
    run: runRow.id,
    step: { id: stepDef.id, type: stepDef.type },
    prompt_id: stepDef.prompt_id ?? null,
    allowed_action: contract.allowed_action,
    required_context: requiredContext,
    do_not: contract.do_not,
    when_done: contract.when_done,
    next_actions: contract.next_actions,
    lease,
    retry_after: null,
  };
}

const idle = (reason: string, retryAfter: number, session?: string): NextResult => ({
  status: 'idle', reason, data: { status: 'idle', reason, retry_after: retryAfter }, session,
});

/**
 * Number of concurrent dispatch slots the fleet allows. Read in a deferred tx
 * from the GLOBAL effective policy: when parallel_work_enabled is false the
 * fleet is forced to a single slot, otherwise max_parallel_agents (default 4).
 */
function effectiveSlotCount(ctx: Ctx): number {
  const pol = ctx.storage.transaction('deferred', (tx) => globalFleetPolicy(tx));
  return pol.parallel_work_enabled === false ? 1 : (pol.max_parallel_agents ?? 4);
}

export function next(ctx: Ctx, args: NextArgs): NextResult {
  // Resolve session outside any read/walk tx (start() uses its own immediate txn).
  let session: string | undefined;
  if (args.session === 'current' || (args.acquire && !args.session)) {
    session = resolveCurrent(ctx, args.agent);
  } else if (args.session) {
    session = args.session;
  }

  // PHASE 1 — peek + rank in a deferred (read) tx. No write lock held.
  const ranked = ctx.storage.transaction('deferred', (tx) => buildRankedCandidates(tx, args));

  if (ranked.kind === 'drained') {
    const { reason, counts } = ranked;
    // Acquire mode logs the drained event; peek (read tx) does not.
    if (args.acquire) {
      ctx.storage.transaction('immediate', (tx) => {
        tx.appendEvent({ actorId: args.agent, eventType: 'next.drained', entityType: 'agent', entityId: args.agent, payload: { reason, counts } });
      });
    }
    return { status: 'drained', reason, counts, data: { status: 'drained', reason, counts }, session };
  }

  if (ranked.kind === 'idle') {
    return idle(ranked.reason, ranked.retryAfter, session);
  }

  const { workItemIds } = ranked;

  // Peek mode — return a stale dispatch payload for the top candidate (no acquire).
  if (!args.acquire) {
    return ctx.storage.transaction('deferred', (tx) => {
      const data = buildDispatchPayload(tx, workItemIds[0], session, args, null);
      if (!data) {
        const { reason, counts } = buildDrainResult(tx);
        return { status: 'drained', reason, counts, data: { status: 'drained', reason, counts }, session };
      }
      return { status: 'dispatched', data, session, stale: true };
    });
  }

  // FLEET GOVERNOR (Spec B) — a runner must hold a `slot` resource lease to
  // dispatch. Only gate when acquiring AND PHASE 1 found dispatchable work (no
  // point taking a slot when drained/idle). If no slot is free, return idle
  // WITHOUT having acquired a work-item lease. A slot held here may be briefly
  // wasted if the work-item walk below finds everything taken — that is
  // acceptable (it expires / gets reused; the runner owns slot release).
  const secs = parseTtlSeconds(args.ttl ?? '30m');
  const slots = effectiveSlotCount(ctx);
  const slotOk = ctx.storage.transaction('immediate', (tx) => {
    const now = tx.now();
    // Reuse a slot this agent already holds (idempotent across repeated next calls).
    const mine = tx.get(
      "SELECT id FROM leases WHERE resource_type='slot' AND agent_id=? AND status='active' AND expires_at > ?",
      args.agent, now,
    );
    if (mine) return true;
    for (let i = 1; i <= slots; i++) {
      const key = `slot-${i}`;
      // Lazy-heal a stale holder of this slot.
      tx.run(
        "UPDATE leases SET status='expired' WHERE resource_type='slot' AND resource_key=? AND status='active' AND expires_at <= ?",
        key, now,
      );
      const taken = tx.get(
        "SELECT 1 FROM leases WHERE resource_type='slot' AND resource_key=? AND status='active' AND expires_at > ?",
        key, now,
      );
      if (taken) continue;
      try {
        const id = tx.allocateId('LEASE');
        repos(tx).agents.ensure(args.agent);
        tx.run(
          "INSERT INTO leases (id, resource_type, resource_key, work_item_id, agent_id, session_id, status, acquired_at, expires_at, heartbeat_at) VALUES (?, 'slot', ?, NULL, ?, NULL, 'active', ?, ?, ?)",
          id, key, args.agent, now, addSeconds(now, secs), now,
        );
        tx.appendEvent({ actorId: args.agent, eventType: 'lease.acquired', entityType: 'lease', entityId: id, payload: { slot: key } });
        return true;
      } catch (e: any) {
        if (isUnique(e)) continue; // another runner grabbed this slot since the check
        throw e;
      }
    }
    return false;
  });
  if (!slotOk) return idle('all_leased', jitter(args.agent), session);

  // PHASE 2 — acquire-walk. Each acquire attempt is its own short IMMEDIATE tx.
  // Walk the ranked list until one INSERT succeeds; advance past items taken
  // since the peek (UNIQUE), and bail to idle on a busy database.

  for (const workItemId of workItemIds) {
    try {
      const result = ctx.storage.transaction('immediate', (tx): NextResult | 'taken' => {
        const r = repos(tx);
        const now = tx.now();

        // Lazy-heal stale active leases on THIS work item only (never the caller's own).
        tx.run(
          "UPDATE leases SET status='expired' WHERE resource_type='work_item' AND resource_key=? AND status='active' AND expires_at <= ? AND agent_id != ?",
          workItemId, now, args.agent,
        );

        r.agents.ensure(args.agent);
        const leaseId = tx.allocateId('LEASE');
        // Only use session_id if it refers to a real session row (FK constraint).
        const sessionIdForLease = session
          ? (tx.get<{ id: string }>('SELECT id FROM sessions WHERE id=?', session) ? session : null)
          : null;

        try {
          tx.run(
            "INSERT INTO leases (id, resource_type, resource_key, work_item_id, agent_id, session_id, status, acquired_at, expires_at, heartbeat_at) VALUES (?, 'work_item', ?, ?, ?, ?, 'active', ?, ?, ?)",
            leaseId, workItemId, workItemId, args.agent, sessionIdForLease, now, addSeconds(now, secs), now,
          );
        } catch (e: any) {
          if (isUnique(e)) return 'taken'; // lost the race since peek — try next candidate
          throw e;
        }

        tx.appendEvent({ actorId: args.agent, eventType: 'lease.acquired', entityType: 'lease', entityId: leaseId, payload: { work_item: workItemId } });
        const leaseRow = tx.get<any>('SELECT * FROM leases WHERE id=?', leaseId);
        const lease = { id: leaseRow.id, expires_at: leaseRow.expires_at };

        const data = buildDispatchPayload(tx, workItemId, session, args, lease);
        if (!data) return 'taken'; // run/step vanished since peek — skip
        return { status: 'dispatched', data, session, stale: false };
      });

      if (result !== 'taken') return result;
      // 'taken' — advance to next candidate
    } catch (e: any) {
      if (isBusy(e)) return idle('all_leased', jitter(args.agent), session);
      throw e;
    }
  }

  // Walked the whole ranked list; every candidate was taken.
  return idle('all_leased', jitter(args.agent), session);
}
