# APM V1 — Plan 3: Workflow Engine

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** The durable workflow engine: DSL loader/validator, built-in `feature_delivery` + default policy seeding, workflow definitions/runs, the advance state-machine enforcing the run invariant, all step-type handlers, artifacts (versioned/immutable), decisions/ADRs, blockers/human-gates, and policy evaluation — plus populating `WorkItemView.blocker_ids/artifact_ids/active_run` and adding `work current`/`work blockers`.

**Architecture:** Adds `domain/workflow.ts` (DSL types + validator + pure advance logic), `workflows/feature_delivery.ts` (built-in), `storage/repos.ts` extensions (runs, step_runs, artifacts, decisions, blockers, policies, definitions), and usecases `workflow/run/step/artifact/decision/adr/blocker/gate/policy/prompt`. The **run invariant** is enforced centrally in one `advance` module.

**Tech Stack:** Same. Builds on merged Plans 1–2 (Storage/Tx, repos, entities, errors, runCommand, work/session/lease usecases).

**The run invariant (enforced by every transition):** every active workflow run is (a) terminal, OR (b) has exactly one dispatchable pending step on the main path (`parent_step_run_id IS NULL`), OR (c) has an open blocker on its work item. A `review_gate` main-path step may additionally have N pending reviewer child step_runs.

**Deferred to Plan 4:** `apm next` resolver, agent-format projection, `apm status`, full e2e loop + concurrency tests.

---

## File Structure
- `src/domain/workflow.ts` — `WorkflowDef`/`StepDef` types, `parseWorkflow(yaml)`, `validateWorkflow(def)` (linear `next`, known step types, reviewers for review_gate), `firstStep(def)`, `nextStepId(def, stepId)`, `stepById(def, id)`.
- `src/workflows/feature_delivery.ts` — the built-in definition (as a JS object) + `DEFAULT_POLICY`.
- `src/usecases/seed.ts` — `seedBuiltins(ctx)` inserting the built-in workflow def + default policy (idempotent); called by `apm init`.
- `src/storage/repos.ts` — extend with `defs`, `runs`, `stepRuns`, `artifacts`, `decisions`, `blockers`, `policies`, `prompts` helpers.
- `src/domain/advance.ts` — `enterStep(tx, run, stepDef)` (creates the pending main step + side-effects: review children, human_gate blocker, decision check), `completeStep`/`failStep`/`retryStep` core preserving the invariant.
- `src/usecases/{workflow,run,step,artifact,decision,adr,blocker,gate,policy,prompt}.ts`.
- `src/usecases/work.ts` — extend `view()` to populate blocker_ids/artifact_ids/active_run; add `current`/`blockers`.
- `src/usecases/init.ts` — call `seedBuiltins`.
- `src/cli/program.ts` — wire the new groups.
- Tests mirror each.

---

## Task 1: Workflow DSL types, parser & validator

**Files:** Create `src/domain/workflow.ts`; Test `tests/domain/workflow.test.ts`.

- [ ] **Step 1: Failing test** `tests/domain/workflow.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseWorkflow, validateWorkflow, firstStep, nextStepId, stepById } from '../../src/domain/workflow.js';

const YAML = `
id: demo
version: 1
name: Demo
applies_to: [feature, task]
status: active
steps:
  - id: brainstorm
    type: agent_prompt
    outputs: [{ artifact_type: spec }]
    next: [design]
  - id: design
    type: agent_prompt
    requires: { artifacts: [spec] }
    outputs: [{ artifact_type: design }]
    next: [complete]
  - id: complete
    type: terminal
