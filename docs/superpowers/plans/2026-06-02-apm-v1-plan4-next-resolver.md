# APM V1 — Plan 4: `apm next` Resolver, Agent Contract & Loop

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** The headline command `apm next` — a pure candidate resolver, the agent-format prompt contract (one-shot, token-lean), `--acquire` atomic dispatch+lease, `--session current`, the exit-code/status taxonomy, `apm status`, and the full autonomous-loop + concurrency e2e tests. This completes V1.

**Architecture:** Adds `domain/resolver.ts` (pure `selectCandidate(candidates, caller, now)`), `domain/contract.ts` (pure per-step contract text + `next_actions`), `usecases/next.ts` (assemble candidates, dispatch payload, `--acquire`), extends `format/render.ts` with the agent projection for `next`, and `usecases/status.ts`.

**Tech Stack:** Same. Builds on merged Plans 1–3 (engine, repos, work.current, leases, sessions).

**The next contract (spec §7.6):** `next` data = `{ status, work_item, run, step:{id,type}, allowed_action, required_context:[{id,version,type,title,one_line}], do_not:[], when_done:[], next_actions:[], lease, retry_after }`. Agent format is a strict projection of this; `next_actions` stays json-only.

---

## File Structure
- `src/domain/resolver.ts` — `Candidate`, `Caller`, `Resolution`, `selectCandidate(cands, caller, now)` (pure).
- `src/domain/contract.ts` — `buildContract(step, requiredContext, workItemId, runId, sessionId)` → `{ allowed_action, do_not, when_done, next_actions }` (pure).
- `src/usecases/next.ts` — `next(ctx, args)`; `nextExitCode(status)`.
- `src/usecases/status.ts` — `status(ctx)`.
- `src/format/render.ts` — extend: agent projection for the `next` payload.
- `src/cli/program.ts` — wire `next` + `status`.
- Tests + `tests/integration/plan4-loop.test.ts`.

---

## Task 1: Pure candidate resolver

**Files:** Create `src/domain/resolver.ts`; Test `tests/domain/resolver.test.ts`.

`selectCandidate` is pure: given pre-computed candidate descriptors + caller filters + `now`, decide dispatched/idle/drained. The usecase (Task 3) does the DB work to build descriptors.

- [ ] **Step 1: Failing test** `tests/domain/resolver.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { selectCandidate, type Candidate, type Caller } from '../../src/domain/resolver.js';

const NOW = '2026-06-02T12:00:00.000Z';
function cand(p: Partial<Candidate>): Candidate {
  return {
    workItemId: 'WI-1', priority: 0, createdAt: '2026-06-02T00:00:00.000Z',
    depsAllComplete: true, hasPendingStep: true, blockedByHumanGate: false,
    requiredCaps: [], leaseHolderAgent: null, leaseLive: false, ...p,
  };
}
const caller: Caller = { agent: 'claude', capabilities: [], match: 'any' };

describe('selectCandidate', () => {
  it('dispatches the only eligible candidate', () => {
    const r = selectCandidate([cand({})], caller, NOW);
    expect(r).toEqual({ status: 'dispatched', workItemId: 'WI-1' });
  });

  it('drained when no candidates have a pending step at all', () => {
    const r = selectCandidate([], caller, NOW);
    expect(r.status).toBe('drained');
  });

  it('idle deps_pending when deps incomplete', () => {
    const r = selectCandidate([cand({ depsAllComplete: false })], caller, NOW);
    expect(r).toMatchObject({ status: 'idle', reason: 'deps_pending' });
  });

  it('idle all_leased when the only candidate is live-leased by another agent', () => {
    const r = selectCandidate([cand({ leaseLive: true, leaseHolderAgent: 'other' })], caller, NOW);
    expect(r).toMatchObject({ status: 'idle', reason: 'all_leased' });
  });

  it('dispatches a candidate the caller already holds the live lease on', () => {
    const r = selectCandidate([cand({ leaseLive: true, leaseHolderAgent: 'claude' })], caller, NOW);
    expect(r.status).toBe('dispatched');
  });

  it('idle awaiting_human when the only candidate is blocked by a human gate', () => {
    const r = selectCandidate([cand({ hasPendingStep: false, blockedByHumanGate: true })], caller, NOW);
    expect(r).toMatchObject({ status: 'idle', reason: 'awaiting_human' });
  });

  it('idle capability_mismatch when caps do not match (match=all)', () => {
    const r = selectCandidate([cand({ requiredCaps: ['security'] })], { agent: 'claude', capabilities: ['coding'], match: 'all' }, NOW);
    expect(r).toMatchObject({ status: 'idle', reason: 'capability_mismatch' });
  });

  it('ranks by priority desc then created_at then id', () => {
    const r = selectCandidate([
      cand({ workItemId: 'WI-1', priority: 1 }),
      cand({ workItemId: 'WI-2', priority: 5 }),
    ], caller, NOW);
    expect(r).toMatchObject({ status: 'dispatched', workItemId: 'WI-2' });
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/domain/resolver.ts`

