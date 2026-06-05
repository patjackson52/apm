import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import {
  parseWorkflow, validateWorkflow, firstStep, layoutSteps, edgesOf, type WorkflowDef,
} from '../domain/workflow.js';
import { enterStep } from '../domain/advance.js';
import { effectivePolicy } from '../domain/policy.js';
import { toRunView, type RunView, type WorkflowDefView } from '../domain/entities.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Lean summary used by `list` (no steps/edges — keeps list payloads small). */
function defToView(row: any) {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    status: row.status,
    created_at: row.created_at,
  };
}

/** Full view used by `show` — includes laid-out steps + derived edges for the graph. */
function defToFullView(row: any): WorkflowDefView {
  const def: WorkflowDef = JSON.parse(row.definition_json);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    status: row.status,
    created_at: row.created_at,
    applies_to: def.applies_to,
    steps: layoutSteps(def),
    edges: edgesOf(def),
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
    return defToFullView(row);
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
    // Every referenced prompt_id must resolve to a stored prompt, else `apm next`
    // would dispatch a contract pointing at a phantom prompt. Fail fast, loud.
    for (const s of def.steps) {
      if (s.prompt_id && !r.prompts.byName(s.prompt_id)) {
        throw new ApmError('E_VALIDATION', `step ${s.id}: prompt '${s.prompt_id}' not found (create it with 'apm prompt create' first)`);
      }
    }
    const id = r.defs.register({ name: def.name, version: def.version, definitionJson: JSON.stringify(def) });
    return defToView(r.defs.byId(id)!);
  });
}

// ─── run operations ────────────────────────────────────────────────────────────

export const DEFAULT_WORKFLOW = 'feature_delivery';

export interface ActivateArgs { ids: string[]; workflow?: string; agent: string; }
export type ActivateStatus = 'activated' | 'already_active' | 'skipped';
export interface ActivateItem { id: string; status: ActivateStatus; run?: string; reason?: string; }
export interface ActivateResult { items: ActivateItem[]; }

/** Batch-activate work items: attach the (default) workflow + promote draft→ready so the
 *  scheduler can dispatch them. Idempotent; skips unknown/terminal items with a reason.
 *  Rec #6 — one ergonomic step instead of per-item `work update` + `workflow attach`. */
export function activate(ctx: Ctx, a: ActivateArgs): ActivateResult {
  const workflow = a.workflow ?? DEFAULT_WORKFLOW;
  const items: ActivateItem[] = [];
  for (const id of a.ids) {
    // read current state in a short deferred tx, then attach in attachRun's own immediate tx
    const state = ctx.storage.transaction('deferred', (tx) => {
      const r = repos(tx);
      const wi = r.workItems.byId(id);
      if (!wi) return { kind: 'not_found' as const };
      if (wi.status === 'completed' || wi.status === 'cancelled') return { kind: 'terminal' as const };
      const existing = r.runs.activeForWorkItem(id);
      return existing ? { kind: 'active' as const, run: existing.id } : { kind: 'eligible' as const };
    });
    if (state.kind === 'not_found') { items.push({ id, status: 'skipped', reason: 'not_found' }); continue; }
    if (state.kind === 'terminal') { items.push({ id, status: 'skipped', reason: 'terminal' }); continue; }
    if (state.kind === 'active') { items.push({ id, status: 'already_active', run: state.run }); continue; }
    const run = attachRun(ctx, { workItem: id, workflow, agent: a.agent });
    items.push({ id, status: 'activated', run: run.id });
  }
  return { items };
}

export interface CascadeResult { activated: string[]; }

/** Rec #4 (flag-gated, default OFF). When `completedWorkItemId` completes, auto-activate any
 *  DRAFT work item that depends on it once ALL of that dependent's deps are complete — but only
 *  if the completed item's effective policy has `auto_activate_dependents: true` (set it at the
 *  global or milestone-subtree scope to let the loop self-advance milestones with no human gate).
 *  Runs in its own transactions AFTER the completing tx commits (attachRun can't nest). */
export function cascadeActivateDependents(ctx: Ctx, completedWorkItemId: string, agent: string): CascadeResult {
  const eligible = ctx.storage.transaction('deferred', (tx) => {
    const pol = effectivePolicy(tx, completedWorkItemId);
    if (pol.auto_activate_dependents !== true) return [] as string[];
    const r = repos(tx);
    const out: string[] = [];
    for (const depId of r.links.dependents(completedWorkItemId)) {
      const wi = r.workItems.byId(depId);
      if (!wi || wi.status !== 'draft') continue;          // only fresh, un-started work
      if (r.runs.activeForWorkItem(depId)) continue;       // already running
      const allDepsDone = r.links.dependsOn(depId).every((t) => r.workItems.byId(t)?.status === 'completed');
      if (allDepsDone) out.push(depId);
    }
    return out;
  });
  if (eligible.length === 0) return { activated: [] };
  const res = activate(ctx, { ids: eligible, agent });
  return { activated: res.items.filter((i) => i.status === 'activated').map((i) => i.id) };
}

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

    // Promote draft work item to ready so it is dispatchable
    const freshWi = r.workItems.byId(a.workItem)!;
    if (freshWi.status === 'draft') {
      r.workItems.setStatus(a.workItem, 'ready', a.agent);
    }

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
