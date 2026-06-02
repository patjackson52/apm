# APM V1 — Plan 2: Work Graph, Sessions, Leases & Output Contract

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Build the shared output contract (envelope, canonical entities, renderers, error/exit-code model, CLI runner) and the first command groups on top of it: `work`, `session`, `lease` — including the lease concurrency model and the computed-`active` work-item status.

**Architecture:** Adds `format/` (envelope + renderers), `domain/errors.ts` (typed errors → exit codes), `domain/entities.ts` (canonical shapes + row mappers), `storage/repos.ts` (typed query helpers on `Tx`), and `cli/run.ts` (a runner that opens storage, executes a usecase, renders the envelope, sets the exit code). Usecases for work/session/lease orchestrate repos inside `Storage.transaction`.

**Tech Stack:** Same as Plan 1 (TS, better-sqlite3, commander, yaml, vitest). Builds on the merged Plan 1 foundation (Clock, ids, types, schema, SqliteStorage, `apm init`).

**Depends on Plan 1.** Reuses `Storage`/`Tx`, `Clock`, `ID_PREFIXES`, the status enums, and the schema. `work current` and `work blockers` are DEFERRED to Plans 3–4 (need workflow runs/blockers). `work complete`'s child/run guard is finalized in Plan 3 (Plan 2 implements the child-only guard).

---

## File Structure

- `src/domain/errors.ts` — `ApmError` (code, message, retryable, issues?), `ErrorCode` union, `CODE_EXIT` map, `EXIT` constants.
- `src/domain/entities.ts` — canonical entity TS types (`WorkItemView`, `SessionView`, `LeaseView`, `Page<T>`) + `toWorkItemView`/`toSessionView`/`toLeaseView` row mappers.
- `src/format/envelope.ts` — `Envelope<T>`, `ok(data, meta)`, `fail(error, meta)`, `buildMeta(command, clock, session?)`.
- `src/format/render.ts` — `render(format, envelope)` for `json|yaml|human|agent`; per-entity human tables; agent-format fallback to json with `meta.note` for non-`next` commands.
- `src/storage/repos.ts` — `repos(tx)` returning typed helpers: `agents`, `workItems`, `links`, `sessions`, `leases`.
- `src/cli/run.ts` — `runCommand(deps, command, fn)` harness: locate `.apm`, open storage, run `fn(ctx)`, render, set `process.exitCode`. `resolveFormat`, `findProjectDb`.
- `src/usecases/work.ts`, `src/usecases/session.ts`, `src/usecases/lease.ts` — command logic.
- `src/cli/program.ts` — extend with `work`, `session`, `lease` groups (modify).
- Tests under `tests/` mirroring each.

---

## Task 1: Error model & exit codes

**Files:** Create `src/domain/errors.ts`; Test `tests/domain/errors.test.ts`.

- [ ] **Step 1: Write the failing test** `tests/domain/errors.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { ApmError, CODE_EXIT, exitFor } from '../../src/domain/errors.js';

describe('errors', () => {
  it('carries code, message, retryable', () => {
    const e = new ApmError('E_NOT_FOUND', 'WI-9 not found');
    expect(e.code).toBe('E_NOT_FOUND');
    expect(e.retryable).toBe(false);
    expect(e.message).toBe('WI-9 not found');
  });

  it('marks lease conflict retryable', () => {
    expect(new ApmError('E_LEASE_CONFLICT', 'held').retryable).toBe(true);
  });

  it('maps codes to exit codes', () => {
    expect(CODE_EXIT.E_VALIDATION).toBe(40);
    expect(CODE_EXIT.E_NOT_FOUND).toBe(44);
    expect(CODE_EXIT.E_LEASE_CONFLICT).toBe(10);
    expect(CODE_EXIT.E_INTERNAL).toBe(75);
  });

  it('exitFor returns 75 for unknown/non-ApmError', () => {
    expect(exitFor(new Error('boom'))).toBe(75);
    expect(exitFor(new ApmError('E_VALIDATION', 'x'))).toBe(40);
  });

  it('carries validation issues', () => {
    const e = new ApmError('E_VALIDATION', 'bad', [{ field: 'estimate', problem: 'must be XS|S|M|L|XL', got: 'XXL' }]);
    expect(e.issues?.[0].field).toBe('estimate');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/domain/errors.test.ts`

- [ ] **Step 3: Implement** `src/domain/errors.ts`

```ts
export type ErrorCode =
  | 'E_VALIDATION' | 'E_NOT_FOUND' | 'E_LEASE_CONFLICT'
  | 'E_PRECONDITION' | 'E_BLOCKED' | 'E_AWAITING_HUMAN'
  | 'E_CONFLICT' | 'E_INTERNAL';

export interface Issue { field: string; problem: string; got?: unknown; }

export const CODE_EXIT: Record<ErrorCode, number> = {
  E_LEASE_CONFLICT: 10,
  E_PRECONDITION: 20,
  E_BLOCKED: 20,
  E_AWAITING_HUMAN: 20,
  E_VALIDATION: 40,
  E_CONFLICT: 40,
  E_NOT_FOUND: 44,
  E_INTERNAL: 75,
};

const RETRYABLE: ReadonlySet<ErrorCode> = new Set(['E_LEASE_CONFLICT', 'E_INTERNAL']);

export class ApmError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly issues?: Issue[];
  constructor(code: ErrorCode, message: string, issues?: Issue[]) {
    super(message);
    this.name = 'ApmError';
    this.code = code;
    this.retryable = RETRYABLE.has(code);
    this.issues = issues;
  }
}

/** Exit code for any thrown value (non-ApmError → 75 internal). */
export function exitFor(err: unknown): number {
  return err instanceof ApmError ? CODE_EXIT[err.code] : 75;
}
```

- [ ] **Step 4: Run, expect PASS (5).** **Step 5: Commit** `git add src/domain/errors.ts tests/domain/errors.test.ts && git commit -m "feat: add ApmError code/exit-code model"`

---

## Task 2: Canonical entities & mappers

**Files:** Create `src/domain/entities.ts`; Test `tests/domain/entities.test.ts`.

Canonical views are the ONE shape per entity used by list items, show, and mutation returns. Row mappers convert raw DB rows (snake_case columns) to the canonical view (snake_case fields, references as ids). `lease` on a WorkItemView is the *live* lease id or null (computed by the caller; mapper takes it as an arg).