`;

describe('workflow dsl', () => {
  it('parses a definition', () => {
    const def = parseWorkflow(YAML);
    expect(def.id).toBe('demo'); expect(def.steps).toHaveLength(3);
    expect(def.steps[0].outputs?.[0].artifact_type).toBe('spec');
  });

  it('validates a good definition', () => {
    expect(() => validateWorkflow(parseWorkflow(YAML))).not.toThrow();
  });

  it('rejects a branching next (V1 is linear)', () => {
    const bad = parseWorkflow(YAML.replace('next: [design]', 'next: [design, complete]'));
    expect(() => validateWorkflow(bad)).toThrowError(/linear|single|branch/i);
  });

  it('rejects an unknown step type', () => {
    const bad = parseWorkflow(YAML.replace('type: terminal', 'type: bogus'));
    expect(() => validateWorkflow(bad)).toThrowError(/step type/i);
  });

  it('rejects a next pointing at a missing step', () => {
    const bad = parseWorkflow(YAML.replace('next: [complete]', 'next: [nope]'));
    expect(() => validateWorkflow(bad)).toThrowError(/unknown step|nope/i);
  });

  it('requires reviewers on a review_gate', () => {
    const rg = parseWorkflow(`
id: d
version: 1
name: D
applies_to: [feature]
status: active
steps:
  - id: r
    type: review_gate
    next: [done]
  - id: done
    type: terminal
`);
    expect(() => validateWorkflow(rg)).toThrowError(/reviewer/i);
  });

  it('navigates first/next/by-id', () => {
    const def = parseWorkflow(YAML);
    expect(firstStep(def).id).toBe('brainstorm');
    expect(nextStepId(def, 'brainstorm')).toBe('design');
    expect(nextStepId(def, 'complete')).toBeNull();
    expect(stepById(def, 'design')?.type).toBe('agent_prompt');
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/domain/workflow.ts`

```ts
import { parse as parseYaml } from 'yaml';
import { ApmError } from './errors.js';
import { STEP_TYPES, type StepType, type ArtifactType, type WorkItemType } from './types.js';

export interface StepOutput { artifact_type: ArtifactType; }
export interface StepDef {
  id: string; type: StepType;
  prompt_id?: string;
  requires?: { artifacts?: ArtifactType[]; capabilities?: string[] };
  outputs?: StepOutput[];
  reviewers?: string[];
  pass_policy?: 'all_required';
  action?: string;
  may_create_work_items?: boolean;
  next?: string[];
}
export interface WorkflowDef {
  id: string; version: number; name: string;
  applies_to: WorkItemType[]; status: string;
  session_policy?: unknown;
  steps: StepDef[];
}

export function parseWorkflow(yaml: string): WorkflowDef {
  const raw = parseYaml(yaml);
  return raw as WorkflowDef;
}

export function validateWorkflow(def: WorkflowDef): void {
  if (!def.id || !def.steps?.length) throw new ApmError('E_VALIDATION', 'workflow needs id and steps');
  const ids = new Set(def.steps.map((s) => s.id));
  for (const s of def.steps) {
    if (!STEP_TYPES.includes(s.type)) throw new ApmError('E_VALIDATION', `unknown step type: ${s.type}`);
    if (s.next && s.next.length > 1) throw new ApmError('E_VALIDATION', `step ${s.id}: V1 is linear (single next target)`);
    for (const n of s.next ?? []) if (!ids.has(n)) throw new ApmError('E_VALIDATION', `step ${s.id}: next points at unknown step ${n}`);
    if (s.type === 'review_gate' && !(s.reviewers?.length)) throw new ApmError('E_VALIDATION', `review_gate ${s.id} needs reviewers`);
    if (s.type !== 'terminal' && !(s.next?.length)) throw new ApmError('E_VALIDATION', `non-terminal step ${s.id} needs a next`);
  }
}

export function firstStep(def: WorkflowDef): StepDef { return def.steps[0]; }
export function stepById(def: WorkflowDef, id: string): StepDef | undefined { return def.steps.find((s) => s.id === id); }
export function nextStepId(def: WorkflowDef, id: string): string | null {
  const s = stepById(def, id); return s?.next?.[0] ?? null;
}
```

- [ ] **Step 4: Run, expect PASS (7).** **Step 5: Commit** `git add src/domain/workflow.ts tests/domain/workflow.test.ts && git commit -m "feat: add workflow DSL parser and validator"`

---

## Task 2: Built-in workflow + default policy + seeding

**Files:** Create `src/workflows/feature_delivery.ts`, `src/usecases/seed.ts`; modify `src/usecases/init.ts`; Test `tests/usecases/seed.test.ts`.

