import type { Ctx } from '../cli/run.js';
import { toLeaseView, toRunView, toBlockerView, type LeaseView, type RunView, type BlockerView } from '../domain/entities.js';
import { repos } from '../storage/repos.js';

export interface AwaitsHuman { id: string; reason: string; }

export interface StatusResult {
  work: { by_status: Record<string, number> };
  ready_count: number;
  active_leases: LeaseView[];
  open_blockers: BlockerView[];
  awaiting_human: AwaitsHuman[];
  active_runs: RunView[];
}

export function status(ctx: Ctx): StatusResult {
  return ctx.storage.transaction('deferred', (tx) => {
    const now = tx.now();
    const r = repos(tx);

    // work items by_status
    const statusRows = tx.all<{ status: string; cnt: number }>(
      'SELECT status, count(*) cnt FROM work_items GROUP BY status',
    );
    const by_status: Record<string, number> = {};
    for (const row of statusRows) {
      by_status[row.status] = row.cnt;
    }
    // also compute 'active' = live leases (each unique work_item that is leased)
    const activeLeasedCount = (tx.get<{ cnt: number }>(
      "SELECT count(DISTINCT work_item_id) cnt FROM leases WHERE status='active' AND expires_at > ?",
      now,
    ) as { cnt: number }).cnt;
    if (activeLeasedCount > 0) {
      by_status['active'] = activeLeasedCount;
    }

    const ready_count = by_status['ready'] ?? 0;

    // active leases
    const leaseRows = tx.all<any>(
      "SELECT * FROM leases WHERE status='active' AND expires_at > ? ORDER BY id",
      now,
    );
    const active_leases = leaseRows.map(toLeaseView);

    // open blockers
    const blockerRows = tx.all<any>("SELECT * FROM blockers WHERE status='open' ORDER BY id");
    const open_blockers = blockerRows.map(toBlockerView);

    // awaiting_human: open human_gate blockers
    const awaiting_human: AwaitsHuman[] = blockerRows
      .filter((b: any) => b.blocker_type === 'human_gate')
      .map((b: any) => ({ id: b.id, reason: b.reason }));

    // active (running) workflow runs
    const runRows = tx.all<any>("SELECT * FROM workflow_runs WHERE status='running' ORDER BY id");
    const active_runs: RunView[] = runRows.map((row: any) => {
      const defRow = r.defs.byId(row.workflow_definition_id);
      return toRunView(row, defRow?.name ?? row.workflow_definition_id);
    });

    return { work: { by_status }, ready_count, active_leases, open_blockers, awaiting_human, active_runs };
  });
}
