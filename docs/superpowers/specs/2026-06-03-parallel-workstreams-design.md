# Parallel Multi-Agent Workstreams — Design

**Date:** 2026-06-03
**Status:** Approved design; decomposes into three implementation specs (A build-first, B next, C runner-side).
**Question this answers:** How do multiple AI agents safely and efficiently work on *separate* work items in parallel — without conflicts or duplication — and is dependency resolution strong enough?

---

## 1. Context & current state

APM is a CLI-first, local-first durable project-execution **state** system. It is explicitly **not** an orchestrator: external runners (Claude Code `/loop`, cron, daemons) provide repetition; APM provides correctness/state. Storage is SQLite (WAL, `busy_timeout=5000`), reached only via `Storage.transaction('immediate'|'deferred', fn)`. Domain code is pure (time injected via `Clock`).

An adversarial review of the codebase established what already works and what does not:

**Already parallel-safe (APM-state layer):**
- Leases are per-work-item, acquired atomically inside an `immediate` transaction, with correctness guaranteed by a partial UNIQUE index `ux_active_lease ON leases(work_item_id) WHERE status='active'` (`schema.sql:79`). A second agent leasing the same item fails fast with `E_LEASE_CONFLICT`.
- `apm next` already does capability matching (`resolver.ts` `capsMatch`, with `any|all` mode and a `capability_mismatch` idle reason) and already excludes items behind an open `human_gate` blocker.
- WAL + `busy_timeout` + the immediate/deferred split are a sound base for single-host multi-process operation.

**Gaps that make unattended parallel operation unsafe or inefficient:**
1. **Dispatch contention** — `selectCandidate` returns exactly one top candidate and, on a lease conflict, returns `idle/all_leased` instead of walking to the next free item. Under contention N agents fight over the top item; throughput collapses toward 1.
2. **Dependency model too weak** — readiness checks `status === 'completed'` only, so a **cancelled** dependency blocks its dependents forever; the post-commit cascade that promotes `draft → ready` has a lost-update race under parallel completions (diamond dependents stranded in `draft`); and cycle detection is one-hop only (`A→B→C→A` slips through).
3. **No code-collision protection** — a lease stops two agents on the *same* item, but two agents on *separate* items can still edit the same source files; conflicts surface only at integration.
4. **No fleet governor** — nothing caps N; 20 runners on one WAL writer plus 20 parallel builds is a fork bomb.
5. **No failure containment** — a lease can expire mid-step (multi-hour work, minutes-long TTL) and another agent grabs a half-done item; a perpetually-failing item is re-dispatched forever, burning the whole fleet.

## 2. Goal & non-goals

**Goal:** make it safe and efficient for N agents on **one host**, sharing one `.apm/apm.db`, to each work a *separate* work item in parallel — with strong dependency resolution, no duplicate work, no silent stalls, and conflicts handled at a single authoritative chokepoint.

**Topology (in scope):** same host, N Claude Code `/loop` runner processes, one shared WAL database, one git worktree per active work item.

**Non-goals (deferred):** distributed / multi-host execution (SQLite-over-network-FS is unsafe; would need a server/daemon or a different storage provider — out of scope, noted for a future version). No web UI, sync, or auth.

## 3. Governing principle: APM provides primitives, the runner does git

The single most important design correction from review: **git/filesystem execution does not belong in APM.** `git worktree add`, branch creation, and merges are non-transactional, non-idempotent, non-rollbackable side effects. Putting them inside (or alongside) `Storage.transaction()` produces split-brain — a committed git side-effect with a rolled-back DB row, or vice versa — and re-architects a state store into a mini-orchestrator, violating APM's stated boundary and its "domain code is pure" invariant.

Therefore:
- **APM owns:** the state graph, the **resource-lease** serialization primitive, dependency correctness, dedup, and the events log. It *records* that a branch / worktree / PR exists (as work-item fields + events); it never invokes git.
- **The runner owns:** all git verbs (worktree create, branch, PR, merge-train), heartbeating during long steps, and worktree GC. The existing `superpowers:using-git-worktrees` and `superpowers:finishing-a-development-branch` skills already do exactly this.

This split is why the work decomposes cleanly into the three specs below, and why the git-heavy parts (Spec C) live outside the APM domain.

## 4. The parallel-work toggle