`feature_delivery` mirrors the DSL spec. Integration steps are present but executed as manual stubs by the engine (Task 5). The default policy is a global policy row.

- [ ] **Step 1: Failing test** `tests/usecases/seed.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';

let dir: string; const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-seed-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('seeding', () => {
  it('init seeds the built-in feature_delivery workflow and a default policy', () => {
    initProject(dir, clock);
    const s = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
    const def = s.transaction('deferred', (tx) => tx.get<any>("SELECT * FROM workflow_definitions WHERE name='feature_delivery'"));
    expect(def).toBeTruthy(); expect(def.version).toBe(1); expect(def.status).toBe('active');
    const pol = s.transaction('deferred', (tx) => tx.get<any>("SELECT * FROM policies WHERE scope_type='global'"));
    expect(pol).toBeTruthy();
    s.close();
  });

  it('is idempotent — re-init does not duplicate the workflow', () => {
    initProject(dir, clock);
    initProject(dir, clock);
    const s = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
    const count = s.transaction('deferred', (tx) => tx.get<{ c: number }>("SELECT count(*) c FROM workflow_definitions WHERE name='feature_delivery'")!.c);
    expect(count).toBe(1);
    s.close();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/workflows/feature_delivery.ts`

```ts
import type { WorkflowDef } from '../domain/workflow.js';

export const FEATURE_DELIVERY: WorkflowDef = {
  id: 'feature_delivery', version: 1, name: 'Feature Delivery Workflow',
  applies_to: ['feature', 'task'], status: 'active',
  steps: [
    { id: 'brainstorm', type: 'agent_prompt', prompt_id: 'brainstorm_feature_v1', outputs: [{ artifact_type: 'decision' }, { artifact_type: 'spec' }], next: ['design'] },
    { id: 'design', type: 'agent_prompt', prompt_id: 'design_solution_v1', requires: { artifacts: ['spec'] }, outputs: [{ artifact_type: 'design' }], next: ['design_review'] },
    { id: 'design_review', type: 'review_gate', reviewers: ['architecture', 'security', 'simplicity'], pass_policy: 'all_required', next: ['planning'] },
    { id: 'planning', type: 'agent_prompt', prompt_id: 'implementation_plan_v1', requires: { artifacts: ['design'] }, outputs: [{ artifact_type: 'plan' }], may_create_work_items: true, next: ['implementation'] },
    { id: 'implementation', type: 'agent_execution', requires: { artifacts: ['plan'] }, outputs: [{ artifact_type: 'work_log' }], next: ['pr_create'] },
    { id: 'pr_create', type: 'integration', action: 'github_create_pr', next: ['pr_monitor'] },
    { id: 'pr_monitor', type: 'integration_loop', action: 'github_monitor_pr', next: ['merge'] },
    { id: 'merge', type: 'integration', action: 'github_merge_pr', next: ['complete'] },
    { id: 'complete', type: 'terminal' },
  ],
};

export const DEFAULT_POLICY = {
  auto_accept_recommendations: { enabled: true, confidence_threshold: 90 },
  auto_create_work_items: true,
  adr_policy: { auto_create: true, categories: ['architecture', 'storage', 'platform', 'workflow'], confidence_threshold: 85 },
  max_work_item_depth: 5,
};
```

- [ ] **Step 4: Implement** `src/usecases/seed.ts`

```ts
import type { Storage } from '../storage/storage.js';
import { validateWorkflow } from '../domain/workflow.js';
import { FEATURE_DELIVERY, DEFAULT_POLICY } from '../workflows/feature_delivery.js';

/** Seed built-in workflow + default global policy. Idempotent. Runs inside its own immediate txn. */
export function seedBuiltins(storage: Storage): void {
  validateWorkflow(FEATURE_DELIVERY);
  storage.transaction('immediate', (tx) => {
    const exists = tx.get("SELECT id FROM workflow_definitions WHERE name=? AND version=?", FEATURE_DELIVERY.id, FEATURE_DELIVERY.version);
    if (!exists) {
      const id = tx.allocateId('WD');
      tx.run("INSERT INTO workflow_definitions (id, name, version, definition_json, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)",
        id, FEATURE_DELIVERY.id, FEATURE_DELIVERY.version, JSON.stringify(FEATURE_DELIVERY), tx.now());
      tx.appendEvent({ eventType: 'workflow.registered', entityType: 'workflow_definition', entityId: id, payload: { name: FEATURE_DELIVERY.id } });
    }
    const pol = tx.get("SELECT id FROM policies WHERE scope_type='global'");
    if (!pol) {
      const id = tx.allocateId('POL');
      tx.run("INSERT INTO policies (id, scope_type, scope_id, policy_json, created_at) VALUES (?, 'global', NULL, ?, ?)", id, JSON.stringify(DEFAULT_POLICY), tx.now());
    }
  });
}
```