- [ ] **Step 1: Write the failing test** `tests/domain/entities.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { toWorkItemView, toSessionView, toLeaseView } from '../../src/domain/entities.js';

describe('entity mappers', () => {
  it('maps a work item row to a canonical view with id refs', () => {
    const row = {
      id: 'WI-1', type: 'feature', title: 'Offline', description: null, status: 'ready',
      priority: 0, estimate: 'M', parent_id: 'WI-0', created_by: 'claude',
      created_at: '2026-06-02T00:00:00.000Z', updated_at: '2026-06-02T00:00:00.000Z', completed_at: null,
    };
    const v = toWorkItemView(row, { dependsOn: ['WI-5'], blockerIds: [], artifactIds: ['ART-2'], activeRun: 'WR-1', lease: null });
    expect(v).toEqual({
      id: 'WI-1', type: 'feature', title: 'Offline', description: null, status: 'ready',
      priority: 0, estimate: 'M', parent: 'WI-0', depends_on: ['WI-5'], blocker_ids: [],
      artifact_ids: ['ART-2'], active_run: 'WR-1', lease: null, created_by: 'claude',
      created_at: '2026-06-02T00:00:00.000Z', updated_at: '2026-06-02T00:00:00.000Z', completed_at: null,
    });
  });

  it('maps a session row', () => {
    const v = toSessionView({ id: 'S-1', agent_id: 'claude', status: 'active', context_summary: null,
      started_at: '2026-06-02T00:00:00.000Z', last_seen_at: null, ended_at: null });
    expect(v.id).toBe('S-1'); expect(v.agent).toBe('claude'); expect(v.status).toBe('active');
  });

  it('maps a lease row', () => {
    const v = toLeaseView({ id: 'LEASE-1', work_item_id: 'WI-1', agent_id: 'claude', session_id: 'S-1',
      status: 'active', acquired_at: 'a', expires_at: 'b', heartbeat_at: null });
    expect(v).toMatchObject({ id: 'LEASE-1', work_item: 'WI-1', agent: 'claude', session: 'S-1', status: 'active', expires_at: 'b' });
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/domain/entities.ts`

```ts
import type {
  WorkItemType, WorkItemStatus, Estimate, SessionStatus, LeaseStatus,
} from './types.js';

export interface Page<T> { items: T[]; page: { total: number; limit: number; offset: number; has_more: boolean }; }

export interface WorkItemView {
  id: string; type: WorkItemType; title: string; description: string | null;
  status: WorkItemStatus | 'active'; priority: number; estimate: Estimate | null;
  parent: string | null; depends_on: string[]; blocker_ids: string[]; artifact_ids: string[];
  active_run: string | null; lease: string | null; created_by: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
}

export interface WorkItemRels {
  dependsOn: string[]; blockerIds: string[]; artifactIds: string[];
  activeRun: string | null; lease: string | null;
}

export function toWorkItemView(row: any, rels: WorkItemRels): WorkItemView {
  return {
    id: row.id, type: row.type, title: row.title, description: row.description ?? null,
    // effective status: a live lease projects to 'active'; else the stored status
    status: rels.lease ? 'active' : row.status,
    priority: row.priority, estimate: row.estimate ?? null, parent: row.parent_id ?? null,
    depends_on: rels.dependsOn, blocker_ids: rels.blockerIds, artifact_ids: rels.artifactIds,
    active_run: rels.activeRun, lease: rels.lease, created_by: row.created_by ?? null,
    created_at: row.created_at, updated_at: row.updated_at, completed_at: row.completed_at ?? null,
  };
}

export interface SessionView {
  id: string; agent: string; status: SessionStatus; context_summary: string | null;
  started_at: string; last_seen_at: string | null; ended_at: string | null;
}
export function toSessionView(row: any): SessionView {
  return {
    id: row.id, agent: row.agent_id, status: row.status, context_summary: row.context_summary ?? null,
    started_at: row.started_at, last_seen_at: row.last_seen_at ?? null, ended_at: row.ended_at ?? null,
  };
}

export interface LeaseView {
  id: string; work_item: string; agent: string; session: string | null;
  status: LeaseStatus; acquired_at: string; expires_at: string; heartbeat_at: string | null;
}
export function toLeaseView(row: any): LeaseView {
  return {
    id: row.id, work_item: row.work_item_id, agent: row.agent_id, session: row.session_id ?? null,
    status: row.status, acquired_at: row.acquired_at, expires_at: row.expires_at, heartbeat_at: row.heartbeat_at ?? null,
  };
}
```

- [ ] **Step 4: Run, expect PASS (3).** **Step 5: Commit** `git add src/domain/entities.ts tests/domain/entities.test.ts && git commit -m "feat: add canonical entity views and row mappers"`

---

## Task 3: Envelope

**Files:** Create `src/format/envelope.ts`; Test `tests/format/envelope.test.ts`.

- [ ] **Step 1: Failing test** `tests/format/envelope.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { ok, fail, buildMeta } from '../../src/format/envelope.js';
import { ApmError } from '../../src/domain/errors.js';
import { fixedClock } from '../../src/domain/clock.js';

const clock = fixedClock('2026-06-02T12:00:00.000Z');

describe('envelope', () => {
  it('builds an ok envelope', () => {
    const env = ok({ id: 'WI-1' }, buildMeta('work show', clock, 'S-1'));
    expect(env).toEqual({
      ok: true, data: { id: 'WI-1' }, error: null,
      meta: { api_version: 1, command: 'work show', ts: '2026-06-02T12:00:00.000Z', actor_session: 'S-1' },
    });
  });

  it('builds a fail envelope from ApmError with issues', () => {
    const e = new ApmError('E_VALIDATION', 'bad', [{ field: 'x', problem: 'nope' }]);
    const env = fail(e, buildMeta('work create', clock));
    expect(env.ok).toBe(false);
    expect(env.data).toBeNull();
    expect(env.error).toEqual({ code: 'E_VALIDATION', message: 'bad', retryable: false, issues: [{ field: 'x', problem: 'nope' }] });
    expect(env.meta.actor_session).toBeUndefined();
  });

  it('omits issues when absent', () => {
    const env = fail(new ApmError('E_NOT_FOUND', 'missing'), buildMeta('work show', clock));
    expect(env.error).toEqual({ code: 'E_NOT_FOUND', message: 'missing', retryable: false });
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/format/envelope.ts`

```ts
import type { Clock } from '../domain/clock.js';
import { ApmError } from '../domain/errors.js';

export interface Meta { api_version: 1; command: string; ts: string; actor_session?: string; note?: string; }
export interface ErrorBody { code: string; message: string; retryable: boolean; issues?: { field: string; problem: string; got?: unknown }[]; }
export interface Envelope<T> { ok: boolean; data: T | null; error: ErrorBody | null; meta: Meta; }

export function buildMeta(command: string, clock: Clock, session?: string): Meta {
  const meta: Meta = { api_version: 1, command, ts: clock.now() };
  if (session) meta.actor_session = session;
  return meta;
}

export function ok<T>(data: T, meta: Meta): Envelope<T> {
  return { ok: true, data, error: null, meta };
}

export function fail(err: ApmError, meta: Meta): Envelope<never> {
  const error: ErrorBody = { code: err.code, message: err.message, retryable: err.retryable };
  if (err.issues) error.issues = err.issues;
  return { ok: false, data: null, error, meta };
}
```

- [ ] **Step 4: Run, expect PASS (3).** **Step 5: Commit** `git add src/format/envelope.ts tests/format/envelope.test.ts && git commit -m "feat: add response envelope builder"`

---

## Task 4: Renderers

**Files:** Create `src/format/render.ts`; Test `tests/format/render.test.ts`.

`render(format, envelope, opts)` returns a string. `json` = pretty JSON of the envelope. `yaml` = YAML of the envelope. `agent` = (Plan 2) falls back to json but sets `meta.note`. `human` = a readable rendering: for `ok` with a `Page` data → a table; for a single entity → key/value lines; for `fail` → `error: <code> <message>` (+ issues). Human format must NOT include volatile-only noise but may show timestamps.

