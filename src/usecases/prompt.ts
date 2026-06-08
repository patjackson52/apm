import { readFileSync } from 'node:fs';
import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';

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