- [ ] **Step 5: Modify** `src/usecases/init.ts` — after opening storage and before closing, call `seedBuiltins(storage)`. Import it. (The factory-created storage is the same `Storage` instance.)

- [ ] **Step 6: Run, expect PASS (2)** + full `npm test` still green. **Step 7: Commit** `git add src/workflows/feature_delivery.ts src/usecases/seed.ts src/usecases/init.ts tests/usecases/seed.test.ts && git commit -m "feat: seed built-in feature_delivery workflow and default policy on init"`

---

## Task 3: Repository extensions

**Files:** Modify `src/storage/repos.ts`; Test add to `tests/storage/repos.test.ts`.

Add helpers (the implementer writes the bodies following the Task-5/Plan-2 pattern; each mutating helper appends an event):
- `defs`: `byNameVersion(name, version)`, `byId(id)`, `active(name)` (latest active), `register(def)` (insert immutable row, returns id), `list()`.
- `runs`: `insert(workItemId, defId)`, `byId(id)`, `activeForWorkItem(workItemId)`, `setCurrentStep(runId, stepId)`, `setStatus(runId, status, completedAt?)`, `listForWorkItem(workItemId)`.
- `stepRuns`: `insertPending(runId, stepId, parent?, role?, round?)`, `byId(id)`, `mainPending(runId)` (the one pending/running main-path step), `reviewerChildren(parentId)`, `setStatus(id, status, fields?)`, `complete(id, verdict?, artifactId?)`, `fail(id, reason)`.
- `artifacts`: `insert({type,title,body,createdBy,rootId?,supersedes?,version})` (root defaults to own id on v1), `byId(id)`, `currentByRoot(rootId)`, `linkToWorkItem(workItemId, rootId, relation)`, `linkedRoots(workItemId)`, `currentByTypeForWorkItem(workItemId, type)`, `setStatus(id, status)`.
- `decisions`: `insert(...)`, `byId(id)`, `setDecided(id, choice, artifactId?)`, `setStatus(id,status)`.
- `blockers`: `insert({workItemId, type, reason, question?, optionsJson?})`, `byId(id)`, `openForWorkItem(workItemId)`, `resolve(id, {resolution?, answer?, choice?, answeredBy?})`, `listOpen(filter)`.
- `policies`: `global()`, `forWorkItem(workItemId)`.
- `prompts`: `insert(name, body)`, `byName(name)`, `list()`.

- [ ] **Step 1: Failing test** — add focused tests proving the non-trivial ones:

```ts
// append to tests/storage/repos.test.ts
import { /* existing */ } from '../../src/storage/repos.js';

describe('repos extensions', () => {
  it('artifacts: insert v1 sets root to own id; currentByRoot returns latest version', () => {
    const s = mem();
    const ids = s.transaction('immediate', (tx) => {
      const r = repos(tx); r.agents.ensure('claude');
      const v1 = r.artifacts.insert({ type: 'spec', title: 'Spec', body: 'a', createdBy: 'claude', version: 1 });
      const v2 = r.artifacts.insert({ type: 'spec', title: 'Spec', body: 'b', createdBy: 'claude', version: 2, rootId: v1, supersedes: v1 });
      return { v1, v2 };
    });
    const cur = s.transaction('deferred', (tx) => repos(tx).artifacts.currentByRoot(ids.v1));
    expect(cur.id).toBe(ids.v2); expect(cur.version).toBe(2);
    s.close();
  });

  it('runs: one active run per work item enforced', () => {
    const s = mem();
    expect(() => s.transaction('immediate', (tx) => {
      const r = repos(tx); r.agents.ensure('claude');
      const wi = r.workItems.insert({ type: 'feature', title: 'A', description: null, priority: 0, estimate: null, parentId: null, createdBy: 'claude' });
      const def = tx.allocateId('WD'); tx.run("INSERT INTO workflow_definitions (id,name,version,definition_json,status,created_at) VALUES (?, 'x', 1, '{}', 'active', ?)", def, tx.now());
      r.runs.insert(wi, def); r.runs.insert(wi, def); // second active run -> UNIQUE violation
    })).toThrowError(/UNIQUE/i);
    s.close();
  });

  it('stepRuns: mainPending returns the single pending main-path step', () => {
    const s = mem();
    const got = s.transaction('immediate', (tx) => {
      const r = repos(tx); r.agents.ensure('claude');
      const wi = r.workItems.insert({ type: 'feature', title: 'A', description: null, priority: 0, estimate: null, parentId: null, createdBy: 'claude' });
      const def = tx.allocateId('WD'); tx.run("INSERT INTO workflow_definitions (id,name,version,definition_json,status,created_at) VALUES (?, 'x', 1, '{}', 'active', ?)", def, tx.now());
      const run = r.runs.insert(wi, def);
      r.stepRuns.insertPending(run, 'brainstorm');
      return r.stepRuns.mainPending(run);
    });
    expect(got.step_id).toBe('brainstorm');
    s.close();
  });
});
```

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement** the repo extensions in `src/storage/repos.ts`. Key SQL notes for the implementer:
  - `runs.insert`: `INSERT INTO workflow_runs (id, work_item_id, workflow_definition_id, status, started_at) VALUES (?,?,?, 'running', now)`; the partial-unique `ux_wr_active` enforces one active run → catch UNIQUE only where the usecase wants (the repo can let it throw; `attach` usecase translates to E_PRECONDITION).
  - `stepRuns.insertPending`: `INSERT ... (id, workflow_run_id, step_id, parent_step_run_id, role, status, review_round, created_at) VALUES (?,?,?,?,?, 'pending', ?, now)`.
  - `stepRuns.mainPending`: `SELECT * FROM workflow_step_runs WHERE workflow_run_id=? AND parent_step_run_id IS NULL AND status IN ('pending','running') LIMIT 1`.
  - `stepRuns.complete`: set status='completed', completed_at, verdict?, output_artifact_id?.
  - `artifacts.insert`: allocate ART id; if no rootId, set root = own id (UPDATE after insert or compute id first then insert with root=id). version required.
  - `artifacts.currentByRoot`: `SELECT * FROM artifacts WHERE root_artifact_id=? ORDER BY version DESC LIMIT 1`.
  - `artifacts.currentByTypeForWorkItem`: join work_item_artifacts (by root) → artifacts current version WHERE type=?.

- [ ] **Step 4: Run, expect PASS.** **Step 5: Commit** `git add src/storage/repos.ts tests/storage/repos.test.ts && git commit -m "feat: extend repos with runs/step_runs/artifacts/decisions/blockers/policies/prompts"`

---

## Task 4: Artifacts usecases

**Files:** Create `src/usecases/artifact.ts`; Test `tests/usecases/artifact.test.ts`.

`create({workItem, type, title, body, agent})` → v1 artifact (status draft), link to work item by root, return an `ArtifactView`. `revise(id, body, agent)` → new version superseding, repoint nothing (links are by root), old → superseded, in one immediate txn. `show(id)`, `list({workItem})`, `submit/approve/archive(id)` set status (draft→review→approved; →archived). Add `ArtifactView` + mapper to `entities.ts`.

- [ ] Tests (representative):

