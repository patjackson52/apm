import Database from 'better-sqlite3';
import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { selectCandidate, type Candidate, type Caller } from '../domain/resolver.js';
import { buildContract, type ContextRef } from '../domain/contract.js';
import { parseWorkflow, stepById } from '../domain/workflow.js';
import { resolveCurrent } from './session.js';
import { parseTtlSeconds } from './lease.js';

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

export function next(ctx: Ctx, args: NextArgs): NextResult {
  // Resolve session outside transaction (start() uses its own immediate txn)
  let session: string | undefined;
  if (args.session === 'current' || (args.acquire && !args.session)) {
    session = resolveCurrent(ctx, args.agent);
  } else if (args.session) {
    session = args.session;
  }

  const txMode = args.acquire ? 'immediate' : 'deferred';

  return ctx.storage.transaction(txMode, (tx) => {
    const r = repos(tx);
    const now = tx.now();

    // Drain diagnostics: snapshot the backlog + classify why the queue is empty.
    // Only logs an event when acquiring (immediate tx); peeks run in a deferred/read tx.
    const buildDrained = (): NextResult => {
      const byStatus = tx.all<{ status: string; c: number }>('SELECT status, COUNT(*) c FROM work_items GROUP BY status');
      const at = (s: string) => byStatus.find((row) => row.status === s)?.c ?? 0;
      const running_runs = tx.get<{ c: number }>("SELECT COUNT(*) c FROM workflow_runs WHERE status='running'")?.c ?? 0;
      const counts: DrainCounts = {
        draft: at('draft'), ready: at('ready'), active: at('active'), blocked: at('blocked'),
        completed: at('completed'), cancelled: at('cancelled'), running_runs,
      };
      const reason: DrainReason = (counts.draft + counts.ready + counts.active + counts.blocked) > 0 ? 'backlog' : 'complete';
      if (args.acquire) {
        tx.appendEvent({ actorId: args.agent, eventType: 'next.drained', entityType: 'agent', entityId: args.agent, payload: { reason, counts } });
      }
      return { status: 'drained', reason, counts, data: { status: 'drained', reason, counts }, session };
    };

    // (a) acquire only: lazy-heal stale active leases (never the caller's own)
    if (args.acquire) {
      tx.run(
        "UPDATE leases SET status='expired' WHERE status='active' AND expires_at <= ? AND agent_id != ?",
        now, args.agent,
      );
    }

    // (b) Build candidates: work items with a running workflow run
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
      let stepType: string | null = null;

      if (mainPending && !blockedByHumanGate) {
        stepType = mainPending.step_type ?? null;

        // Determine step type from def if not stored
        const runRow = r.runs.byId(runId);
        const defRow = runRow ? r.defs.byId(runRow.workflow_definition_id) : null;
        if (defRow) {
          const def = JSON.parse(defRow.definition_json);
          const stepDef = def.steps?.find((s: any) => s.id === mainPending.step_id);
          if (stepDef) {
            stepType = stepDef.type;
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
    const res = selectCandidate(candidates, caller, now);

    if (res.status === 'drained') {
      return buildDrained();
    }

    if (res.status === 'idle') {
      return {
        status: 'idle',
        reason: res.reason,
        data: { status: 'idle', reason: res.reason, retry_after: res.retryAfter },
        session,
      };
    }

    // dispatched — build full payload
    const workItemId = res.workItemId;
    const runRow = tx.all<any>(
      "SELECT * FROM workflow_runs WHERE work_item_id=? AND status='running' LIMIT 1",
      workItemId,
    )[0];
    if (!runRow) {
      // Should not happen — candidate was just built from running runs
      return buildDrained();
    }

    const mainPending = r.stepRuns.mainPending(runRow.id);
    if (!mainPending) {
      return buildDrained();
    }

    const defRow = r.defs.byId(runRow.workflow_definition_id);
    if (!defRow) {
      return buildDrained();
    }

    const def = JSON.parse(defRow.definition_json);
    const stepDef = stepById(def, mainPending.step_id);
    if (!stepDef) {
      return buildDrained();
    }

    // Required context: current artifacts for each required artifact type
    const requiredContext: ContextRef[] = [];
    for (const artType of stepDef.requires?.artifacts ?? []) {
      const art = r.artifacts.currentByTypeForWorkItem(workItemId, artType);
      if (art) {
        requiredContext.push({ id: art.id, version: art.version, type: art.type, title: art.title, one_line: art.title });
      }
    }

    const requiredCaptures = stepDef.requires?.captures ?? [];

    const sessionForContract = session ?? '<session>';
    const contract = buildContract(stepDef, requiredContext, { workItem: workItemId, run: runRow.id, session: sessionForContract });

    let lease: { id: string; expires_at: string } | null = null;

    if (args.acquire) {
      // Inline lease insert inside this same immediate txn for atomicity
      const secs = parseTtlSeconds(args.ttl ?? '30m');
      r.agents.ensure(args.agent);
      const leaseId = tx.allocateId('LEASE');
      // Only use session_id if it refers to a real session row (FK constraint)
      const sessionIdForLease = session
        ? (tx.get<{ id: string }>('SELECT id FROM sessions WHERE id=?', session) ? session : null)
        : null;
      try {
        tx.run(
          "INSERT INTO leases (id, work_item_id, agent_id, session_id, status, acquired_at, expires_at, heartbeat_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)",
          leaseId, workItemId, args.agent, sessionIdForLease, now, addSeconds(now, secs), now,
        );
      } catch (e: any) {
        if (
          (e instanceof Database.SqliteError && /UNIQUE/i.test(e.message)) ||
          e.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
          /UNIQUE/i.test(String(e.message))
        ) {
          // Lost race — return idle/all_leased
          return {
            status: 'idle',
            reason: 'all_leased',
            data: { status: 'idle', reason: 'all_leased', retry_after: 30 },
            session,
          };
        }
        throw e;
      }
      tx.appendEvent({ actorId: args.agent, eventType: 'lease.acquired', entityType: 'lease', entityId: leaseId, payload: { work_item: workItemId } });
      const leaseRow = tx.get<any>('SELECT * FROM leases WHERE id=?', leaseId);
      lease = { id: leaseRow.id, expires_at: leaseRow.expires_at };
    }

    const data: any = {
      status: 'dispatched',
      work_item: workItemId,
      run: runRow.id,
      step: { id: stepDef.id, type: stepDef.type },
      prompt_id: stepDef.prompt_id ?? null,
      allowed_action: contract.allowed_action,
      required_context: requiredContext,
      required_captures: requiredCaptures,
      do_not: contract.do_not,
      when_done: contract.when_done,
      next_actions: contract.next_actions,
      lease,
      retry_after: null,
    };

    const stale = !args.acquire;

    return { status: 'dispatched', data, session, stale };
  });
}
