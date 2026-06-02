# APM V1 — Plan 1: Foundation & Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the APM TypeScript project and its storage foundation — schema, migrations, type-prefixed ID sequences, a transaction-boundary storage abstraction over SQLite, an append-only event log, and a working `apm init` command.

**Architecture:** Layered/hexagonal. `domain/` is pure (types, ID prefixes, injected clock). `storage/` owns the SQLite schema, a migration runner, and a `Storage` object whose single abstraction is `transaction(mode, fn)` exposing typed query helpers. `usecases/` open transactions and orchestrate; `cli/` wires commander to usecases. Every mutation allocates IDs from a `sequences` table and appends an `events` row in the same transaction.

**Tech Stack:** Node 24, TypeScript, `better-sqlite3` (synchronous; `.immediate()` transactions for writes), `commander`, `yaml`, `vitest`. Tests run against `:memory:` databases with an injected clock for determinism.

This plan is the foundation referenced by Plans 2–4 (work graph, engine, next-resolver). It establishes the schema for the *entire* V1 (all tables), but only `init` + storage primitives are exercised by commands here; later plans add usecases over the same schema.

---

## File Structure

- `package.json`, `tsconfig.json`, `vitest.config.ts` — project config.
- `src/bin/apm.ts` — CLI entrypoint (shebang), builds the commander program.
- `src/cli/program.ts` — assembles the commander root; Plan 1 registers only `init`.
- `src/domain/clock.ts` — `Clock` interface + `systemClock`; ISO-8601-Z formatting.
- `src/domain/ids.ts` — ID prefix constants + `formatId`/`parseId`.
- `src/domain/types.ts` — entity TypeScript types + status enums (string unions).
- `src/storage/schema.sql` — the complete V1 DDL (all tables, indexes, triggers, CHECKs).
- `src/storage/migrations.ts` — numbered migration runner keyed on `PRAGMA user_version`.
- `src/storage/sqlite.ts` — `openDatabase(path)` (pragmas) + `SqliteStorage` implementing `Storage`.
- `src/storage/storage.ts` — `Storage` + `Tx` interfaces; `allocateId`, `appendEvent` helpers live on `Tx`.
- `src/usecases/init.ts` — `initProject(dir)`; creates `.apm/`, db, config, runs migrations.
- `tests/storage/*.test.ts`, `tests/usecases/init.test.ts` — vitest specs.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Test: `tests/smoke.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "apm",
  "version": "0.1.0",
  "description": "Agent Project Manager — durable project-execution state CLI",
  "type": "module",
  "bin": { "apm": "dist/bin/apm.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "apm": "tsx src/bin/apm.ts"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "commander": "^12.1.0",
    "yaml": "^2.5.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.7.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Create `src/index.ts`** (placeholder export so the package has a root module)

```ts
export const VERSION = '0.1.0';
```

- [ ] **Step 5: Write the smoke test** at `tests/smoke.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

