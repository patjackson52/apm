import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { ARTIFACT_TYPES, ARTIFACT_STATUSES, type ArtifactType } from '../domain/types.js';
import { toArtifactView, type ArtifactView, type Page } from '../domain/entities.js';

/** The work item an artifact lineage is linked to (V1: at most one), or null. */
function workItemForRoot(tx: any, rootId: string): string | null {
  const row = tx.get('SELECT work_item_id FROM work_item_artifacts WHERE root_artifact_id=? LIMIT 1', rootId) as { work_item_id: string } | undefined;
  return row?.work_item_id ?? null;
}

export interface CreateArgs {
  workItem: string; type: ArtifactType; title: string; body: string; agent: string;
}

export function create(ctx: Ctx, a: CreateArgs): ArtifactView {
  if (!ARTIFACT_TYPES.includes(a.type)) throw new ApmError('E_VALIDATION', 'invalid artifact type', [{ field: 'type', problem: `must be one of ${ARTIFACT_TYPES.join('|')}`, got: a.type }]);
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(a.agent);
    if (!r.workItems.byId(a.workItem)) throw new ApmError('E_NOT_FOUND', `work item ${a.workItem} not found`);
    const id = r.artifacts.insert({ type: a.type, title: a.title, body: a.body, createdBy: a.agent, version: 1 });
    r.artifacts.linkToWorkItem(a.workItem, id, 'produced');
    const row = r.artifacts.byId(id)!;
    return toArtifactView(row, a.workItem);
  });
}

export function revise(ctx: Ctx, id: string, body: string, agent: string): ArtifactView {
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(agent);
    const old = r.artifacts.byId(id);
    if (!old) throw new ApmError('E_NOT_FOUND', `artifact ${id} not found`);
    if (old.status === 'superseded') throw new ApmError('E_PRECONDITION', 'cannot revise a superseded artifact; revise the current version');
    const newId = r.artifacts.insert({
      type: old.type, title: old.title, body,
      createdBy: agent, version: old.version + 1,
      rootId: old.root_artifact_id, supersedes: old.id,
    });
    r.artifacts.setSuperseded(id);
    const row = r.artifacts.byId(newId)!;
    return toArtifactView(row, workItemForRoot(tx, row.root_artifact_id));
  });
}

export function show(ctx: Ctx, id: string): ArtifactView {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    const row = r.artifacts.byId(id);
    if (!row) throw new ApmError('E_NOT_FOUND', `artifact ${id} not found`);
    return toArtifactView(row, workItemForRoot(tx, row.root_artifact_id));
  });
}

export interface ListArgs { workItem: string; limit?: number; offset?: number; }
export function list(ctx: Ctx, a: ListArgs): Page<ArtifactView> {
  const limit = a.limit ?? 20; const offset = a.offset ?? 0;
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    if (!r.workItems.byId(a.workItem)) throw new ApmError('E_NOT_FOUND', `work item ${a.workItem} not found`);
    const roots = r.artifacts.linkedRoots(a.workItem);
    const rows = roots.map((root) => r.artifacts.currentByRoot(root)).filter(Boolean);
    const paged = rows.slice(offset, offset + limit);
    return {
      items: paged.map((row: any) => toArtifactView({ ...row, body: undefined }, a.workItem)),
      page: { total: rows.length, limit, offset, has_more: offset + paged.length < rows.length },
    };
  });
}

function transition(ctx: Ctx, id: string, from: string[], to: string): ArtifactView {
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    const row = r.artifacts.byId(id);
    if (!row) throw new ApmError('E_NOT_FOUND', `artifact ${id} not found`);
    if (!from.includes(row.status)) throw new ApmError('E_PRECONDITION', `cannot transition ${row.status} → ${to}`);
    r.artifacts.setStatus(id, to);
    return toArtifactView({ ...row, status: to }, workItemForRoot(tx, row.root_artifact_id));
  });
}

export function submit(ctx: Ctx, id: string): ArtifactView {
  return transition(ctx, id, ['draft'], 'review');
}

export function approve(ctx: Ctx, id: string): ArtifactView {
  return transition(ctx, id, ['review', 'draft'], 'approved');
}

export function archive(ctx: Ctx, id: string): ArtifactView {
  return transition(ctx, id, ARTIFACT_STATUSES.filter((s) => s !== 'archived') as string[], 'archived');
}