Project-level setting **`parallel_work_enabled`** (policy-scoped, **default `true`**). When `false`, the global concurrency cap (the `slot` resource, §5 A3) is forced to `1`, so exactly one agent is dispatched at a time across the project — serial execution — using the same mechanism, no special-case code path. Surfaced via `apm policy` and reported in `apm status`.

---

## 5. Spec A — APM parallel-safety core (build first)

The real APM contribution. All of the following are pure state/transaction changes, testable without git.

### A1. Generalize lease → resource-lease (foundation)
- Add to `leases`: `resource_type TEXT NOT NULL DEFAULT 'work_item'` (`'work_item' | 'integration' | 'slot' | 'path'`), `resource_key TEXT NOT NULL`. Make `work_item_id` **nullable** (singleton/slot leases have no work item). For work-item leases, `resource_key = work_item_id`.
- Replace `ux_active_lease` with `UNIQUE(resource_type, resource_key) WHERE status='active'`. `resource_key` is `NOT NULL` so the partial index always fires (a NULL key would let duplicates coexist — the key correctness trap).
- Acquire/heartbeat/release/expire-stale logic is unchanged; a thin compat shim keeps existing work-item-lease callers working.
- **Migration (explicit, ordered, one transaction):** add columns nullable → backfill all rows incl. active (`resource_type='work_item'`, `resource_key=work_item_id`) → add the new partial-UNIQUE index → drop `ux_active_lease`. Keep both indexes valid mid-migration. Confirm/extend the migration runner in `init.ts`.
- This single change yields, for free: the singleton **`integration`** lease (merge serialization, Spec C), the counting **`slot`** lease (fleet cap, A3), and any future advisory locks.

### A2. Claim-walk dispatch (efficiency; the thundering-herd fix)
- **Correctness constraint (load-bearing):** do **not** hold the WAL write lock for the whole walk. Peek + rank candidates in a **`deferred`** read tx; then attempt acquisition as **one INSERT per attempt in a short `immediate` tx**, looping in TypeScript until one succeeds or the ranked list is exhausted.
- On `SQLITE_CONSTRAINT_UNIQUE` (item taken since peek), advance to the next candidate. A caught UNIQUE does **not** poison the surrounding tx (SQLite default conflict = ABORT rolls back only the failed statement) — verified — but each attempt is its own tx anyway, so the question is moot.
- Catch `SQLITE_BUSY` / `SQLITE_BUSY_SNAPSHOT` at the `next` boundary → map to `idle` with a small **jittered** `retry_after` (never an uncaught throw). Jitter prevents N runners re-colliding in lockstep.
- `selectCandidate` returns the **ranked dispatchable list** (not a single winner); the dispatch loop consumes it. Bound the walk to the first K candidates to keep each immediate tx short.
- Result: agent A grabs rank #1; agent B's #1 attempt fails UNIQUE, B immediately takes #2 — in the same `apm next` call, no backoff, priority still dominates, write lock held only per-INSERT.

### A3. Fleet governor — counting `slot` lease + parallel toggle
- Policy `max_parallel_agents` (integer). A runner must hold a `resource_type='slot'` lease (`resource_key` = `slot-1..slot-N`) to dispatch; claim-walk over free slots. No free slot → `idle`.
- `parallel_work_enabled=false` (§4) forces `N=1`.
- Slot leases carry the same TTL/heartbeat/expire-stale machinery, so a dead runner's slot is reclaimed automatically.

### A4. Dependency correctness (answers "is dependency resolution strong enough?" — today: no)
- **Cancelled satisfies:** readiness predicate becomes `dep.status IN ('completed','cancelled')` consistently across `next.ts`, `work.ts` blockers, and the cascade. A cancelled prerequisite no longer blocks dependents forever. Emit an event so it is auditable. (Decision recorded: cancellation does **not** auto-cascade-cancel dependents — it unblocks them.)
- **Readiness as a pure function of current state (kills the cascade race):** fold `draft → ready` promotion into the existing dep-scan inside `apm next` — when scanning a candidate's deps, if all are terminal, promote it. This makes activation self-healing and eliminates the post-commit lost-update race (diamond dependents can no longer strand in `draft`) by construction. The event-driven `cascadeActivateDependents` becomes a non-authoritative optimization (or is removed).
- **Transitive cycle detection:** replace the one-hop reciprocal check in `work.ts` with an **iterative DFS (explicit visited-set)** from the new edge's target following `depends_on`; reaching the source ⇒ `E_VALIDATION cyclic`. **Must run inside the same `immediate` tx as the insert** — the write lock serializes concurrent `work link` calls so each DFS sees all previously-committed edges; moving it to a deferred read reopens the cross-process cycle race. State this explicitly in code comments.
- **Re-validate at completion:** at terminal-step completion (`advance.ts` terminal branch), assert all `depends_on` targets are terminal, mirroring the existing `parent_id` child guard — otherwise dep gating is advisory at dispatch but never enforced at completion.
- **Reconcile missing-target semantics:** `next.ts` currently treats a missing dep target as *satisfied* while the cascade treats it as *blocking*. Pick one (recommended: a missing target is a hard error / raises a blocker, never silently satisfied) and apply both places.

