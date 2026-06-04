import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { reopenReviewer } from '../domain/advance.js';
import { toBlockerView, toImageView, type BlockerView, type ImageView } from '../domain/entities.js';

export interface CreateBlockerArgs {
  workItem: string;
  type: string;
  reason: string;
  agent: string;
}

export function create(ctx: Ctx, a: CreateBlockerArgs): BlockerView {
  if (a.type === 'human_gate') {
    throw new ApmError('E_VALIDATION', "use gate.answer to create human_gate blockers — they need question/options");
  }
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(a.agent);

    if (!r.workItems.byId(a.workItem)) {
      throw new ApmError('E_NOT_FOUND', `work item ${a.workItem} not found`);
    }

    const id = r.blockers.insert({
      workItemId: a.workItem,
      type: a.type,
      reason: a.reason,
    });
    r.workItems.setStatus(a.workItem, 'blocked', a.agent);

    return toBlockerView(r.blockers.byId(id)!);
  });
}

export interface ResolveBlockerArgs {
  resolution?: string | null;
  agent: string;
}

export function resolve(ctx: Ctx, blockerId: string, a: ResolveBlockerArgs): BlockerView {
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(a.agent);

    const blocker = r.blockers.byId(blockerId);
    if (!blocker) throw new ApmError('E_NOT_FOUND', `blocker ${blockerId} not found`);
    if (blocker.status !== 'open') {
      throw new ApmError('E_PRECONDITION', `blocker ${blockerId} is not open (status: ${blocker.status})`);
    }

    r.blockers.resolve(blockerId, { resolution: a.resolution ?? null, answeredBy: a.agent });

    // If this was a review_disagreement blocker, reopen the non-passing reviewer children
    if (blocker.blocker_type === 'review_disagreement') {
      // Find the active run for this work item
      const run = r.runs.activeForWorkItem(blocker.work_item_id);
      if (run) {
        // Find the main step run for the review gate
        const mainStep = tx.get<{ id: string; step_id: string }>(
          "SELECT id, step_id FROM workflow_step_runs WHERE workflow_run_id=? AND parent_step_run_id IS NULL AND status IN ('pending','running') LIMIT 1",
          run.id,
        );
        if (mainStep) {
          // Extract roles from reason: supports both
          //   "Review not passed by roles: arch, security"  (new format)
          //   "Review rejected by role: arch"               (legacy format)
          const rolesMatch = blocker.reason?.match(/Review not passed by roles: (.+)/);
          const legacyMatch = !rolesMatch && blocker.reason?.match(/Review rejected by role: (.+)/);
          const rolesStr = rolesMatch?.[1] ?? legacyMatch?.[1] ?? '';
          const roles = rolesStr.split(',').map((r: string) => r.trim()).filter(Boolean);
          for (const role of roles) {
            reopenReviewer(tx, mainStep.id, role);
          }
        }
      }
    }

    // Check if this was the only open blocker — if so, unblock the work item
    const remaining = r.blockers.listOpen({ workItemId: blocker.work_item_id });
    if (remaining.length === 0) {
      r.workItems.setStatus(blocker.work_item_id, 'ready', a.agent);
    }

    return toBlockerView(r.blockers.byId(blockerId)!);
  });
}

export function list(ctx: Ctx, workItem?: string | null): BlockerView[] {
  return ctx.storage.transaction('deferred', (tx) => {
    const rows = repos(tx).blockers.listOpen({ workItemId: workItem ?? undefined });
    return rows.map(toBlockerView);
  });
}

export function show(ctx: Ctx, id: string): BlockerView & { images: ImageView[] } {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    const row = r.blockers.byId(id);
    if (!row) throw new ApmError('E_NOT_FOUND', `blocker ${id} not found`);
    const images = r.artifacts.imagesByBlocker(id).map((ir: any) => toImageView(ir, row.work_item_id));
    return { ...toBlockerView(row), images };
  });
}