```ts
// tests/usecases/artifact.test.ts — setup like other usecase tests (initProject + SqliteStorage + ctx())
it('creates a v1 artifact linked to a work item', () => {
  const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
  const a = artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'Spec', body: 'hello', agent: 'claude' });
  expect(a).toMatchObject({ id: 'ART-1', type: 'spec', version: 1, status: 'draft' });
  expect(work.show(ctx(), wi.id).artifact_ids).toEqual(['ART-1']);
});
it('revise creates v2 superseding v1; current resolves to v2; link unchanged', () => {
  const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
  const a = artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'Spec', body: 'v1', agent: 'claude' });
  const b = artifact.revise(ctx(), a.id, 'v2', 'claude');
  expect(b.version).toBe(2);
  expect(artifact.show(ctx(), a.id).status).toBe('superseded');
  expect(work.show(ctx(), wi.id).artifact_ids).toEqual([b.id]); // view shows current version per root
});
it('approve transitions draft->review->approved', () => {
  const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
  const a = artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'S', body: 'x', agent: 'claude' });
  artifact.submit(ctx(), a.id); expect(artifact.show(ctx(), a.id).status).toBe('review');
  artifact.approve(ctx(), a.id); expect(artifact.show(ctx(), a.id).status).toBe('approved');
});
```

NOTE for `work.view()`: `artifact_ids` should list the CURRENT version id per linked root (so after revise it shows v2). Implementer updates `view()` in work.ts: `artifactIds = r.artifacts.linkedRoots(id).map(root => r.artifacts.currentByRoot(root).id)`.

- [ ] Implement `src/usecases/artifact.ts` + `ArtifactView`/`toArtifactView` in entities.ts. Commit `feat: add artifact create/revise/show/list/status usecases`.

---

## Task 5: The advance engine & step-type entry

**Files:** Create `src/domain/advance.ts`; Test `tests/domain/advance.test.ts` (engine-level, using a real `:memory:` storage + repos).

This is the heart. `enterStep(tx, runId, def, stepDef, actor)` creates the pending main step_run and performs entry side-effects per type:
- `agent_prompt`/`agent_execution`/`manual`/`integration`/`integration_loop`/`decompose`: just create the pending main step_run (the agent acts, then calls `step complete`). For integration steps, the allowed-action text (Plan 4) says "manual: do X then complete".
- `review_gate`: create the pending main step_run, then seed one pending reviewer child step_run per `reviewers[]` role.
- `human_gate`: create the main step_run (status 'running'), then create an open `human_gate` blocker (question/options from step or defaults) → work item blocked.
- `decision`: create the main step_run; decision resolution handled at `complete` time (Task 7).
- `terminal`: do not create a step_run; complete the run + work item (subject to child guard).

`completeMainStep(tx, run, def, stepRun, {artifactId?}, actor)`:
1. Verify required output artifacts present (for agent_prompt/agent_execution: every `outputs[].artifact_type` must have a current artifact linked to the work item) → else `E_PRECONDITION`.
2. Mark the step_run completed (idempotent if already completed).
3. Compute `nextStepId`; if null or next is terminal → complete run + work item (child/run guard); else `enterStep` the next step (eager pending creation), set `run.current_step_id`.

The invariant is preserved: after completing, the run is terminal OR has exactly one new pending main step OR (for human_gate/review entry) has an open blocker / reviewer children.

- [ ] **Step 1: Failing test** `tests/domain/advance.test.ts` — drive a small linear workflow through the engine. Build a tiny def (brainstorm→design→complete), attach, then complete steps, asserting the invariant.

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import { repos } from '../../src/storage/repos.js';
import { attachRun } from '../../src/usecases/workflow.js';
import * as step from '../../src/usecases/step.js';
import * as artifact from '../../src/usecases/artifact.js';
import * as work from '../../src/usecases/work.js';

