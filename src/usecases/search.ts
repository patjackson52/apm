import type { Ctx } from '../cli/run.js';

export type SearchKind = 'work_item' | 'artifact' | 'run' | 'step';
export interface SearchResultView {
  kind: SearchKind;
  id: string;
  title: string;
  snippet: string | null;
  work_item: string | null;
}
export interface SearchArgs { q: string; limit?: number }

/** Escape LIKE wildcards. Backslash FIRST, then % and _ (else double-escaping). */
export function escapeLike(q: string): string {
  return q.replace(/\\/g, '\\\\').replace(/[%_]/g, (c) => `\\${c}`);
}

/** Plain-text ~`len`-char window centered on the first case-insensitive match. */
export function excerpt(text: string, q: string, len = 120): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return t.slice(0, len);
  const start = Math.max(0, i - 40);
  const end = Math.min(t.length, start + len);
  return (start > 0 ? '…' : '') + t.slice(start, end) + (end < t.length ? '…' : '');
}

/** Unified global search across work items, artifacts, runs, and steps. Read-only. */
export function query(ctx: Ctx, a: SearchArgs): SearchResultView[] {
  const q = a.q.trim();
  if (!q) return [];
  const limit = a.limit ?? 30;
  const like = `%${escapeLike(q)}%`;
  return ctx.storage.transaction('deferred', (tx) => {
    const out: SearchResultView[] = [];

    for (const r of tx.all<{ id: string; title: string; description: string | null }>(
      "SELECT id, title, description FROM work_items WHERE title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'",
      like, like,
    )) {
      out.push({ kind: 'work_item', id: r.id, title: r.title, snippet: excerpt(r.description ?? r.title, q), work_item: r.id });
    }

    const seen = new Set<string>();
    for (const r of tx.all<{ id: string; title: string; body: string | null; work_item: string | null }>(
      "SELECT a.id, a.title, a.body, wia.work_item_id AS work_item FROM artifacts a LEFT JOIN work_item_artifacts wia ON wia.root_artifact_id = a.root_artifact_id WHERE a.title LIKE ? ESCAPE '\\' OR a.body LIKE ? ESCAPE '\\'",
      like, like,
    )) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ kind: 'artifact', id: r.id, title: r.title, snippet: excerpt(r.body ?? r.title, q), work_item: r.work_item ?? null });
    }

    for (const r of tx.all<{ id: string; work_item: string | null; workflow_definition_id: string | null }>(
      "SELECT id, work_item_id AS work_item, workflow_definition_id FROM workflow_runs WHERE id LIKE ? ESCAPE '\\'",
      like,
    )) {
      out.push({ kind: 'run', id: r.id, title: r.workflow_definition_id ?? r.id, snippet: null, work_item: r.work_item ?? null });
    }

    for (const r of tx.all<{ id: string; step_id: string; work_item: string | null }>(
      "SELECT s.id, s.step_id, r.work_item_id AS work_item FROM workflow_step_runs s JOIN workflow_runs r ON r.id = s.workflow_run_id WHERE s.step_id LIKE ? ESCAPE '\\' OR s.id LIKE ? ESCAPE '\\'",
      like, like,
    )) {
      out.push({ kind: 'step', id: r.id, title: r.step_id, snippet: null, work_item: r.work_item ?? null });
    }

    return out.slice(0, limit);
  });
}