```ts
export interface Candidate {
  workItemId: string;
  priority: number;
  createdAt: string;
  depsAllComplete: boolean;
  hasPendingStep: boolean;        // has a dispatchable pending main step (or review_gate with a pending child)
  blockedByHumanGate: boolean;    // has an open human_gate blocker
  requiredCaps: string[];         // capabilities the pending step requires
  leaseHolderAgent: string | null;
  leaseLive: boolean;             // a non-expired active lease exists
}

export interface Caller { agent: string; capabilities: string[]; match: 'any' | 'all'; }

export type Resolution =
  | { status: 'dispatched'; workItemId: string }
  | { status: 'idle'; reason: 'deps_pending' | 'all_leased' | 'capability_mismatch' | 'awaiting_human'; retryAfter: number }
  | { status: 'drained' };

function capsMatch(required: string[], caller: Caller): boolean {
  if (required.length === 0) return true;
  const have = new Set(caller.capabilities);
  return caller.match === 'all' ? required.every((c) => have.has(c)) : required.some((c) => have.has(c));
}

/** Pure dispatch decision over pre-computed candidates. `now` reserved for future time-based ranking. */
export function selectCandidate(candidates: Candidate[], caller: Caller, now: string): Resolution {
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
    return { status: 'dispatched', workItemId: dispatchable[0].workItemId };
  }

  // nothing dispatchable now — choose the most informative idle reason
  if (sawDeps) return { status: 'idle', reason: 'deps_pending', retryAfter: 30 };
  if (sawLeased) return { status: 'idle', reason: 'all_leased', retryAfter: 30 };
  if (sawCaps) return { status: 'idle', reason: 'capability_mismatch', retryAfter: 60 };
  if (sawHuman && !sawPending) return { status: 'idle', reason: 'awaiting_human', retryAfter: 0 };
  if (sawHuman) return { status: 'idle', reason: 'awaiting_human', retryAfter: 0 };
  return { status: 'drained' };
}
```

- [ ] **Step 4: Run, expect PASS (8).** **Step 5: Commit** `git add src/domain/resolver.ts tests/domain/resolver.test.ts && git commit -m "feat: add pure next-candidate resolver"`

---

## Task 2: Pure contract builder

**Files:** Create `src/domain/contract.ts`; Test `tests/domain/contract.test.ts`.

Per step type, produce the agent-facing `allowed_action`, `do_not` (≤3), `when_done` (resolved commands), and structured `next_actions`. Pure.