- [ ] **Step 1: Failing test** `tests/format/render.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { render } from '../../src/format/render.js';
import { ok, fail, buildMeta } from '../../src/format/envelope.js';
import { ApmError } from '../../src/domain/errors.js';
import { fixedClock } from '../../src/domain/clock.js';
import { parse as parseYaml } from 'yaml';

const clock = fixedClock('2026-06-02T12:00:00.000Z');
const env = ok({ id: 'WI-1', title: 'Offline', status: 'ready' }, buildMeta('work show', clock, 'S-1'));

describe('render', () => {
  it('json round-trips the envelope', () => {
    const s = render('json', env);
    expect(JSON.parse(s)).toEqual(env);
  });

  it('yaml round-trips the envelope', () => {
    const s = render('yaml', env);
    expect(parseYaml(s)).toEqual(env);
  });

  it('agent falls back to json with a note for non-next commands', () => {
    const s = render('agent', env);
    const parsed = JSON.parse(s);
    expect(parsed.meta.note).toMatch(/agent format not applicable/i);
  });

  it('human shows key/value for a single entity', () => {
    const s = render('human', env);
    expect(s).toMatch(/id\s+WI-1/);
    expect(s).toMatch(/title\s+Offline/);
  });

  it('human shows a table for a page', () => {
    const page = ok({ items: [{ id: 'WI-1', status: 'ready', type: 'feature', title: 'Offline' }],
      page: { total: 1, limit: 20, offset: 0, has_more: false } }, buildMeta('work list', clock));
    const s = render('human', page);
    expect(s).toMatch(/WI-1/);
    expect(s).toMatch(/Offline/);
  });

  it('human renders an error line', () => {
    const s = render('human', fail(new ApmError('E_NOT_FOUND', 'WI-9 not found'), buildMeta('work show', clock)));
    expect(s).toMatch(/error: E_NOT_FOUND WI-9 not found/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/format/render.ts`

```ts
import { stringify as toYaml } from 'yaml';
import type { Envelope } from './envelope.js';

export type OutputFormat = 'human' | 'json' | 'yaml' | 'agent';

function isPage(data: any): boolean {
  return data && typeof data === 'object' && Array.isArray(data.items) && data.page;
}

function kv(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj);
  const width = Math.max(...keys.map((k) => k.length));
  return keys.map((k) => {
    const v = obj[k];
    const val = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(typeof v === 'object' ? JSON.stringify(v) : v);
    return `${k.padEnd(width)}  ${val}`;
  }).join('\n');
}

function table(items: Record<string, unknown>[]): string {
  if (items.length === 0) return '(none)';
  const cols = Object.keys(items[0]).filter((c) => typeof items[0][c] !== 'object' || items[0][c] === null);
  const widths = cols.map((c) => Math.max(c.length, ...items.map((i) => String(i[c] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  return [line(cols), ...items.map((it) => line(cols.map((c) => String(it[c] ?? ''))))].join('\n');
}

function renderHuman(env: Envelope<any>): string {
  if (!env.ok && env.error) {
    let s = `error: ${env.error.code} ${env.error.message}`;
    if (env.error.issues) s += '\n' + env.error.issues.map((i) => `  - ${i.field}: ${i.problem}`).join('\n');
    return s;
  }
  const d = env.data;
  if (isPage(d)) {
    const tbl = table(d.items);
    return d.page.has_more ? `${tbl}\n(${d.items.length} of ${d.page.total}; --offset ${d.page.offset + d.page.limit} for more)` : tbl;
  }
  if (d && typeof d === 'object') return kv(d);
  return String(d);
}

export function render(format: OutputFormat, envelope: Envelope<any>): string {
  if (format === 'human') return renderHuman(envelope);
  if (format === 'yaml') return toYaml(envelope);
  if (format === 'agent') {
    // Plan 2 commands have no agent projection; fall back to json with a note.
    const withNote = { ...envelope, meta: { ...envelope.meta, note: 'agent format not applicable; emitted json' } };
    return JSON.stringify(withNote, null, 2);
  }
  return JSON.stringify(envelope, null, 2);
}
```

- [ ] **Step 4: Run, expect PASS (6).** **Step 5: Commit** `git add src/format/render.ts tests/format/render.test.ts && git commit -m "feat: add output renderers (human/json/yaml/agent-fallback)"`

---

## Task 5: Repositories

**Files:** Create `src/storage/repos.ts`; Test `tests/storage/repos.test.ts`.

`repos(tx)` returns typed helpers used by usecases. Keep it focused on Plan-2 needs; later plans extend it.

- [ ] **Step 1: Failing test** `tests/storage/repos.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import { repos } from '../../src/storage/repos.js';

function mem() { return new SqliteStorage(':memory:', fixedClock('2026-06-02T12:00:00.000Z')); }

describe('repos', () => {
  it('upserts an agent by name (idempotent) and returns its id', () => {
    const s = mem();
    const [a1, a2] = s.transaction('immediate', (tx) => {
      const r = repos(tx);
      return [r.agents.ensure('claude'), r.agents.ensure('claude')];
    });
    expect(a1).toBe('claude');           // agent id == name for V1
    expect(a2).toBe('claude');
    const count = s.transaction('deferred', (tx) => tx.get<{ c: number }>('SELECT count(*) c FROM agents')!.c);
    expect(count).toBe(1);
    s.close();
  });

  it('inserts and fetches a work item', () => {
    const s = mem();
    const id = s.transaction('immediate', (tx) => {
      const r = repos(tx);
      r.agents.ensure('claude');
      return r.workItems.insert({ type: 'feature', title: 'Offline', description: 'd', priority: 2, estimate: 'M', parentId: null, createdBy: 'claude' });
    });
    expect(id).toBe('WI-1');
    const row = s.transaction('deferred', (tx) => repos(tx).workItems.byId('WI-1'));
    expect(row!.title).toBe('Offline');
    expect(row!.status).toBe('draft');
    s.close();
  });

  it('records a depends_on link and lists dependency ids', () => {
    const s = mem();
    const deps = s.transaction('immediate', (tx) => {
      const r = repos(tx);
      r.agents.ensure('claude');
      const a = r.workItems.insert({ type: 'feature', title: 'A', description: null, priority: 0, estimate: null, parentId: null, createdBy: 'claude' });
      const b = r.workItems.insert({ type: 'task', title: 'B', description: null, priority: 0, estimate: null, parentId: null, createdBy: 'claude' });
      r.links.add(a, b, 'depends_on');
      return r.links.dependsOn(a);
    });
    expect(deps).toEqual(['WI-2']);
    s.close();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/storage/repos.ts`

