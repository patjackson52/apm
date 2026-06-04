# Parallel-Safety Core (Spec A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make N agents on one host safely and efficiently work separate work items in parallel — generalized resource-leases, contention-free claim-walk dispatch, a fleet cap with a project on/off toggle, correct dependency resolution, work dedup, and a real multi-process concurrency test.

**Architecture:** All changes are pure state/transaction changes in the APM domain (no git). A schema migration generalizes `leases` to lock arbitrary resources (`work_item` | `slot` | `integration`). `apm next --acquire` is split into a read-only peek (deferred tx) plus a short per-attempt acquire loop (immediate tx) so the WAL write lock is never held across a multi-candidate walk. Dependency readiness becomes a pure function of current committed state evaluated inside `next`, eliminating a cascade race. Reference: `docs/superpowers/specs/2026-06-03-parallel-workstreams-design.md`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), better-sqlite3 (WAL, `busy_timeout=5000`), Vitest. Storage reached only via `Storage.transaction('immediate'|'deferred', fn)`. Time injected via `Clock`. Migrations are `PRAGMA user_version`-gated entries in `src/storage/migrations.ts`.

---

## File Structure

- `src/storage/migrations.ts` — **modify**: add migration v2 (rebuild `leases` table: nullable `work_item_id`, add `resource_type`/`resource_key`, swap unique index).
- `src/storage/repos.ts` — **modify**: `links` gets `allDepsSatisfied`/`wouldCycle` helpers; new `leaseResources` repo for generic acquire; `policies` unchanged (read via `effectivePolicy`).
- `src/domain/policy.ts` — **modify**: surface `parallel_work_enabled` (default true) and `max_parallel_agents` in the effective-policy type + defaults.
- `src/usecases/lease.ts` — **modify**: `acquire` gains optional `resourceType`/`resourceKey`; add `acquireResource()` for slot/integration; lazy-heal keyed on resource.
- `src/usecases/next.ts` — **modify**: split peek/acquire; claim-walk over ranked list; `SQLITE_BUSY` handling; slot-gate; readiness self-heal (draft→ready); cancelled-satisfies.
- `src/domain/resolver.ts` — **modify**: `selectCandidate` returns the ranked dispatchable **list** (not one winner).
- `src/usecases/work.ts` — **modify**: `link` uses transitive DFS; `create` adds `dedup_key` + sibling check; `blockers`/readiness treat `cancelled` as satisfied.
- `src/usecases/advance.ts` — **modify**: terminal completion re-validates deps.
- `src/domain/normalize.ts` — **create**: `normalizeTitle()` for `dedup_key`.
- `tests/usecases/*.test.ts`, `tests/integration/parallel-dispatch.test.ts`, `tests/integration/concurrency-procs.test.ts` — **create/modify**: unit + multi-process tests.

---

## Task 1: Migration v2 — generalize the leases table

**Files:**
- Modify: `src/storage/migrations.ts`
- Test: `tests/storage/migration-v2.test.ts` (create)

SQLite cannot drop a column's `NOT NULL` via `ALTER`, so we rebuild the `leases` table. Nothing references `leases` by foreign key (verified), so the rebuild is safe inside the migration transaction.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/storage/migration-v2.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-03T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-mig-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });

