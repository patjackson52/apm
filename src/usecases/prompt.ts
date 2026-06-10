import { readFileSync } from 'node:fs';
import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { toPromptSummaryView, toPromptDetailView, type PromptSummaryView, type PromptDetailView, type Page } from '../domain/entities.js';

export interface PromptView {
  id: string; name: string; version: number; body: string; created_at: string;
}

function toView(row: any): PromptView {
  return { id: row.id, name: row.name, version: row.version, body: row.body, created_at: row.created_at };
}

export const PROMPT_NAME_RE = /^[A-Za-z0-9._-]+$/;

function assertValidName(name: string): void {
  if (!PROMPT_NAME_RE.test(name)) {
    throw new ApmError('E_VALIDATION', `invalid prompt name '${name}' (allowed: letters, digits, . _ -)`);
  }
}

function bodyFrom(a: { body?: string | null; bodyFile?: string | null }): string {
  if (a.bodyFile) return readFileSync(a.bodyFile, 'utf8');
  if (a.body != null) return a.body;
  throw new ApmError('E_VALIDATION', 'body or body-file is required');
}

export interface CreatePromptArgs {
  name: string;
  body?: string | null;
  bodyFile?: string | null;
}

export function create(ctx: Ctx, a: CreatePromptArgs): PromptView {
  assertValidName(a.name);
  const body = bodyFrom(a);
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    if (r.prompts.byName(a.name)) {
      throw new ApmError('E_CONFLICT', `prompt '${a.name}' already exists — use 'apm prompt revise' to add a version`);
    }
    const id = r.prompts.insert(a.name, body);
    return toView(tx.get<any>('SELECT * FROM prompt_definitions WHERE id=?', id)!);
  });
}

export interface RevisePromptArgs {
  name: string;
  body?: string | null;
  bodyFile?: string | null;
}

export function revise(ctx: Ctx, a: RevisePromptArgs): PromptView {
  const body = bodyFrom(a);
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    if (!r.prompts.byName(a.name)) throw new ApmError('E_NOT_FOUND', `prompt '${a.name}' not found`);
    const id = r.prompts.insert(a.name, body); // auto-increments version per name
    return toView(tx.get<any>('SELECT * FROM prompt_definitions WHERE id=?', id)!);
  });
}

export function list(ctx: Ctx): PromptView[] {
  return ctx.storage.transaction('deferred', (tx) => {
    return repos(tx).prompts.list().map(toView);
  });
}

export function show(ctx: Ctx, name: string, version?: number): PromptView {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    const row = version != null ? r.prompts.byNameVersion(name, version) : r.prompts.byName(name);
    if (!row) throw new ApmError('E_NOT_FOUND', `prompt '${name}'${version != null ? ` v${version}` : ''} not found`);
    return toView(row);
  });
}

/** Library list — latest-per-name with where-used counts. */
export function listSummaries(ctx: Ctx): PromptSummaryView[] {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    return r.prompts.listLatest().map((row: any) => {
      const wu = r.prompts.whereUsed(row.name);
      return toPromptSummaryView(row, { versionCount: r.prompts.versionCount(row.name), defs: wu.defs, runs: wu.runs });
    });
  });
}

/** Detail — latest body + full version history (newest first) + where-used counts. */
export function detail(ctx: Ctx, name: string): PromptDetailView {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    const latest = r.prompts.byName(name);
    if (!latest) throw new ApmError('E_NOT_FOUND', `prompt '${name}' not found`);
    const versions = tx.all<any>('SELECT * FROM prompt_definitions WHERE name=? ORDER BY version DESC', name);
    const wu = r.prompts.whereUsed(name);
    return toPromptDetailView(latest, versions, { defs: wu.defs, runs: wu.runs });
  });
}

export interface UsageRow { run: string; work_item: string; version: number; status: string; at: string | null; }

/** Where-used drill-down — the runs that dispatched this prompt, paginated. */
export function usage(ctx: Ctx, name: string, limit?: number, offset?: number): Page<UsageRow> {
  const lim = limit ?? 20;
  const off = offset ?? 0;
  return ctx.storage.transaction('deferred', (tx) => {
    const { rows, total } = repos(tx).prompts.whereUsedRuns(name, lim, off);
    return {
      items: rows.map((r: any) => ({ run: r.run, work_item: r.work_item, version: r.version, status: r.status, at: r.at ?? null })),
      page: { total, limit: lim, offset: off, has_more: off + rows.length < total },
    };
  });
}