### A5. Dedup-on-decompose
- Add `dedup_key` (normalized title: lowercase, trim, collapse whitespace, strip punctuation) to `work_items`. `work create` and the `decompose` step check siblings under the same parent for a matching key. Match → human mode warns + requires `--force`; agent/json mode returns the existing id with `E_DUPLICATE`; decompose auto-skips. Advisory (no hard unique index — legitimate duplicate titles exist); documented as best-effort under concurrency.

### A6. Multi-process concurrency test harness
- Spawn several real `tsx src/bin/apm.ts next --acquire` child processes against one WAL db; assert: **no double-lease, every item completed exactly once, no deadlock, no uncaught `SQLITE_BUSY`.** Scoped to DB-level claim races (no git), so it stays a pure integration test. Plus unit tests: claim-walk interleaving, cancelled-dep readiness, diamond self-heal, transitive-cycle rejection, resource-lease UNIQUE per `(type,key)`.

---

## 6. Spec B — Failure semantics & observability (next)

- **Fence token (lease epoch):** monotonic epoch bumped on every acquire/expire of a work-item lease. Mutating step ops (`step complete/fail/review`) require the caller's epoch to match the live lease (`WHERE lease_epoch = ?`) → a stale holder whose lease expired mid-step is rejected with `E_LEASE_LOST` instead of silently racing another agent on the same item. This is the standard "lease expired but holder still running" fix and is essential once irreversible side effects (merges) hang off leases.
- **Runner heartbeat contract:** documented requirement that the `/loop` wrapper heartbeats on a timer while a child step executes (the busy agent can't heartbeat itself). Step-type-aware default TTLs via policy (long for `agent_execution`, short for reviews).
- **Poison-item quarantine:** track per-item dispatch/failure count (derivable from the `events` table). After K failed re-dispatches, auto-create a `human_gate` blocker and stop dispatching → one bad item can no longer burn the whole fleet.
- **Observability:** `apm status --agents` (per-agent live lease + heartbeat age + last event) and `apm work why <id>` (replay the resolver's gate decisions for one item — why is it idle/blocked/not dispatchable). Both read-only, reusing existing resolver logic.
- **`step complete` lease-holder guard:** completion rejected unless the actor holds the current live lease (complements the fence token).

## 7. Spec C — Runner integration (outside the APM domain)

Owned by `/loop` + the superpowers git skills, *not* APM core. APM only records state and provides the serialization primitive.

- **Worktree per item:** on dispatch of an implementation step, the runner `git fetch origin main` then `git worktree add .claude/worktrees/<WI-id> -b apm/<WI-id> origin/main`. **Not** under `.apm/` (which holds the db + WAL). The db is reached via explicit `APM_DB` / `--dir` passed to the child, never cwd walk-up (walk-up breaks for worktrees on another volume). APM records `branch`, `worktree_path`, `base_sha` (work-item fields + events).
- **Idempotent re-dispatch:** before `worktree add`, check `git worktree list --porcelain` and `git branch --list apm/<WI-id>`. Reuse an existing matching worktree; `add` without `-b` if only the branch exists; `-b` only when neither exists. Resume vs reset is an explicit decision.
- **Merge train (optimistic, not a global test mutex):** run the test suite **outside** the `integration` lease; acquire the singleton `integration` lease only for the short critical section (re-check main hasn't moved by SHA; if it moved, re-rebase + retest; then fast-forward/merge); release in `finally` **regardless of outcome**. Rebase conflict → transition the item to `blocked` (human gate), never hold the lease. Make merge idempotent: check PR-already-merged state first; record `merged_sha` so a retry is a no-op.
- **Worktree GC / reaper:** keyed off APM's released/expired-lease events + recorded `worktree_path`. On expiry, preserve uncommitted work (stash/bundle to a `wip/<WI-id>` ref) **before** `git worktree remove --force` — never force-remove and silently destroy agent work. Keep the branch for resume; prune only after merge/cancel.
- **Disk:** N worktrees share `.git/objects` but each has a working tree; for this Node project use a shared/hard-linked `node_modules` (or pnpm's content-addressed store) to avoid N × hundreds-of-MB. Cap concurrent worktrees via `max_parallel_agents`.

**Path-locks (former component 5b): CUT for v1 (YAGNI).** Touched files are unknown before code is written; `--touches` is an unverified promise; the merge train already detects conflicts at the authoritative chokepoint. Revisit only with evidence of real churn-conflict pain; if ever needed it is a generic `resource_type='path'` lease (free from A1), enforced at merge time when touched files are actually known.

---

## 8. Risks & open items

- **WAL writer is the ultimate serialization point.** Every `--acquire` is an immediate (write) tx. The `slot` cap and short claim-walk txns keep contention bounded, but very large N will serialize on the single writer regardless — another reason the fleet governor (A3) is mandatory, not optional.
- **Fence token vs. existing callers** — A1/A6 must land before B's fence token so the epoch column has a stable home; ordering is reflected in the spec sequence.
- **`orders_before` (soft/merge-order) edge type** — deferred. Today only hard `depends_on` exists, which over-serializes when two items could build in parallel but must merge in order. If parallel branches need a defined integration order beyond what the `integration` lease gives, add a non-blocking `orders_before` edge (gates the merge step, not dispatch; included in the cycle DFS). Noted, not built in v1.

## 9. Implementation order

1. **Spec A** — A1 (migration) → A2/A3/A4/A5 (mostly independent) → A6 harness. This is itself a good parallel-work demo once A2 lands.
2. **Spec B** — fence token + heartbeat contract + poison quarantine + observability.
3. **Spec C** — runner-side wiring (separate plan; lives in `/loop` + git skills).

## 10. Spec A — status & carried-forward follow-ups

**Status:** Spec A implemented and merged (16 commits, 321 tests green, typecheck clean). Plan: `docs/superpowers/plans/2026-06-03-parallel-safety-core.md`. All tasks passed per-task spec+quality review and a final whole-implementation review.

Items the final cross-task review flagged as **prerequisites before Spec B/C builds on this** (none are Spec-A blockers):

- **[I1 → Spec C] Surface the slot lease id for runner release.** `apm next --acquire` acquires a `slot` lease implicitly but the dispatch payload returns only the work-item lease, so a runner cannot release its slot — it expires only on TTL. At `max_parallel_agents=1` (serial mode) a polling-but-idle agent holds the sole slot for the full TTL, locking others out until expiry (latency, not a deadlock — lazy-heal reclaims on `expires_at`). Fix in Spec C: add `data.slot_lease` to the dispatch payload and have the runner `lease release` it in `finally`; or shorten slot TTL relative to work TTL.
- **[I2 → Spec B] Reconcile the two global-policy readers.** `globalFleetPolicy` merges all `scope_type='global'` rows `ORDER BY id` (last wins); `effectivePolicy`/`repos.policies.global()` uses `LIMIT 1` with no `ORDER BY`. They agree out-of-box (seed creates exactly one global row) but split-brain if an operator adds a second global row (fleet cap reads the new value; `auto_activate_dependents`/`auto_accept` read the stale one). True fix: make `effectivePolicy` merge global rows too (touches advance/workflow/decision — do it deliberately with tests), or enforce a single global row.
- **[M1] Filter operator lease views to `resource_type='work_item'`.** `apm status` active-leases and `apm lease list` now also surface `slot`/`integration` leases (the work-item `active` count is unaffected — it uses `COUNT(DISTINCT work_item_id)`).
- **[M2] Remove the now-redundant singular `selectCandidate`** in `resolver.ts` (superseded by `selectCandidates`; only its own test keeps it alive) and migrate its tests.
- **[M3] Wrap the missing-dep-target throw in `ApmError`.** `allDepsSatisfied`/`unmetDeps` throw a raw `Error` on a missing target (currently unreachable — FK `ON DELETE RESTRICT`, no hard-delete path), reached from hot read paths (`next`, `blockers`, cascade, terminal guard). Wrap as `E_VALIDATION` for graceful surfacing if it ever fires.
