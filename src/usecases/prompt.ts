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

export interface CreatePromptArgs {
  name: string;
  body?: string | null;
  bodyFile?: string | null;
}

export function create(ctx: Ctx, a: CreatePromptArgs): PromptView {
  let body: string;
  if (a.bodyFile) {
    body = readFileSync(a.bodyFile, 'utf8');
  } else if (a.body != null) {
    body = a.body;
  } else {
    throw new ApmError('E_VALIDATION', 'body or body-file is required');
  }

  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    const id = r.prompts.insert(a.name, body);
    return toView(tx.get<any>('SELECT * FROM prompt_definitions WHERE id=?', id)!);
  });
}

export function list(ctx: Ctx): PromptView[] {
  return ctx.storage.transaction('deferred', (tx) => {
    return repos(tx).prompts.list().map(toView);
  });
}

export function show(ctx: Ctx, name: string): PromptView {
  return ctx.storage.transaction('deferred', (tx) => {
    const row = repos(tx).prompts.byName(name);
    if (!row) throw new ApmError('E_NOT_FOUND', `prompt '${name}' not found`);
    return toView(row);
  });
}
