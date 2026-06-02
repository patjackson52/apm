import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { parseWorkflow, validateWorkflow, firstStep, type WorkflowDef } from '../domain/workflow.js';
import { enterStep } from '../domain/advance.js';
import { toRunView, type RunView } from '../domain/entities.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function defToView(row: any) {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    status: row.status,
    created_at: row.created_at,
  };
}

function runToView(tx: any, runRow: any): RunView {
  const defRow = repos(tx).defs.byId(runRow.workflow_definition_id);
  return toRunView(runRow, defRow?.name ?? runRow.workflow_definition_id);
}

// ─── workflow CRUD ─────────────────────────────────────────────────────────────

export function list(ctx: Ctx) {
  return ctx.storage.transaction('deferred', (tx) => repos(tx).defs.list().map(defToView));
}

export function show(ctx: Ctx, nameOrId: string) {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    const row = r.defs.byId(nameOrId) ?? r.defs.active(nameOrId);
    if (!row) throw new ApmError('E_NOT_FOUND', `workflow ${nameOrId} not found`);
    return defToView(row);
  });
}

/** Register an immutable workflow definition. Duplicate name+version → E_CONFLICT. */
export function register(ctx: Ctx, defObjOrYaml: string | object) {
  const def: WorkflowDef = typeof defObjOrYaml === 'string'
    ? parseWorkflow(defObjOrYaml)
    : (defObjOrYaml as WorkflowDef);
  validateWorkflow(def);
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    const existing = r.defs.byNameVersion(def.name, def.version);
    if (existing) throw new ApmError('E_CONFLICT', `workflow ${def.name}@${def.version} already registered`);
    const id = r.defs.register({ name: def.name, version: def.version, definitionJson: JSON.stringify(def) });
    return defToView(r.defs.byId(id)!);
  });
}

// ─── run operations ────────────────────────────────────────────────────────────

export interface AttachRunArgs { workItem: string; workflow: string; agent: string; }

export function attachRun(ctx: Ctx, a: AttachRunArgs): RunView {
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(a.agent);
    const wi = r.workItems.byId(a.workItem);
    if (!wi) throw new ApmError('E_NOT_FOUND', `work item ${a.workItem} not found`);

    // Check for existing active run
    const existing = r.runs.activeForWorkItem(a.workItem);
    if (existing) throw new ApmError('E_PRECONDITION', 'work item already has an active run');

    const defRow = r.defs.active(a.workflow);
    if (!defRow) throw new ApmError('E_NOT_FOUND', `workflow ${a.workflow} not found`);

    const def: WorkflowDef = JSON.parse(defRow.definition_json);
    validateWorkflow(def);

    const runId = r.runs.insert(a.workItem, defRow.id);

    // Enter the first step (sets current_step_id via enterStep)
    const firstStepDef = firstStep(def);
    enterStep(tx, runId, def, firstStepDef, a.agent);

    const runRow = r.runs.byId(runId)!;
    return toRunView(runRow, defRow.name);
  });
}

export function runsForWorkItem(ctx: Ctx, workItem: string) {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    if (!r.workItems.byId(workItem)) throw new ApmError('E_NOT_FOUND', `work item ${workItem} not found`);
    return r.runs.listForWorkItem(workItem).map((row: any) => runToView(tx, row));
  });
}

export function cancelRun(ctx: Ctx, runId: string): RunView {
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    const runRow = r.runs.byId(runId);
    if (!runRow) throw new ApmError('E_NOT_FOUND', `run ${runId} not found`);
    if (['completed', 'cancelled'].includes(runRow.status)) {
      throw new ApmError('E_PRECONDITION', `run is already ${runRow.status}`);
    }
    // Cancel non-terminal step_runs (schema uses 'skipped' for abandoned steps)
    tx.run(
      "UPDATE workflow_step_runs SET status='skipped' WHERE workflow_run_id=? AND status NOT IN ('completed','failed','skipped')",
      runId,
    );
    r.runs.setStatus(runId, 'cancelled', tx.now());
    tx.appendEvent({
      eventType: 'workflow_run.cancelled', entityType: 'workflow_run', entityId: runId, payload: {},
    });
    const defRow = r.defs.byId(runRow.workflow_definition_id);
    return toRunView(r.runs.byId(runId)!, defRow?.name ?? runRow.workflow_definition_id);
  });
}
