/**
 * Effective policy resolution:
 * workflow-def policy < global policy < work-item policy
 * (work_item overrides global overrides def)
 */
import type { Tx } from '../storage/storage.js';
import { repos } from '../storage/repos.js';

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
