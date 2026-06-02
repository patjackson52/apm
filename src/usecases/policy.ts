import { readFileSync } from 'node:fs';
import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { effectivePolicy } from '../domain/policy.js';

export interface PolicyView {
  id: string; scope_type: string; scope_id: string | null;
  policy: unknown; created_at: string;
}

function toView(row: any): PolicyView {
  return {
    id: row.id,
    scope_type: row.scope_type,
    scope_id: row.scope_id ?? null,
    policy: JSON.parse(row.policy_json),
    created_at: row.created_at,
  };
}

export interface CreatePolicyArgs {
  scopeType: string;
  scopeId?: string | null;
  policyFile?: string | null;
  policyJson?: string | null;
}

export function create(ctx: Ctx, a: CreatePolicyArgs): PolicyView {
  let policyJson: string;
  if (a.policyFile) {
    policyJson = readFileSync(a.policyFile, 'utf8');
    // Validate it's parseable
    JSON.parse(policyJson);
  } else if (a.policyJson) {
    JSON.parse(a.policyJson); // validate
    policyJson = a.policyJson;
  } else {
    throw new ApmError('E_VALIDATION', 'policy-file or policy-json is required');
  }

  return ctx.storage.transaction('immediate', (tx) => {
    const id = tx.allocateId('POL');
    tx.run(
      'INSERT INTO policies (id, scope_type, scope_id, policy_json, created_at) VALUES (?, ?, ?, ?, ?)',
      id, a.scopeType, a.scopeId ?? null, policyJson, tx.now(),
    );
    tx.appendEvent({
      eventType: 'policy.created', entityType: 'policy', entityId: id,
      payload: { scopeType: a.scopeType, scopeId: a.scopeId ?? null },
    });
    return toView(tx.get<any>('SELECT * FROM policies WHERE id=?', id)!);
  });
}

export function list(ctx: Ctx): PolicyView[] {
  return ctx.storage.transaction('deferred', (tx) => {
    const rows = tx.all<any>('SELECT * FROM policies ORDER BY id');
    return rows.map(toView);
  });
}

export interface ShowPolicyArgs {
  workItem?: string | null;
}

export function show(ctx: Ctx, a: ShowPolicyArgs = {}): unknown {
  return ctx.storage.transaction('deferred', (tx) => {
    if (a.workItem) {
      // Return effective merged policy for the work item
      return effectivePolicy(tx, a.workItem);
    }
    // Return all policy rows
    const rows = tx.all<any>('SELECT * FROM policies ORDER BY id');
    return rows.map(toView);
  });
}