```ts
import type { Tx } from './storage.js';
import type { WorkItemType, Estimate } from '../domain/types.js';

export interface NewWorkItem {
  type: WorkItemType; title: string; description: string | null;
  priority: number; estimate: Estimate | null; parentId: string | null; createdBy: string | null;
}

export function repos(tx: Tx) {
  const now = tx.now();
  return {
    agents: {
      /** Ensure an agent row exists (id == name in V1). Idempotent. Returns the id. */
      ensure(name: string): string {
        const existing = tx.get<{ id: string }>('SELECT id FROM agents WHERE id=?', name);
        if (!existing) {
          tx.run('INSERT INTO agents (id, name, type, created_at) VALUES (?, ?, ?, ?)', name, name, name.startsWith('human:') ? 'human' : 'agent', now);
        }
        return name;
      },
    },
    workItems: {
      insert(w: NewWorkItem): string {
        const id = tx.allocateId('WI');
        tx.run(
          `INSERT INTO work_items (id, type, title, description, status, priority, estimate, parent_id, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
          id, w.type, w.title, w.description, w.priority, w.estimate, w.parentId, w.createdBy, now, now,
        );
        tx.appendEvent({ actorId: w.createdBy, eventType: 'work_item.created', entityType: 'work_item', entityId: id, payload: { type: w.type, title: w.title } });
        return id;
      },
      byId(id: string): any | undefined { return tx.get('SELECT * FROM work_items WHERE id=?', id); },
      children(id: string): any[] { return tx.all('SELECT * FROM work_items WHERE parent_id=? ORDER BY id', id); },
      setStatus(id: string, status: string, actor: string | null, completedAt?: string | null) {
        tx.run('UPDATE work_items SET status=?, updated_at=?, completed_at=COALESCE(?, completed_at) WHERE id=?', status, now, completedAt ?? null, id);
        tx.appendEvent({ actorId: actor, eventType: 'work_item.status', entityType: 'work_item', entityId: id, payload: { status } });
      },
      update(id: string, fields: Record<string, unknown>, actor: string | null) {
        const cols = Object.keys(fields);
        if (cols.length === 0) return;
        tx.run(`UPDATE work_items SET ${cols.map((c) => `${c}=?`).join(', ')}, updated_at=? WHERE id=?`, ...cols.map((c) => fields[c]), now, id);
        tx.appendEvent({ actorId: actor, eventType: 'work_item.updated', entityType: 'work_item', entityId: id, payload: fields });
      },
    },
    links: {
      add(source: string, target: string, linkType: string) {
        const id = tx.allocateId('WI'); // reuse WI seq? No — use a dedicated link id; see note
        // links have no prefix in the spec; use a synthetic id from the event sequence is wrong.
        // Use rowid-style: generate "LNK-<n>"? Not in prefix list. Use composite uniqueness; id = `${source}:${target}:${linkType}`.
        throw new Error('replaced below');
      },
      dependsOn(source: string): string[] {
        return tx.all<{ target_work_item_id: string }>(
          "SELECT target_work_item_id FROM work_item_links WHERE source_work_item_id=? AND link_type='depends_on' ORDER BY target_work_item_id", source,
        ).map((r) => r.target_work_item_id);
      },
    },
  };
}
```

NOTE for implementer: `work_item_links.id` has no type-prefix in the ID scheme. Implement `links.add` with a deterministic id `id = \`${source}_${target}_${linkType}\`` (the unique index already prevents dupes; on conflict, ignore). Replace the throwing stub:

```ts
add(source: string, target: string, linkType: string) {
  const id = `${source}_${target}_${linkType}`;
  tx.run('INSERT OR IGNORE INTO work_item_links (id, source_work_item_id, target_work_item_id, link_type, created_at) VALUES (?, ?, ?, ?, ?)',
    id, source, target, linkType, now);
},
```

- [ ] **Step 4: Run, expect PASS (3).** **Step 5: Commit** `git add src/storage/repos.ts tests/storage/repos.test.ts && git commit -m "feat: add agent/workItem/link repositories"`

---

## Task 6: CLI runner harness

**Files:** Create `src/cli/run.ts`; Test `tests/cli/run.test.ts`.

The runner: resolves format (explicit `--format`/`-o` > `APM_FORMAT` env > human if TTY else json), locates `.apm/apm.db` (walk up from cwd or `--dir`), opens `SqliteStorage`, builds a `Ctx { storage, clock, out, format }`, runs the usecase `fn(ctx) -> { data, session? }`, renders the ok envelope, and on `ApmError` renders the fail envelope and sets `process.exitCode = exitFor(err)`. Reads are the usecase's responsibility (it opens its own transactions on `ctx.storage`).

- [ ] **Step 1: Failing test** `tests/cli/run.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { runCommand, findProjectDb, resolveFormat } from '../../src/cli/run.js';
import { fixedClock } from '../../src/domain/clock.js';
import { ApmError } from '../../src/domain/errors.js';

let dir: string;
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-run-')); initProject(dir, clock); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('runCommand', () => {
  it('renders an ok envelope and exit 0', () => {
    const lines: string[] = [];
    const code = runCommand({ dir, clock, format: 'json', out: (s) => lines.push(s) }, 'demo', () => ({ data: { hello: 'world' } }));
    expect(code).toBe(0);
    const env = JSON.parse(lines.join('\n'));
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ hello: 'world' });
    expect(env.meta.command).toBe('demo');
  });

  it('renders a fail envelope and the mapped exit code', () => {
    const lines: string[] = [];
    const code = runCommand({ dir, clock, format: 'json', out: (s) => lines.push(s) }, 'demo', () => { throw new ApmError('E_NOT_FOUND', 'nope'); });
    expect(code).toBe(44);
    const env = JSON.parse(lines.join('\n'));
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe('E_NOT_FOUND');
  });

  it('findProjectDb walks up to locate .apm', () => {
    expect(findProjectDb(dir)).toBe(join(dir, '.apm', 'apm.db'));
  });

  it('resolveFormat prefers explicit over env over default', () => {
    expect(resolveFormat('yaml', { APM_FORMAT: 'json' }, false)).toBe('yaml');
    expect(resolveFormat(undefined, { APM_FORMAT: 'json' }, false)).toBe('json');
    expect(resolveFormat(undefined, {}, true)).toBe('human');
    expect(resolveFormat(undefined, {}, false)).toBe('json');
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/cli/run.ts`

```ts
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import { SqliteStorage } from '../storage/sqlite.js';
import type { Storage } from '../storage/storage.js';
import { ApmError, exitFor } from '../domain/errors.js';
import { ok, fail, buildMeta } from '../format/envelope.js';
import { render, type OutputFormat } from '../format/render.js';

export interface RunDeps {
  dir?: string;
  clock?: Clock;
  format?: OutputFormat;
  out?: (line: string) => void;
}

export interface Ctx { storage: Storage; clock: Clock; }
export interface CmdResult { data: unknown; session?: string; }

export function resolveFormat(explicit: string | undefined, env: Record<string, string | undefined>, isTty: boolean): OutputFormat {
  const pick = (explicit ?? env.APM_FORMAT ?? (isTty ? 'human' : 'json')) as OutputFormat;
  return (['human', 'json', 'yaml', 'agent'] as const).includes(pick) ? pick : 'json';
}

/** Walk up from `start` to find a `.apm/apm.db`. Throws E_NOT_FOUND if none. */
export function findProjectDb(start: string): string {
  let cur = resolve(start);
  for (;;) {
    const candidate = join(cur, '.apm', 'apm.db');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cur);
    if (parent === cur) throw new ApmError('E_NOT_FOUND', 'no APM project found (run `apm init`)');
    cur = parent;
  }
}

export function runCommand(deps: RunDeps, command: string, fn: (ctx: Ctx) => CmdResult): number {
  const clock = deps.clock ?? systemClock;
  const out = deps.out ?? ((s: string) => process.stdout.write(s + '\n'));
  const format = deps.format ?? 'json';
  let storage: Storage | undefined;
  try {
    const dbPath = findProjectDb(deps.dir ?? process.cwd());
    storage = new SqliteStorage(dbPath, clock);
    const result = fn({ storage, clock });
    out(render(format, ok(result.data, buildMeta(command, clock, result.session))));
    return 0;
  } catch (err) {
    const apm = err instanceof ApmError ? err : new ApmError('E_INTERNAL', String((err as Error)?.message ?? err));
    out(render(format, fail(apm, buildMeta(command, clock))));
    return exitFor(apm);
  } finally {
    storage?.close();
  }
}
```