// helper registers a tiny linear workflow and attaches it
// (use the built-in feature_delivery for the real path; here assert the invariant on agent_prompt steps)
let dir: string; let storage: SqliteStorage; const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-adv-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('advance engine', () => {
  it('attaching feature_delivery creates a run with brainstorm pending', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    expect(run.current_step).toBe('brainstorm');
    expect(work.show(ctx(), wi.id).active_run).toBe(run.id);
  });

  it('completing brainstorm (with required outputs) advances to design', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    // brainstorm outputs decision + spec
    artifact.create(ctx(), { workItem: wi.id, type: 'decision', title: 'D', body: 'x', agent: 'claude' });
    artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'S', body: 'x', agent: 'claude' });
    const r = step.complete(ctx(), { run: run.id, step: 'brainstorm', agent: 'claude' });
    expect(r.current_step).toBe('design');
  });

  it('blocks completing brainstorm when a required output is missing', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    artifact.create(ctx(), { workItem: wi.id, type: 'decision', title: 'D', body: 'x', agent: 'claude' });
    // missing spec
    expect(() => step.complete(ctx(), { run: run.id, step: 'brainstorm', agent: 'claude' })).toThrowError(/spec|required/i);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement** `src/domain/advance.ts` (pure-ish: takes `tx` + repos) and the `attachRun`/`step.complete` usecases (Tasks 6–7 wire these; for this test they must exist). The implementer may implement `attachRun` (Task 6) and `step.complete` (Task 7) minimally here to make the engine test pass, then flesh out in those tasks. Keep the invariant central in `advance.ts`.

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** `git add src/domain/advance.ts tests/domain/advance.test.ts && git commit -m "feat: add advance engine enforcing the run invariant"`

---

## Task 6: Workflow + run usecases

**Files:** Create `src/usecases/workflow.ts`; Test `tests/usecases/workflow.test.ts`.

- `list()` → registered definitions (RunView/DefView). `show(nameOrId)`. `register(yamlOrObj)` → validate + insert immutable (reject duplicate name+version with E_CONFLICT). `attachRun({workItem, workflow, agent})` → resolve the active def by name; reject if work item already has an active run (E_PRECONDITION via UNIQUE catch); insert run; `enterStep(firstStep)`; set current_step; return `RunView`. `runsForWorkItem(workItem)`. `cancelRun(runId)` → status cancelled (+ cancel its non-terminal step_runs).
- Add `RunView` ({id, work_item, workflow, status, current_step, started_at, completed_at}) + mapper.

- [ ] Tests: attach creates a run with first step pending (covered in Task 5 too); attaching a second run → E_PRECONDITION; `register` rejects duplicate; `cancelRun` sets cancelled. Implement + commit `feat: add workflow register/list/show/attach/runs/cancel usecases`.

---

## Task 7: Step usecases (complete/fail/retry/review) + decision/gate handlers

**Files:** Create `src/usecases/step.ts`, `src/usecases/decision.ts`, `src/usecases/blocker.ts`, `src/usecases/gate.ts`, `src/usecases/adr.ts`; Tests for each.

- `step.complete({run, step, agent, artifactId?, artifactType?, bodyFile?})`: if `artifactType`+body provided, create the artifact first (atomic), then run `completeMainStep`. CAS: the named step must be the current pending main step (else `E_CONFLICT`). Idempotent replay if already completed. Returns `RunView`.
- `step.fail({run, step, reason, agent})`: mark step_run failed; set work item blocked + create a blocker (`blocker_type='step_failure'`). Returns RunView.
- `step.retry({run, step, agent})`: precondition an open step-failure blocker exists; resolve it; create a fresh pending main step_run for the same step_id (new attempt). Returns RunView.
- `step.review({run, step, reviewer, verdict, artifactId?, agent})`: set the matching reviewer child step_run completed with the verdict. If all required reviewers `pass` → complete the review_gate main step → advance. If any `reject` → block work item with a review-disagreement blocker; on `gate`/`blocker resolve`, spawn a fresh reviewer child (new round) for that role.
- `decision.create/accept/reject`: create a Decision; `accept(choice)` sets decided. When invoked as a workflow `decision` step's completion, evaluate policy: if confidence ≥ effective threshold auto-accept + auto-create ADR (category ∈ adr categories), in one txn; else create a human_gate blocker.
- `adr.createFromDecision(decId)`: create an `adr` artifact from a decided decision, link `decision.artifact_id`. `list/show`.
- `blocker.create/resolve`: generic. `resolve` on a `step_failure` blocker is the retry trigger (or via step.retry). `gate.list` = open `human_gate` blockers; `gate.answer(blockerId, choice, note)` resolves the gate (writes choice/answer/answered_by) and advances the workflow (completes the gate's step / records the decision). 

Provide focused tests for: review_gate all-pass advances; a reject blocks; gate answer advances; decision auto-accept ≥ threshold; below-threshold creates a human_gate. Commit each usecase with its tests (`feat: add step complete/fail/retry/review`, `feat: add decision/adr usecases with policy auto-accept`, `feat: add blocker/gate usecases`).

NOTE: Effective policy = merge(workflow-def policy, global, work-item) with precedence work-item > global > workflow-def. Implement `domain/policy.ts` `effectivePolicy(tx, workItemId)` reading the policies table + the run's def policy.

---

## Task 8: Populate WorkItemView + work current/blockers + CLI wiring + integration

**Files:** Modify `src/usecases/work.ts`, `src/cli/program.ts`; Create `tests/integration/plan3-feature-delivery.test.ts`; modify CLAUDE.md.

- Update `work.view()`: `blocker_ids` = open blockers; `artifact_ids` = current-version ids per linked root; `active_run` = the active run id.
- `work.current(ctx, id)`: read-only; returns the current step contract data ({work_item, run, step, required_context (artifact refs), do_not, when_done}) WITHOUT advancing/leasing — the Plan-4 `next` will reuse this shape. For Plan 3, return at least {work_item, run, step:{id,type}, required_context: artifact refs for the step's requires}.
- `work.blockers(ctx, id)`: list open blockers + unmet deps.
- Wire CLI groups: `workflow list|show|attach|register|runs`, `run cancel`, `step complete|fail|retry|review`, `artifact create|show|revise|list|submit|approve|archive`, `decision create|accept|reject`, `adr create-from-decision|list|show`, `blocker create|resolve`, `gate list|answer`, `policy create|list|show`, `prompt create|list|show`, and `work current|blockers`.
- Integration test: drive `feature_delivery` from attach → brainstorm (create decision+spec, complete) → design (create design, complete) → design_review (review pass ×3 → advance) → planning (create plan, complete) → implementation (create work_log, complete) → pr_create/pr_monitor/merge (manual integration: just `step complete` each) → complete (terminal → run + work item completed). Assert the run invariant holds at each step and the work item ends `completed`.

- [ ] Implement, test, build gate (`npm test`, typecheck, build), update CLAUDE.md command reference, commit `feat: populate work view; add work current/blockers; wire engine CLI; e2e feature_delivery`.

---

## Self-Review

**Spec coverage:** workflow DSL + linear validation (§5.2, Workflow DSL spec) → Task 1. built-in feature_delivery + default policy seed (§8,§9) → Task 2. defs/runs/step_runs/artifacts/decisions/blockers/policies repos (§4.3) → Task 3. artifacts versioned/immutable + status transitions (§5.3,§8) → Task 4. advance engine + run invariant + required-output gate (§5.1–5.4) → Task 5. attach (one active run) + register + runs + cancel (§5.2,§8) → Task 6. step complete/fail/retry/review, review_gate children + pass_policy, human_gate, decision auto-accept + ADR, blockers/gates, policy precedence (§5.3,§5.4,§8) → Task 7. WorkItemView population + work current/blockers + full CLI wiring + e2e (§7.5,§8) → Task 8. **Deferred to Plan 4:** `apm next` resolver, agent-format projection, `apm status`, concurrency tests.

**Placeholder note:** Tasks 3, 6, 7 specify repo/usecase helpers by signature + behavior + key SQL + representative tests rather than every line — the implementer writes bodies following the established Plan-2 patterns (errors via ApmError, events via tx.appendEvent, views via mappers). The engine-critical logic (advance, validator, seed, required-output gate, review-gate aggregation, decision auto-accept) is specified concretely with tests. This is intentional given the breadth; each task still lands with passing tests proving the behavior.

**Type consistency:** `WorkflowDef`/`StepDef` from workflow.ts; `RunView`/`ArtifactView` added to entities.ts; `Ctx`/`ApmError`/`repos(tx)` reused; `attachRun`/`step.complete` signatures shared between advance.test (Task 5) and workflow/step usecases (Tasks 6–7) — implement consistently.
