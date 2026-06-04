import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { toImageView, type ImageView, type Page } from '../domain/entities.js';
import type { BlobMeta } from '../storage/blobstore.js';
import type { Tx } from '../storage/storage.js';

/** Hard ceiling on a single image (P4). 25 MiB. */
export const MAX_BLOB_BYTES = 25 * 1024 * 1024;

const IMAGE_KINDS = ['screenshot', 'mockup', 'diagram', 'reference', 'bug'] as const;
const RELATIONS = ['evidence', 'reference', 'bug', 'produced'] as const;

export interface AddArgs {
  workItem: string;
  kind: string;
  alt?: string;
  capture?: Record<string, unknown>;
  relation?: string;
  blocker?: string;
  agent: string;
  blob: BlobMeta;
}

/** Insert + link an image inside a caller-provided transaction. Validates kind/relation/size. */
export function addImageTx(tx: Tx, a: AddArgs): ImageView {
  if (!IMAGE_KINDS.includes(a.kind as any)) {
    throw new ApmError('E_VALIDATION', `invalid kind`, [{ field: 'kind', problem: `must be one of ${IMAGE_KINDS.join('|')}`, got: a.kind }]);
  }
  const relation = a.relation ?? (a.blocker ? 'bug' : 'evidence');
  if (!RELATIONS.includes(relation as any)) {
    throw new ApmError('E_VALIDATION', `invalid relation`, [{ field: 'relation', problem: `must be one of ${RELATIONS.join('|')}`, got: relation }]);
  }
  if (a.blob.byte_size > MAX_BLOB_BYTES) {
    throw new ApmError('E_VALIDATION', `image too large (${a.blob.byte_size} bytes > ${MAX_BLOB_BYTES})`);
  }
  const r = repos(tx);
  r.agents.ensure(a.agent);
  if (!r.workItems.byId(a.workItem)) throw new ApmError('E_NOT_FOUND', `work item ${a.workItem} not found`);
  r.blobs.insert(a.blob);
  const metadata = {
    kind: a.kind,
    blob: a.blob.sha256,
    mime: a.blob.mime,
    ext: a.blob.ext,
    width: a.blob.width,
    height: a.blob.height,
    byte_size: a.blob.byte_size,
    alt: a.alt ?? null,
    capture: a.capture ?? null,
    blocker: a.blocker ?? null,
  };
  const id = r.artifacts.insert(
    { type: 'image', title: a.alt ?? a.kind, body: a.alt ?? null, createdBy: a.agent, version: 1, metadata },
    'image.created',
  );
  r.artifacts.linkToWorkItem(a.workItem, id, relation);
  tx.appendEvent({
    actorId: a.agent,
    eventType: 'image.linked',
    entityType: 'artifact',
    entityId: id,
    payload: { work_item: a.workItem, relation, ...(a.blocker ? { blocker: a.blocker } : {}) },
  });
  return toImageView(r.artifacts.byId(id)!, a.workItem);
}

export function add(ctx: Ctx, a: AddArgs): ImageView {
  return ctx.storage.transaction('immediate', (tx) => addImageTx(tx, a));
}

export interface ListArgs { workItem: string; limit?: number; offset?: number }

export function list(ctx: Ctx, a: ListArgs): Page<ImageView> {
  const limit = a.limit ?? 50;
  const offset = a.offset ?? 0;
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    if (!r.workItems.byId(a.workItem)) throw new ApmError('E_NOT_FOUND', `work item ${a.workItem} not found`);
    const roots = r.artifacts.linkedImages(a.workItem);
    const rows = roots.map((root) => r.artifacts.currentByRoot(root)).filter(Boolean);
    const paged = rows.slice(offset, offset + limit);
    return {
      items: paged.map((row: any) => toImageView(row, a.workItem)),
      page: { total: rows.length, limit, offset, has_more: offset + paged.length < rows.length },
    };
  });
}

export function show(ctx: Ctx, id: string): ImageView {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    const row = r.artifacts.byId(id);
    if (!row || row.type !== 'image') throw new ApmError('E_NOT_FOUND', `image ${id} not found`);
    const link: any = tx.get('SELECT work_item_id FROM work_item_artifacts WHERE root_artifact_id=? LIMIT 1', row.root_artifact_id);
    return toImageView(row, link?.work_item_id ?? null);
  });
}

export interface ReviseArgs { alt?: string; capture?: Record<string, unknown>; agent: string; blob: BlobMeta }

export function revise(ctx: Ctx, id: string, a: ReviseArgs): ImageView {
  if (a.blob.byte_size > MAX_BLOB_BYTES) throw new ApmError('E_VALIDATION', `image too large`);
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(a.agent);
    const old = r.artifacts.byId(id);
    if (!old || old.type !== 'image') throw new ApmError('E_NOT_FOUND', `image ${id} not found`);
    if (old.status === 'superseded') throw new ApmError('E_PRECONDITION', 'cannot revise a superseded image; revise the current version');
    r.blobs.insert(a.blob);
    const prev = old.metadata_json != null ? JSON.parse(old.metadata_json) : {};
    const metadata = {
      kind: prev.kind ?? 'screenshot',
      blob: a.blob.sha256, mime: a.blob.mime, ext: a.blob.ext,
      width: a.blob.width, height: a.blob.height, byte_size: a.blob.byte_size,
      alt: a.alt ?? prev.alt ?? null,
      capture: a.capture ?? prev.capture ?? null,
    };
    const newId = r.artifacts.insert(
      { type: 'image', title: metadata.alt ?? metadata.kind, body: metadata.alt ?? null, createdBy: a.agent, version: old.version + 1, rootId: old.root_artifact_id, supersedes: old.id, metadata },
      'image.created',
    );
    r.artifacts.setSuperseded(id);
    const link: any = tx.get('SELECT work_item_id FROM work_item_artifacts WHERE root_artifact_id=? LIMIT 1', old.root_artifact_id);
    return toImageView(r.artifacts.byId(newId)!, link?.work_item_id ?? null);
  });
}

export function find(ctx: Ctx, sha256: string): ImageView[] {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    return r.artifacts.imagesByBlob(sha256).map((row: any) => toImageView(row, null));
  });
}

export interface PairArgs { a: string; b: string; kind: string; agent: string }

export function pair(ctx: Ctx, p: PairArgs): void {
  ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(p.agent);
    for (const id of [p.a, p.b]) {
      const row = r.artifacts.byId(id);
      if (!row || row.type !== 'image') throw new ApmError('E_NOT_FOUND', `image ${id} not found`);
    }
    tx.appendEvent({
      actorId: p.agent,
      eventType: 'image.paired',
      entityType: 'artifact',
      entityId: p.a,
      payload: { a: p.a, b: p.b, kind: p.kind },
    });
  });
}