- [ ] **Step 1: Failing test** `tests/domain/contract.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildContract } from '../../src/domain/contract.js';
import type { StepDef } from '../../src/domain/workflow.js';

const ctxIds = { workItem: 'WI-1', run: 'WR-1', session: 'S-1' };

describe('buildContract', () => {
  it('agent_prompt with outputs → create-artifact action + resolved when_done', () => {
    const step: StepDef = { id: 'design', type: 'agent_prompt', outputs: [{ artifact_type: 'design' }], next: ['x'] };
    const c = buildContract(step, [{ id: 'ART-1', version: 2, type: 'spec', title: 'Spec', one_line: 'Spec' }], ctxIds);
    expect(c.allowed_action).toMatch(/design/i);
    expect(c.when_done[0]).toContain('apm step complete WR-1 design');
    expect(c.when_done[0]).toContain('--artifact-type design');
    expect(c.next_actions[0].cmd).toBe('apm step complete');
  });

  it('review_gate → review action listing reviewers', () => {
    const step: StepDef = { id: 'design_review', type: 'review_gate', reviewers: ['architecture', 'security'], next: ['x'] };
    const c = buildContract(step, [], ctxIds);
    expect(c.allowed_action).toMatch(/review/i);
    expect(c.when_done.join(' ')).toMatch(/apm step review WR-1 design_review --reviewer architecture/);
  });

  it('integration → manual stub action', () => {
    const step: StepDef = { id: 'pr_create', type: 'integration', action: 'github_create_pr', next: ['x'] };
    const c = buildContract(step, [], ctxIds);
    expect(c.allowed_action).toMatch(/manual|github_create_pr/i);
    expect(c.when_done[0]).toContain('apm step complete WR-1 pr_create');
  });

  it('caps do_not at 3 entries', () => {
    const step: StepDef = { id: 'design', type: 'agent_prompt', outputs: [{ artifact_type: 'design' }], next: ['x'] };
    const c = buildContract(step, [], ctxIds);
    expect(c.do_not.length).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/domain/contract.ts`

```ts
import type { StepDef } from './workflow.js';

export interface ContextRef { id: string; version: number; type: string; title: string; one_line: string; }
export interface NextAction { cmd: string; args: Record<string, unknown>; }
export interface Contract { allowed_action: string; do_not: string[]; when_done: string[]; next_actions: NextAction[]; }
interface Ids { workItem: string; run: string; session: string; }

export function buildContract(step: StepDef, requiredContext: ContextRef[], ids: Ids): Contract {
  const base = `apm step complete ${ids.run} ${step.id}`;
  switch (step.type) {
    case 'agent_prompt':
    case 'agent_execution': {
      const types = (step.outputs ?? []).map((o) => o.artifact_type);
      const primary = types[0];
      const action = step.type === 'agent_execution'
        ? `Execute the work for "${step.id}" and record ${types.join(', ') || 'a work_log'}.`
        : `Produce the ${types.join(', ') || step.id} artifact(s) for "${step.id}".`;
      const when_done = primary
        ? [`${base} --artifact-type ${primary} --body-file <path> --agent <agent>`]
        : [`${base} --agent <agent>`];
      const next_actions: NextAction[] = primary
        ? [{ cmd: 'apm step complete', args: { run: ids.run, step: step.id, artifact_type: primary, body_file: '<path>' } }]
        : [{ cmd: 'apm step complete', args: { run: ids.run, step: step.id } }];
      // extra outputs beyond the first must be created separately
      const extra = types.slice(1).map((t) => `apm artifact create --work-item ${ids.workItem} --type ${t} --title <t> --body-file <path> --agent <agent>`);
      return { allowed_action: action, do_not: doNotFor(step), when_done: [...extra, ...when_done], next_actions };
    }
    case 'review_gate': {
      const roles = step.reviewers ?? [];
      return {
        allowed_action: `Review "${step.id}" and submit a verdict for each role: ${roles.join(', ')}.`,
        do_not: ['advance the workflow manually'],
        when_done: roles.map((r) => `apm step review ${ids.run} ${step.id} --reviewer ${r} --verdict pass --agent <agent>`),
        next_actions: roles.map((r) => ({ cmd: 'apm step review', args: { run: ids.run, step: step.id, reviewer: r, verdict: 'pass' } })),
      };
    }
    case 'decision':
      return {
        allowed_action: `Record a decision for "${step.id}", then complete the step.`,
        do_not: doNotFor(step),
        when_done: [`apm decision create --work-item ${ids.workItem} --question <q> --options <csv> --recommendation <r> --confidence <n> --agent <agent>`, `${base} --agent <agent>`],
        next_actions: [{ cmd: 'apm step complete', args: { run: ids.run, step: step.id } }],
      };
    case 'integration':
    case 'integration_loop':
      return {
        allowed_action: `Manual integration step "${step.id}" (${step.action ?? 'external action'}): perform it, then complete.`,
        do_not: [],
        when_done: [`${base} --agent <agent>`],
        next_actions: [{ cmd: 'apm step complete', args: { run: ids.run, step: step.id } }],
      };
    default:
      return {
        allowed_action: `Complete step "${step.id}".`,
        do_not: [],
        when_done: [`${base} --agent <agent>`],
        next_actions: [{ cmd: 'apm step complete', args: { run: ids.run, step: step.id } }],
      };
  }
}

function doNotFor(step: StepDef): string[] {
  const dn: string[] = [];
  if (step.type === 'agent_prompt') { dn.push('write implementation code', 'open a PR'); }
  if (step.type === 'agent_execution') { dn.push('skip recording the work_log'); }
  return dn.slice(0, 3);
}
```

