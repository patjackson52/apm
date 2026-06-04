# Image Support — Plan 2: Verification Evidence + Capture Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind images to verification runs and gate workflow-step completion on required screenshots, with the requirement surfaced to agents and bug screenshots attached to blockers.

**Architecture:** Workflow step defs gain `requires.captures` (a list of named capture specs). Step completion validates that linked `evidence` images satisfy each spec (matched on image `metadata.kind` + optional route/viewport) — a pure domain check inside `completeMainStep`. `apm step complete --image-file` ingests a screenshot (reusing Plan 1's blob store), links it as `evidence`, wraps it in an evidence doc that embeds the `IMG-N`, and sets `output_artifact_id` (K2). Required captures are surfaced in `apm next --format agent` as a `REQUIRED_CAPTURES:` block. Bug screenshots link to a blocker (`--blocker`) and appear in `apm blocker show`.

**Tech Stack:** TypeScript, Node, better-sqlite3, commander, vitest. No new deps (reuses Plan 1's `image-size`/blob store).

**Spec:** `docs/superpowers/specs/2026-06-04-image-support-design.md` (§5 Capture specs + prompts, §6 Linking & verification, K2/K4). Built on Plan 1 (merged: `src/usecases/image.ts`, `src/storage/blobstore.ts`, `IMG-` ids, `metadata_json`).

**Scope decision (confirmed):** the agent-facing `REQUIRED_CAPTURES` surfacing is included HERE (not deferred to Plan 3). Plan 3 covers only `REQUIRED_CONTEXT` image-consume fields; Plan 4 covers the viewer.

**Out of scope (later plans / YAGNI):** `produces.captures` (informational only — no consumer yet); perceptual-diff gating; `--clipboard` ingestion; viewer.

---

## File Structure

**Create:**
- `src/domain/captures.ts` — pure `unmetCaptures(required, images)` matcher + `CaptureImage` type. One responsibility: capture-spec ↔ image matching.
- `tests/domain/captures.test.ts`, plus tests appended to existing files noted per task.

**Modify:**
- `src/domain/workflow.ts` — `CaptureSpec` type; `requires.captures`; validate captures.
- `src/domain/contract.ts` — `CaptureRef` type.
- `src/domain/advance.ts` — capture gate in `completeMainStep`.
- `src/domain/entities.ts` — (import only; `PromptView` gains `kind`).
- `src/storage/schema.sql` — `prompt_definitions.kind` column.
- `src/storage/repos.ts` — `linkedImagesByRelation`, `imagesByBlocker`, `prompts.insert(kind)`.
- `src/usecases/image.ts` — extract `addImageTx`; `AddArgs.blocker`.
- `src/usecases/step.ts` — `CompleteArgs` image fields + evidence binding.
- `src/usecases/prompt.ts` — `kind` on create/view.
- `src/usecases/next.ts` — build `required_captures`.
- `src/usecases/blocker.ts` — surface images in `show`.
- `src/format/render.ts` — `REQUIRED_CAPTURES:` block.
- `src/cli/program.ts` — `step complete --image-file`, `image add --blocker`, `prompt create --kind`.
- `CLAUDE.md` — doc the new flags.

---

## Task 1: `CaptureSpec` type + `requires.captures` + validation

**Files:**
- Modify: `src/domain/workflow.ts:6-45`
- Test: `tests/domain/workflow.test.ts` (append; create if absent)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/domain/workflow.test.ts
import { describe, it, expect } from 'vitest';
import { parseWorkflow, validateWorkflow } from '../../src/domain/workflow.js';

const WITH_CAPTURES = `
id: cap
version: 1
name: cap
applies_to: [feature]
status: active
steps:
  - id: shoot
    type: agent_execution
    requires:
      captures:
        - name: login-dark
          kind: screenshot
          route: /login
          viewport: { w: 1280, h: 800 }
          prompt: capture-login
    outputs:
      - artifact_type: review
    next: [done]
  - id: done
    type: terminal
`;

describe('capture specs in workflow', () => {
  it('parses + validates a step with requires.captures', () => {
    const def = parseWorkflow(WITH_CAPTURES);
    expect(() => validateWorkflow(def)).not.toThrow();
    expect(def.steps[0].requires?.captures?.[0]).toMatchObject({ name: 'login-dark', kind: 'screenshot', route: '/login' });
  });

  it('rejects a capture missing name or kind', () => {
    const bad = parseWorkflow(`
id: b
version: 1
name: b
applies_to: [feature]
status: active
steps:
  - id: s
    type: agent_execution
    requires:
      captures:
        - route: /x
    next: [t]
  - id: t
    type: terminal
`);
    expect(() => validateWorkflow(bad)).toThrow(/capture needs name and kind/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/workflow.test.ts`
Expected: FAIL — `captures` not a known field / no validation message.

- [ ] **Step 3: Implement**

In `src/domain/workflow.ts`, add the `CaptureSpec` interface (above `StepDef`):

```typescript
export interface CaptureSpec {
  name: string;
  kind: string;
  route?: string;
  viewport?: { w: number; h: number };
  prompt?: string;
}
```

Extend `StepDef.requires` to include captures:

```typescript
  requires?: { artifacts?: ArtifactType[]; capabilities?: string[]; captures?: CaptureSpec[] };
```

In `validateWorkflow`, inside the `for (const s of def.steps)` loop (after the `on_reject` checks), add:

```typescript
    for (const cap of s.requires?.captures ?? []) {
      if (!cap.name || !cap.kind) throw new ApmError('E_VALIDATION', `step ${s.id}: capture needs name and kind`);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/workflow.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/domain/workflow.ts tests/domain/workflow.test.ts
git commit -m "feat(workflow): CaptureSpec + requires.captures with validation"
```

---

## Task 2: `unmetCaptures` pure matcher

**Files:**
- Create: `src/domain/captures.ts`
- Test: `tests/domain/captures.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/domain/captures.test.ts
import { describe, it, expect } from 'vitest';
import { unmetCaptures } from '../../src/domain/captures.js';
import type { CaptureSpec } from '../../src/domain/workflow.js';

const spec = (o: Partial<CaptureSpec>): CaptureSpec => ({ name: 'c', kind: 'screenshot', ...o });

describe('unmetCaptures', () => {
  it('returns [] when an image satisfies kind', () => {
    expect(unmetCaptures([spec({})], [{ kind: 'screenshot', capture: null }])).toEqual([]);
  });
  it('flags unmet when no image matches kind', () => {
    expect(unmetCaptures([spec({ name: 'x', kind: 'diagram' })], [{ kind: 'screenshot', capture: null }])).toEqual(['x']);
  });
  it('matches on route when specified', () => {
    const s = [spec({ name: 'r', route: '/login' })];
    expect(unmetCaptures(s, [{ kind: 'screenshot', capture: { route: '/home' } }])).toEqual(['r']);
    expect(unmetCaptures(s, [{ kind: 'screenshot', capture: { route: '/login' } }])).toEqual([]);
  });
  it('matches on viewport when specified', () => {
    const s = [spec({ name: 'v', viewport: { w: 1280, h: 800 } })];
    expect(unmetCaptures(s, [{ kind: 'screenshot', capture: { viewport: { w: 375, h: 812 } } }])).toEqual(['v']);
    expect(unmetCaptures(s, [{ kind: 'screenshot', capture: { viewport: { w: 1280, h: 800 } } }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/captures.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/domain/captures.ts
import type { CaptureSpec } from './workflow.js';

/** The minimal image shape the matcher needs: its kind + parsed capture metadata. */
export interface CaptureImage {
  kind: string;
  capture: Record<string, unknown> | null;
}

/** Names of required captures NOT satisfied by any of the supplied images. Pure. */
export function unmetCaptures(required: CaptureSpec[], images: CaptureImage[]): string[] {
  return required.filter((spec) => !images.some((img) => matches(spec, img))).map((spec) => spec.name);
}

function matches(spec: CaptureSpec, img: CaptureImage): boolean {
  if (img.kind !== spec.kind) return false;
  const cap = (img.capture ?? {}) as { route?: string; viewport?: { w: number; h: number } };
  if (spec.route != null && cap.route !== spec.route) return false;
  if (spec.viewport != null) {
    const vp = cap.viewport;
    if (!vp || vp.w !== spec.viewport.w || vp.h !== spec.viewport.h) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/captures.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add src/domain/captures.ts tests/domain/captures.test.ts
git commit -m "feat(domain): unmetCaptures matcher (kind + route + viewport)"
```

---

## Task 3: `linkedImagesByRelation` repo query

**Files:**
- Modify: `src/storage/repos.ts` (inside the `artifacts:` object, near `linkedImages`)
- Test: covered by Task 4's gate test (a relation-filtered linked-image read).

- [ ] **Step 1: Add the method**

In `src/storage/repos.ts`, inside the `artifacts:` object, add:

```typescript
      linkedImagesByRelation(workItemId: string, relation: string): string[] {
        return tx.all<{ r: string }>(
          `SELECT wia.root_artifact_id AS r
           FROM work_item_artifacts wia
           JOIN artifacts a ON a.id = wia.root_artifact_id
           WHERE wia.work_item_id=? AND wia.relation_type=? AND a.type='image'
           ORDER BY r`,
          workItemId, relation,
        ).map((x) => x.r);
      },
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/storage/repos.ts
git commit -m "feat(storage): linkedImagesByRelation query"
```

---

## Task 4: Capture gate in `completeMainStep`

**Files:**
- Modify: `src/domain/advance.ts` (in `completeMainStep`, after the outputs check ~line 186; add imports)
- Test: `tests/usecases/step-captures.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/usecases/step-captures.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as workflow from '../../src/usecases/workflow.js';
import * as step from '../../src/usecases/step.js';
import * as image from '../../src/usecases/image.js';
import { putBlob } from '../../src/storage/blobstore.js';

const clock = fixedClock('2026-06-04T12:00:00.000Z');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let dir: string; let storage: SqliteStorage;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-capgate-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

const YAML = `
id: capwf
version: 1
name: capwf
applies_to: [feature]
status: active
steps:
  - id: shoot
    type: agent_execution
    requires:
      captures:
        - name: home-shot
          kind: screenshot
    next: [done]
  - id: done
    type: terminal
`;

function setup() {
  workflow.register(ctx(), YAML);
  const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
  const run = workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'capwf', agent: 'claude' });
  return { wi, run };
}

describe('capture gate on step completion', () => {
  it('blocks completion when a required capture has no evidence image', () => {
    const { run } = setup();
    expect(() => step.complete(ctx(), { run: run.id, step: 'shoot', agent: 'claude' }))
      .toThrow(/missing required captures: home-shot/);
  });

  it('allows completion once a matching evidence image is linked', () => {
    const { wi, run } = setup();
    image.add(ctx(), { workItem: wi.id, kind: 'screenshot', alt: 'home', relation: 'evidence', agent: 'claude', blob: putBlob(dir, PNG) });
    const view = step.complete(ctx(), { run: run.id, step: 'shoot', agent: 'claude' });
    expect(view).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/step-captures.test.ts`
Expected: FAIL — completion succeeds with no image (no gate yet), so the first test's `toThrow` fails.

- [ ] **Step 3: Implement**

In `src/domain/advance.ts`, add imports at the top:

```typescript
import { unmetCaptures } from './captures.js';
import { toImageView } from './entities.js';
```

In `completeMainStep`, after the `if (stepDef.type === 'agent_prompt' || stepDef.type === 'agent_execution') { ... }` outputs block, add (independent of step type):

```typescript
  if (stepDef.requires?.captures?.length) {
    const roots = r.artifacts.linkedImagesByRelation(runRow.work_item_id, 'evidence');
    const images = roots
      .map((root) => r.artifacts.currentByRoot(root))
      .filter(Boolean)
      .map((row: any) => {
        const v = toImageView(row);
        return { kind: v.kind, capture: v.capture };
      });
    const unmet = unmetCaptures(stepDef.requires.captures, images);
    if (unmet.length) {
      throw new ApmError('E_PRECONDITION', `missing required captures: ${unmet.join(', ')}`);
    }
  }
```

(`r`, `stepDef`, `runRow`, and `ApmError` are already in scope in `completeMainStep`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/usecases/step-captures.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Run full suite (no regression — existing workflows have no captures)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/advance.ts tests/usecases/step-captures.test.ts
git commit -m "feat(workflow): gate step completion on required captures"
```

---

## Task 5: Extract `addImageTx` (refactor, no behavior change)

So `step complete --image-file` can ingest an image inside the step's transaction without duplicating image-insert logic.

**Files:**
- Modify: `src/usecases/image.ts` (extract in-transaction body of `add`)
- Test: `tests/usecases/image.test.ts` (append a direct `addImageTx` test); existing image tests must still pass.

- [ ] **Step 1: Write the failing test**

Append to `tests/usecases/image.test.ts`:

```typescript
import { addImageTx } from '../../src/usecases/image.js';

describe('addImageTx (in-transaction)', () => {
  it('inserts + links an image within a caller-provided transaction', () => {
    const ctx = { storage, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'TX', agent: 'agent:claude' });
    const meta = putBlob(dir, PNG);
    const v = storage.transaction('immediate', (tx) =>
      addImageTx(tx, { workItem: wi.id, kind: 'screenshot', alt: 'x', relation: 'evidence', agent: 'agent:claude', blob: meta }),
    );
    expect(v.id).toMatch(/^IMG-/);
    expect(v.work_item).toBe(wi.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/image.test.ts -t addImageTx`
Expected: FAIL — `addImageTx` not exported.

- [ ] **Step 3: Implement**

In `src/usecases/image.ts`, add the `Tx` import:

```typescript
import type { Tx } from '../storage/storage.js';
```

Replace the `add` function with an extracted helper + thin wrapper. The validation (kind/relation/size) moves into `addImageTx` so every caller is guarded:

```typescript
/** Insert + link an image inside a caller-provided transaction. Validates kind/relation/size. */
export function addImageTx(tx: Tx, a: AddArgs): ImageView {
  if (!IMAGE_KINDS.includes(a.kind as any)) {
    throw new ApmError('E_VALIDATION', `invalid kind`, [{ field: 'kind', problem: `must be one of ${IMAGE_KINDS.join('|')}`, got: a.kind }]);
  }
  const relation = a.relation ?? 'evidence';
  if (!RELATIONS.includes(relation as any)) {
    throw new ApmError('E_VALIDATION', `invalid relation`, [{ field: 'relation', problem: `must be one of ${RELATIONS.join('|')}`, got: relation }]);
  }
  if (a.blob.byte_size > MAX_BLOB_BYTES) {
    throw new ApmError('E_VALIDATION', `image too large (${a.blob.byte_size} bytes > ${MAX_BLOB_BYTES})`);
  }
  const r = repos(tx);
  r.agents.ensure(a.agent);
  if (!r.workItems.byId(a.workItem)) throw new ApmError('E_NOT_FOUND', `work item ${a.workItem} not found`);
  r.blobs.insert(a.blob);
  const metadata = {
    kind: a.kind,
    blob: a.blob.sha256,
    mime: a.blob.mime,
    ext: a.blob.ext,
    width: a.blob.width,
    height: a.blob.height,
    byte_size: a.blob.byte_size,
    alt: a.alt ?? null,
    capture: a.capture ?? null,
  };
  const id = r.artifacts.insert(
    { type: 'image', title: a.alt ?? a.kind, body: a.alt ?? null, createdBy: a.agent, version: 1, metadata },
    'image.created',
  );
  r.artifacts.linkToWorkItem(a.workItem, id, relation);
  tx.appendEvent({
    actorId: a.agent,
    eventType: 'image.linked',
    entityType: 'artifact',
    entityId: id,
    payload: { work_item: a.workItem, relation },
  });
  return toImageView(r.artifacts.byId(id)!, a.workItem);
}

export function add(ctx: Ctx, a: AddArgs): ImageView {
  return ctx.storage.transaction('immediate', (tx) => addImageTx(tx, a));
}
```

(Leave `IMAGE_KINDS`, `RELATIONS`, `MAX_BLOB_BYTES`, `AddArgs`, and all other usecases unchanged.)

- [ ] **Step 4: Run tests to verify pass + no regression**

Run: `npx vitest run tests/usecases/image.test.ts tests/cli/image.test.ts`
Expected: PASS (existing add/list/show/etc. tests still green; new addImageTx test green).

- [ ] **Step 5: Commit**

```bash
git add src/usecases/image.ts tests/usecases/image.test.ts
git commit -m "refactor(image): extract addImageTx for in-transaction reuse"
```

---

## Task 6: `step.complete` evidence binding (`--image-file` core, K2)

**Files:**
- Modify: `src/usecases/step.ts` (`CompleteArgs` + `complete`)
- Test: `tests/usecases/step-captures.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/usecases/step-captures.test.ts`:

```typescript
import { putBlob as putBlob2 } from '../../src/storage/blobstore.js';

describe('step.complete --image-file evidence binding', () => {
  it('ingests a screenshot, links it as evidence, embeds it in the output doc, and satisfies the gate', () => {
    const { wi, run } = setup();
    const blob = putBlob2(dir, PNG);
    const view = step.complete(ctx(), { run: run.id, step: 'shoot', agent: 'claude', imageBlob: blob, imageKind: 'screenshot', imageAlt: 'home' });
    expect(view).toBeTruthy();

    // an evidence image is linked to the work item
    const imgs = image.list(ctx(), { workItem: wi.id });
    expect(imgs.items.length).toBe(1);
    const imgId = imgs.items[0].id;

    // the step's output artifact is a doc embedding the image ref
    const out = storage.transaction('deferred', (tx) => {
      const sr: any = tx.get("SELECT output_artifact_id FROM workflow_step_runs WHERE run_id=? AND step_id='shoot'", run.id);
      const art: any = tx.get('SELECT type, body FROM artifacts WHERE id=?', sr.output_artifact_id);
      return art;
    });
    expect(out.type).toBe('review');
    expect(out.body).toContain(`apm:${imgId}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/step-captures.test.ts -t "evidence binding"`
Expected: FAIL — `CompleteArgs` has no `imageBlob`.

- [ ] **Step 3: Implement**

In `src/usecases/step.ts`, add imports:

```typescript
import { addImageTx } from './image.js';
import type { BlobMeta } from '../storage/blobstore.js';
```

Extend `CompleteArgs`:

```typescript
export interface CompleteArgs {
  run: string;
  step: string;
  agent: string;
  artifactId?: string | null;
  artifactType?: string | null;
  bodyFile?: string | null;
  imageBlob?: BlobMeta | null;
  imageKind?: string | null;
  imageAlt?: string | null;
  imageCapture?: Record<string, unknown> | null;
}
```

In `complete`, after the existing `if (a.artifactType && a.bodyFile) { ... }` block and BEFORE `completeMainStep(...)`, add:

```typescript
    // Evidence screenshot: ingest the image, link it as evidence, wrap it in an output doc.
    if (a.imageBlob) {
      const img = addImageTx(tx, {
        workItem: runRow.work_item_id,
        kind: a.imageKind ?? 'screenshot',
        alt: a.imageAlt ?? undefined,
        capture: a.imageCapture ?? undefined,
        relation: 'evidence',
        agent: a.agent,
        blob: a.imageBlob,
      });
      const evidenceId = r.artifacts.insert({
        type: 'review',
        title: `${a.step} evidence`,
        body: `![${img.alt ?? img.id}](apm:${img.id})`,
        createdBy: a.agent,
        version: 1,
      });
      r.artifacts.linkToWorkItem(runRow.work_item_id, evidenceId, 'produced');
      resolvedArtifactId = evidenceId;
    }
```

(`resolvedArtifactId` is the existing `let` from the artifact-type block; the image path takes precedence when both are supplied. `completeMainStep(..., { artifactId: resolvedArtifactId }, ...)` is unchanged and now also passes the capture gate because the evidence image was linked above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/usecases/step-captures.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/usecases/step.ts tests/usecases/step-captures.test.ts
git commit -m "feat(step): --image-file evidence binding (image + embed doc + output)"
```

---

## Task 7: CLI `step complete --image-file`

**Files:**
- Modify: `src/cli/program.ts` (the `step complete` action)
- Test: `tests/cli/step-image.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/cli/step-image.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { fixedClock } from '../../src/domain/clock.js';
import { buildProgram } from '../../src/cli/program.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import * as work from '../../src/usecases/work.js';
import * as workflow from '../../src/usecases/workflow.js';

const clock = fixedClock('2026-06-04T12:00:00.000Z');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let dir: string;
beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'apm-stepimg-'))); initProject(dir, clock); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function runCli(args: string[]): { out: string } {
  const lines: string[] = [];
  const program = buildProgram({ clock, out: (s) => lines.push(s), defaultFormat: 'json' });
  const orig = process.exitCode;
  program.parse(['--dir', dir, ...args], { from: 'user' });
  process.exitCode = orig;
  return { out: lines.join('\n') };
}

const YAML = `
id: capwf
version: 1
name: capwf
applies_to: [feature]
status: active
steps:
  - id: shoot
    type: agent_execution
    requires:
      captures:
        - name: home-shot
          kind: screenshot
    next: [done]
  - id: done
    type: terminal
`;

describe('apm step complete --image-file', () => {
  it('completes a capture-gated step by attaching a screenshot', () => {
    const storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
    workflow.register({ storage, clock }, YAML);
    const wi = work.create({ storage, clock }, { type: 'feature', title: 'F', agent: 'claude' });
    const run = workflow.attachRun({ storage, clock }, { workItem: wi.id, workflow: 'capwf', agent: 'claude' });
    storage.close();
    const png = join(dir, 'shot.png');
    writeFileSync(png, PNG);

    const res = JSON.parse(runCli(['step', 'complete', run.id, 'shoot', '--image-file', png, '--image-kind', 'screenshot', '--image-alt', 'home', '--agent', 'claude']).out);
    expect(res.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/step-image.test.ts`
Expected: FAIL — `--image-file` unknown option.

- [ ] **Step 3: Implement**

In `src/cli/program.ts`, find the `stepCmd.command('complete <runId> <stepId>')` block. Add the new options and rewrite the action to ingest the blob inside the `runCommand` callback (matching the Plan 1 error-handling pattern). `putBlob` and `resolveProjectRoot` are already imported (Plan 1).

```typescript
stepCmd
  .command('complete <runId> <stepId>')
  .description('Complete a workflow step')
  .requiredOption('--agent <name>', 'agent name')
  .option('--artifact <id>', 'artifact id')
  .option('--artifact-type <t>', 'artifact type (creates artifact from --body-file)')
  .option('--body-file <f>', 'path to artifact body file')
  .option('--image-file <path>', 'attach an evidence screenshot (creates IMG + embeds in output doc)')
  .option('--image-kind <k>', 'image kind', 'screenshot')
  .option('--image-alt <s>', 'image alt text')
  .option('--capture-file <f>', 'path to a JSON file of capture metadata for the image')
  .action(function (this: Command, runId: string, stepId: string, o: { agent: string; artifact?: string; artifactType?: string; bodyFile?: string; imageFile?: string; imageKind: string; imageAlt?: string; captureFile?: string }) {
    const deps = buildDeps();
    process.exitCode = runCommand(deps, 'step complete', (ctx) => {
      const bodyContent = o.bodyFile ? readFileSync(o.bodyFile, 'utf8') : undefined;
      let imageBlob = null;
      let imageCapture = undefined;
      if (o.imageFile) {
        const root = resolveProjectRoot(deps.dir);
        imageBlob = putBlob(root, readFileSync(o.imageFile));
        imageCapture = o.captureFile ? JSON.parse(readFileSync(o.captureFile, 'utf8')) : undefined;
      }
      return {
        data: step.complete(ctx, {
          run: runId, step: stepId, agent: o.agent,
          artifactId: o.artifact ?? null,
          artifactType: o.artifactType ?? null,
          bodyFile: bodyContent ?? null,
          imageBlob,
          imageKind: o.imageKind ?? null,
          imageAlt: o.imageAlt ?? null,
          imageCapture: imageCapture ?? null,
        }),
      };
    });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/step-image.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/program.ts tests/cli/step-image.test.ts
git commit -m "feat(cli): step complete --image-file evidence attachment"
```

---

## Task 8: Capture prompt `kind`

**Files:**
- Modify: `src/storage/schema.sql` (`prompt_definitions`), `src/storage/repos.ts` (`prompts.insert`), `src/usecases/prompt.ts` (`PromptView` + create), `src/cli/program.ts` (`prompt create --kind`)
- Test: `tests/usecases/prompt.test.ts` (append; create if absent)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/usecases/prompt.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as prompt from '../../src/usecases/prompt.js';

const clock = fixedClock('2026-06-04T12:00:00.000Z');
let dir: string; let storage: SqliteStorage;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-prompt-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });

describe('prompt kind', () => {
  it('stores and returns kind (default general; capture when set)', () => {
    const ctx = { storage, clock };
    const a = prompt.create(ctx, { name: 'plain', body: 'hi' });
    expect(a.kind).toBe('general');
    const b = prompt.create(ctx, { name: 'capture-login', body: 'steps...', kind: 'capture' });
    expect(b.kind).toBe('capture');
    expect(prompt.show(ctx, 'capture-login').kind).toBe('capture');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/prompt.test.ts`
Expected: FAIL — `kind` not on `PromptView` / not accepted by create.

- [ ] **Step 3: Implement**

In `src/storage/schema.sql`, change the `prompt_definitions` table to add a `kind` column:

```sql
CREATE TABLE prompt_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'general',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

In `src/storage/repos.ts`, update `prompts.insert` to accept + persist `kind`:

```typescript
    insert(name: string, body: string, kind: string = 'general'): string {
      const id = tx.allocateId('PD');
      const prev = tx.get<{ version: number }>('SELECT MAX(version) version FROM prompt_definitions WHERE name=?', name);
      const version = (prev?.version ?? 0) + 1;
      tx.run(
        'INSERT INTO prompt_definitions (id, name, version, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        id, name, version, kind, body, now,
      );
      tx.appendEvent({ eventType: 'prompt.created', entityType: 'prompt_definition', entityId: id, payload: { name, version, kind } });
      return id;
    },
```

In `src/usecases/prompt.ts`, add `kind` to `PromptView`, `CreatePromptArgs`, and map it:

```typescript
export interface PromptView {
  id: string; name: string; version: number; kind: string; body: string; created_at: string;
}

export interface CreatePromptArgs {
  name: string;
  body?: string | null;
  bodyFile?: string | null;
  kind?: string;
}
```

In `create`, pass `a.kind ?? 'general'` to `r.prompts.insert(...)`, and ensure the returned `PromptView` (and `show`/`list` mappers) include `kind: row.kind`. (Mirror the existing row→view mapping in this file; add `kind: row.kind ?? 'general'`.)

In `src/cli/program.ts`, add `--kind` to `prompt create`:

```typescript
  .option('--kind <k>', 'prompt kind (e.g. capture)', 'general')
```

and pass `kind: o.kind` into the `prompt.create(ctx, { ... })` call.

- [ ] **Step 4: Run test + full suite**

Run: `npx vitest run tests/usecases/prompt.test.ts && npm test`
Expected: PASS (prompt tests green; no regression).

- [ ] **Step 5: Commit**

```bash
git add src/storage/schema.sql src/storage/repos.ts src/usecases/prompt.ts src/cli/program.ts tests/usecases/prompt.test.ts
git commit -m "feat(prompt): kind column (general default, capture recipes)"
```

---

## Task 9: `CaptureRef` + `required_captures` in dispatch payload

**Files:**
- Modify: `src/domain/contract.ts` (add `CaptureRef`), `src/usecases/next.ts` (build `required_captures`, add to `data`)
- Test: `tests/usecases/next-captures.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/usecases/next-captures.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as workflow from '../../src/usecases/workflow.js';
import * as next from '../../src/usecases/next.js';

const clock = fixedClock('2026-06-04T12:00:00.000Z');
let dir: string; let storage: SqliteStorage;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-nextcap-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

const YAML = `
id: capwf
version: 1
name: capwf
applies_to: [feature]
status: active
steps:
  - id: shoot
    type: agent_execution
    requires:
      captures:
        - name: home-shot
          kind: screenshot
          route: /home
          viewport: { w: 1280, h: 800 }
          prompt: capture-home
    next: [done]
  - id: done
    type: terminal
`;

describe('required_captures in next payload', () => {
  it('includes capture specs for the dispatched step', () => {
    workflow.register(ctx(), YAML);
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'capwf', agent: 'claude' });
    const res: any = next.next(ctx(), { agent: 'claude' });
    expect(res.required_captures).toEqual([
      { name: 'home-shot', kind: 'screenshot', route: '/home', viewport: { w: 1280, h: 800 }, prompt: 'capture-home' },
    ]);
  });
});
```

> Note: confirm the exact `next` entry point name/signature in `src/usecases/next.ts` (e.g. `next(ctx, { agent })`); adjust the call to match. The assertion target is the `required_captures` field on the dispatched payload.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/next-captures.test.ts`
Expected: FAIL — `required_captures` undefined.

- [ ] **Step 3: Implement**

In `src/domain/contract.ts`, add:

```typescript
export interface CaptureRef {
  name: string;
  kind: string;
  route?: string;
  viewport?: { w: number; h: number };
  prompt?: string;
}
```

In `src/usecases/next.ts`, after the `requiredContext` loop, build the captures list:

```typescript
  const requiredCaptures = (stepDef.requires?.captures ?? []).map((c) => ({
    name: c.name,
    kind: c.kind,
    ...(c.route != null ? { route: c.route } : {}),
    ...(c.viewport != null ? { viewport: c.viewport } : {}),
    ...(c.prompt != null ? { prompt: c.prompt } : {}),
  }));
```

Add it to the `data` payload object (alongside `required_context`):

```typescript
    required_captures: requiredCaptures,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/usecases/next-captures.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/contract.ts src/usecases/next.ts tests/usecases/next-captures.test.ts
git commit -m "feat(next): required_captures in dispatch payload"
```

---

## Task 10: `REQUIRED_CAPTURES:` block in agent format

**Files:**
- Modify: `src/format/render.ts` (`renderAgent`, after the `REQUIRED_CONTEXT` block)
- Test: `tests/format/render-captures.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/format/render-captures.test.ts
import { describe, it, expect } from 'vitest';
import { render } from '../../src/format/render.js';

const envelope = {
  ok: true,
  data: {
    status: 'dispatched',
    work_item: 'WI-1',
    step: { id: 'shoot', type: 'agent_execution' },
    allowed_action: 'capture screenshots',
    required_context: [],
    required_captures: [
      { name: 'home-shot', kind: 'screenshot', route: '/home', viewport: { w: 1280, h: 800 }, prompt: 'capture-home' },
    ],
    do_not: [],
    when_done: [],
  },
  error: null,
  meta: {},
};

describe('agent format REQUIRED_CAPTURES', () => {
  it('renders a REQUIRED_CAPTURES block with matchers + recipe', () => {
    const out = render('agent', envelope as any);
    expect(out).toContain('REQUIRED_CAPTURES:');
    expect(out).toContain('home-shot  kind=screenshot  route=/home  viewport=1280x800  recipe=capture-home');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/format/render-captures.test.ts`
Expected: FAIL — no REQUIRED_CAPTURES block.

- [ ] **Step 3: Implement**

In `src/format/render.ts`, inside the dispatched-payload branch (`if (d.work_item && d.step)`), after the `REQUIRED_CONTEXT` block and before `DO_NOT`, add:

```typescript
    if (Array.isArray(d.required_captures) && d.required_captures.length > 0) {
      lines.push('');
      lines.push('REQUIRED_CAPTURES:');
      for (const c of d.required_captures) {
        const parts = [c.name, `kind=${c.kind}`];
        if (c.route) parts.push(`route=${c.route}`);
        if (c.viewport) parts.push(`viewport=${c.viewport.w}x${c.viewport.h}`);
        if (c.prompt) parts.push(`recipe=${c.prompt}`);
        lines.push(parts.join('  '));
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/format/render-captures.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format/render.ts tests/format/render-captures.test.ts
git commit -m "feat(format): REQUIRED_CAPTURES block in agent contract"
```

---

## Task 11: `image add --blocker` + `imagesByBlocker`

**Files:**
- Modify: `src/usecases/image.ts` (`AddArgs.blocker`, metadata + event + default relation in `addImageTx`), `src/storage/repos.ts` (`imagesByBlocker`), `src/cli/program.ts` (`image add --blocker`)
- Test: `tests/usecases/image.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/usecases/image.test.ts`:

```typescript
describe('bug capture (--blocker)', () => {
  it('links a bug screenshot to a blocker, discoverable via imagesByBlocker', () => {
    const ctx = { storage, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'B', agent: 'agent:claude' });
    // create a blocker on the work item
    const blkId = storage.transaction('immediate', (tx) => {
      const r = repos(tx);
      return r.blockers.insert({ workItem: wi.id, type: 'bug', reason: 'broken', createdBy: 'agent:claude' });
    });
    const v = image.add(ctx, { workItem: wi.id, kind: 'bug', alt: 'broken', blocker: blkId, agent: 'agent:claude', blob: putBlob(dir, PNG) });
    expect(v.kind).toBe('bug');
    const found = storage.transaction('deferred', (tx) => repos(tx).artifacts.imagesByBlocker(blkId));
    expect(found.map((r: any) => r.id)).toContain(v.id);
  });
});
```

> Note: confirm `r.blockers.insert(...)` arg shape against `src/storage/repos.ts` (mirror how `blocker.create` calls it). If the repo signature differs, adapt the seeding line — the assertion (imagesByBlocker finds the image) is the point.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/image.test.ts -t "bug capture"`
Expected: FAIL — `blocker` not on `AddArgs` / `imagesByBlocker` missing.

- [ ] **Step 3: Implement**

In `src/usecases/image.ts`, add `blocker` to `AddArgs`:

```typescript
export interface AddArgs {
  workItem: string;
  kind: string;
  alt?: string;
  capture?: Record<string, unknown>;
  relation?: string;
  blocker?: string;
  agent: string;
  blob: BlobMeta;
}
```

In `addImageTx`, default the relation to `'bug'` when a blocker is supplied, store the blocker in metadata, and include it in the event payload. Change the relation line and metadata/event:

```typescript
  const relation = a.relation ?? (a.blocker ? 'bug' : 'evidence');
```

In the `metadata` object add:

```typescript
    blocker: a.blocker ?? null,
```

In the `image.linked` event payload add the blocker:

```typescript
    payload: { work_item: a.workItem, relation, ...(a.blocker ? { blocker: a.blocker } : {}) },
```

In `src/storage/repos.ts`, add to the `artifacts:` object:

```typescript
      imagesByBlocker(blockerId: string): any[] {
        return tx.all(
          "SELECT * FROM artifacts WHERE type='image' AND json_extract(metadata_json,'$.blocker')=? ORDER BY id",
          blockerId,
        );
      },
```

In `src/cli/program.ts`, add `--blocker` to the `image add` command:

```typescript
  .option('--blocker <id>', 'attach as bug evidence to a blocker')
```

and pass `blocker: o.blocker` into the `image.add(ctx, { ... })` call.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/usecases/image.test.ts -t "bug capture"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/usecases/image.ts src/storage/repos.ts src/cli/program.ts tests/usecases/image.test.ts
git commit -m "feat(image): --blocker bug-capture + imagesByBlocker query"
```

---

## Task 12: Surface bug images in `apm blocker show`

**Files:**
- Modify: `src/usecases/blocker.ts` (`show` returns blocker + `images`)
- Test: `tests/usecases/blocker-images.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/usecases/blocker-images.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as image from '../../src/usecases/image.js';
import * as blocker from '../../src/usecases/blocker.js';
import { putBlob } from '../../src/storage/blobstore.js';

const clock = fixedClock('2026-06-04T12:00:00.000Z');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let dir: string; let storage: SqliteStorage;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-blkimg-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });

describe('blocker show surfaces bug images', () => {
  it('returns images linked to the blocker', () => {
    const ctx = { storage, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'B', agent: 'agent:claude' });
    const blk = blocker.create(ctx, { workItem: wi.id, type: 'bug', reason: 'broken', agent: 'agent:claude' });
    const img = image.add(ctx, { workItem: wi.id, kind: 'bug', alt: 'broken', blocker: blk.id, agent: 'agent:claude', blob: putBlob(dir, PNG) });
    const shown: any = blocker.show(ctx, blk.id);
    expect(shown.images.map((i: any) => i.id)).toContain(img.id);
  });
});
```

> Note: confirm `blocker.create` arg/return shape in `src/usecases/blocker.ts`; adapt the seeding line to match its real signature.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/blocker-images.test.ts`
Expected: FAIL — `shown.images` undefined.

- [ ] **Step 3: Implement**

In `src/usecases/blocker.ts`, import the image view + repos and extend `show` to attach images:

```typescript
import { toImageView, type ImageView } from '../domain/entities.js';
```

Change `show` to:

```typescript
export function show(ctx: Ctx, id: string): BlockerView & { images: ImageView[] } {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    const row = r.blockers.byId(id);
    if (!row) throw new ApmError('E_NOT_FOUND', `blocker ${id} not found`);
    const images = r.artifacts.imagesByBlocker(id).map((ir: any) => toImageView(ir, row.work_item_id));
    return { ...toBlockerView(row), images };
  });
}
```

(`repos`/`ApmError`/`toBlockerView` are already imported in this file. The CLI `blocker show` already calls `blocker.show`, so the `images` field flows into its JSON/human output automatically.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/usecases/blocker-images.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/usecases/blocker.ts tests/usecases/blocker-images.test.ts
git commit -m "feat(blocker): surface linked bug images in blocker show"
```

---

## Task 13: Docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update command docs**

In `CLAUDE.md`, on the `Steps:` line, append the image flag:

```
· `step complete <run> <step> --image-file <f> [--image-kind screenshot] [--image-alt <s>] [--capture-file <f>] --agent <a>` (attach evidence screenshot; satisfies capture gates)
```

On the `Images:` line, append `[--blocker <id>]` to the `image add` usage. On the `Prompts:` line, append `[--kind capture]` to `prompt create`.

Add a one-line note near the Workflows section:

```
- Capture gates: a step may declare `requires.captures: [{ name, kind, route?, viewport?, prompt? }]`; completion is blocked until a linked `evidence` image matches each (matched on image `metadata.kind` + route/viewport). Surfaced to agents as `REQUIRED_CAPTURES:` in `apm next --format agent`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: capture gates, step --image-file, image --blocker, prompt --kind"
```

---

## Task 14: Final verification

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS; `dist/` emits; `schema.sql` (with `prompt_definitions.kind`) copied to `dist/storage/`.

- [ ] **Step 2: Manual smoke (real binary)**

```bash
TMP=$(mktemp -d)
npx tsx src/bin/apm.ts --dir "$TMP" init
# register a capture-gated workflow
cat > "$TMP/wf.yaml" <<'YAML'
id: capwf
version: 1
name: capwf
applies_to: [feature]
status: active
steps:
  - id: shoot
    type: agent_execution
    requires:
      captures:
        - name: home-shot
          kind: screenshot
    next: [done]
  - id: done
    type: terminal
YAML
npx tsx src/bin/apm.ts --dir "$TMP" workflow register --file "$TMP/wf.yaml"
WI=WI-1; npx tsx src/bin/apm.ts --dir "$TMP" work create --type feature --title Cap --agent claude >/dev/null
RUN=$(npx tsx src/bin/apm.ts --dir "$TMP" workflow attach WI-1 --workflow capwf --agent claude -o json | npx --yes node-jq -r .data.id 2>/dev/null || echo WR-1)
# agent contract should show REQUIRED_CAPTURES
npx tsx src/bin/apm.ts --dir "$TMP" next --agent claude --format agent
# completing without a shot should FAIL the gate
npx tsx src/bin/apm.ts --dir "$TMP" step complete WR-1 shoot --agent claude -o json
# attach a screenshot -> gate satisfied
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' | base64 -d > "$TMP/s.png"
npx tsx src/bin/apm.ts --dir "$TMP" step complete WR-1 shoot --image-file "$TMP/s.png" --image-kind screenshot --image-alt home --agent claude
rm -rf "$TMP"
```
Expected: `next --format agent` prints a `REQUIRED_CAPTURES:` block with `home-shot kind=screenshot`; the first `step complete` returns `ok:false` `E_PRECONDITION` (`missing required captures: home-shot`); the `--image-file` completion returns `ok:true`.

- [ ] **Step 3: Commit any fixes, then stop for review.**

---

## Self-Review (author checklist — completed)

**Spec coverage (Plan-2 scope):**
- §6 verification-run binding / K2 (one step, many shots via embed) → Tasks 5–7 (`addImageTx`, `step.complete` evidence doc, CLI `--image-file`).
- §5 required-capture spec on steps + gate (K4 match on `metadata.kind`) → Tasks 1–4 (`CaptureSpec`, `unmetCaptures`, `linkedImagesByRelation`, gate in `completeMainStep`).
- §5 capture prompt templates (reuse `prompt` entity, `capture` kind) → Task 8.
- §5 `REQUIRED_CAPTURES` surfacing (pulled into Plan 2 per scope decision) → Tasks 9–10.
- §6 blocker/bug capture (`image.linked` carries blocker id; `blocker show` surfaces) → Tasks 11–12.
- Docs → Task 13. Verification → Task 14.
- Deferred & labeled: `produces.captures` (no consumer — omitted), perceptual diff, viewer, `--clipboard` ingestion → later plans.

**Placeholder scan:** none. Three tasks (9, 11, 12) carry an explicit "confirm the real signature of X" note where they call a pre-existing function (`next` entry point, `blockers.insert`, `blocker.create`) — these are verification instructions, not placeholders; the implementation code itself is complete.

**Type consistency:** `CaptureSpec` (workflow.ts) flows into `unmetCaptures` (captures.ts), the gate (advance.ts), and is mapped to `CaptureRef` (contract.ts) for the payload + render. `AddArgs` gains `blocker?` once (Task 11) and is consumed by `addImageTx` (Task 5) + `step.complete` (Task 6). `addImageTx(tx, AddArgs): ImageView` signature is identical across image.ts and step.ts callers. `CompleteArgs` image fields (`imageBlob`/`imageKind`/`imageAlt`/`imageCapture`) match between usecase (Task 6) and CLI (Task 7). `prompts.insert(name, body, kind?)` matches `prompt.create` (Task 8). `imagesByBlocker` shared by Tasks 11 (define) and 12 (consume).
