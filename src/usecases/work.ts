import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { WORK_ITEM_TYPES, WORK_ITEM_STATUSES, ESTIMATES, type WorkItemType, type Estimate } from '../domain/types.js';
import { toWorkItemView, toBlockerView, type WorkItemView, type BlockerView, type Page } from '../domain/entities.js';

export interface CreateArgs { type: WorkItemType; title: string; description?: string; priority?: number; estimate?: Estimate; parent?: string; agent: string; }

/** Build the canonical view for a work-item id inside an existing tx. */
function view(tx: any, id: string): WorkItemView {
  const r = repos(tx);
  const row = r.workItems.byId(id);
  if (!row) throw new ApmError('E_NOT_FOUND', `${id} not found`);
  const lease = tx.get("SELECT id FROM leases WHERE work_item_id=? AND status='active' AND expires_at > ?", id, tx.now()) as { id: string } | undefined;
  const activeRun = r.runs.activeForWorkItem(id);
  const artifactIds = r.artifacts.linkedRoots(id).map((root: string) => r.artifacts.currentByRoot(root)?.id).filter(Boolean) as string[];
  const blockerIds = r.blockers.openForWorkItem(id).map((b: any) => b.id as string);
  return toWorkItemView(row, {
    dependsOn: r.links.dependsOn(id),
    blockerIds,
    artifactIds,
    activeRun: activeRun?.id ?? null,
    lease: lease?.id ?? null,
  });
}

export function create(ctx: Ctx, a: CreateArgs): WorkItemView {
  if (!WORK_ITEM_TYPES.includes(a.type)) throw new ApmError('E_VALIDATION', 'invalid type', [{ field: 'type', problem: `must be one of ${WORK_ITEM_TYPES.join('|')}`, got: a.type }]);
  if (a.estimate && !ESTIMATES.includes(a.estimate)) throw new ApmError('E_VALIDATION', 'invalid estimate', [{ field: 'estimate', problem: `must be one of ${ESTIMATES.join('|')}`, got: a.estimate }]);
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(a.agent);
    if (a.parent && !r.workItems.byId(a.parent)) throw new ApmError('E_NOT_FOUND', `parent ${a.parent} not found`);
    const id = r.workItems.insert({ type: a.type, title: a.title, description: a.description ?? null, priority: a.priority ?? 0, estimate: a.estimate ?? null, parentId: a.parent ?? null, createdBy: a.agent });
    return view(tx, id);
  });
}

export function show(ctx: Ctx, id: string): WorkItemView {
  return ctx.storage.transaction('deferred', (tx) => view(tx, id));
}

export interface ListArgs { limit?: number; offset?: number; status?: string; type?: string; }
export function list(ctx: Ctx, a: ListArgs = {}): Page<WorkItemView> {
  if (a.status && !(WORK_ITEM_STATUSES as readonly string[]).includes(a.status)) throw new ApmError('E_VALIDATION', `invalid status filter: must be one of ${WORK_ITEM_STATUSES.join('|')} (active is computed from leases — use \`lease list\`)`, [{ field: 'status', problem: `must be one of ${WORK_ITEM_STATUSES.join('|')} (active is computed from leases — use \`lease list\`)`, got: a.status }]);
  if (a.type && !(WORK_ITEM_TYPES as readonly string[]).includes(a.type)) throw new ApmError('E_VALIDATION', 'invalid type filter', [{ field: 'type', problem: `must be one of ${WORK_ITEM_TYPES.join('|')}`, got: a.type }]);
  const limit = a.limit ?? 20; const offset = a.offset ?? 0;
  return ctx.storage.transaction('deferred', (tx) => {
    const where: string[] = []; const params: unknown[] = [];
    if (a.status) { where.push('status=?'); params.push(a.status); }
    if (a.type) { where.push('type=?'); params.push(a.type); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (tx.get(`SELECT count(*) c FROM work_items ${clause}`, ...params) as { c: number }).c;
    const rows = tx.all(`SELECT id FROM work_items ${clause} ORDER BY priority DESC, id LIMIT ? OFFSET ?`, ...params, limit, offset) as { id: string }[];
    return { items: rows.map((r) => view(tx, r.id)), page: { total, limit, offset, has_more: offset + rows.length < total } };
  });
}

export function children(ctx: Ctx, id: string): Page<WorkItemView> {
  return ctx.storage.transaction('deferred', (tx) => {
    const rows = repos(tx).workItems.children(id);
    return { items: rows.map((row: any) => view(tx, row.id)), page: { total: rows.length, limit: rows.length, offset: 0, has_more: false } };
  });
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['ready', 'cancelled'],
  ready: ['blocked', 'cancelled', 'completed'],
  blocked: ['ready', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function update(ctx: Ctx, id: string, fields: { title?: string; description?: string; priority?: number; estimate?: Estimate; status?: string }, agent: string): WorkItemView {
  if (fields.estimate && !ESTIMATES.includes(fields.estimate)) throw new ApmError('E_VALIDATION', 'invalid estimate', [{ field: 'estimate', problem: `must be one of ${ESTIMATES.join('|')}`, got: fields.estimate }]);
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    const row = r.workItems.byId(id);
    if (!row) throw new ApmError('E_NOT_FOUND', `${id} not found`);
    if (fields.status && fields.status !== row.status) {
      if (!(ALLOWED_TRANSITIONS[row.status] ?? []).includes(fields.status)) throw new ApmError('E_PRECONDITION', `invalid transition ${row.status} -> ${fields.status}`);
      if (fields.status === 'completed') {
        const open = tx.get("SELECT count(*) c FROM work_items WHERE parent_id=? AND status NOT IN ('completed','cancelled')", id) as { c: number };
        if (open.c > 0) throw new ApmError('E_PRECONDITION', 'cannot complete: children incomplete');
      }
    }
    const set: Record<string, unknown> = {};
    for (const k of ['title', 'description', 'priority', 'estimate', 'status'] as const) if (fields[k] !== undefined) set[k] = fields[k];
    if ('status' in set && set.status === 'completed') set.completed_at = tx.now();
    r.workItems.update(id, set, agent);
    return view(tx, id);
  });
}

export function link(ctx: Ctx, source: string, target: string, agent: string): WorkItemView {
  if (source === target) throw new ApmError('E_VALIDATION', 'cannot depend on self');
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    if (!r.workItems.byId(source)) throw new ApmError('E_NOT_FOUND', `${source} not found`);
    if (!r.workItems.byId(target)) throw new ApmError('E_NOT_FOUND', `${target} not found`);
    const reciprocal = tx.get("SELECT 1 x FROM work_item_links WHERE source_work_item_id=? AND target_work_item_id=? AND link_type='depends_on'", target, source);
    if (reciprocal) throw new ApmError('E_VALIDATION', 'cyclic dependency');
    r.links.add(source, target, 'depends_on');
    tx.appendEvent({ actorId: agent, eventType: 'work_item.linked', entityType: 'work_item', entityId: source, payload: { depends_on: target } });
    return view(tx, source);
  });
}