- [ ] **Step 4: Run, expect PASS (4).** **Step 5: Commit** `git add src/cli/run.ts tests/cli/run.test.ts && git commit -m "feat: add CLI runner harness with format resolution"`

---

## Task 7: work create / show / list / children

**Files:** Create `src/usecases/work.ts`; Test `tests/usecases/work.test.ts`.

Implement usecase functions that take `(ctx, args)` and return canonical data. Validation throws `ApmError('E_VALIDATION', …, issues)`. `show`/`byId` throws `E_NOT_FOUND` when missing. Build `WorkItemView` via mappers, computing rels (depends_on via links; blocker_ids/artifact_ids = [] in Plan 2 — wired in Plan 3; active_run = null in Plan 2 — wired in Plan 3; lease = live lease id from the leases table).

- [ ] **Step 1: Failing test** `tests/usecases/work.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-work-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('work usecases', () => {
  it('creates a work item and returns the canonical view', () => {
    const v = work.create(ctx(), { type: 'feature', title: 'Offline', description: 'sync', priority: 1, estimate: 'M', agent: 'claude' });
    expect(v).toMatchObject({ id: 'WI-1', type: 'feature', title: 'Offline', status: 'draft', estimate: 'M', created_by: 'claude' });
  });

  it('rejects an invalid estimate', () => {
    expect(() => work.create(ctx(), { type: 'feature', title: 'X', estimate: 'XXL' as any, agent: 'claude' }))
      .toThrowError(/estimate/i);
  });

  it('rejects an invalid type', () => {
    expect(() => work.create(ctx(), { type: 'widget' as any, title: 'X', agent: 'claude' })).toThrowError(/type/i);
  });

  it('shows a created item; 404s a missing one', () => {
    work.create(ctx(), { type: 'task', title: 'A', agent: 'claude' });
    expect(work.show(ctx(), 'WI-1').id).toBe('WI-1');
    expect(() => work.show(ctx(), 'WI-99')).toThrowError(/not found/i);
  });

  it('lists with pagination metadata', () => {
    for (let i = 0; i < 3; i++) work.create(ctx(), { type: 'task', title: `T${i}`, agent: 'claude' });
    const page = work.list(ctx(), { limit: 2, offset: 0 });
    expect(page.items).toHaveLength(2);
    expect(page.page).toEqual({ total: 3, limit: 2, offset: 0, has_more: true });
  });

  it('lists children of a parent', () => {
    const p = work.create(ctx(), { type: 'feature', title: 'P', agent: 'claude' });
    work.create(ctx(), { type: 'task', title: 'C', parent: p.id, agent: 'claude' });
    const kids = work.children(ctx(), p.id);
    expect(kids.items.map((k) => k.title)).toEqual(['C']);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/usecases/work.ts`. Use this exact contract; the implementer writes bodies following the repo pattern from Task 5 and the mappers from Task 2.

```ts
import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { WORK_ITEM_TYPES, ESTIMATES, type WorkItemType, type Estimate } from '../domain/types.js';
import { toWorkItemView, type WorkItemView, type Page } from '../domain/entities.js';

export interface CreateArgs { type: WorkItemType; title: string; description?: string; priority?: number; estimate?: Estimate; parent?: string; agent: string; }

/** Build the canonical view for a work-item id inside an existing tx. */
function view(tx: any, id: string): WorkItemView {
  const r = repos(tx);
  const row = r.workItems.byId(id);
  if (!row) throw new ApmError('E_NOT_FOUND', `${id} not found`);
  const lease = tx.get("SELECT id FROM leases WHERE work_item_id=? AND status='active' AND expires_at > ?", id, tx.now()) as { id: string } | undefined;
  return toWorkItemView(row, {
    dependsOn: r.links.dependsOn(id),
    blockerIds: [],      // Plan 3
    artifactIds: [],     // Plan 3
    activeRun: null,     // Plan 3
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
```

- [ ] **Step 4: Run, expect PASS (6).** **Step 5: Commit** `git add src/usecases/work.ts tests/usecases/work.test.ts && git commit -m "feat: add work create/show/list/children usecases"`

---

## Task 8: work update / link / cancel

**Files:** Modify `src/usecases/work.ts`; Test add to `tests/usecases/work.test.ts`.

`update` sets allowed mutable fields (title, description, priority, estimate, status). Status transitions validated: allowed targets from current per a transition table; cannot set `completed` here while children non-terminal (the child guard; run guard added Plan 3). `link(source, --depends-on target)` validates both exist and rejects self-link + a cycle (simple: target must not be an ancestor via depends_on/parent — V1: reject direct reciprocal + self). `cancel` sets status=cancelled, cascades children→cancelled and releases active leases on the subtree, all in one immediate txn.

- [ ] **Step 1: Failing test** (append inside the describe block)