- [ ] **Step 4: Run, expect PASS (4).** **Step 5: Commit** `git add src/domain/contract.ts tests/domain/contract.test.ts && git commit -m "feat: add pure step contract builder"`

---

## Task 3: `next` usecase

**Files:** Create `src/usecases/next.ts`; Test `tests/usecases/next.test.ts`.

Assemble candidates from the DB, call `selectCandidate`, and for a dispatch build the full payload (using `buildContract` + `work.current`-style required-context). `--acquire` runs everything in ONE `immediate` txn: lazy-heal stale leases (excluding the caller's own), build candidates, select, then acquire the lease for the dispatched item (UNIQUE → `E_LEASE_CONFLICT`). Without `--acquire`, read in a `deferred` txn and set `meta`-level `stale` via the payload. `--session current` resolves/auto-starts via `session.resolveCurrent`.

Candidate assembly query (per work item with an active run): status='ready' (stored) OR has a live lease held by caller; gather depsAllComplete (all depends_on targets completed), the pending main step (repos.stepRuns.mainPending) — `hasPendingStep`, its required caps (step def requires.capabilities), `blockedByHumanGate` (open human_gate blocker), lease state (live lease + holder).

`nextExitCode(status, reason?)`: dispatched→0, drained→3, idle(awaiting_human)→20, idle(other)→10.

- [ ] **Step 1: Failing test** `tests/usecases/next.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as wf from '../../src/usecases/workflow.js';
import * as artifact from '../../src/usecases/artifact.js';
import * as next from '../../src/usecases/next.js';

let dir: string; let storage: SqliteStorage; const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-next-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('next usecase', () => {
  it('drained when no runs exist', () => {
    const r = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any' });
    expect(r.status).toBe('drained');
    expect(next.nextExitCode(r)).toBe(3);
  });

  it('dispatches the pending step with a resolved contract', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = wf.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    const r = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any' });
    expect(r.status).toBe('dispatched');
    expect(r.data.work_item).toBe(wi.id);
    expect(r.data.step.id).toBe('brainstorm');
    expect(r.data.when_done[0]).toContain(`apm step complete ${run.id} brainstorm`);
    expect(next.nextExitCode(r)).toBe(0);
  });

  it('--acquire takes a lease and a second acquire conflicts', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    wf.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    const r1 = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any', acquire: true, session: 'S-x' });
    expect(r1.status).toBe('dispatched'); expect(r1.data.lease).toBeTruthy();
    // a different agent acquiring the same item now conflicts (item is live-leased) -> idle all_leased
    const r2 = next.next(ctx(), { agent: 'other', capabilities: [], match: 'any', acquire: true });
    expect(r2.status).toBe('idle');
  });

  it('idle awaiting_human when the only run is human-gate blocked', () => {
    // build a tiny workflow with a human_gate first step
    wf.register(ctx(), { id: 'hg', version: 1, name: 'HG', applies_to: ['task'], status: 'active',
      steps: [{ id: 'gate', type: 'human_gate', next: ['done'] }, { id: 'done', type: 'terminal' }] } as any);
    const wi = work.create(ctx(), { type: 'task', title: 'G', agent: 'claude' });
    wf.attachRun(ctx(), { workItem: wi.id, workflow: 'hg', agent: 'claude' });
    const r = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any' });
    expect(r.status).toBe('idle');
    expect(r.reason).toBe('awaiting_human');
    expect(next.nextExitCode(r)).toBe(20);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/usecases/next.ts`. The implementer writes the assembly + payload following the established patterns. Contract:

```ts
import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { selectCandidate, type Candidate, type Caller } from '../domain/resolver.js';
import { buildContract, type ContextRef } from '../domain/contract.js';
import { parseWorkflow, stepById } from '../domain/workflow.js';
import { resolveCurrent } from './session.js';
import { acquire } from './lease.js';

export interface NextArgs { agent: string; capabilities: string[]; match: 'any' | 'all'; acquire?: boolean; session?: string; ttl?: string; }
export type NextResult =
  | { status: 'dispatched'; data: any; session?: string }
  | { status: 'idle'; reason: string; data: { status: 'idle'; reason: string; retry_after: number }; session?: string }
  | { status: 'drained'; data: { status: 'drained' }; session?: string };

export function nextExitCode(r: NextResult): number {
  if (r.status === 'dispatched') return 0;
  if (r.status === 'drained') return 3;
  return r.reason === 'awaiting_human' ? 20 : 10;
}

// Implementer: assemble candidates (one per work item with an active run), call selectCandidate,
// and for 'dispatched' build the payload: resolve the pending step def, required_context (current
// artifacts for step.requires.artifacts), buildContract(...), and (if acquire) lease.acquire in the
// SAME flow. Use 'immediate' txn when acquire, else 'deferred'. resolveCurrent for --session current.
export function next(ctx: Ctx, args: NextArgs): NextResult { /* ... */ throw new Error('implement'); }
```

Key assembly notes for the implementer:
- Candidate query: `SELECT wi.* FROM work_items wi JOIN workflow_runs r ON r.work_item_id=wi.id AND r.status='running'`. For each, compute: `depsAllComplete` (no depends_on target with status not in completed), `mainPending = repos.stepRuns.mainPending(run)` → `hasPendingStep`, `requiredCaps` from the step def's `requires.capabilities`, `blockedByHumanGate` (open blocker type human_gate), lease state (live active lease + holder agent).
- For `dispatched`: load the run's def (parse definition_json), `stepById(def, mainPending.step_id)`, required_context = for each `step.requires.artifacts` type → current artifact `{id, version, type, title, one_line: title}`. `buildContract(step, ctxRefs, {workItem, run, session})`. Compose data per spec §7.6 (status:'dispatched', work_item, run, step:{id,type}, allowed_action, required_context, do_not, when_done, next_actions, lease). If `acquire`, set `data.lease = { id, expires_at }` from the acquired lease; else `data.lease = null` and `data.stale = true`.
- `--acquire` must do the candidate selection AND the lease acquire in ONE immediate transaction so the dispatch is atomic; if `lease.acquire` raises E_LEASE_CONFLICT (lost race), return idle/all_leased (retryable).

- [ ] **Step 4: Run, expect PASS (4).** **Step 5: Commit** `git add src/usecases/next.ts tests/usecases/next.test.ts && git commit -m "feat: add apm next resolver usecase with --acquire"`

---

## Task 4: Agent-format projection for `next`

**Files:** Modify `src/format/render.ts`; Test add to `tests/format/render.test.ts`.

Extend `render('agent', envelope)`: when the envelope's `data` looks like a `next` dispatched payload (has `work_item` + `step` + `when_done`), render the plaintext contract instead of the json fallback. For idle/drained data, render a single terse line (`status=idle reason=… retry_after=…` / `status=drained`). Other commands keep the json fallback. No volatile fields (timestamps) in the agent body.

- [ ] **Step 1: Failing test** (append to render.test.ts)

```ts
it('agent projects a next dispatched payload to the plaintext contract', () => {
  const data = { status: 'dispatched', work_item: 'WI-1', run: 'WR-1', step: { id: 'design', type: 'agent_prompt' },
    allowed_action: 'Produce the design artifact.', required_context: [{ id: 'ART-1', version: 2, type: 'spec', title: 'Spec', one_line: 'sync model' }],
    do_not: ['write implementation code'], when_done: ['apm step complete WR-1 design --artifact-type design --body-file <path> --agent <agent>'],
    next_actions: [{ cmd: 'apm step complete', args: {} }], lease: null };
  const s = render('agent', ok(data, buildMeta('next', clock, 'S-1')));
  expect(s).toMatch(/WORK_ITEM:\s*\n?WI-1/);
  expect(s).toMatch(/CURRENT_STEP:\s*\n?design/);
  expect(s).toMatch(/ALLOWED_ACTION:/);
  expect(s).toMatch(/ART-1@2/);
  expect(s).toMatch(/DO_NOT:/);
  expect(s).toMatch(/WHEN_DONE:/);
  expect(s).toMatch(/apm step complete WR-1 design/);
  expect(s).not.toContain('next_actions'); // json-only
  expect(s).not.toContain('2026-06-02'); // no volatile timestamps in the agent body
});

it('agent renders a terse idle line', () => {
  const s = render('agent', ok({ status: 'idle', reason: 'all_leased', retry_after: 30 }, buildMeta('next', clock)));
  expect(s.trim()).toMatch(/^status=idle reason=all_leased/);
  expect(s).not.toMatch(/WORK_ITEM/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — in `render.ts`, add a `renderAgent(envelope)` branch used when `format==='agent'`:
  - if `data.status === 'idle'` → `status=idle reason=<reason> retry_after=<n>`
  - if `data.status === 'drained'` → `status=drained`
  - if `data.work_item && data.step` (dispatched) → build the contract block:
    ```
    WORK_ITEM:
    <work_item>

    CURRENT_STEP:
    <step.id> (<step.type>)

    ALLOWED_ACTION:
    <allowed_action>

    REQUIRED_CONTEXT:
    <for each ctx: "<id>@<version> \"<title>\" — <one_line>">   (omit section if empty)

    DO_NOT:
    - <each>                                                     (omit section if empty)

    WHEN_DONE:
    <each when_done line>
    ```
  - otherwise (non-next command) → existing json-fallback-with-note.
  Keep `next_actions` and all timestamps OUT of the agent text.

- [ ] **Step 4: Run, expect PASS.** **Step 5: Commit** `git add src/format/render.ts tests/format/render.test.ts && git commit -m "feat: project next payload to agent plaintext contract"`

---

## Task 5: `apm status` + CLI wiring

**Files:** Create `src/usecases/status.ts`; Modify `src/cli/program.ts`; Test `tests/usecases/status.test.ts` + add to `tests/cli/commands.test.ts`.

`status(ctx)` returns `{ work: { by_status: {...counts} }, ready_count, active_leases: LeaseView[], open_blockers: BlockerView[], awaiting_human: [{id, reason}], active_runs: RunView[] }`. CLI: wire `apm next` (options `--agent --session --capabilities <csv> --match --acquire --ttl -o/--format`) setting `process.exitCode = nextExitCode(result)` and rendering the payload envelope; wire `apm status`.

- [ ] **Step 1: Failing tests** — status usecase counts + a CLI test that `apm next --format agent` prints the contract and that `apm status` returns counts. (Write concrete tests mirroring earlier CLI tests; assert `next` dispatched exit 0 and drained exit 3.)

- [ ] **Step 2–4: Implement, run, commit** `feat: add apm status; wire next and status CLI`.

Implementer notes: `next` CLI action splits `--capabilities` on comma; resolves `--session current` (the literal string 'current') via the usecase; maps the result to the envelope `data` and sets the exit code. The agent format on `next` now projects the contract (Task 4).

---

## Task 6: Full loop + concurrency integration, build gate, docs

**Files:** Create `tests/integration/plan4-loop.test.ts`; Modify `CLAUDE.md`.

- [ ] **Step 1: Autonomous-loop test** — drive `feature_delivery` to completion using ONLY `apm next` + the dispatched contract's actions (simulating an agent loop): repeatedly call `next({acquire:true})`, perform the dispatched step (create the named artifact(s) then `step.complete`, or `step.review` for the gate), heartbeat/release leases, until `next` returns `drained`. Assert the work item ends `completed` and the loop terminates (drained) within a bounded number of iterations.

```ts
// sketch
let guard = 0;
for (;;) {
  if (++guard > 50) throw new Error('loop did not drain');
  const r = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any', acquire: true, session: 'S-1' });
  if (r.status === 'drained') break;
  if (r.status === 'idle') { /* perform review/gate based on reason, or fail the test */ ... }
  // dispatched: act on r.data.step — create required output artifacts then step.complete,
  // or for review_gate submit pass verdicts for each reviewer.
}
expect(work.show(ctx(), wi.id).status).toBe('completed');
```

- [ ] **Step 2: Concurrency test** — two `SqliteStorage` handles on the same db file; attach a run; call `next({acquire:true})` from agent A and agent B "concurrently" (sequentially in-process is sufficient to prove the partial-unique guard): exactly one gets `dispatched` with a lease, the other gets `idle/all_leased` (or `E_LEASE_CONFLICT` mapped to idle). Assert only one active lease exists on the item.

- [ ] **Step 3: Build gate** — `npm test` (all green), `npm run typecheck`, `npm run build`, and a real binary smoke: `node dist/bin/apm.js --dir <tmp> next --agent claude --format agent` after seeding a work item + run (or just assert it runs and prints `status=drained` on an empty project).

- [ ] **Step 4: Update CLAUDE.md** — add `apm next` (with the loop description + exit codes) and `apm status` to the Commands section; flip the Project State line to "V1 complete".

- [ ] **Step 5: Commit** `test: full next loop + concurrency; docs: next/status + V1 complete`.

---

## Self-Review

**Spec coverage:** pure resolver with idle/drained/dispatched + reasons + ranking (§6) → Task 1. contract builder allowed_action/do_not/when_done/next_actions per step (§7.6,§7.7) → Task 2. next usecase + --acquire atomic dispatch+lease + --session current + exit codes (§6,§7.3) → Task 3. agent-format projection, token-lean, no volatile fields, next_actions json-only (§7.6,§7.7) → Task 4. apm status + CLI wiring (§7.5,§8) → Task 5. autonomous loop + concurrency e2e (§1 success criterion, §6) → Task 6.

**Placeholder note:** Task 3's `next()` body and Task 5 are specified by contract + assembly notes + concrete tests; the implementer writes the assembly following established repo/usecase patterns. The pure, novel logic (resolver, contract builder, agent projection) is fully coded with tests. Task 6's loop test sketch is completed by the implementer into a real passing test.

**Type consistency:** `Candidate`/`Caller`/`Resolution` (resolver.ts), `Contract`/`ContextRef`/`NextAction` (contract.ts), `NextArgs`/`NextResult`/`nextExitCode` (next.ts) used consistently; reuses `Ctx`, `repos`, `parseWorkflow`/`stepById`, `resolveCurrent`, `lease.acquire`, the envelope/render layer, and the RunView/Lease/Blocker views from Plans 2–3.