export interface CurrentStep {
  id: string;
  type: string;
}

export interface ArtifactRef {
  id: string;
  version: number;
  type: string;
}

export interface WorkCurrentResult {
  work_item: WorkItemView;
  run: string | null;
  step: CurrentStep | null;
  required_context: ArtifactRef[];
}

/** READ-ONLY: returns current step + required artifact refs without advancing or leasing. */
export function current(ctx: Ctx, id: string): WorkCurrentResult {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    const row = r.workItems.byId(id);
    if (!row) throw new ApmError('E_NOT_FOUND', `${id} not found`);

    const activeRun = r.runs.activeForWorkItem(id);
    if (!activeRun) {
      return { work_item: view(tx, id), run: null, step: null, required_context: [] };
    }

    const mainStep = r.stepRuns.mainPending(activeRun.id);
    if (!mainStep) {
      return { work_item: view(tx, id), run: activeRun.id, step: null, required_context: [] };
    }

    // Resolve required artifacts for the current step from the workflow def
    let requiredContext: ArtifactRef[] = [];
    const defRow = r.defs.byId(activeRun.workflow_definition_id);
    if (defRow) {
      const def = JSON.parse(defRow.definition_json);
      const stepDef = def.steps?.find((s: any) => s.id === mainStep.step_id);
      const requires: string[] = stepDef?.requires?.artifacts ?? [];
      for (const artType of requires) {
        const art = r.artifacts.currentByTypeForWorkItem(id, artType);
        if (art) {
          requiredContext.push({ id: art.id, version: art.version, type: art.type });
        }
      }
    }

    return {
      work_item: view(tx, id),
      run: activeRun.id,
      step: { id: mainStep.step_id, type: mainStep.step_type ?? (defRow ? JSON.parse(defRow.definition_json).steps?.find((s: any) => s.id === mainStep.step_id)?.type ?? 'unknown' : 'unknown') },
      required_context: requiredContext,
    };
  });
}

export interface BlockersResult {
  open_blockers: BlockerView[];
  unmet_dependencies: string[];
}

/** Returns open blockers + unmet deps (depends_on targets that are not completed). */
export function blockers(ctx: Ctx, id: string): BlockersResult {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    if (!r.workItems.byId(id)) throw new ApmError('E_NOT_FOUND', `${id} not found`);

    const openBlockers = r.blockers.openForWorkItem(id).map(toBlockerView);

    const unmetDeps = r.links.unmetDeps(id);

    return { open_blockers: openBlockers, unmet_dependencies: unmetDeps };
  });
}

export function cancel(ctx: Ctx, id: string, agent: string): WorkItemView {
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    if (!r.workItems.byId(id)) throw new ApmError('E_NOT_FOUND', `${id} not found`);
    // cascade: this item + all descendants via parent_id
    const stack = [id]; const all: string[] = [];
    while (stack.length) {
      const cur = stack.pop()!; all.push(cur);
      for (const c of tx.all('SELECT id FROM work_items WHERE parent_id=?', cur) as { id: string }[]) stack.push(c.id);
    }
    for (const wid of all) {
      tx.run("UPDATE work_items SET status='cancelled', updated_at=? WHERE id=? AND status NOT IN ('completed','cancelled')", tx.now(), wid);
      tx.run("UPDATE leases SET status='released' WHERE work_item_id=? AND status='active'", wid);
      tx.appendEvent({ actorId: agent, eventType: 'work_item.cancelled', entityType: 'work_item', entityId: wid });
    }
    return view(tx, id);
  });
}