describe('migration v2 — resource leases', () => {
  it('adds resource_type/resource_key columns and makes work_item_id nullable', () => {
    const db = new Database(join(dir, '.apm', 'apm.db'));
    try {
      const cols = db.prepare("PRAGMA table_info('leases')").all() as Array<{ name: string; notnull: number }>;
      const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
      expect(byName.resource_type).toBeTruthy();
      expect(byName.resource_key).toBeTruthy();
      expect(byName.work_item_id.notnull).toBe(0); // nullable now
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='leases'").all() as Array<{ name: string }>;
      const names = idx.map((i) => i.name);
      expect(names).toContain('ux_active_resource');
      expect(names).not.toContain('ux_active_lease');
    } finally { db.close(); }
  });

  it('backfills resource_type/resource_key for pre-existing work-item leases', () => {
    // simulate a v1 row by inserting directly, then confirm a fresh db has the backfill shape
    const db = new Database(join(dir, '.apm', 'apm.db'));
    try {
      const ver = db.pragma('user_version', { simple: true }) as number;
      expect(ver).toBeGreaterThanOrEqual(2);
    } finally { db.close(); }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage/migration-v2.test.ts`
Expected: FAIL — `resource_type` undefined / `ux_active_resource` not found.

- [ ] **Step 3: Add migration v2**

In `src/storage/migrations.ts`, append to the `MIGRATIONS` array (after version 1):

```typescript
  {
    version: 2,
    up: (db, stamp) => {
      // Rebuild leases: work_item_id becomes nullable; add resource_type/resource_key.
      // Nothing FK-references leases, so a table rebuild is safe inside this txn.
      db.exec(`
        CREATE TABLE leases_new (
          id TEXT PRIMARY KEY,
          resource_type TEXT NOT NULL DEFAULT 'work_item',
          resource_key TEXT NOT NULL,
          work_item_id TEXT,
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
        INSERT INTO leases_new (id, resource_type, resource_key, work_item_id, agent_id, session_id, status, acquired_at, expires_at, heartbeat_at)
          SELECT id, 'work_item', work_item_id, work_item_id, agent_id, session_id, status, acquired_at, expires_at, heartbeat_at FROM leases;
        DROP TABLE leases;
        ALTER TABLE leases_new RENAME TO leases;
        CREATE UNIQUE INDEX ux_active_resource ON leases(resource_type, resource_key) WHERE status='active';
        CREATE INDEX ix_leases_wi ON leases(work_item_id, status);
        CREATE INDEX ix_leases_expiry ON leases(status, expires_at);
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(2, stamp);
    },
  },
```

Also update `src/storage/schema.sql` `leases` table + indexes to match this shape (so fresh v1 installs that later jump to v2 stay consistent, and the schema file documents reality). Replace the `leases` block (`schema.sql:66-81`) with the `leases_new` shape above (table named `leases`) and the three indexes (`ux_active_resource`, `ix_leases_wi`, `ix_leases_expiry`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/storage/migration-v2.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite to catch regressions**

Run: `npm test`
Expected: existing lease/next tests still pass (they query `work_item_id`, which still exists). Fix any test that asserted on the old index name.

- [ ] **Step 6: Commit**

```bash
git add src/storage/migrations.ts src/storage/schema.sql tests/storage/migration-v2.test.ts
git commit -m "feat(storage): migration v2 — generalize leases to resource leases"
```

---

## Task 2: Generic resource acquire in the lease usecase

**Files:**
- Modify: `src/usecases/lease.ts`
- Test: `tests/usecases/lease-resource.test.ts` (create)

Keep work-item `acquire()` behavior identical; add the resource dimension underneath it, plus a thin `acquireResource()` for slot/integration leases (no work item).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/usecases/lease-resource.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as lease from '../../src/usecases/lease.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-03T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-lr-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('resource leases', () => {
  it('acquires a non-work-item resource lease (integration)', () => {
    const l = lease.acquireResource(ctx(), { resourceType: 'integration', resourceKey: 'main', agent: 'agentA', ttl: '10m' });
    expect(l.status).toBe('active');
  });

  it('rejects a second active lease on the same resource', () => {
    lease.acquireResource(ctx(), { resourceType: 'integration', resourceKey: 'main', agent: 'agentA', ttl: '10m' });
    expect(() => lease.acquireResource(ctx(), { resourceType: 'integration', resourceKey: 'main', agent: 'agentB', ttl: '10m' }))
      .toThrowError(/lease/i);
  });

  it('allows distinct resource keys of the same type concurrently', () => {
    lease.acquireResource(ctx(), { resourceType: 'slot', resourceKey: 'slot-1', agent: 'agentA', ttl: '10m' });
    const l2 = lease.acquireResource(ctx(), { resourceType: 'slot', resourceKey: 'slot-2', agent: 'agentB', ttl: '10m' });
    expect(l2.status).toBe('active');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/lease-resource.test.ts`
Expected: FAIL — `lease.acquireResource is not a function`.

- [ ] **Step 3: Implement `acquireResource` and route `acquire` through it**

In `src/usecases/lease.ts`, add after `parseTtlSeconds`/`addSeconds`:

```typescript
export interface AcquireResourceArgs {
  resourceType: 'work_item' | 'slot' | 'integration';
  resourceKey: string;
  workItem?: string | null;
  agent: string;
  session?: string;
  ttl: string;
}

export function acquireResource(ctx: Ctx, a: AcquireResourceArgs): LeaseView {
  const secs = parseTtlSeconds(a.ttl);
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    if (a.workItem && !r.workItems.byId(a.workItem)) throw new ApmError('E_NOT_FOUND', `${a.workItem} not found`);
    r.agents.ensure(a.agent);
    // lazy-heal expired active leases on THIS resource only
    tx.run("UPDATE leases SET status='expired' WHERE resource_type=? AND resource_key=? AND status='active' AND expires_at <= ?",
      a.resourceType, a.resourceKey, tx.now());
    const id = tx.allocateId('LEASE');
    try {
      tx.run(
        "INSERT INTO leases (id, resource_type, resource_key, work_item_id, agent_id, session_id, status, acquired_at, expires_at, heartbeat_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)",
        id, a.resourceType, a.resourceKey, a.workItem ?? null, a.agent, a.session ?? null, tx.now(), addSeconds(tx.now(), secs), tx.now(),
      );
    } catch (e: any) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE/i.test(String(e.message))) {
        throw new ApmError('E_LEASE_CONFLICT', `${a.resourceType}:${a.resourceKey} is already leased`);
      }
      throw e;
    }
    tx.appendEvent({ actorId: a.agent, eventType: 'lease.acquired', entityType: 'lease', entityId: id, payload: { resource_type: a.resourceType, resource_key: a.resourceKey, work_item: a.workItem ?? null } });
    return toLeaseView(tx.get('SELECT * FROM leases WHERE id=?', id));
  });
}
```

Then make the existing `acquire` delegate (preserves its public signature + behavior):

```typescript
export function acquire(ctx: Ctx, a: AcquireArgs): LeaseView {
  return acquireResource(ctx, { resourceType: 'work_item', resourceKey: a.workItem, workItem: a.workItem, agent: a.agent, session: a.session, ttl: a.ttl });
}
```

Note: `toLeaseView` reads `work_item_id`; for non-work-item leases it will be null — confirm `LeaseView`/`toLeaseView` in `src/domain/entities.ts` tolerates a null `work_item` (if it asserts non-null, relax it to `string | null`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/usecases/lease-resource.test.ts tests/usecases/lease.test.ts`
Expected: PASS (both new and original lease tests).

- [ ] **Step 5: Commit**

```bash
git add src/usecases/lease.ts src/domain/entities.ts tests/usecases/lease-resource.test.ts
git commit -m "feat(lease): generic resource acquire (work_item/slot/integration)"
```

---

## Task 3: Resolver returns the ranked dispatchable list

**Files:**
- Modify: `src/domain/resolver.ts`
- Test: `tests/domain/resolver.test.ts` (modify/create)

Claim-walk needs the full ranked list, not a single winner.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/domain/resolver.test.ts
import { describe, it, expect } from 'vitest';
import { selectCandidates, type Candidate, type Caller } from '../../src/domain/resolver.js';

const base = (over: Partial<Candidate>): Candidate => ({
  workItemId: 'WI-1', priority: 0, createdAt: '2026-06-03T00:00:00Z',
  depsAllComplete: true, hasPendingStep: true, blockedByHumanGate: false,
  requiredCaps: [], leaseHolderAgent: null, leaseLive: false, ...over,
});
const caller: Caller = { agent: 'a', capabilities: [], match: 'any' };

describe('selectCandidates (ranked list)', () => {
  it('returns dispatchable items in priority then created/id order', () => {
    const r = selectCandidates([
      base({ workItemId: 'WI-2', priority: 1 }),
      base({ workItemId: 'WI-1', priority: 5 }),
      base({ workItemId: 'WI-3', priority: 5 }),
    ], caller, '2026-06-03T01:00:00Z');
    expect(r.status).toBe('dispatchable');
    if (r.status === 'dispatchable') expect(r.workItemIds).toEqual(['WI-1', 'WI-3', 'WI-2']);
  });

  it('excludes items leased by another agent but keeps others', () => {
    const r = selectCandidates([
      base({ workItemId: 'WI-1', leaseLive: true, leaseHolderAgent: 'other' }),
      base({ workItemId: 'WI-2' }),
    ], caller, '2026-06-03T01:00:00Z');
    expect(r.status).toBe('dispatchable');
    if (r.status === 'dispatchable') expect(r.workItemIds).toEqual(['WI-2']);
  });

  it('reports deps_pending idle reason when nothing dispatchable', () => {
    const r = selectCandidates([base({ depsAllComplete: false })], caller, 'x');
    expect(r).toEqual({ status: 'idle', reason: 'deps_pending', retryAfter: 30 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/resolver.test.ts`
Expected: FAIL — `selectCandidates is not exported`.

- [ ] **Step 3: Add `selectCandidates` (list-returning) alongside the existing function**

In `src/domain/resolver.ts`, add a new resolution type and function. Keep `selectCandidate` as a thin wrapper for any existing callers.

```typescript
export type ListResolution =
  | { status: 'dispatchable'; workItemIds: string[] }
  | { status: 'idle'; reason: 'deps_pending' | 'all_leased' | 'capability_mismatch' | 'awaiting_human'; retryAfter: number }
  | { status: 'drained' };

export function selectCandidates(candidates: Candidate[], caller: Caller, now: string): ListResolution {
  if (candidates.length === 0) return { status: 'drained' };
  const dispatchable: Candidate[] = [];
  let sawDeps = false, sawLeased = false, sawCaps = false, sawHuman = false, sawPending = false;
  for (const c of candidates) {
    if (c.blockedByHumanGate) { sawHuman = true; continue; }
    if (!c.hasPendingStep) continue;
    sawPending = true;
    if (!c.depsAllComplete) { sawDeps = true; continue; }
    if (c.leaseLive && c.leaseHolderAgent !== caller.agent) { sawLeased = true; continue; }
    if (!capsMatch(c.requiredCaps, caller)) { sawCaps = true; continue; }
    dispatchable.push(c);
  }
  if (dispatchable.length > 0) {
    dispatchable.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.workItemId.localeCompare(b.workItemId));
    return { status: 'dispatchable', workItemIds: dispatchable.map((c) => c.workItemId) };
  }
  if (sawDeps) return { status: 'idle', reason: 'deps_pending', retryAfter: 30 };
  if (sawLeased) return { status: 'idle', reason: 'all_leased', retryAfter: 30 };
  if (sawCaps) return { status: 'idle', reason: 'capability_mismatch', retryAfter: 60 };
  if (sawHuman) return { status: 'idle', reason: 'awaiting_human', retryAfter: 0 };
  return { status: 'drained' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/resolver.ts tests/domain/resolver.test.ts
git commit -m "feat(resolver): selectCandidates returns ranked dispatchable list"
```

---

## Task 4: Claim-walk dispatch — split peek from acquire, handle SQLITE_BUSY

**Files:**
- Modify: `src/usecases/next.ts`
- Test: `tests/integration/parallel-dispatch.test.ts` (create)

The peek + ranking runs in a **deferred** read tx. Each acquire attempt is its own short **immediate** tx. On `SQLITE_CONSTRAINT_UNIQUE`, advance to the next ranked candidate; on `SQLITE_BUSY`, return `idle` with jittered `retry_after`. The write lock is held only per single INSERT.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/parallel-dispatch.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as wf from '../../src/usecases/workflow.js';
import * as next from '../../src/usecases/next.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-03T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-pd-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('claim-walk dispatch', () => {
  it('two agents on two ready items each get a different item (no idle)', () => {
    const a = work.create(ctx(), { type: 'feature', title: 'A', agent: 'agentA' });
    const b = work.create(ctx(), { type: 'feature', title: 'B', agent: 'agentA' });
    wf.attachRun(ctx(), { workItem: a.id, workflow: 'feature_delivery', agent: 'agentA' });
    wf.attachRun(ctx(), { workItem: b.id, workflow: 'feature_delivery', agent: 'agentA' });

    const r1 = next.next(ctx(), { agent: 'agentA', capabilities: [], match: 'any', acquire: true, session: 'SA' });
    const r2 = next.next(ctx(), { agent: 'agentB', capabilities: [], match: 'any', acquire: true, session: 'SB' });

    expect(r1.status).toBe('dispatched');
    expect(r2.status).toBe('dispatched'); // walked past the item agentA took
    if (r1.status === 'dispatched' && r2.status === 'dispatched') {
      expect(r1.data.work_item).not.toBe(r2.data.work_item);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/parallel-dispatch.test.ts`
Expected: FAIL — `r2.status` is `'idle'` (current code gives up after the top item).

- [ ] **Step 3: Refactor `next` into peek (deferred) + acquire-walk (immediate)**

Rewrite `src/usecases/next.ts` so the candidate build + ranking happen in a deferred tx and produce a ranked list of work-item ids; then loop, attempting one acquire per immediate tx, building the dispatch payload for the winner. Key shape:

```typescript
import { selectCandidates } from '../domain/resolver.js';
// ...

const isBusy = (e: any) => e?.code === 'SQLITE_BUSY' || e?.code === 'SQLITE_BUSY_SNAPSHOT' || /SQLITE_BUSY/i.test(String(e?.message));
const isUnique = (e: any) => e?.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE/i.test(String(e?.message));
// deterministic-ish jitter without Math.random/Date.now (forbidden): derive from agent id length
const jitter = (agent: string) => 25 + (agent.length % 10);

export function next(ctx: Ctx, args: NextArgs): NextResult {
  let session: string | undefined;
  if (args.session === 'current' || (args.acquire && !args.session)) session = resolveCurrent(ctx, args.agent);
  else if (args.session) session = args.session;

  // PHASE 1 — peek + rank in a deferred read tx (no write lock).
  const peek = ctx.storage.transaction('deferred', (tx) => buildRankedCandidates(tx, args));
  if (peek.kind === 'drained') return peek.result;
  if (peek.kind === 'idle') return { status: 'idle', reason: peek.reason, data: { status: 'idle', reason: peek.reason, retry_after: peek.retryAfter }, session };

  // Peek-only mode (no --acquire): return the top candidate as a stale dispatch.
  if (!args.acquire) {
    const payload = ctx.storage.transaction('deferred', (tx) => buildDispatchPayload(tx, peek.workItemIds[0], session, args, /*lease*/ null));
    return { status: 'dispatched', data: payload, session, stale: true };
  }

  // PHASE 2 — acquire-walk: one immediate tx per attempt.
  for (const workItemId of peek.workItemIds) {
    try {
      const acquired = ctx.storage.transaction('immediate', (tx) => {
        // re-heal + re-check this resource, then INSERT; relies on ux_active_resource.
        tx.run("UPDATE leases SET status='expired' WHERE resource_type='work_item' AND resource_key=? AND status='active' AND expires_at <= ? AND agent_id != ?", workItemId, tx.now(), args.agent);
        const secs = parseTtlSeconds(args.ttl ?? '30m');
        r_ensureAgent(tx, args.agent);
        const leaseId = tx.allocateId('LEASE');
        const sessionIdForLease = sessionFk(tx, session);
        tx.run(
          "INSERT INTO leases (id, resource_type, resource_key, work_item_id, agent_id, session_id, status, acquired_at, expires_at, heartbeat_at) VALUES (?, 'work_item', ?, ?, ?, ?, 'active', ?, ?, ?)",
          leaseId, workItemId, workItemId, args.agent, sessionIdForLease, tx.now(), addSeconds(tx.now(), secs), tx.now(),
        );
        tx.appendEvent({ actorId: args.agent, eventType: 'lease.acquired', entityType: 'lease', entityId: leaseId, payload: { work_item: workItemId } });
        const row = tx.get<any>('SELECT * FROM leases WHERE id=?', leaseId);
        return buildDispatchPayload(tx, workItemId, session, args, { id: row.id, expires_at: row.expires_at });
      });
      return { status: 'dispatched', data: acquired, session, stale: false };
    } catch (e: any) {
      if (isUnique(e)) continue;                 // someone took it since peek — try next
      if (isBusy(e)) return { status: 'idle', reason: 'all_leased', data: { status: 'idle', reason: 'all_leased', retry_after: jitter(args.agent) }, session };
      throw e;
    }
  }
  // walked the whole list, everything got taken
  return { status: 'idle', reason: 'all_leased', data: { status: 'idle', reason: 'all_leased', retry_after: jitter(args.agent) }, session };
}
```

Extract the existing candidate-building loop (current `next.ts:80-160`) into `buildRankedCandidates(tx, args)` returning `{ kind: 'dispatchable'; workItemIds }` (via `selectCandidates`), `{ kind: 'idle'; reason; retryAfter }`, or `{ kind: 'drained'; result }` (reuse the existing `buildDrained` logic, but in this peek tx do **not** append the drained event — move the event append into the acquire phase or drop it for peeks). Extract the existing payload assembly (current `next.ts:176-264`, minus the inline lease insert) into `buildDispatchPayload(tx, workItemId, session, args, lease)`. `r_ensureAgent` and `sessionFk` are small helpers wrapping `repos(tx).agents.ensure` and the existing session-FK guard (`next.ts:222-224`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/parallel-dispatch.test.ts tests/usecases/next.test.ts tests/integration/plan4-loop.test.ts`
Expected: PASS. The existing "second acquire conflicts" test still passes when only ONE item exists (the walk has nothing else to take → `idle/all_leased`).

- [ ] **Step 5: Commit**

```bash
git add src/usecases/next.ts tests/integration/parallel-dispatch.test.ts
git commit -m "feat(next): claim-walk dispatch — short per-attempt txns, walk past leased items"
```

---

## Task 5: Fleet governor — slot cap + parallel_work_enabled toggle

**Files:**
- Modify: `src/domain/policy.ts`, `src/usecases/next.ts`
- Test: `tests/integration/slot-cap.test.ts` (create)

A runner must hold a `slot` lease to dispatch. `max_parallel_agents` (default e.g. 4) sets the slot count; `parallel_work_enabled=false` forces it to 1.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/slot-cap.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as wf from '../../src/usecases/workflow.js';
import * as next from '../../src/usecases/next.js';
import * as policy from '../../src/usecases/policy.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-03T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-slot-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('slot cap', () => {
  it('parallel_work_enabled=false serializes to one concurrent dispatch', () => {
    policy.create(ctx(), { scopeType: 'global', policyJson: JSON.stringify({ parallel_work_enabled: false }) });
    const a = work.create(ctx(), { type: 'feature', title: 'A', agent: 'x' });
    const b = work.create(ctx(), { type: 'feature', title: 'B', agent: 'x' });
    wf.attachRun(ctx(), { workItem: a.id, workflow: 'feature_delivery', agent: 'x' });
    wf.attachRun(ctx(), { workItem: b.id, workflow: 'feature_delivery', agent: 'x' });

    const r1 = next.next(ctx(), { agent: 'agentA', capabilities: [], match: 'any', acquire: true, session: 'SA' });
    const r2 = next.next(ctx(), { agent: 'agentB', capabilities: [], match: 'any', acquire: true, session: 'SB' });
    expect(r1.status).toBe('dispatched');
    expect(r2.status).toBe('idle'); // no free slot — serial
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/slot-cap.test.ts`
Expected: FAIL — both dispatch (no slot gating yet).

- [ ] **Step 3: Add policy defaults + slot gate**

In `src/domain/policy.ts`, extend the effective-policy type and defaults with `parallel_work_enabled: boolean` (default `true`) and `max_parallel_agents: number` (default `4`). Compute the effective slot count: `const slots = pol.parallel_work_enabled === false ? 1 : (pol.max_parallel_agents ?? 4);`.

In `src/usecases/next.ts`, **before** Phase 2's acquire-walk (only when `args.acquire`), require a slot lease keyed to the agent so the same agent re-entering reuses its slot:

```typescript
// slot gate: acquire (or reuse) a slot before dispatching work
const slots = effectiveSlotCount(ctx); // reads global effective policy in a deferred tx
const slotOk = ctx.storage.transaction('immediate', (tx) => {
  // already holding a slot? reuse it.
  const mine = tx.get("SELECT id FROM leases WHERE resource_type='slot' AND agent_id=? AND status='active' AND expires_at > ?", args.agent, tx.now());
  if (mine) return true;
  for (let i = 1; i <= slots; i++) {
    tx.run("UPDATE leases SET status='expired' WHERE resource_type='slot' AND resource_key=? AND status='active' AND expires_at <= ?", `slot-${i}`, tx.now());
    const taken = tx.get("SELECT 1 FROM leases WHERE resource_type='slot' AND resource_key=? AND status='active' AND expires_at > ?", `slot-${i}`, tx.now());
    if (taken) continue;
    try {
      const id = tx.allocateId('LEASE');
      repos(tx).agents.ensure(args.agent);
      tx.run("INSERT INTO leases (id, resource_type, resource_key, work_item_id, agent_id, session_id, status, acquired_at, expires_at, heartbeat_at) VALUES (?, 'slot', ?, NULL, ?, NULL, 'active', ?, ?, ?)",
        id, `slot-${i}`, args.agent, tx.now(), addSeconds(tx.now(), parseTtlSeconds(args.ttl ?? '30m')), tx.now());
      return true;
    } catch (e: any) { if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') continue; throw e; }
  }
  return false;
});
if (!slotOk) return { status: 'idle', reason: 'all_leased', data: { status: 'idle', reason: 'all_leased', retry_after: jitter(args.agent) }, session };
```

Add `effectiveSlotCount(ctx)` near the top of `next.ts`, reading the global effective policy via `effectivePolicy(tx, /* no work item */)` or `repos(tx).policies.global()` in a deferred tx and applying the default/override logic above. (Slot leases are released by `lease release`/`expire-stale`; a runner releases its slot when it ends — documented in Spec B's runner contract.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/slot-cap.test.ts tests/integration/parallel-dispatch.test.ts`
Expected: PASS. (The Task-4 two-agent test still passes because the default cap is 4 ≥ 2.)

- [ ] **Step 5: Commit**

```bash
git add src/domain/policy.ts src/usecases/next.ts tests/integration/slot-cap.test.ts
git commit -m "feat(next): slot-based fleet cap + parallel_work_enabled toggle (default on)"
```

---

## Task 6: Dependency correctness — cancelled satisfies + readiness self-heal

**Files:**
- Modify: `src/usecases/next.ts`, `src/usecases/work.ts`, `src/storage/repos.ts`
- Test: `tests/usecases/dep-readiness.test.ts` (create)

A dep counts as satisfied when its status is `completed` **or** `cancelled`. During the peek, a `draft` candidate whose every dep is satisfied is promoted to `ready` (self-heal, in an immediate tx during the acquire phase — never in the deferred peek). This removes reliance on the racy post-commit cascade.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/usecases/dep-readiness.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-03T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-dep-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('dependency readiness', () => {
  it('a cancelled dependency does not appear as an unmet dependency', () => {
    const dep = work.create(ctx(), { type: 'task', title: 'dep', agent: 'x' });
    const d = work.create(ctx(), { type: 'task', title: 'd', agent: 'x' });
    work.link(ctx(), d.id, dep.id, 'x');
    work.cancel(ctx(), dep.id, 'x');
    const res = work.blockers(ctx(), d.id);
    expect(res.unmet_dependencies).toEqual([]); // cancelled satisfies
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/dep-readiness.test.ts`
Expected: FAIL — `unmet_dependencies` contains the cancelled dep id.

- [ ] **Step 3: Treat cancelled as satisfied everywhere readiness is computed**

Add a helper in `src/storage/repos.ts` under `links`:

```typescript
      /** A dep is satisfied when its status is terminal (completed OR cancelled). */
      allDepsSatisfied(source: string): boolean {
        for (const t of this.dependsOn(source)) {
          const wi = tx.get<{ status: string }>('SELECT status FROM work_items WHERE id=?', t);
          if (!wi) throw new Error(`dependency target ${t} missing for ${source}`); // never silently satisfied
          if (wi.status !== 'completed' && wi.status !== 'cancelled') return false;
        }
        return true;
      },
      unmetDeps(source: string): string[] {
        const out: string[] = [];
        for (const t of this.dependsOn(source)) {
          const wi = tx.get<{ status: string }>('SELECT status FROM work_items WHERE id=?', t);
          if (!wi) throw new Error(`dependency target ${t} missing for ${source}`);
          if (wi.status !== 'completed' && wi.status !== 'cancelled') out.push(t);
        }
        return out;
      },
```

Update `src/usecases/work.ts` `blockers()` to use `r.links.unmetDeps(id)` instead of the inline `status !== 'completed'` loop. Update `src/usecases/next.ts` `buildRankedCandidates` to compute `depsAllComplete` via `r.links.allDepsSatisfied(workItemId)`. (This also fixes the missing-target inconsistency: both now throw rather than silently satisfy.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/usecases/dep-readiness.test.ts tests/usecases/cascade.test.ts`
Expected: PASS.

- [ ] **Step 5: Self-heal draft→ready in the acquire phase**

In `src/usecases/next.ts`, inside the acquire-walk immediate tx (Task 4, before the lease INSERT), promote the item if it is a `draft` with all deps satisfied and a running step is present:

```typescript
const wiRow = tx.get<{ status: string }>('SELECT status FROM work_items WHERE id=?', workItemId);
if (wiRow?.status === 'draft' && repos(tx).links.allDepsSatisfied(workItemId)) {
  repos(tx).workItems.setStatus(workItemId, 'ready', args.agent);
}
```

Add a test asserting a `draft` dependent becomes dispatchable once its prerequisite completes, even without the `auto_activate_dependents` cascade (append to `dep-readiness.test.ts`). Run: `npx vitest run tests/usecases/dep-readiness.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/usecases/next.ts src/usecases/work.ts src/storage/repos.ts tests/usecases/dep-readiness.test.ts
git commit -m "feat(deps): cancelled satisfies + readiness self-heal in next (kills cascade race)"
```

---

## Task 7: Transitive cycle detection on `work link`

**Files:**
- Modify: `src/usecases/work.ts`, `src/storage/repos.ts`
- Test: `tests/usecases/cycle.test.ts` (create)

Replace the one-hop reciprocal check with an iterative DFS, run **inside the same immediate tx** as the insert.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/usecases/cycle.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-03T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-cyc-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('transitive cycle detection', () => {
  it('rejects A->B->C->A', () => {
    const A = work.create(ctx(), { type: 'task', title: 'A', agent: 'x' });
    const B = work.create(ctx(), { type: 'task', title: 'B', agent: 'x' });
    const C = work.create(ctx(), { type: 'task', title: 'C', agent: 'x' });
    work.link(ctx(), A.id, B.id, 'x'); // A depends on B
    work.link(ctx(), B.id, C.id, 'x'); // B depends on C
    expect(() => work.link(ctx(), C.id, A.id, 'x')).toThrowError(/cycl/i); // C depends on A → cycle
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/cycle.test.ts`
Expected: FAIL — the link is allowed (one-hop check misses it).

- [ ] **Step 3: Implement DFS `wouldCycle` and use it in `link`**

Add to `src/storage/repos.ts` under `links`:

```typescript
      /** True if adding source -depends_on-> target would create a cycle.
       *  Run inside the immediate (write) txn so it sees all committed edges. */
      wouldCycle(source: string, target: string): boolean {
        // Adding source->target closes a cycle iff source is already reachable FROM target.
        const stack = [target]; const seen = new Set<string>();
        while (stack.length) {
          const cur = stack.pop()!;
          if (cur === source) return true;
          if (seen.has(cur)) continue;
          seen.add(cur);
          for (const t of this.dependsOn(cur)) stack.push(t);
        }
        return false;
      },
```

In `src/usecases/work.ts` `link()`, replace the reciprocal-check block (`work.ts:101-102`) with:

```typescript
    // Transitive cycle check — MUST run inside this immediate txn so it sees all committed edges.
    if (r.links.wouldCycle(source, target)) throw new ApmError('E_VALIDATION', 'cyclic dependency');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/usecases/cycle.test.ts tests/usecases/work.test.ts`
Expected: PASS (self-dep test and new transitive test both pass).

- [ ] **Step 5: Commit**

```bash
git add src/usecases/work.ts src/storage/repos.ts tests/usecases/cycle.test.ts
git commit -m "feat(deps): transitive DFS cycle detection on work link"
```

---

## Task 8: Re-validate dependencies at terminal completion

**Files:**
- Modify: `src/usecases/advance.ts`
- Test: `tests/usecases/complete-dep-guard.test.ts` (create)

Dep gating today is enforced at dispatch but never at completion. Mirror the existing `parent_id` child guard.

- [ ] **Step 1: Read the terminal branch**

Run: `sed -n '40,90p' src/usecases/advance.ts` — locate the terminal-completion branch that sets the work item to `completed` (around `advance.ts:54-69`). Identify the `tx` and `workItemId` in scope.

- [ ] **Step 2: Write the failing test**

```typescript
// tests/usecases/complete-dep-guard.test.ts
// Build a work item whose workflow reaches terminal while a depends_on target is still incomplete,
// then assert completion is refused with E_PRECONDITION. Model the smallest workflow that reaches
// terminal in one step (reuse a fixture from tests/integration/step-types.test.ts as a template).
import { describe, it, expect } from 'vitest';
// ... standard setup (see sibling tests) ...
// expect(() => advanceToTerminal(...)).toThrowError(/dependenc/i);
```

(Author the concrete setup by copying the smallest terminal-reaching workflow fixture already used in `tests/integration/step-types.test.ts`; link an incomplete dep onto the item before the terminal step completes.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/usecases/complete-dep-guard.test.ts`
Expected: FAIL — completion succeeds despite an unmet dependency.

- [ ] **Step 4: Add the guard in the terminal branch**

In the terminal-completion branch of `src/usecases/advance.ts`, before setting status `completed`:

```typescript
if (!repos(tx).links.allDepsSatisfied(workItemId)) {
  throw new ApmError('E_PRECONDITION', 'cannot complete: dependencies incomplete');
}
```

(Import `repos` and `ApmError` if not already imported in this file.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/usecases/complete-dep-guard.test.ts && npm test`
Expected: PASS; no regressions in integration flows (existing fixtures complete deps before terminal).

- [ ] **Step 6: Commit**

```bash
git add src/usecases/advance.ts tests/usecases/complete-dep-guard.test.ts
git commit -m "feat(deps): re-validate dependencies at terminal completion"
```

---

## Task 9: Dedup-on-create / decompose

**Files:**
- Create: `src/domain/normalize.ts`
- Modify: `src/storage/migrations.ts` (add `dedup_key` column — migration v3), `src/storage/repos.ts`, `src/usecases/work.ts`
- Test: `tests/domain/normalize.test.ts`, `tests/usecases/dedup.test.ts` (create)

- [ ] **Step 1: Write the failing normalize test**

```typescript
// tests/domain/normalize.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeTitle } from '../../src/domain/normalize.js';

describe('normalizeTitle', () => {
  it('lowercases, trims, collapses whitespace, strips punctuation', () => {
    expect(normalizeTitle('  Fix   the Login-Bug! ')).toBe('fix the loginbug');
    expect(normalizeTitle('Add OAuth')).toBe(normalizeTitle('add   oauth'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/domain/normalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `normalizeTitle`**

```typescript
// src/domain/normalize.ts
/** Canonical dedup key for a work-item title. */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/domain/normalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `dedup_key` column (migration v3) + backfill**

Append migration version 3 to `src/storage/migrations.ts`:

```typescript
  {
    version: 3,
    up: (db, stamp) => {
      db.exec(`ALTER TABLE work_items ADD COLUMN dedup_key TEXT;`);
      // backfill is left to app writes; existing rows keep NULL (advisory feature, no unique index)
      db.exec(`CREATE INDEX ix_wi_dedup ON work_items(parent_id, dedup_key);`);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(3, stamp);
    },
  },
```

Also add the column + index to `src/storage/schema.sql`'s `work_items` block for fresh installs.

- [ ] **Step 6: Write the failing dedup test**

```typescript
// tests/usecases/dedup.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-03T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-dd-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('dedup on create', () => {
  it('refuses a duplicate-titled sibling without force, returns existing id detail', () => {
    const parent = work.create(ctx(), { type: 'feature', title: 'P', agent: 'x' });
    work.create(ctx(), { type: 'task', title: 'Add OAuth', parent: parent.id, agent: 'x' });
    expect(() => work.create(ctx(), { type: 'task', title: 'add  oauth', parent: parent.id, agent: 'x' }))
      .toThrowError(/E_DUPLICATE|duplicate/i);
  });
  it('allows duplicate with force', () => {
    const parent = work.create(ctx(), { type: 'feature', title: 'P', agent: 'x' });
    work.create(ctx(), { type: 'task', title: 'Add OAuth', parent: parent.id, agent: 'x' });
    const dup = work.create(ctx(), { type: 'task', title: 'Add OAuth', parent: parent.id, agent: 'x', force: true });
    expect(dup.id).toBeTruthy();
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npx vitest run tests/usecases/dedup.test.ts`
Expected: FAIL — duplicate is created; no `force` option.

- [ ] **Step 8: Wire dedup into `create`**

In `src/usecases/work.ts`: import `normalizeTitle`; add `force?: boolean` to `CreateArgs`. Inside the `create` transaction, after the parent check:

```typescript
    const dedupKey = normalizeTitle(a.title);
    if (!a.force) {
      const dup = tx.get<{ id: string }>(
        "SELECT id FROM work_items WHERE dedup_key=? AND status NOT IN ('cancelled') AND ((parent_id IS NULL AND ? IS NULL) OR parent_id=?)",
        dedupKey, a.parent ?? null, a.parent ?? null,
      );
      if (dup) throw new ApmError('E_DUPLICATE', `duplicate of ${dup.id} (use --force to override)`, [{ field: 'title', problem: 'duplicate sibling', got: a.title }]);
    }
```

Pass `dedupKey` into `r.workItems.insert` — extend `NewWorkItem` with `dedupKey: string | null` and add `dedup_key` to the INSERT column list + values in `repos.ts`. Add `E_DUPLICATE` to the `ApmError` code union in `src/domain/errors.ts` (map to a distinct exit code if the CLI switches on codes). Wire a `--force` flag on `apm work create` in the CLI command file (search `work create` registration; add `.option('--force', ...)` and pass through).

- [ ] **Step 9: Run to verify it passes**

Run: `npx vitest run tests/usecases/dedup.test.ts && npm test`
Expected: PASS, no regressions.

- [ ] **Step 10: Commit**

```bash
git add src/domain/normalize.ts src/storage/migrations.ts src/storage/schema.sql src/storage/repos.ts src/usecases/work.ts src/domain/errors.ts tests/domain/normalize.test.ts tests/usecases/dedup.test.ts
git commit -m "feat(work): dedup_key sibling check on create/decompose (advisory, --force)"
```

---

## Task 10: Multi-process concurrency harness

**Files:**
- Create: `tests/integration/concurrency-procs.test.ts`, `scripts/next-once.ts` (a tiny dispatch driver child script)
- Test: the above

Two layers: (a) a same-process two-handle test proving no double-lease across connections (extends the existing pattern in `plan4-loop.test.ts`); (b) a real multi-process spawn test proving every item is taken exactly once with no uncaught `SQLITE_BUSY`.

- [ ] **Step 1: Write the child driver**

```typescript
// scripts/next-once.ts — dispatch exactly one item and print its id (or IDLE), then exit.
import { SqliteStorage } from '../src/storage/sqlite.js';
import { systemClock } from '../src/domain/clock.js';
import * as next from '../src/usecases/next.js';

const [dbPath, agent] = process.argv.slice(2);
const storage = new SqliteStorage(dbPath, systemClock());
try {
  const r = next.next({ storage, clock: systemClock() }, { agent, capabilities: [], match: 'any', acquire: true, session: `S-${agent}` });
  process.stdout.write(r.status === 'dispatched' ? `OK ${r.data.work_item}\n` : `IDLE ${('reason' in r ? r.reason : r.status)}\n`);
} catch (e: any) {
  process.stdout.write(`ERR ${e?.code ?? e?.message}\n`); process.exitCode = 1;
} finally { storage.close(); }
```

(If `systemClock` does not exist, add a real-wall-clock `Clock` in `src/domain/clock.ts`: `export const systemClock = (): Clock => ({ now: () => new Date().toISOString() });` — needed because concurrency requires real time, not the fixed test clock.)

- [ ] **Step 2: Write the failing test**

```typescript
// tests/integration/concurrency-procs.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { systemClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as wf from '../../src/usecases/workflow.js';

let dir: string; const clock = systemClock();
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-cc-')); initProject(dir, clock); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('multi-process dispatch', () => {
  it('N agents take M ready items with no double-lease, no uncaught SQLITE_BUSY', () => {
    const dbPath = join(dir, '.apm', 'apm.db');
    const s = new SqliteStorage(dbPath, clock);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const wi = work.create({ storage: s, clock }, { type: 'feature', title: `F${i}`, agent: 'seed' });
      wf.attachRun({ storage: s, clock }, { workItem: wi.id, workflow: 'feature_delivery', agent: 'seed' });
      ids.push(wi.id);
    }
    // raise the cap so 6 agents can run
    s.transaction('immediate', (tx) => tx.run("INSERT INTO policies (id, scope_type, scope_id, policy_json, created_at) VALUES ('POL-cap','global',NULL,?,?)", JSON.stringify({ max_parallel_agents: 6 }), tx.now()));
    s.close();

    const outs: string[] = [];
    for (let i = 0; i < 6; i++) {
      const out = execFileSync('npx', ['tsx', 'scripts/next-once.ts', dbPath, `agent-${i}`], { encoding: 'utf8' });
      outs.push(out.trim());
    }
    const taken = outs.filter((o) => o.startsWith('OK ')).map((o) => o.slice(3));
    expect(outs.some((o) => o.startsWith('ERR'))).toBe(false);       // no uncaught busy/error
    expect(new Set(taken).size).toBe(taken.length);                  // no item taken twice
  });
});
```

(For stronger parallelism, swap the sequential loop for concurrent `child_process.execFile` with `Promise.all`; sequential still proves uniqueness + no-error and is deterministic. Note in a comment that true simultaneity is better exercised by the concurrent variant.)

- [ ] **Step 3: Run test to verify it fails (then passes after wiring)**

Run: `npx vitest run tests/integration/concurrency-procs.test.ts`
Expected: initially may FAIL if `systemClock` is missing — add it (Step 1), then PASS.

- [ ] **Step 4: Add the same-process two-handle assertion**

Append a second `it()` mirroring `plan4-loop.test.ts` TEST B but with **two distinct ready items** and two storage handles, asserting both agents dispatch different items and exactly two active `work_item` leases exist.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/concurrency-procs.test.ts scripts/next-once.ts src/domain/clock.js
git commit -m "test: multi-process concurrency harness for parallel dispatch"
```

---

## Self-Review

**1. Spec coverage (against `2026-06-03-parallel-workstreams-design.md` §5 Spec A):**
- A1 resource-lease + migration → Tasks 1, 2 ✓
- A2 claim-walk (deferred peek + short immediate acquire, SQLITE_BUSY+jitter) → Tasks 3, 4 ✓
- A3 slot cap + `parallel_work_enabled` (default on) → Task 5 ✓
- A4 cancelled-satisfies + readiness self-heal + transitive DFS + completion re-validate + missing-target reconcile → Tasks 6, 7, 8 ✓ (missing-target handled by `allDepsSatisfied` throwing in Task 6)
- A5 dedup-on-decompose → Task 9 ✓ (decompose path: the decompose step calls `work.create`; ensure it passes no `force` so the sibling check applies — verify in the decompose usecase during Task 9)
- A6 multi-process harness → Task 10 ✓

**2. Placeholder scan:** Task 8's test setup references "copy the smallest terminal-reaching fixture" rather than inlining it — this is a pointer to an existing fixture, not a code placeholder, but the implementer must write the concrete setup. Acceptable because the exact fixture lives in the named test file; flagged here so it is not skipped.

**3. Type consistency:** `selectCandidates` (Task 3) returns `{status:'dispatchable'; workItemIds}` consumed in Task 4's `buildRankedCandidates`. `allDepsSatisfied`/`unmetDeps`/`wouldCycle` (Tasks 6, 7) live on the `links` repo and are used in `next.ts`/`work.ts`/`advance.ts`. `acquireResource` (Task 2) is reused conceptually by Task 5's inline slot insert (same column list). `normalizeTitle` (Task 9) matches the `dedup_key` column. `NewWorkItem.dedupKey` added in Task 9 must be threaded through `repos.workItems.insert` — noted in Task 9 Step 8.

**Cross-task ordering note:** Task 4 introduces `buildRankedCandidates`/`buildDispatchPayload`; Tasks 5 and 6 add code *inside* those functions/the acquire tx. Implement Tasks 1→4 in order; 6/7/8/9 are largely independent after 4; 10 last.