describe('smoke', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 6: Install deps and run the smoke test**

Run: `npm install && npm test`
Expected: 1 passing test (`tests/smoke.test.ts`). `better-sqlite3` compiles during install.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/index.ts tests/smoke.test.ts package-lock.json
git commit -m "chore: scaffold APM TypeScript project with vitest"
```

---

## Task 2: Clock abstraction

**Files:**
- Create: `src/domain/clock.ts`
- Test: `tests/domain/clock.test.ts`

The resolver and lease/expiry logic must be deterministic in tests, so "now" is always injected, never read via `Date.now()` inside domain code.

- [ ] **Step 1: Write the failing test** at `tests/domain/clock.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { fixedClock, isoZ } from '../../src/domain/clock.js';

describe('clock', () => {
  it('fixedClock returns the same instant', () => {
    const clock = fixedClock('2026-06-02T12:00:00.000Z');
    expect(clock.now()).toBe('2026-06-02T12:00:00.000Z');
    expect(clock.now()).toBe('2026-06-02T12:00:00.000Z');
  });

  it('isoZ formats an epoch-ms as zero-padded UTC Z', () => {
    expect(isoZ(0)).toBe('1970-01-01T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/clock.test.ts`
Expected: FAIL — cannot find module `clock.js`.

- [ ] **Step 3: Write the implementation** at `src/domain/clock.ts`

```ts
/** A source of "now" as a UTC ISO-8601 string ending in Z. Always injected. */
export interface Clock {
  now(): string;
}

/** Format epoch milliseconds as zero-padded UTC ISO-8601 with a Z suffix. */
export function isoZ(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** Real clock — the ONLY place argless `new Date()` is permitted. */
export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

/** Deterministic clock for tests. */
export function fixedClock(iso: string): Clock {
  return { now: () => iso };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/clock.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/clock.ts tests/domain/clock.test.ts
git commit -m "feat: add injectable Clock with UTC-Z formatting"
```

---

## Task 3: ID prefixes & formatting

**Files:**
- Create: `src/domain/ids.ts`
- Test: `tests/domain/ids.test.ts`

- [ ] **Step 1: Write the failing test** at `tests/domain/ids.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { ID_PREFIXES, formatId, parseId, artifactRef } from '../../src/domain/ids.js';

describe('ids', () => {
  it('lists every entity prefix', () => {
    expect(ID_PREFIXES.workItem).toBe('WI');
    expect(ID_PREFIXES.blocker).toBe('BLK');
    expect(ID_PREFIXES.workflowRun).toBe('WR');
    // gates share the blocker space — there is no HG prefix
    expect(Object.values(ID_PREFIXES)).not.toContain('HG');
  });

  it('formats a prefix + number into an id', () => {
    expect(formatId('WI', 123)).toBe('WI-123');
  });

  it('parses an id back into prefix + number', () => {
    expect(parseId('ART-9')).toEqual({ prefix: 'ART', value: 9 });
  });

  it('throws on a malformed id', () => {
    expect(() => parseId('nonsense')).toThrow(/invalid id/i);
  });

  it('renders a compact artifact version ref', () => {
    expect(artifactRef('ART-1', 2)).toBe('ART-1@2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/ids.test.ts`
Expected: FAIL — cannot find module `ids.js`.

- [ ] **Step 3: Write the implementation** at `src/domain/ids.ts`

```ts
/** Type-prefixed monotonic ID scheme. Gates are blockers — no HG prefix. */
export const ID_PREFIXES = {
  workItem: 'WI',
  artifact: 'ART',
  decision: 'DEC',
  adr: 'ADR',
  blocker: 'BLK',
  workflowRun: 'WR',
  lease: 'LEASE',
  session: 'S',
  workflowDefinition: 'WD',
  promptDefinition: 'PD',
  policy: 'POL',
  event: 'EV',
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

export function formatId(prefix: IdPrefix, value: number): string {
  return `${prefix}-${value}`;
}

export function parseId(id: string): { prefix: string; value: number } {
  const m = /^([A-Z]+)-(\d+)$/.exec(id);
  if (!m) throw new Error(`invalid id: ${id}`);
  return { prefix: m[1], value: Number(m[2]) };
}

/** Compact artifact version reference, e.g. ART-1@2. */
export function artifactRef(artifactId: string, version: number): string {
  return `${artifactId}@${version}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/ids.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/ids.ts tests/domain/ids.test.ts
git commit -m "feat: add type-prefixed id scheme and formatting"
```

---

## Task 4: Entity types & status enums

**Files:**
- Create: `src/domain/types.ts`
- Test: `tests/domain/types.test.ts`

These string-union enums are the single source of truth mirrored by the SQL `CHECK` constraints in Task 5.

- [ ] **Step 1: Write the failing test** at `tests/domain/types.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  WORK_ITEM_STATUSES,
  WORK_ITEM_TYPES,
  ARTIFACT_STATUSES,
  ESTIMATES,
  STEP_TYPES,
} from '../../src/domain/types.js';

describe('enums', () => {
  it('work item statuses exclude the computed `active`', () => {
    expect(WORK_ITEM_STATUSES).toEqual(['draft', 'ready', 'blocked', 'completed', 'cancelled']);
    expect(WORK_ITEM_STATUSES).not.toContain('active');
  });

  it('covers all spec work item types', () => {
    expect(WORK_ITEM_TYPES).toContain('feature');
    expect(WORK_ITEM_TYPES).toContain('human_gate');
    expect(WORK_ITEM_TYPES).toHaveLength(10);
  });

  it('artifact statuses follow the spec lifecycle', () => {
    expect(ARTIFACT_STATUSES).toEqual(['draft', 'review', 'approved', 'superseded', 'archived']);
  });

  it('estimates are the t-shirt scale', () => {
    expect(ESTIMATES).toEqual(['XS', 'S', 'M', 'L', 'XL']);
  });

  it('lists every workflow step type', () => {
    expect(STEP_TYPES).toEqual([
      'agent_prompt', 'agent_execution', 'review_gate', 'human_gate',
      'decision', 'decompose', 'integration', 'integration_loop', 'manual', 'terminal',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/types.test.ts`
Expected: FAIL — cannot find module `types.js`.

- [ ] **Step 3: Write the implementation** at `src/domain/types.ts`

```ts
export const WORK_ITEM_TYPES = [
  'project', 'goal', 'milestone', 'feature', 'task',
  'subtask', 'bug', 'research', 'human_gate', 'maintenance',
] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

// `active` is NOT stored — it is computed from a live lease. Stored lifecycle only.
export const WORK_ITEM_STATUSES = ['draft', 'ready', 'blocked', 'completed', 'cancelled'] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const ESTIMATES = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type Estimate = (typeof ESTIMATES)[number];

export const ARTIFACT_TYPES = [
  'spec', 'adr', 'decision', 'design', 'plan', 'review', 'handoff', 'work_log', 'status_report',
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const ARTIFACT_STATUSES = ['draft', 'review', 'approved', 'superseded', 'archived'] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export const WORKFLOW_RUN_STATUSES = ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const STEP_RUN_STATUSES = ['pending', 'running', 'completed', 'failed', 'skipped'] as const;
export type StepRunStatus = (typeof STEP_RUN_STATUSES)[number];

export const REVIEW_VERDICTS = ['pass', 'reject', 'abstain'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const SESSION_STATUSES = ['active', 'idle', 'ended'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const LEASE_STATUSES = ['active', 'released', 'expired'] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

export const BLOCKER_STATUSES = ['open', 'resolved', 'cancelled'] as const;
export type BlockerStatus = (typeof BLOCKER_STATUSES)[number];

export const DECISION_STATUSES = ['open', 'recommended', 'decided', 'cancelled'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const WORKFLOW_DEF_STATUSES = ['draft', 'active', 'deprecated', 'archived'] as const;
export type WorkflowDefStatus = (typeof WORKFLOW_DEF_STATUSES)[number];

export const STEP_TYPES = [
  'agent_prompt', 'agent_execution', 'review_gate', 'human_gate',
  'decision', 'decompose', 'integration', 'integration_loop', 'manual', 'terminal',
] as const;
export type StepType = (typeof STEP_TYPES)[number];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/types.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/types.ts tests/domain/types.test.ts
git commit -m "feat: add entity types and status enums"
```

---

## Task 5: V1 schema DDL

**Files:**
- Create: `src/storage/schema.sql`
- Test: `tests/storage/schema.test.ts`

This is the complete V1 schema (all tables, used across plans 2–4). Plan 1 only verifies it applies cleanly and enforces its key constraints.

- [ ] **Step 1: Write the failing test** at `tests/storage/schema.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const schema = readFileSync(fileURLToPath(new URL('../../src/storage/schema.sql', import.meta.url)), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  return db;
}

describe('schema', () => {
  it('applies cleanly', () => {
    const db = freshDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    for (const t of ['work_items', 'leases', 'workflow_runs', 'workflow_step_runs', 'artifacts',
      'blockers', 'decisions', 'policies', 'events', 'sequences', 'schema_migrations',
      'agents', 'sessions', 'workflow_definitions', 'prompt_definitions', 'work_item_links', 'work_item_artifacts']) {
      expect(tables).toContain(t);
    }
    db.close();
  });

  it('rejects an invalid work_item status via CHECK', () => {
    const db = freshDb();
    const insert = () => db.prepare(
      "INSERT INTO work_items (id,type,title,status,created_at,updated_at) VALUES ('WI-1','feature','t','bogus','2026-06-02T00:00:00.000Z','2026-06-02T00:00:00.000Z')"
    ).run();
    expect(insert).toThrow(/CHECK/i);
    db.close();
  });

  it('enforces one active lease per work item', () => {
    const db = freshDb();
    db.exec("INSERT INTO agents (id,name,type,created_at) VALUES ('A','claude','agent','2026-06-02T00:00:00.000Z')");
    db.exec("INSERT INTO work_items (id,type,title,status,created_at,updated_at) VALUES ('WI-1','feature','t','ready','2026-06-02T00:00:00.000Z','2026-06-02T00:00:00.000Z')");
    const lease = (id: string) => db.prepare(
      "INSERT INTO leases (id,work_item_id,agent_id,status,acquired_at,expires_at) VALUES (?, 'WI-1','A','active','2026-06-02T00:00:00.000Z','2026-06-02T01:00:00.000Z')"
    ).run(id);
    lease('LEASE-1');
    expect(() => lease('LEASE-2')).toThrow(/UNIQUE/i);
    db.close();
  });

  it('blocks a human_gate blocker resolved without an answer', () => {
    const db = freshDb();
    db.exec("INSERT INTO work_items (id,type,title,status,created_at,updated_at) VALUES ('WI-1','feature','t','blocked','2026-06-02T00:00:00.000Z','2026-06-02T00:00:00.000Z')");
    const bad = () => db.prepare(
      "INSERT INTO blockers (id,work_item_id,blocker_type,reason,status,question,options_json,created_at) VALUES ('BLK-1','WI-1','human_gate','need decision','resolved','Which?','[\"a\",\"b\"]','2026-06-02T00:00:00.000Z')"
    ).run();
    expect(bad).toThrow(/CHECK/i);
    db.close();
  });

  it('makes workflow_definitions immutable once inserted', () => {
    const db = freshDb();
    db.exec("INSERT INTO workflow_definitions (id,name,version,definition_json,status,created_at) VALUES ('WD-1','feature_delivery',1,'{}','active','2026-06-02T00:00:00.000Z')");
    expect(() => db.exec("UPDATE workflow_definitions SET definition_json='{\"x\":1}' WHERE id='WD-1'")).toThrow(/immutable/i);
    // status transitions are still allowed
    expect(() => db.exec("UPDATE workflow_definitions SET status='deprecated' WHERE id='WD-1'")).not.toThrow();
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage/schema.test.ts`
Expected: FAIL — cannot read `schema.sql`.

- [ ] **Step 3: Write the schema** at `src/storage/schema.sql`

```sql
-- APM V1 schema. Timestamps are TEXT, strict UTC ISO-8601 with Z.
-- foreign_keys is enabled by the connection; ON DELETE RESTRICT everywhere (soft-delete via status).

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE sequences (
  prefix TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  capabilities TEXT,            -- JSON array of strings
  created_at TEXT NOT NULL
);

CREATE TABLE work_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','ready','blocked','completed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  estimate TEXT CHECK (estimate IS NULL OR estimate IN ('XS','S','M','L','XL')),
  parent_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(parent_id) REFERENCES work_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(created_by) REFERENCES agents(id) ON DELETE RESTRICT
);

CREATE TABLE work_item_links (
  id TEXT PRIMARY KEY,
  source_work_item_id TEXT NOT NULL,
  target_work_item_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(source_work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(target_work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ux_link ON work_item_links(source_work_item_id, target_work_item_id, link_type);
CREATE INDEX ix_link_type ON work_item_links(link_type, source_work_item_id, target_work_item_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','idle','ended')),
  context_summary TEXT,
  started_at TEXT NOT NULL,
  last_seen_at TEXT,
  ended_at TEXT,
  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ux_session_live ON sessions(agent_id) WHERE status IN ('active','idle');

CREATE TABLE leases (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','released','expired')),
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  heartbeat_at TEXT,
  FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ux_active_lease ON leases(work_item_id) WHERE status='active';
CREATE INDEX ix_leases_wi ON leases(work_item_id, status);
CREATE INDEX ix_leases_expiry ON leases(status, expires_at);

CREATE TABLE workflow_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','deprecated','archived')),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_wfdef_ver ON workflow_definitions(name, version);

CREATE TRIGGER wd_immutable BEFORE UPDATE OF definition_json, version ON workflow_definitions
WHEN OLD.definition_json <> NEW.definition_json OR OLD.version <> NEW.version
BEGIN
  SELECT RAISE(ABORT, 'workflow_definition is immutable');
END;

CREATE TABLE prompt_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_prompt_ver ON prompt_definitions(name, version);

CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  workflow_definition_id TEXT NOT NULL,
  current_step_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','running','paused','completed','failed','cancelled')),
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(workflow_definition_id) REFERENCES workflow_definitions(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ux_wr_active ON workflow_runs(work_item_id) WHERE status IN ('pending','running','paused');
CREATE INDEX ix_runs_wi ON workflow_runs(work_item_id, status);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','review','approved','superseded','archived')),
  body TEXT,
  metadata_json TEXT,
  root_artifact_id TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  supersedes_artifact_id TEXT,
  FOREIGN KEY(supersedes_artifact_id) REFERENCES artifacts(id) ON DELETE RESTRICT,
  FOREIGN KEY(created_by) REFERENCES agents(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ux_artifact_supersedes ON artifacts(supersedes_artifact_id) WHERE supersedes_artifact_id IS NOT NULL;
CREATE UNIQUE INDEX ux_artifact_version ON artifacts(root_artifact_id, version);
CREATE INDEX ix_artifacts_root ON artifacts(root_artifact_id, version);

CREATE TABLE work_item_artifacts (
  work_item_id TEXT NOT NULL,
  root_artifact_id TEXT NOT NULL,   -- link to lineage root; current version resolved at read
  relation_type TEXT NOT NULL,
  PRIMARY KEY(work_item_id, root_artifact_id),
  FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT
);

CREATE TABLE workflow_step_runs (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  parent_step_run_id TEXT,                  -- NULL = main path; non-NULL = reviewer child
  role TEXT,                                -- reviewer role; NULL on main path
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','skipped')),
  verdict TEXT CHECK (verdict IS NULL OR verdict IN ('pass','reject','abstain')),
  review_round INTEGER NOT NULL DEFAULT 1,
  prompt_definition_id TEXT,
  started_at TEXT,
  completed_at TEXT,
  output_artifact_id TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workflow_run_id) REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY(parent_step_run_id) REFERENCES workflow_step_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY(prompt_definition_id) REFERENCES prompt_definitions(id) ON DELETE RESTRICT,
  FOREIGN KEY(output_artifact_id) REFERENCES artifacts(id) ON DELETE RESTRICT,
  CHECK ((parent_step_run_id IS NULL) = (role IS NULL)),
  CHECK (parent_step_run_id IS NULL OR ((status='completed') = (verdict IS NOT NULL)))
);
CREATE INDEX ix_steprun_run ON workflow_step_runs(workflow_run_id, status);
CREATE UNIQUE INDEX ux_live_reviewer ON workflow_step_runs(workflow_run_id, parent_step_run_id, role)
  WHERE status IN ('pending','running');

CREATE TABLE blockers (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  blocker_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','resolved','cancelled')),
  question TEXT,
  options_json TEXT,
  answer TEXT,
  choice TEXT,
  answered_by TEXT,
  answered_at TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(answered_by) REFERENCES agents(id) ON DELETE RESTRICT,
  CHECK ((blocker_type='human_gate') = (question IS NOT NULL AND options_json IS NOT NULL)),
  CHECK (blocker_type <> 'human_gate' OR status <> 'resolved' OR (answer IS NOT NULL OR choice IS NOT NULL))
);
CREATE INDEX ix_blockers_open ON blockers(work_item_id) WHERE status='open';

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  work_item_id TEXT,
  question TEXT NOT NULL,
  options_json TEXT NOT NULL,
  recommendation TEXT,
  confidence INTEGER CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 100)),
  decision TEXT,
  category TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','recommended','decided','cancelled')),
  artifact_id TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(artifact_id) REFERENCES artifacts(id) ON DELETE RESTRICT,
  CHECK ((status='decided') = (decided_at IS NOT NULL))
);
CREATE INDEX ix_decisions_category ON decisions(category);

CREATE TABLE policies (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT,
  policy_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_policies_scope ON policies(scope_type, scope_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_events_entity ON events(entity_type, entity_id, created_at);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/storage/schema.test.ts`
Expected: PASS (5 tests). The immutability trigger, lease uniqueness, and gate CHECK all fire.

- [ ] **Step 5: Commit**

```bash
git add src/storage/schema.sql tests/storage/schema.test.ts
git commit -m "feat: add complete V1 SQLite schema with constraints and triggers"
```

---

## Task 6: Migration runner

**Files:**
- Create: `src/storage/migrations.ts`
- Test: `tests/storage/migrations.test.ts`

- [ ] **Step 1: Write the failing test** at `tests/storage/migrations.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, CURRENT_VERSION } from '../../src/storage/migrations.js';

describe('migrations', () => {
  it('applies the schema and sets user_version', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(db.pragma('user_version', { simple: true })).toBe(CURRENT_VERSION);
    const tables = db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table' AND name='work_items'").get() as any;
    expect(tables.c).toBe(1);
    db.close();
  });

  it('is idempotent — running twice is a no-op', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(CURRENT_VERSION);
    db.close();
  });

  it('seeds the sequences table empty (allocator inserts lazily)', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const rows = db.prepare('SELECT count(*) c FROM sequences').get() as any;
    expect(rows.c).toBe(0);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage/migrations.test.ts`
Expected: FAIL — cannot find module `migrations.js`.

- [ ] **Step 3: Write the implementation** at `src/storage/migrations.ts`

```ts
import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const schemaSql = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');

/** Ordered migrations. Migration 1 is the full V1 schema. */
const MIGRATIONS: Array<{ version: number; up: (db: Database.Database) => void }> = [
  {
    version: 1,
    up: (db) => {
      db.exec(schemaSql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(1, new Date(0).toISOString());
    },
  },
];

export const CURRENT_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Apply pending migrations in one transaction, gated on PRAGMA user_version. */
export function runMigrations(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  const current = db.pragma('user_version', { simple: true }) as number;
  const pending = MIGRATIONS.filter((m) => m.version > current);
  if (pending.length === 0) return;
  const apply = db.transaction(() => {
    for (const m of pending) {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    }
  });
  apply.immediate();
}
```

Note: `schema_migrations.applied_at` is stamped with a fixed epoch here because migrations may run before a `Clock` is wired; the row is for audit only and never ordered against live timestamps.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/storage/migrations.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/storage/migrations.ts tests/storage/migrations.test.ts
git commit -m "feat: add user_version-gated migration runner"
```

---

## Task 7: Storage interface & SQLite adapter

**Files:**
- Create: `src/storage/storage.ts`
- Create: `src/storage/sqlite.ts`
- Test: `tests/storage/sqlite.test.ts`

The abstraction is the *transaction boundary*. `transaction('immediate'|'deferred', fn)` gives `fn` a `Tx` with raw query access plus `allocateId` and `appendEvent` helpers. Later plans add typed repositories on top of `Tx`; Plan 1 keeps `Tx` minimal.

- [ ] **Step 1: Write the failing test** at `tests/storage/sqlite.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';

function mem() {
  return new SqliteStorage(':memory:', fixedClock('2026-06-02T12:00:00.000Z'));
}

describe('SqliteStorage', () => {
  it('runs migrations on open', () => {
    const s = mem();
    const ok = s.transaction('deferred', (tx) =>
      tx.get<{ c: number }>("SELECT count(*) c FROM sqlite_master WHERE name='work_items'"));
    expect(ok!.c).toBe(1);
    s.close();
  });

  it('allocates gap-free-per-prefix monotonic ids', () => {
    const s = mem();
    const ids = s.transaction('immediate', (tx) => [tx.allocateId('WI'), tx.allocateId('WI'), tx.allocateId('ART')]);
    expect(ids).toEqual(['WI-1', 'WI-2', 'ART-1']);
    s.close();
  });

  it('appends an event with an allocated id and the clock timestamp', () => {
    const s = mem();
    const evId = s.transaction('immediate', (tx) =>
      tx.appendEvent({ actorId: 'A', eventType: 'created', entityType: 'work_item', entityId: 'WI-1', payload: { a: 1 } }));
    expect(evId).toBe('EV-1');
    const ev = s.transaction('deferred', (tx) => tx.get<any>('SELECT * FROM events WHERE id=?', 'EV-1'));
    expect(ev.created_at).toBe('2026-06-02T12:00:00.000Z');
    expect(JSON.parse(ev.payload_json)).toEqual({ a: 1 });
    s.close();
  });

  it('rolls back the whole transaction on throw — no partial id burn visible', () => {
    const s = mem();
    expect(() => s.transaction('immediate', (tx) => { tx.allocateId('WI'); throw new Error('boom'); })).toThrow('boom');
    const next = s.transaction('immediate', (tx) => tx.allocateId('WI'));
    expect(next).toBe('WI-1');
    s.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage/sqlite.test.ts`
Expected: FAIL — cannot find module `sqlite.js`.

- [ ] **Step 3: Write the interface** at `src/storage/storage.ts`

```ts
import type { IdPrefix } from '../domain/ids.js';

export interface EventInput {
  actorId?: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  payload?: unknown;
}

/** Query surface available inside a transaction. */
export interface Tx {
  run(sql: string, ...params: unknown[]): void;
  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined;
  all<T = unknown>(sql: string, ...params: unknown[]): T[];
  /** Allocate the next monotonic id for a prefix (e.g. 'WI' -> 'WI-1'). */
  allocateId(prefix: IdPrefix): string;
  /** Append an audit event; returns the event id. */
  appendEvent(input: EventInput): string;
  /** Current time from the injected clock (UTC ISO-Z). */
  now(): string;
}

export type TxMode = 'deferred' | 'immediate';

export interface Storage {
  transaction<T>(mode: TxMode, fn: (tx: Tx) => T): T;
  close(): void;
}
```

- [ ] **Step 4: Write the adapter** at `src/storage/sqlite.ts`

```ts
import Database from 'better-sqlite3';
import type { Clock } from '../domain/clock.js';
import { formatId, type IdPrefix } from '../domain/ids.js';
import { runMigrations } from './migrations.js';
import type { EventInput, Storage, Tx, TxMode } from './storage.js';

export class SqliteStorage implements Storage {
  private readonly db: Database.Database;

  constructor(path: string, private readonly clock: Clock) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    runMigrations(this.db);
  }

  transaction<T>(mode: TxMode, fn: (tx: Tx) => T): T {
    const tx = this.makeTx();
    const wrapped = this.db.transaction(fn);
    return mode === 'immediate' ? wrapped.immediate(tx) : wrapped.deferred(tx);
  }

  close(): void {
    this.db.close();
  }

  private makeTx(): Tx {
    const db = this.db;
    const clock = this.clock;
    const tx: Tx = {
      run: (sql, ...params) => { db.prepare(sql).run(...(params as never[])); },
      get: <R>(sql: string, ...params: unknown[]) => db.prepare(sql).get(...(params as never[])) as R | undefined,
      all: <R>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as never[])) as R[],
      now: () => clock.now(),
      allocateId: (prefix: IdPrefix) => {
        const row = db.prepare(
          `INSERT INTO sequences (prefix, next_value) VALUES (?, 1)
           ON CONFLICT(prefix) DO UPDATE SET next_value = next_value + 1
           RETURNING next_value`,
        ).get(prefix) as { next_value: number };
        return formatId(prefix, row.next_value);
      },
      appendEvent: (input: EventInput) => {
        const id = tx.allocateId('EV');
        db.prepare(
          `INSERT INTO events (id, actor_id, event_type, entity_type, entity_id, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          input.actorId ?? null,
          input.eventType,
          input.entityType,
          input.entityId,
          input.payload === undefined ? null : JSON.stringify(input.payload),
          clock.now(),
        );
        return id;
      },
    };
    return tx;
  }
}
```

Note: `better-sqlite3` transaction functions accept arguments forwarded to `.immediate(arg)`/`.deferred(arg)`; we pass the `Tx` object so the same `fn(tx)` signature works for both modes.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/storage/sqlite.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/storage/storage.ts src/storage/sqlite.ts tests/storage/sqlite.test.ts
git commit -m "feat: add Storage transaction boundary and SQLite adapter"
```

---

## Task 8: `apm init` usecase

**Files:**
- Create: `src/usecases/init.ts`
- Test: `tests/usecases/init.test.ts`

`init` creates `.apm/`, opens the db (which runs migrations), writes a default `config.yaml`, and is idempotent.

- [ ] **Step 1: Write the failing test** at `tests/usecases/init.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { fixedClock } from '../../src/domain/clock.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('initProject', () => {
  it('creates .apm with a db and config', () => {
    const res = initProject(dir, fixedClock('2026-06-02T12:00:00.000Z'));
    expect(res.created).toBe(true);
    expect(existsSync(join(dir, '.apm', 'apm.db'))).toBe(true);
    expect(existsSync(join(dir, '.apm', 'config.yaml'))).toBe(true);
    expect(readFileSync(join(dir, '.apm', 'config.yaml'), 'utf8')).toMatch(/capabilities:/);
  });

  it('is idempotent — second run reports already-initialized', () => {
    initProject(dir, fixedClock('2026-06-02T12:00:00.000Z'));
    const res = initProject(dir, fixedClock('2026-06-02T12:00:00.000Z'));
    expect(res.created).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/init.test.ts`
Expected: FAIL — cannot find module `init.js`.

- [ ] **Step 3: Write the implementation** at `src/usecases/init.ts`

```ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Clock } from '../domain/clock.js';
import { SqliteStorage } from '../storage/sqlite.js';

const DEFAULT_CONFIG = `# APM tool configuration (not policies — those live in the DB).
capabilities:
  - planning
  - design
  - coding
  - review
  - security
`;

export interface InitResult {
  created: boolean;
  dbPath: string;
}

/** Create .apm/ with a migrated db and a default config. Idempotent. */
export function initProject(dir: string, clock: Clock): InitResult {
  const apmDir = join(dir, '.apm');
  const dbPath = join(apmDir, 'apm.db');
  const alreadyInitialized = existsSync(dbPath);

  mkdirSync(apmDir, { recursive: true });

  // Opening the storage runs migrations (idempotent via user_version).
  const storage = new SqliteStorage(dbPath, clock);
  storage.close();

  const configPath = join(apmDir, 'config.yaml');
  if (!existsSync(configPath)) writeFileSync(configPath, DEFAULT_CONFIG);

  return { created: !alreadyInitialized, dbPath };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/usecases/init.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/usecases/init.ts tests/usecases/init.test.ts
git commit -m "feat: add idempotent apm init usecase"
```

---

## Task 9: CLI wiring for `init`

**Files:**
- Create: `src/cli/program.ts`
- Create: `src/bin/apm.ts`
- Test: `tests/cli/init.test.ts`

Plan 1 wires only `init`. The full envelope/format layer arrives in Plan 2; here `init` prints a plain human line and exits 0.

- [ ] **Step 1: Write the failing test** at `tests/cli/init.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProgram } from '../../src/cli/program.js';
import { fixedClock } from '../../src/domain/clock.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-cli-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('apm init (cli)', () => {
  it('initializes in the given --dir and prints a confirmation', () => {
    const lines: string[] = [];
    const program = buildProgram({ clock: fixedClock('2026-06-02T12:00:00.000Z'), out: (s) => lines.push(s) });
    program.parse(['init', '--dir', dir], { from: 'user' });
    expect(existsSync(join(dir, '.apm', 'apm.db'))).toBe(true);
    expect(lines.join('\n')).toMatch(/initialized/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/init.test.ts`
Expected: FAIL — cannot find module `program.js`.

- [ ] **Step 3: Write the program builder** at `src/cli/program.ts`

```ts
import { Command } from 'commander';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import { initProject } from '../usecases/init.js';

export interface ProgramDeps {
  clock?: Clock;
  out?: (line: string) => void;
}

export function buildProgram(deps: ProgramDeps = {}): Command {
  const clock = deps.clock ?? systemClock;
  const out = deps.out ?? ((s: string) => process.stdout.write(s + '\n'));

  const program = new Command();
  program.name('apm').description('Agent Project Manager').version('0.1.0');

  program
    .command('init')
    .description('Initialize an APM project in the current directory')
    .option('--dir <path>', 'project directory', process.cwd())
    .action((opts: { dir: string }) => {
      const res = initProject(opts.dir, clock);
      out(res.created ? `APM initialized at ${res.dbPath}` : `APM already initialized at ${res.dbPath}`);
    });

  return program;
}
```

- [ ] **Step 4: Write the entrypoint** at `src/bin/apm.ts`

```ts
#!/usr/bin/env node
import { buildProgram } from '../cli/program.js';

buildProgram().parseAsync(process.argv).catch((err) => {
  process.stderr.write(String(err?.message ?? err) + '\n');
  process.exit(75);
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/cli/init.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Verify the binary runs end-to-end**

Run: `npx tsx src/bin/apm.ts init --dir "$(mktemp -d)"`
Expected: prints `APM initialized at …/.apm/apm.db`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/cli/program.ts src/bin/apm.ts tests/cli/init.test.ts
git commit -m "feat: wire apm init command"
```

---

## Task 10: Build + full test gate; update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (replace the "Spec-stage. No code yet." section + add commands)

- [ ] **Step 1: Run the whole suite and a typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass; typecheck clean.

- [ ] **Step 2: Verify the build emits the binary**

Run: `npm run build && node dist/bin/apm.js init --dir "$(mktemp -d)"`
Expected: build succeeds; binary prints the initialized line.

- [ ] **Step 3: Update `CLAUDE.md`** — replace the Project State section's first paragraph with the real status and add a Commands section near the top (after the title block). Use this exact replacement for the paragraph beginning "**Spec-stage. No code yet.**":

```markdown
**Implementation underway (V1).** TypeScript/Node CLI. Specs in `docs/`; design spec in `docs/superpowers/specs/2026-06-02-apm-v1-cli-design.md`; implementation plans in `docs/superpowers/plans/`. `.obsidian/` is editor config; `.apm/` (runtime db) is gitignored.

## Commands

- Install: `npm install`
- Test (all): `npm test`  — single file: `npx vitest run tests/path/to/file.test.ts`  — watch: `npm run test:watch`
- Typecheck: `npm run typecheck`
- Build: `npm run build` (emits `dist/`, binary at `dist/bin/apm.js`)
- Run without building: `npx tsx src/bin/apm.ts <args>` (or `npm run apm -- <args>`)
- Init a project: `apm init` (creates `.apm/apm.db` + `.apm/config.yaml`)

## Engineering invariants (V1)

- Storage is reached only through `Storage.transaction(mode, fn)`; writes use `'immediate'`, reads `'deferred'` and release immediately.
- Domain code is pure — "now" is injected via `Clock`, never `Date.now()`.
- Every mutation allocates ids from the `sequences` table and appends an `events` row in the same transaction.
- Work-item `active` is computed from a live lease, never stored.
```

- [ ] **Step 4: Run tests once more after the edit (docs-only, but confirm nothing broke)**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with build/test commands and V1 invariants"
```

---

## Self-Review

**Spec coverage (Plan 1 portion of the design spec):**
- §2 language/runtime → Task 1. ✅
- §3 layering (domain/storage/usecases/cli; Storage = transaction boundary) → Tasks 2–9. ✅
- §4.1 files & pragmas (WAL, foreign_keys, busy_timeout; `.apm/apm.db`, `config.yaml` holds capabilities not policies) → Tasks 7, 8. ✅
- §4.2 IDs (sequences, `UPDATE … RETURNING`, prefixes incl. no `HG-`, `ART-1@2`) → Tasks 3, 7. ✅
- §4.3 schema (all tables, status CHECKs, partial-unique indexes, gate/verdict CHECKs, immutability trigger, FKs RESTRICT, UTC-Z) → Tasks 4, 5. ✅
- §8 `apm init` (seeds db; idempotent) → Tasks 8, 9. Built-in workflow + default policy seeding is deferred to Plan 3 (needs the definition loader); noted, not silently dropped. ✅
- §10 testing (`:memory:`, injected clock) → throughout. ✅

**Deferred to later plans (intentionally, not gaps):** envelope/canonical-entity/format layer (Plan 2), built-in `feature_delivery` seed + policy seed (Plan 3), resolver/agent-format/e2e (Plan 4). The schema for all of these already exists after Task 5.

**Placeholder scan:** no TBD/TODO; every code step has complete code; every run step has an expected result. ✅

**Type consistency:** `Clock.now()`, `Tx` (`run/get/all/allocateId/appendEvent/now`), `Storage.transaction(mode, fn)`, `initProject(dir, clock)`, `buildProgram(deps)`, `ID_PREFIXES`, and the status-enum arrays are used identically across tasks and match the schema CHECK literals. ✅
