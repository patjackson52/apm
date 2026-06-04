/**
 * Effective policy resolution:
 * workflow-def policy < global policy < work-item policy
 * (work_item overrides global overrides def)
 */
import type { Tx } from '../storage/storage.js';
import { repos } from '../storage/repos.js';

/**
 * Code-level defaults for fleet/parallelism knobs. These are applied on read
 * (not baked into the seeded global policy row) so a project initialised before
 * these fields existed still gets correct behaviour.
 *
 *  - parallel_work_enabled (default true): master switch. When false, the fleet
 *    is forced to a single concurrent dispatch regardless of max_parallel_agents.
 *  - max_parallel_agents (default 4): number of dispatch slots when parallel
 *    work is enabled.
 */
export const POLICY_DEFAULTS = {
  parallel_work_enabled: true,
  max_parallel_agents: 4,
} as const;

/** The subset of policy fields this module exposes with typed defaults applied. */
export interface FleetPolicy {
  parallel_work_enabled: boolean;
  max_parallel_agents: number;
}

/** Merge ALL global policy rows (later id wins) into a single object. */
export function globalPolicy(tx: Tx): Record<string, unknown> {
  const rows = tx.all<{ policy_json: string }>(
    "SELECT policy_json FROM policies WHERE scope_type='global' ORDER BY id",
  );
  let merged: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      merged = { ...merged, ...(JSON.parse(row.policy_json) as Record<string, unknown>) };
    } catch {
      // ignore malformed rows
    }
  }
  return merged;
}

/** Read the global fleet policy with code-level defaults applied. */
export function globalFleetPolicy(tx: Tx): FleetPolicy {
  const g = globalPolicy(tx);
  return {
    parallel_work_enabled:
      typeof g.parallel_work_enabled === 'boolean'
        ? g.parallel_work_enabled
        : POLICY_DEFAULTS.parallel_work_enabled,
    max_parallel_agents:
      typeof g.max_parallel_agents === 'number' && g.max_parallel_agents > 0
        ? g.max_parallel_agents
        : POLICY_DEFAULTS.max_parallel_agents,
  };
}

export function effectivePolicy(tx: Tx, workItemId: string): Record<string, unknown> {
  const r = repos(tx);

  // 1. workflow-def policy: find active run → parse definition_json → policies block (may not exist)
  const activeRun = r.runs.activeForWorkItem(workItemId);
  let defPolicy: Record<string, unknown> = {};
  if (activeRun) {
    const defRow = r.defs.byId(activeRun.workflow_definition_id);
    if (defRow) {
      const def = JSON.parse(defRow.definition_json);
      if (def.policies && typeof def.policies === 'object') {
        defPolicy = def.policies as Record<string, unknown>;
      }
    }
  }

  // 2. global policy
  const globalRow = r.policies.global();
  const globalPolicy: Record<string, unknown> = globalRow
    ? JSON.parse(globalRow.policy_json)
    : {};

  // 3. work-item policy
  const wiRow = r.policies.forWorkItem(workItemId);
  const wiPolicy: Record<string, unknown> = wiRow
    ? JSON.parse(wiRow.policy_json)
    : {};

  // Deep merge: def < global < work_item (shallow merge per top-level key is sufficient for V1)
  return { ...defPolicy, ...globalPolicy, ...wiPolicy };
}