```ts
  it('updates title and estimate', () => {
    work.create(ctx(), { type: 'task', title: 'A', agent: 'claude' });
    const v = work.update(ctx(), 'WI-1', { title: 'A2', estimate: 'L' }, 'claude');
    expect(v.title).toBe('A2'); expect(v.estimate).toBe('L');
  });

  it('rejects an invalid status transition', () => {
    work.create(ctx(), { type: 'task', title: 'A', agent: 'claude' }); // draft
    expect(() => work.update(ctx(), 'WI-1', { status: 'completed' }, 'claude')).toThrowError(/transition/i);
  });

  it('links a dependency and reflects it in the view', () => {
    work.create(ctx(), { type: 'feature', title: 'A', agent: 'claude' });
    work.create(ctx(), { type: 'task', title: 'B', agent: 'claude' });
    work.link(ctx(), 'WI-1', 'WI-2', 'claude');
    expect(work.show(ctx(), 'WI-1').depends_on).toEqual(['WI-2']);
  });

  it('rejects a self-dependency', () => {
    work.create(ctx(), { type: 'task', title: 'A', agent: 'claude' });
    expect(() => work.link(ctx(), 'WI-1', 'WI-1', 'claude')).toThrowError(/self/i);
  });

  it('cancels a parent and cascades to children', () => {
    const p = work.create(ctx(), { type: 'feature', title: 'P', agent: 'claude' });
    work.create(ctx(), { type: 'task', title: 'C', parent: p.id, agent: 'claude' });
    work.cancel(ctx(), p.id, 'claude');
    expect(work.show(ctx(), p.id).status).toBe('cancelled');
    expect(work.show(ctx(), 'WI-2').status).toBe('cancelled');
  });
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — add to `src/usecases/work.ts`:

```ts
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
```

NOTE: `complete` (the explicit `apm work complete` command) is `update(..., {status:'completed'})`; the full run guard (no non-terminal workflow runs) is added in Plan 3. Plan 2 enforces the child guard only.

- [ ] **Step 4: Run, expect PASS (5 more).** **Step 5: Commit** `git add src/usecases/work.ts tests/usecases/work.test.ts && git commit -m "feat: add work update/link/cancel with transition + cascade rules"`

---

## Task 9: Sessions

**Files:** Create `src/usecases/session.ts`; Test `tests/usecases/session.test.ts`.

`start(agent)` ensures the agent and returns the live session, creating one if none (partial-unique enforces one live per agent; if a live session exists, return it). `resolveCurrent(agent)` returns the live session id or, if none, starts one — used by Plan 4's `--session current`. `summarize(id, body)` sets context_summary + last_seen_at. `end(id)` sets status=ended + ended_at. `show(id)` returns the view.

- [ ] **Step 1: Failing test** `tests/usecases/session.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as session from '../../src/usecases/session.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-sess-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('session usecases', () => {
  it('starts a live session for an agent', () => {
    const s = session.start(ctx(), 'claude');
    expect(s.id).toBe('S-1'); expect(s.agent).toBe('claude'); expect(s.status).toBe('active');
  });

  it('start is idempotent while a live session exists (one live per agent)', () => {
    const a = session.start(ctx(), 'claude');
    const b = session.start(ctx(), 'claude');
    expect(b.id).toBe(a.id);
  });

  it('summarize records the context summary', () => {
    session.start(ctx(), 'claude');
    const s = session.summarize(ctx(), 'S-1', 'did stuff');
    expect(s.context_summary).toBe('did stuff');
  });

  it('end closes the session and frees the agent for a new one', () => {
    session.start(ctx(), 'claude');
    session.end(ctx(), 'S-1');
    expect(session.show(ctx(), 'S-1').status).toBe('ended');
    const s2 = session.start(ctx(), 'claude');
    expect(s2.id).toBe('S-2');
  });

  it('resolveCurrent returns the live session or starts one', () => {
    const id = session.resolveCurrent(ctx(), 'claude');
    expect(id).toBe('S-1');
    expect(session.resolveCurrent(ctx(), 'claude')).toBe('S-1');
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/usecases/session.ts` (implementer writes bodies; contract):

```ts
import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { toSessionView, type SessionView } from '../domain/entities.js';

function liveSession(tx: any, agent: string): any | undefined {
  return tx.get("SELECT * FROM sessions WHERE agent_id=? AND status IN ('active','idle')", agent);
}

export function start(ctx: Ctx, agent: string): SessionView {
  return ctx.storage.transaction('immediate', (tx) => {
    repos(tx).agents.ensure(agent);
    const existing = liveSession(tx, agent);
    if (existing) return toSessionView(existing);
    const id = tx.allocateId('S');
    tx.run("INSERT INTO sessions (id, agent_id, status, started_at, last_seen_at) VALUES (?, ?, 'active', ?, ?)", id, agent, tx.now(), tx.now());
    tx.appendEvent({ actorId: agent, eventType: 'session.started', entityType: 'session', entityId: id });
    return toSessionView(tx.get('SELECT * FROM sessions WHERE id=?', id));
  });
}

export function resolveCurrent(ctx: Ctx, agent: string): string {
  return start(ctx, agent).id; // start returns existing live session if any
}

export function show(ctx: Ctx, id: string): SessionView {
  return ctx.storage.transaction('deferred', (tx) => {
    const row = tx.get('SELECT * FROM sessions WHERE id=?', id);
    if (!row) throw new ApmError('E_NOT_FOUND', `${id} not found`);
    return toSessionView(row);
  });
}

export function summarize(ctx: Ctx, id: string, body: string): SessionView {
  return ctx.storage.transaction('immediate', (tx) => {
    const row = tx.get('SELECT * FROM sessions WHERE id=?', id);
    if (!row) throw new ApmError('E_NOT_FOUND', `${id} not found`);
    tx.run('UPDATE sessions SET context_summary=?, last_seen_at=? WHERE id=?', body, tx.now(), id);
    tx.appendEvent({ actorId: (row as any).agent_id, eventType: 'session.summarized', entityType: 'session', entityId: id });
    return toSessionView(tx.get('SELECT * FROM sessions WHERE id=?', id));
  });
}

export function end(ctx: Ctx, id: string): SessionView {
  return ctx.storage.transaction('immediate', (tx) => {
    const row = tx.get('SELECT * FROM sessions WHERE id=?', id);
    if (!row) throw new ApmError('E_NOT_FOUND', `${id} not found`);
    tx.run("UPDATE sessions SET status='ended', ended_at=? WHERE id=?", tx.now(), id);
    tx.appendEvent({ actorId: (row as any).agent_id, eventType: 'session.ended', entityType: 'session', entityId: id });
    return toSessionView(tx.get('SELECT * FROM sessions WHERE id=?', id));
  });
}
```

- [ ] **Step 4: Run, expect PASS (5).** **Step 5: Commit** `git add src/usecases/session.ts tests/usecases/session.test.ts && git commit -m "feat: add session start/show/summarize/end usecases"`

---

## Task 10: Leases

**Files:** Create `src/usecases/lease.ts`; Test `tests/usecases/lease.test.ts`.

`acquire(workItem, agent, session?, ttl)` runs under `immediate`: lazy-heal expired leases on this work item (UPDATE status='expired' WHERE work_item_id=? AND status='active' AND expires_at<=now), then INSERT a new active lease; the partial-unique index makes a second concurrent active lease fail → translate the SQLITE constraint error to `E_LEASE_CONFLICT`. `heartbeat(leaseId, ttl)` extends expires_at; if the lease is not `active` or already expired → `E_LEASE_CONFLICT` with message LEASE_LOST. `release(leaseId)` sets released (idempotent). `expireStale()` flips all active+expired to expired, returns count. `list({agent, session, mine})` returns held leases. `ttl` parses `30m|2h|45s` to seconds.

- [ ] **Step 1: Failing test** `tests/usecases/lease.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as lease from '../../src/usecases/lease.js';
import { parseTtlSeconds } from '../../src/usecases/lease.js';

let dir: string; let storage: SqliteStorage;
// clock fixed; expiry math uses an injected `now` epoch via the clock string
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-lease-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); work.create({ storage, clock }, { type: 'task', title: 'A', agent: 'claude' }); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('lease usecases', () => {
  it('parses ttl strings to seconds', () => {
    expect(parseTtlSeconds('30m')).toBe(1800);
    expect(parseTtlSeconds('2h')).toBe(7200);
    expect(parseTtlSeconds('45s')).toBe(45);
  });

  it('acquires a lease and projects work item status to active', () => {
    const l = lease.acquire(ctx(), { workItem: 'WI-1', agent: 'claude', ttl: '30m' });
    expect(l.id).toBe('LEASE-1'); expect(l.status).toBe('active'); expect(l.work_item).toBe('WI-1');
    expect(work.show(ctx(), 'WI-1').status).toBe('active');
    expect(work.show(ctx(), 'WI-1').lease).toBe('LEASE-1');
  });

  it('rejects a second active lease on the same item', () => {
    lease.acquire(ctx(), { workItem: 'WI-1', agent: 'claude', ttl: '30m' });
    expect(() => lease.acquire(ctx(), { workItem: 'WI-1', agent: 'other', ttl: '30m' })).toThrowError(/lease/i);
  });

  it('releases a lease (idempotent)', () => {
    const l = lease.acquire(ctx(), { workItem: 'WI-1', agent: 'claude', ttl: '30m' });
    lease.release(ctx(), l.id);
    lease.release(ctx(), l.id); // no throw
    expect(work.show(ctx(), 'WI-1').status).toBe('ready'); // computed back to stored status
  });

  it('lists leases held by an agent', () => {
    lease.acquire(ctx(), { workItem: 'WI-1', agent: 'claude', ttl: '30m' });
    const held = lease.list(ctx(), { agent: 'claude' });
    expect(held.items.map((l) => l.id)).toEqual(['LEASE-1']);
  });
});
```

NOTE: the stored work-item status after release is `ready` only if it was `ready` before; freshly-created items are `draft`. Adjust the release test to first set the item to `ready` (call `work.update(ctx(), 'WI-1', { status: 'ready' }, 'claude')` in that test before acquiring) so the projection assertion holds. Implementer: include that setup line.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/usecases/lease.ts`:

```ts
import Database from 'better-sqlite3';
import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { toLeaseView, type LeaseView, type Page } from '../domain/entities.js';

export function parseTtlSeconds(ttl: string): number {
  const m = /^(\d+)([smh])$/.exec(ttl);
  if (!m) throw new ApmError('E_VALIDATION', `invalid ttl: ${ttl}`, [{ field: 'ttl', problem: 'format Ns|Nm|Nh', got: ttl }]);
  const n = Number(m[1]);
  return m[2] === 's' ? n : m[2] === 'm' ? n * 60 : n * 3600;
}

function addSeconds(iso: string, secs: number): string {
  return new Date(new Date(iso).getTime() + secs * 1000).toISOString();
}

export interface AcquireArgs { workItem: string; agent: string; session?: string; ttl: string; }

export function acquire(ctx: Ctx, a: AcquireArgs): LeaseView {
  const secs = parseTtlSeconds(a.ttl);
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    if (!r.workItems.byId(a.workItem)) throw new ApmError('E_NOT_FOUND', `${a.workItem} not found`);
    r.agents.ensure(a.agent);
    // lazy-heal expired active leases on this item
    tx.run("UPDATE leases SET status='expired' WHERE work_item_id=? AND status='active' AND expires_at <= ?", a.workItem, tx.now());
    const id = tx.allocateId('LEASE');
    try {
      tx.run('INSERT INTO leases (id, work_item_id, agent_id, session_id, status, acquired_at, expires_at, heartbeat_at) VALUES (?, ?, ?, ?, \'active\', ?, ?, ?)',
        id, a.workItem, a.agent, a.session ?? null, tx.now(), addSeconds(tx.now(), secs), tx.now());
    } catch (e: any) {
      if (e instanceof Database.SqliteError && /UNIQUE/i.test(e.message)) throw new ApmError('E_LEASE_CONFLICT', `${a.workItem} is already leased`);
      throw e;
    }
    tx.appendEvent({ actorId: a.agent, eventType: 'lease.acquired', entityType: 'lease', entityId: id, payload: { work_item: a.workItem } });
    return toLeaseView(tx.get('SELECT * FROM leases WHERE id=?', id));
  });
}

export function heartbeat(ctx: Ctx, leaseId: string, ttl: string): LeaseView {
  const secs = parseTtlSeconds(ttl);
  return ctx.storage.transaction('immediate', (tx) => {
    const row = tx.get('SELECT * FROM leases WHERE id=?', leaseId) as any;
    if (!row) throw new ApmError('E_NOT_FOUND', `${leaseId} not found`);
    if (row.status !== 'active' || row.expires_at <= tx.now()) throw new ApmError('E_LEASE_CONFLICT', 'LEASE_LOST');
    tx.run('UPDATE leases SET expires_at=?, heartbeat_at=? WHERE id=?', addSeconds(tx.now(), secs), tx.now(), leaseId);
    return toLeaseView(tx.get('SELECT * FROM leases WHERE id=?', leaseId));
  });
}

export function release(ctx: Ctx, leaseId: string): LeaseView {
  return ctx.storage.transaction('immediate', (tx) => {
    const row = tx.get('SELECT * FROM leases WHERE id=?', leaseId) as any;
    if (!row) throw new ApmError('E_NOT_FOUND', `${leaseId} not found`);
    if (row.status === 'active') {
      tx.run("UPDATE leases SET status='released' WHERE id=?", leaseId);
      tx.appendEvent({ actorId: row.agent_id, eventType: 'lease.released', entityType: 'lease', entityId: leaseId });
    }
    return toLeaseView(tx.get('SELECT * FROM leases WHERE id=?', leaseId));
  });
}

export function expireStale(ctx: Ctx): { expired: number } {
  return ctx.storage.transaction('immediate', (tx) => {
    const before = (tx.get("SELECT count(*) c FROM leases WHERE status='active' AND expires_at <= ?", tx.now()) as { c: number }).c;
    tx.run("UPDATE leases SET status='expired' WHERE status='active' AND expires_at <= ?", tx.now());
    return { expired: before };
  });
}

export interface ListArgs { agent?: string; session?: string; mine?: boolean; }
export function list(ctx: Ctx, a: ListArgs): Page<LeaseView> {
  return ctx.storage.transaction('deferred', (tx) => {
    const where = ["status='active'"]; const params: unknown[] = [];
    if (a.agent) { where.push('agent_id=?'); params.push(a.agent); }
    if (a.session) { where.push('session_id=?'); params.push(a.session); }
    const rows = tx.all(`SELECT * FROM leases WHERE ${where.join(' AND ')} ORDER BY id`, ...params) as any[];
    return { items: rows.map(toLeaseView), page: { total: rows.length, limit: rows.length, offset: 0, has_more: false } };
  });
}
```

- [ ] **Step 4: Run, expect PASS (5).** **Step 5: Commit** `git add src/usecases/lease.ts tests/usecases/lease.test.ts && git commit -m "feat: add lease acquire/heartbeat/release/expire-stale/list"`

---

## Task 11: Wire CLI command groups

**Files:** Modify `src/cli/program.ts`; Test `tests/cli/commands.test.ts`.

Add `work`, `session`, `lease` subcommands that call usecases through `runCommand`. Add global `-o, --format <fmt>` and `--dir <path>` options read by each action. Default agent for commands lacking `--agent`: require `--agent` where the usecase needs it (work create, session start, lease acquire); error `E_VALIDATION` if missing. The action handlers build `RunDeps` from global opts + `process.env` + `process.stdout.isTTY`.

- [ ] **Step 1: Failing test** `tests/cli/commands.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { buildProgram } from '../../src/cli/program.js';
import { fixedClock } from '../../src/domain/clock.js';

let dir: string; const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-cmd-')); initProject(dir, clock); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function runCli(args: string[]): { out: string; code: number } {
  const lines: string[] = [];
  const program = buildProgram({ clock, out: (s) => lines.push(s), defaultFormat: 'json' });
  let code = 0;
  const orig = process.exitCode;
  program.parse(['--dir', dir, ...args], { from: 'user' });
  code = (process.exitCode as number) ?? 0;
  process.exitCode = orig;
  return { out: lines.join('\n'), code };
}

describe('cli command groups', () => {
  it('work create -> show -> list round trip', () => {
    const created = JSON.parse(runCli(['work', 'create', '--type', 'feature', '--title', 'Offline', '--agent', 'claude']).out);
    expect(created.ok).toBe(true); expect(created.data.id).toBe('WI-1');
    const shown = JSON.parse(runCli(['work', 'show', 'WI-1']).out);
    expect(shown.data.title).toBe('Offline');
    const listed = JSON.parse(runCli(['work', 'list']).out);
    expect(listed.data.items).toHaveLength(1);
  });

  it('lease acquire reports active and conflict exit code', () => {
    runCli(['work', 'create', '--type', 'task', '--title', 'A', '--agent', 'claude']);
    const ok = runCli(['lease', 'acquire', 'WI-1', '--agent', 'claude', '--ttl', '30m']);
    expect(JSON.parse(ok.out).data.status).toBe('active');
    const conflict = runCli(['lease', 'acquire', 'WI-1', '--agent', 'other', '--ttl', '30m']);
    expect(conflict.code).toBe(10);
    expect(JSON.parse(conflict.out).error.code).toBe('E_LEASE_CONFLICT');
  });

  it('missing project gives E_NOT_FOUND exit 44', () => {
    const lines: string[] = [];
    const program = buildProgram({ clock, out: (s) => lines.push(s), defaultFormat: 'json' });
    program.parse(['--dir', join(dir, 'nope'), 'work', 'list'], { from: 'user' });
    expect((process.exitCode as number)).toBe(44);
    process.exitCode = 0;
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — extend `buildProgram` in `src/cli/program.ts`. Add a `defaultFormat?` to `ProgramDeps` (tests inject json). Each action constructs `RunDeps` and calls `runCommand`. Pattern for one command (implementer applies to all):

```ts
// inside buildProgram, after the existing init command
function deps(cmd: Command): RunDeps {
  const g = program.opts() as { format?: string; dir?: string };
  return {
    dir: g.dir,
    clock,
    format: resolveFormat(g.format, process.env, Boolean(process.stdout.isTTY)) ,
    out,
  };
}
program.option('-o, --format <fmt>', 'output format: human|json|yaml|agent');
program.option('--dir <path>', 'project directory');
// NOTE: when deps.defaultFormat is set (tests), prefer it over TTY detection.

const workCmd = program.command('work').description('work items');
workCmd.command('create').requiredOption('--type <type>').requiredOption('--title <title>')
  .option('--description <d>').option('--priority <n>', 'priority', (v) => parseInt(v, 10))
  .option('--estimate <e>').option('--parent <id>').requiredOption('--agent <name>')
  .action((o) => { process.exitCode = runCommand(deps(workCmd), 'work create', (ctx) => ({ data: work.create(ctx, { type: o.type, title: o.title, description: o.description, priority: o.priority, estimate: o.estimate, parent: o.parent, agent: o.agent }) })); });
// ... show/list/update/link/children/cancel/complete, session start/show/summarize/end, lease acquire/heartbeat/release/expire-stale/list
```

Implementer: wire EVERY command in the Plan-2 surface: `work create|show|list|update|link|children|cancel|complete`, `session start|show|summarize|end`, `lease acquire|heartbeat|release|expire-stale|list`. `complete` = `work.update(ctx, id, {status:'completed'}, agent)`. For `defaultFormat` injection (tests), have `deps()` use `deps.defaultFormat ?? resolveFormat(...)`. Keep `init` working.

- [ ] **Step 4: Run, expect PASS (3).** Then full `npm test`. **Step 5: Commit** `git add src/cli/program.ts tests/cli/commands.test.ts && git commit -m "feat: wire work/session/lease CLI command groups"`

---

## Task 12: Integration test, build gate, docs

**Files:** Create `tests/integration/plan2-flow.test.ts`; Modify `CLAUDE.md`.

- [ ] **Step 1: Write an end-to-end flow test** `tests/integration/plan2-flow.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as session from '../../src/usecases/session.js';
import * as lease from '../../src/usecases/lease.js';

let dir: string; let storage: SqliteStorage; const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-int-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('plan 2 integration', () => {
  it('create -> ready -> session -> lease -> release lifecycle', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'Offline', estimate: 'M', agent: 'claude' });
    work.update(ctx(), wi.id, { status: 'ready' }, 'claude');
    const s = session.start(ctx(), 'claude');
    const l = lease.acquire(ctx(), { workItem: wi.id, agent: 'claude', session: s.id, ttl: '30m' });
    expect(work.show(ctx(), wi.id).status).toBe('active');
    const held = lease.list(ctx(), { agent: 'claude' });
    expect(held.items).toHaveLength(1);
    lease.release(ctx(), l.id);
    expect(work.show(ctx(), wi.id).status).toBe('ready');
    session.end(ctx(), s.id);
    expect(session.show(ctx(), s.id).status).toBe('ended');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/integration/plan2-flow.test.ts` (expect PASS) and full `npm test` (all green) and `npm run typecheck` and `npm run build`.

- [ ] **Step 3: Update `CLAUDE.md`** Commands section — append under the existing bullet list:

```markdown
- Work items: `apm work create --type <t> --title <s> --agent <a>` · `work show <id>` · `work list` · `work update <id> --status ready` · `work link <id> --depends-on <id>` · `work children <id>` · `work cancel <id>` · `work complete <id>`
- Sessions: `apm session start --agent <a>` · `session show <id>` · `session summarize <id> --body <s>` · `session end <id>`
- Leases: `apm lease acquire <wi> --agent <a> --ttl 30m` · `lease heartbeat <id> --ttl 30m` · `lease release <id>` · `lease expire-stale` · `lease list --agent <a>`
- Global: `-o, --format human|json|yaml|agent` (default human at TTY, json piped; `APM_FORMAT` to pin)
```

- [ ] **Step 4: Commit** `git add tests/integration/plan2-flow.test.ts CLAUDE.md && git commit -m "test: plan 2 integration flow; docs: command reference"`

---

## Self-Review

**Spec coverage:** envelope/canonical-entities/renderers/error+exit model (§7) → Tasks 1–4,6. work create/show/list/update/link/children/cancel/complete (§8) → Tasks 7–8,11. session start/show/summarize/end (§8) → Tasks 9,11. lease acquire/heartbeat/release/expire-stale/list (§8) → Tasks 10,11. computed-`active` projection + lazy heal (§4,§6) → Tasks 2,7,10. exit-code taxonomy (§7.3) → Task 1,11. format resolution + APM_FORMAT (§7.1) → Task 6. **Deferred (not gaps):** `work current`/`work blockers` (Plan 3/4), full completion run-guard (Plan 3), agent-format projection + `apm status` + `next` (Plan 4), policy/prompt/decision/adr/blocker/gate/workflow commands (Plan 3).

**Placeholder scan:** the only stub is `links.add` in Task 5 step 3, explicitly replaced in the following NOTE block with the real `INSERT OR IGNORE` body — implementer must use the replacement. No other placeholders.

**Type consistency:** `Ctx` ({storage, clock}) is shared by run.ts and every usecase; `WorkItemView/SessionView/LeaseView/Page` come from entities.ts; `ApmError`/`ErrorCode` from errors.ts; `repos(tx)` shape is used uniformly; envelope `ok/fail/buildMeta` and `render(format, env)` signatures match across tasks.
