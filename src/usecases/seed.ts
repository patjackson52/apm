import type { Storage } from '../storage/storage.js';
import { validateWorkflow } from '../domain/workflow.js';
import { repos } from '../storage/repos.js';
import { FEATURE_DELIVERY, DEFAULT_POLICY } from '../workflows/feature_delivery.js';
import { BUILTIN_PROMPTS } from '../workflows/prompts.js';

/** Seed built-in prompts + workflow + default global policy. Idempotent. Runs inside its own immediate txn. */
export function seedBuiltins(storage: Storage): void {
  validateWorkflow(FEATURE_DELIVERY);
  storage.transaction('immediate', (tx) => {
    // Prompts first: the workflow's agent_prompt steps reference these by name.
    const r = repos(tx);
    for (const p of BUILTIN_PROMPTS) {
      if (!r.prompts.byName(p.name)) r.prompts.insert(p.name, p.body);
    }

    const exists = tx.get("SELECT id FROM workflow_definitions WHERE name=? AND version=?", FEATURE_DELIVERY.id, FEATURE_DELIVERY.version);
    if (!exists) {
      const id = tx.allocateId('WD');
      tx.run("INSERT INTO workflow_definitions (id, name, version, definition_json, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)",
        id, FEATURE_DELIVERY.id, FEATURE_DELIVERY.version, JSON.stringify(FEATURE_DELIVERY), tx.now());
      tx.appendEvent({ eventType: 'workflow.registered', entityType: 'workflow_definition', entityId: id, payload: { name: FEATURE_DELIVERY.id } });
    }
    const pol = tx.get("SELECT id FROM policies WHERE scope_type='global'");
    if (!pol) {
      const id = tx.allocateId('POL');
      tx.run("INSERT INTO policies (id, scope_type, scope_id, policy_json, created_at) VALUES (?, 'global', NULL, ?, ?)", id, JSON.stringify(DEFAULT_POLICY), tx.now());
    }
  });
}
