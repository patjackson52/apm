# Prompt Emphasis — Plan A: apm-core (capabilities + compose/snapshot + API)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give APM the data, composition, and read-API to make a work item's prompt first-class — stored prompts become editable + versioned, the exact composed prompt is snapshotted on dispatch, and the Viewer can fetch prompts, their versions, where-used, and a pre-run preview.

**Architecture:** Extend the existing dispatch machinery (PR #38). At `apm next --acquire`, a single shared composer resolves the stored prompt's current version, inlines its body into the contract, stores the verbatim composed text in `workflow_step_runs.dispatch_prompt`, and pins the exact `prompt_definitions` row via a new `prompt_definition_id` FK. A shared grammar module both renders and parses that contract text. New read-only GET endpoints expose prompts (latest-per-name, detail, version, where-used) and a per-work-item next-prompt preview.

**Tech Stack:** TypeScript, better-sqlite3, Vitest, Commander (CLI), the `apm serve` HTTP layer, Zod (`@apm/types`).

This is **Plan A of two**. Plan B (viewer: adopt design-system CSS + the four prompt surfaces) follows once these endpoints land. Spec: `docs/superpowers/specs/2026-06-08-prompt-emphasis-design.md`.

---

## Conventions (read once)

- Run a single core test file: `npx vitest run tests/path/file.test.ts` (from repo root).
- Typecheck: `npm run typecheck`. Run without building: `npx tsx src/bin/apm.ts <args>`.
- **`@apm/types` is consumed as a built package.** After editing `packages/types/src/*`, run `npm run build -w @apm/types` (or `cd packages/types && npm run build`) before the `apm serve` contract test, or it validates against stale types.
- Every read usecase returns through `ctx.storage.transaction('deferred', …)`; writes use `'immediate'`. "now" comes from `ctx.clock`/`tx`, never `Date.now()`.
- Commit after each task.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/storage/schema.sql` | baseline schema | add `prompt_definition_id` to `workflow_step_runs` |
| `src/storage/migrations.ts` | versioned migrations | add migration **v3** (guarded ALTER) |
| `src/storage/repos.ts` | data access | `prompts.byNameVersion`, `prompts.listLatest`, `prompts.whereUsed`; set `prompt_definition_id` on step-run dispatch |
| `src/domain/dispatchGrammar.ts` | **new** — single render+parse of the contract grammar | move/extend `renderDispatchPrompt`; add `parseDispatchPrompt` |
| `src/domain/contract.ts` | builds `DispatchPayload` | re-export from grammar; add `prompt_name/prompt_version/prompt_body` fields |
| `src/usecases/prompt.ts` | prompt usecases | `create` rejects dup; `revise`; `show(name, version?)`; `listLatest`; `detail`; name validation; `builtin`/`summary` derivation |
| `src/usecases/next.ts` | dispatch loop | extract shared `buildDispatch`; resolve+inline body; snapshot `prompt_definition_id` |
| `src/usecases/workPrompt.ts` | **new** — read-only per-work-item next-prompt preview | `nextPromptPreview` |
| `src/cli/program.ts` | CLI surface | `prompt revise`, `prompt show --version` |
| `src/domain/entities.ts` | view mappers/types | `StepRunView.prompt_definition_id`; `PromptSummaryView`, `PromptDetailView`, `NextPromptView` |
| `src/server/serve.ts` | HTTP routes | `GET /api/prompts`, `/:name`, `/:name/versions/:v`, `/api/work/:id/next-prompt` |
| `packages/types/src/views.ts` | Zod schemas | schemas for the above + `StepRunViewSchema` field |
| `src/workflows/prompts.ts` | seeded built-ins | export a `BUILTIN_PROMPT_NAMES` set for `builtin` derivation |

---

## Phase 1 — Prompt capabilities (versioned edit, validation, queries)

### Task 1: Migration v3 — `prompt_definition_id` on step runs

**Files:**
- Modify: `src/storage/schema.sql` (workflow_step_runs block)
- Modify: `src/storage/migrations.ts`
- Test: `tests/storage/migrations.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/storage/migrations.test.ts`:

```ts
it('migration v3 adds prompt_definition_id to workflow_step_runs', () => {
  const db = freshDb(); // existing helper that opens a migrated DB
  const cols = db.prepare('PRAGMA table_info(workflow_step_runs)').all() as Array<{ name: string }>;
  expect(cols.some((c) => c.name === 'prompt_definition_id')).toBe(true);
  expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 3 });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`column missing` / version 2).

Run: `npx vitest run tests/storage/migrations.test.ts`

- [ ] **Step 3: Add the column to baseline schema.** In `src/storage/schema.sql`, in the `workflow_step_runs` CREATE TABLE, add after `dispatch_prompt TEXT,`:

```sql
  prompt_definition_id TEXT,  -- pinned prompt_definitions.id (name@version) at dispatch; null for non-agent_prompt steps
```

- [ ] **Step 4: Add migration v3.** In `src/storage/migrations.ts`, append to the `MIGRATIONS` array after the v2 object:

```ts
  {
    version: 3,
    up: (db, stamp) => {
      const cols = db.prepare('PRAGMA table_info(workflow_step_runs)').all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'prompt_definition_id')) {
        db.exec('ALTER TABLE workflow_step_runs ADD COLUMN prompt_definition_id TEXT');
      }
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(3, stamp);
    },
  },
```

- [ ] **Step 5: Run it — expect PASS.** Then `npx vitest run tests/storage/migrations.test.ts`.

- [ ] **Step 6: Commit.**

```bash
git add src/storage/schema.sql src/storage/migrations.ts tests/storage/migrations.test.ts
git commit -m "feat(core): migration v3 — prompt_definition_id on workflow_step_runs"
```

---

### Task 2: Repo queries — `byNameVersion`, `listLatest`, `whereUsed`

**Files:**
- Modify: `src/storage/repos.ts` (the `prompts:` object, ~line 342)
- Test: `tests/storage/repos-prompts.test.ts` (create)

- [ ] **Step 1: Write the failing test.** Create `tests/storage/repos-prompts.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import { repos } from '../../src/storage/repos.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-pr-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });

it('listLatest returns one row per name at the highest version', () => {
  storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.prompts.insert('p_a', 'a v1'); r.prompts.insert('p_a', 'a v2'); r.prompts.insert('p_b', 'b v1');
  });
  const rows = storage.transaction('deferred', (tx) => repos(tx).prompts.listLatest());
  const byName = Object.fromEntries(rows.map((x: any) => [x.name, x.version]));
  expect(byName).toEqual({ p_a: 2, p_b: 1 });
});

it('byNameVersion fetches an exact historical version', () => {
  storage.transaction('immediate', (tx) => { const r = repos(tx); r.prompts.insert('p', 'one'); r.prompts.insert('p', 'two'); });
  const v1 = storage.transaction('deferred', (tx) => repos(tx).prompts.byNameVersion('p', 1));
  expect(v1.body).toBe('one'); expect(v1.version).toBe(1);
});
```

- [ ] **Step 2: Run it — expect FAIL** (`listLatest is not a function`).

Run: `npx vitest run tests/storage/repos-prompts.test.ts`

- [ ] **Step 3: Implement.** In `src/storage/repos.ts`, inside the `prompts: { … }` object (after `list()`), add:

```ts
      byNameVersion(name: string, version: number): any | undefined {
        return tx.get('SELECT * FROM prompt_definitions WHERE name=? AND version=?', name, version);
      },
      listLatest(): any[] {
        return tx.all(
          `SELECT p.* FROM prompt_definitions p
           WHERE p.version = (SELECT MAX(v.version) FROM prompt_definitions v WHERE v.name = p.name)
           ORDER BY p.name`,
        );
      },
      versionCount(name: string): number {
        return (tx.get<{ c: number }>('SELECT COUNT(*) c FROM prompt_definitions WHERE name=?', name)?.c) ?? 0;
      },
      whereUsed(name: string): { defs: number; runs: number } {
        // defs: active workflow defs whose JSON has a step with this prompt_id
        const defRows = tx.all<{ definition_json: string }>("SELECT definition_json FROM workflow_definitions WHERE status='active'");
        let defs = 0;
        for (const d of defRows) {
          try {
            const steps = (JSON.parse(d.definition_json).steps ?? []) as Array<{ prompt_id?: string }>;
            if (steps.some((s) => s.prompt_id === name)) defs += 1;
          } catch { /* skip malformed */ }
        }
        const runs = (tx.get<{ c: number }>(
          'SELECT COUNT(*) c FROM workflow_step_runs sr JOIN prompt_definitions pd ON pd.id = sr.prompt_definition_id WHERE pd.name=?',
          name,
        )?.c) ?? 0;
        return { defs, runs };
      },
```

- [ ] **Step 4: Run it — expect PASS.** `npx vitest run tests/storage/repos-prompts.test.ts`

- [ ] **Step 5: Commit.**

```bash
git add src/storage/repos.ts tests/storage/repos-prompts.test.ts
git commit -m "feat(core): prompt repo queries — byNameVersion, listLatest, whereUsed"
```

---

### Task 3: `create` rejects duplicate names + name validation

**Files:**
- Modify: `src/usecases/prompt.ts`
- Test: `tests/usecases/prompt.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test.** Add to `tests/usecases/prompt.test.ts` (same harness as `artifact.test.ts` — copy its imports + beforeEach):

```ts
it('create rejects a name that already exists', () => {
  prompt.create(ctx(), { name: 'dup', body: 'one' });
  expect(() => prompt.create(ctx(), { name: 'dup', body: 'two' })).toThrow(/already exists/i);
});

it('create rejects an invalid name', () => {
  expect(() => prompt.create(ctx(), { name: 'bad name/slash', body: 'x' })).toThrow(/invalid prompt name/i);
});
```

(If `tests/usecases/prompt.test.ts` doesn't exist, create it mirroring `tests/usecases/artifact.test.ts`'s setup, importing `* as prompt from '../../src/usecases/prompt.js'`.)

- [ ] **Step 2: Run it — expect FAIL** (second create succeeds; invalid name accepted).

Run: `npx vitest run tests/usecases/prompt.test.ts`

- [ ] **Step 3: Implement.** In `src/usecases/prompt.ts`, add a validator and guard `create`:

```ts
export const PROMPT_NAME_RE = /^[A-Za-z0-9._-]+$/;

function assertValidName(name: string): void {
  if (!PROMPT_NAME_RE.test(name)) {
    throw new ApmError('E_VALIDATION', `invalid prompt name '${name}' (allowed: letters, digits, . _ -)`);
  }
}
```

In `create`, immediately after resolving `body`, before the transaction, add `assertValidName(a.name);` and inside the `'immediate'` transaction, before `r.prompts.insert(...)`:

```ts
    if (r.prompts.byName(a.name)) {
      throw new ApmError('E_CONFLICT', `prompt '${a.name}' already exists — use 'apm prompt revise' to add a version`);
    }
```

- [ ] **Step 4: Run it — expect PASS.** `npx vitest run tests/usecases/prompt.test.ts`

- [ ] **Step 5: Commit.**

```bash
git add src/usecases/prompt.ts tests/usecases/prompt.test.ts
git commit -m "feat(core): prompt create rejects dup names + validates name"
```

---

### Task 4: `revise` (versioned edit) + CLI

**Files:**
- Modify: `src/usecases/prompt.ts`
- Modify: `src/cli/program.ts` (prompt command group)
- Test: `tests/usecases/prompt.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
it('revise creates the next version; show resolves latest', () => {
  prompt.create(ctx(), { name: 'p', body: 'v1' });
  const v2 = prompt.revise(ctx(), { name: 'p', body: 'v2' });
  expect(v2.version).toBe(2);
  expect(prompt.show(ctx(), 'p').body).toBe('v2');
  expect(prompt.show(ctx(), 'p', 1).body).toBe('v1');
});

it('revise rejects an unknown name', () => {
  expect(() => prompt.revise(ctx(), { name: 'nope', body: 'x' })).toThrow(/not found/i);
});
```

- [ ] **Step 2: Run it — expect FAIL** (`revise is not a function`).

Run: `npx vitest run tests/usecases/prompt.test.ts`

- [ ] **Step 3: Implement `revise` + extend `show`.** In `src/usecases/prompt.ts`:

```ts
export interface RevisePromptArgs { name: string; body?: string | null; bodyFile?: string | null; }

export function revise(ctx: Ctx, a: RevisePromptArgs): PromptView {
  let body: string;
  if (a.bodyFile) body = readFileSync(a.bodyFile, 'utf8');
  else if (a.body != null) body = a.body;
  else throw new ApmError('E_VALIDATION', 'body or body-file is required');

  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    if (!r.prompts.byName(a.name)) throw new ApmError('E_NOT_FOUND', `prompt '${a.name}' not found`);
    const id = r.prompts.insert(a.name, body); // auto-increments version per name
    return toView(tx.get<any>('SELECT * FROM prompt_definitions WHERE id=?', id)!);
  });
}
```

Replace `show` to accept an optional version:

```ts
export function show(ctx: Ctx, name: string, version?: number): PromptView {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    const row = version != null ? r.prompts.byNameVersion(name, version) : r.prompts.byName(name);
    if (!row) throw new ApmError('E_NOT_FOUND', `prompt '${name}'${version != null ? ` v${version}` : ''} not found`);
    return toView(row);
  });
}
```

- [ ] **Step 4: Run it — expect PASS.** `npx vitest run tests/usecases/prompt.test.ts`

- [ ] **Step 5: Add CLI commands.** In `src/cli/program.ts`, in the `promptCmd` group, after the `show` command, add:

```ts
  promptCmd
    .command('revise <name>')
    .description('Add a new version of an existing prompt')
    .requiredOption('--body-file <f>', 'path to prompt body file')
    .action(function (this: Command, name: string, o: { bodyFile: string }) {
      process.exitCode = runCommand(buildDeps(), 'prompt revise', (ctx) => ({
        data: prompt.revise(ctx, { name, bodyFile: o.bodyFile }),
      }));
    });
```

Change the `show <name>` action to pass an optional `--version`:

```ts
  promptCmd
    .command('show <name>')
    .description('Show a prompt definition by name')
    .option('--version <n>', 'specific version', (v) => parseInt(v, 10))
    .action(function (this: Command, name: string, o: { version?: number }) {
      process.exitCode = runCommand(buildDeps(), 'prompt show', (ctx) => ({
        data: prompt.show(ctx, name, o.version),
      }));
    });
```

- [ ] **Step 6: Manual smoke.**

Run:
```bash
D=$(mktemp -d); npx tsx src/bin/apm.ts --dir "$D" init >/dev/null
echo "first" > /tmp/p.md; npx tsx src/bin/apm.ts --dir "$D" prompt create --name demo --body-file /tmp/p.md -o json | grep '"version": 1'
echo "second" > /tmp/p.md; npx tsx src/bin/apm.ts --dir "$D" prompt revise demo --body-file /tmp/p.md -o json | grep '"version": 2'
```
Expected: both greps match.

- [ ] **Step 7: Commit.**

```bash
git add src/usecases/prompt.ts src/cli/program.ts tests/usecases/prompt.test.ts
git commit -m "feat(core): apm prompt revise (versioned) + show --version"
```

---

## Phase 2 — Compose + snapshot

### Task 5: Shared grammar module — render body inline + parse

**Files:**
- Create: `src/domain/dispatchGrammar.ts`
- Modify: `src/domain/contract.ts` (re-export + extend `DispatchPayload`)
- Test: `tests/domain/dispatch-grammar.test.ts` (create)

- [ ] **Step 1: Write the failing test.** Create `tests/domain/dispatch-grammar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderDispatchPrompt, parseDispatchPrompt } from '../../src/domain/dispatchGrammar.js';

const payload = {
  work_item: 'WI-1',
  step: { id: 'brainstorm', type: 'agent_prompt' },
  prompt_name: 'brainstorm_feature_v1', prompt_version: 3, prompt_body: 'Explore 2-3 approaches.',
  allowed_action: 'Produce a decision + spec.',
  required_context: [], do_not: ['write implementation code'], when_done: ['apm step complete ...'],
};

it('renders the stored body inline under PROMPT (name@version)', () => {
  const t = renderDispatchPrompt(payload);
  expect(t).toContain('PROMPT (brainstorm_feature_v1@3):');
  expect(t).toContain('Explore 2-3 approaches.');
});

it('parses a rendered contract back into sections + body region', () => {
  const parsed = parseDispatchPrompt(renderDispatchPrompt(payload));
  expect(parsed.work_item).toBe('WI-1');
  expect(parsed.prompt?.name).toBe('brainstorm_feature_v1');
  expect(parsed.prompt?.version).toBe(3);
  expect(parsed.prompt?.body).toContain('Explore 2-3 approaches.');
  expect(parsed.do_not).toContain('write implementation code');
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing).

Run: `npx vitest run tests/domain/dispatch-grammar.test.ts`

- [ ] **Step 3: Create `src/domain/dispatchGrammar.ts`.** Move the existing `renderDispatchPrompt` + `DispatchPayload`/`CaptureRef`/`ContextRef` interfaces here from `contract.ts`, then (a) extend the PROMPT branch to inline the body and (b) add the parser:

```ts
export interface ContextRef { id: string; version: number; title: string; one_line: string; path?: string; alt?: string; }
export interface CaptureRef { name: string; kind: string; route?: string; viewport?: { w: number; h: number }; prompt?: string; }
export interface DispatchPayload {
  work_item: string;
  step: { id: string; type: string };
  prompt_name?: string | null;
  prompt_version?: number | null;
  prompt_body?: string | null;
  allowed_action?: string;
  required_context?: ContextRef[];
  required_captures?: CaptureRef[];
  do_not?: string[];
  when_done?: string[];
}

export function renderDispatchPrompt(d: DispatchPayload): string {
  const lines: string[] = [];
  lines.push('WORK_ITEM:', d.work_item);
  lines.push('', 'CURRENT_STEP:', `${d.step.id} (${d.step.type})`);
  if (d.prompt_name != null) {
    const tag = d.prompt_version != null ? `${d.prompt_name}@${d.prompt_version}` : d.prompt_name;
    lines.push('', `PROMPT (${tag}):`);
    lines.push(d.prompt_body ?? '');
  }
  lines.push('', 'ALLOWED_ACTION:', d.allowed_action ?? '');
  if (Array.isArray(d.required_context) && d.required_context.length > 0) {
    lines.push('', 'REQUIRED_CONTEXT:');
    for (const ctx of d.required_context) {
      if (ctx.path) {
        lines.push(`${ctx.id}@${ctx.version} "${ctx.title}" [image]`);
        lines.push(`  path: ${ctx.path}`);
        if (ctx.alt) lines.push(`  alt:  ${ctx.alt}`);
      } else {
        lines.push(`${ctx.id}@${ctx.version} "${ctx.title}" — ${ctx.one_line}`);
      }
    }
  }
  if (Array.isArray(d.required_captures) && d.required_captures.length > 0) {
    lines.push('', 'REQUIRED_CAPTURES:');
    for (const c of d.required_captures) {
      const parts = [c.name, `kind=${c.kind}`];
      if (c.route) parts.push(`route=${c.route}`);
      if (c.viewport) parts.push(`viewport=${c.viewport.w}x${c.viewport.h}`);
      if (c.prompt) parts.push(`recipe=${c.prompt}`);
      lines.push(parts.join('  '));
    }
  }
  if (Array.isArray(d.do_not) && d.do_not.length > 0) {
    lines.push('', 'DO_NOT:');
    for (const item of d.do_not) lines.push(`- ${item}`);
  }
  if (Array.isArray(d.when_done) && d.when_done.length > 0) {
    lines.push('', 'WHEN_DONE:');
    for (const item of d.when_done) lines.push(item);
  }
  return lines.join('\n');
}

export interface ParsedDispatch {
  work_item: string | null;
  current_step: string | null;
  prompt: { name: string; version: number | null; body: string } | null;
  allowed_action: string | null;
  required_context: string[];
  do_not: string[];
  when_done: string[];
}

const HEADERS = ['WORK_ITEM:', 'CURRENT_STEP:', 'ALLOWED_ACTION:', 'REQUIRED_CONTEXT:', 'REQUIRED_CAPTURES:', 'DO_NOT:', 'WHEN_DONE:'];
const isHeader = (line: string) => HEADERS.includes(line.trim()) || /^PROMPT \(.+\):$/.test(line.trim());

/** Split a rendered contract into sections. The PROMPT header carries name@version;
 *  its body is every line until the next header. Deterministic — same grammar as render. */
export function parseDispatchPrompt(text: string): ParsedDispatch {
  const out: ParsedDispatch = { work_item: null, current_step: null, prompt: null, allowed_action: null, required_context: [], do_not: [], when_done: [] };
  const lines = text.split('\n');
  let section: string | null = null;
  const buf: Record<string, string[]> = {};
  let promptHeader: string | null = null;
  for (const raw of lines) {
    const line = raw;
    if (isHeader(line)) { section = line.trim(); buf[section] = []; if (section.startsWith('PROMPT (')) promptHeader = section; continue; }
    if (section) (buf[section] ||= []).push(line);
  }
  const first = (k: string) => (buf[k]?.find((l) => l.trim() !== '') ?? null);
  out.work_item = first('WORK_ITEM:');
  out.current_step = first('CURRENT_STEP:');
  out.allowed_action = first('ALLOWED_ACTION:');
  out.required_context = (buf['REQUIRED_CONTEXT:'] ?? []).filter((l) => l.trim() !== '');
  out.do_not = (buf['DO_NOT:'] ?? []).filter((l) => l.trim() !== '').map((l) => l.replace(/^- /, ''));
  out.when_done = (buf['WHEN_DONE:'] ?? []).filter((l) => l.trim() !== '');
  if (promptHeader) {
    const m = promptHeader.match(/^PROMPT \((.+?)(?:@(\d+))?\):$/);
    const body = (buf[promptHeader] ?? []).join('\n').replace(/^\n+|\n+$/g, '');
    if (m) out.prompt = { name: m[1]!, version: m[2] ? parseInt(m[2], 10) : null, body };
  }
  return out;
}
```

In `src/domain/contract.ts`, delete the moved declarations and re-export so existing imports keep working:

```ts
export { renderDispatchPrompt, parseDispatchPrompt } from './dispatchGrammar.js';
export type { DispatchPayload, ContextRef, CaptureRef, ParsedDispatch } from './dispatchGrammar.js';
```

- [ ] **Step 4: Run it — expect PASS.** `npx vitest run tests/domain/dispatch-grammar.test.ts`

- [ ] **Step 5: Update the existing render/contract tests' expectation.** Run `npx vitest run tests/domain/contract.test.ts tests/format` — any test asserting the old `PROMPT:\n<name>` shape now expects `PROMPT (<name>@<v>):` + body. Update those assertions to the new grammar (the snapshot now includes the body). Re-run until green.

- [ ] **Step 6: Commit.**

```bash
git add src/domain/dispatchGrammar.ts src/domain/contract.ts tests/domain/dispatch-grammar.test.ts tests/domain/contract.test.ts
git commit -m "feat(core): shared dispatch grammar — inline prompt body + parser"
```

---

### Task 6: Compose + snapshot in `next` (resolve body, pin `prompt_definition_id`)

**Files:**
- Modify: `src/usecases/next.ts`
- Test: `tests/usecases/prompt-seed-and-dispatch.test.ts` (extend the existing dispatch test)

- [ ] **Step 1: Write the failing test.** Add to `tests/usecases/prompt-seed-and-dispatch.test.ts` (the PR #38 test that already seeds prompts + a feature_delivery run):

```ts
it('next --acquire inlines the prompt body and pins prompt_definition_id', () => {
  const { ctx, workItem, agent } = startBrainstormRun(); // existing helper in this file
  const res = nextAction(ctx, { agent, acquire: true }); // existing wrapper
  expect(res.dispatch_prompt).toContain('PROMPT (brainstorm_feature_v1@1):');
  // body of the seeded built-in must be inlined, not just the name
  expect(res.dispatch_prompt).toMatch(/brainstorm|approach/i);
  const row = ctx.storage.transaction('deferred', (tx) =>
    tx.get<any>('SELECT prompt_definition_id, dispatch_prompt FROM workflow_step_runs WHERE id=?', res.stepRunId));
  expect(row.prompt_definition_id).toBeTruthy();
});
```

(Use whatever helper names already exist in that test file; the assertions are the contract.)

- [ ] **Step 2: Run it — expect FAIL** (body not inlined; `prompt_definition_id` null).

Run: `npx vitest run tests/usecases/prompt-seed-and-dispatch.test.ts`

- [ ] **Step 3: Resolve + inline + pin in `next.ts`.** Where `data` (the `DispatchPayload`) is built (around the line `prompt_id: stepDef.prompt_id ?? null,`), replace the `prompt_id` field and resolve the prompt:

```ts
    // Resolve the pinned prompt version + body so the contract carries the full text.
    let promptDefId: string | null = null;
    let promptName: string | null = null;
    let promptVersion: number | null = null;
    let promptBody: string | null = null;
    if (stepDef.prompt_id) {
      const pd = repos(tx).prompts.byName(stepDef.prompt_id);
      if (pd) { promptDefId = pd.id; promptName = pd.name; promptVersion = pd.version; promptBody = pd.body; }
    }
```

In the `data` object literal, replace `prompt_id: stepDef.prompt_id ?? null,` with:

```ts
      prompt_name: promptName,
      prompt_version: promptVersion,
      prompt_body: promptBody,
```

In the `if (args.acquire) { … }` block, after the existing `UPDATE … SET dispatch_prompt=?`, also persist the pin (combine into one UPDATE):

```ts
      const promptText = renderDispatchPrompt(data);
      tx.run('UPDATE workflow_step_runs SET dispatch_prompt=?, prompt_definition_id=? WHERE id=?', promptText, promptDefId, mainPending.id);
```

(Keep the existing `workflow_run.dispatched` event; add `prompt: promptName ? \`${promptName}@${promptVersion}\` : null` to its payload.)

- [ ] **Step 4: Run it — expect PASS.** `npx vitest run tests/usecases/prompt-seed-and-dispatch.test.ts`

- [ ] **Step 5: Full core suite + typecheck.** `npx vitest run && npm run typecheck` — fix any contract/format tests still expecting the old PROMPT shape.

- [ ] **Step 6: Commit.**

```bash
git add src/usecases/next.ts tests/usecases/prompt-seed-and-dispatch.test.ts
git commit -m "feat(core): next composes prompt body + pins prompt_definition_id on dispatch"
```

---

### Task 7: Per-work-item next-prompt preview (read-only composer)

**Files:**
- Create: `src/usecases/workPrompt.ts`
- Modify: `src/usecases/next.ts` (export a reusable `buildDispatch`) — see note
- Test: `tests/usecases/work-prompt.test.ts` (create)

> **Cohesion requirement:** the preview MUST produce the same text as a real dispatch. Extract the payload-building (the `requiredContext` computation + `data` literal) from `next.ts` into an exported pure function `buildDispatch(tx, { workItem, run, stepDef }): DispatchPayload` and call it from both `next` and here. If a full extraction is too invasive in one task, the minimum is: `nextPromptPreview` reuses the **same** prompt resolution + `renderDispatchPrompt` as Task 6, and a test asserts byte-equality against a real preview-mode `next` for the same item.

- [ ] **Step 1: Write the failing test.** Create `tests/usecases/work-prompt.test.ts`:

```ts
// setup mirrors prompt-seed-and-dispatch.test.ts: init, seed, create a feature work item,
// attach feature_delivery, so the current pending step is `brainstorm` (agent_prompt).
it('nextPromptPreview composes the upcoming prompt without mutating', () => {
  const { ctx, workItem } = startBrainstormRun();
  const preview = workPrompt.nextPromptPreview(ctx, workItem);
  expect(preview.state).toBe('pre-run');
  expect(preview.prompt_name).toBe('brainstorm_feature_v1');
  expect(preview.composed).toContain('PROMPT (brainstorm_feature_v1@1):');
  // no dispatch persisted
  const dp = ctx.storage.transaction('deferred', (tx) => tx.get<any>('SELECT dispatch_prompt FROM workflow_step_runs WHERE step_id=? AND prompt_definition_id IS NOT NULL', 'brainstorm'));
  expect(dp).toBeUndefined();
});

it('returns a no-prompt state when the current step is not agent_prompt', () => {
  const { ctx, workItem } = startReviewGateRun(); // current step = review_gate
  expect(workPrompt.nextPromptPreview(ctx, workItem).state).toBe('no-prompt');
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing).

Run: `npx vitest run tests/usecases/work-prompt.test.ts`

- [ ] **Step 3: Implement `src/usecases/workPrompt.ts`.**

```ts
import type { Ctx } from '../cli/run.js';
import { repos } from '../storage/repos.js';
import { renderDispatchPrompt } from '../domain/dispatchGrammar.js';
import { buildDispatchPayload } from './next.js'; // exported in Step 4

export type NextPromptState = 'pre-run' | 'no-prompt' | 'no-workflow';
export interface NextPromptView {
  state: NextPromptState;
  step_id: string | null;
  prompt_name: string | null;
  prompt_version: number | null;
  composed: string | null;
}

export function nextPromptPreview(ctx: Ctx, workItemId: string): NextPromptView {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    const run = r.workflowRuns.activeForWorkItem(workItemId) ?? r.workflowRuns.listForWorkItem(workItemId).at(-1);
    if (!run) return { state: 'no-workflow', step_id: null, prompt_name: null, prompt_version: null, composed: null };
    const def = JSON.parse(r.workflowDefinitions.byId(run.workflow_definition_id).definition_json);
    const pending = r.stepRuns.mainPending(run.id);
    const stepDef = pending ? def.steps.find((s: any) => s.id === pending.step_id) : null;
    if (!stepDef || stepDef.type !== 'agent_prompt' || !stepDef.prompt_id) {
      return { state: 'no-prompt', step_id: stepDef?.id ?? null, prompt_name: null, prompt_version: null, composed: null };
    }
    const pd = r.prompts.byName(stepDef.prompt_id);
    const payload = buildDispatchPayload(tx, { workItem: workItemId, run, stepDef });
    payload.prompt_name = pd?.name ?? stepDef.prompt_id;
    payload.prompt_version = pd?.version ?? null;
    payload.prompt_body = pd?.body ?? '';
    return { state: 'pre-run', step_id: stepDef.id, prompt_name: payload.prompt_name, prompt_version: payload.prompt_version, composed: renderDispatchPrompt(payload) };
  });
}
```

> **Repo methods used (verified to exist in `repos.ts`):** `workflowRuns.activeForWorkItem(wi)`, `workflowRuns.listForWorkItem(wi)` (ordered by id → `.at(-1)` is latest), `workflowRuns.byId`, `stepRuns.mainPending(runId)`, `stepRuns.listForRun(runId)`. Resolve the def via the `workflowDefinitions` repo getter (confirm the exact name during impl — `next.ts` already loads the def for a run) + `JSON.parse(definition_json).steps`. No new repo helpers required.

- [ ] **Step 4: Export `buildDispatchPayload` from `next.ts`.** Refactor the inline payload construction (the `requiredContext` computation + the `data` object minus prompt fields) into:

```ts
export function buildDispatchPayload(tx: Tx, p: { workItem: string; run: any; stepDef: StepDef }): DispatchPayload {
  // ...moved requiredContext computation + the contract via buildContract...
  return data; // without prompt_* resolved; caller fills prompt_name/version/body
}
```

Then `next`'s own dispatch path calls `buildDispatchPayload(...)` and fills the prompt fields (Task 6), guaranteeing preview === dispatch.

- [ ] **Step 5: Run it — expect PASS.** `npx vitest run tests/usecases/work-prompt.test.ts`

- [ ] **Step 6: Byte-equality guard.** Add a test asserting `nextPromptPreview(...).composed === <text from next in preview mode for the same item>` (reuse the `next` preview path). Run it green.

- [ ] **Step 7: Commit.**

```bash
git add src/usecases/workPrompt.ts src/usecases/next.ts src/storage/repos.ts tests/usecases/work-prompt.test.ts
git commit -m "feat(core): per-work-item next-prompt preview via shared composer"
```

---

## Phase 3 — Views, types, API

### Task 8: View types + mappers (StepRunView field, prompt views)

**Files:**
- Modify: `src/domain/entities.ts`
- Modify: `src/workflows/prompts.ts` (export `BUILTIN_PROMPT_NAMES`)
- Test: `tests/domain/entities-prompt.test.ts` (create)

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest';
import { toStepRunView, toPromptSummaryView } from '../../src/domain/entities.js';

it('toStepRunView carries prompt_definition_id', () => {
  const v = toStepRunView({ id: 'SR-1', workflow_run_id: 'WR-1', step_id: 's', status: 'completed', review_round: 1, prompt_definition_id: 'PD-3' });
  expect(v.prompt_definition_id).toBe('PD-3');
});

it('toPromptSummaryView derives builtin + a one-line summary from the body', () => {
  const v = toPromptSummaryView(
    { id: 'PD-9', name: 'brainstorm_feature_v1', version: 2, body: 'Explore 2-3 approaches.\nMore detail.', created_at: '2026-06-01T00:00:00Z' },
    { versionCount: 2, defs: 1, runs: 14 },
  );
  expect(v).toMatchObject({ name: 'brainstorm_feature_v1', latest_version: 2, version_count: 2, builtin: true, where_defs: 1, where_runs: 14 });
  expect(v.summary).toBe('Explore 2-3 approaches.');
});
```

- [ ] **Step 2: Run it — expect FAIL.**

Run: `npx vitest run tests/domain/entities-prompt.test.ts`

- [ ] **Step 3: Implement.** In `src/workflows/prompts.ts`, add `export const BUILTIN_PROMPT_NAMES = new Set(BUILTIN_PROMPTS.map((p) => p.name));`.

In `src/domain/entities.ts`: add to `toStepRunView`'s returned object `prompt_definition_id: row.prompt_definition_id ?? null,` and to the `StepRunView` interface `prompt_definition_id: string | null;`. Then add:

```ts
import { BUILTIN_PROMPT_NAMES } from '../workflows/prompts.js';

export interface PromptSummaryView {
  name: string; latest_version: number; version_count: number;
  builtin: boolean; summary: string; updated_at: string;
  where_defs: number; where_runs: number;
}
export function toPromptSummaryView(row: any, extra: { versionCount: number; defs: number; runs: number }): PromptSummaryView {
  const firstLine = String(row.body ?? '').split('\n').map((l: string) => l.trim()).find((l: string) => l !== '') ?? '';
  return {
    name: row.name, latest_version: row.version, version_count: extra.versionCount,
    builtin: BUILTIN_PROMPT_NAMES.has(row.name), summary: firstLine.slice(0, 140),
    updated_at: row.created_at, where_defs: extra.defs, where_runs: extra.runs,
  };
}

export interface PromptVersionView { version: number; body: string; created_at: string; }
export interface PromptDetailView extends PromptSummaryView { versions: PromptVersionView[]; }
export function toPromptDetailView(latestRow: any, versions: any[], extra: { defs: number; runs: number }): PromptDetailView {
  return {
    ...toPromptSummaryView(latestRow, { versionCount: versions.length, defs: extra.defs, runs: extra.runs }),
    versions: versions.map((r) => ({ version: r.version, body: r.body, created_at: r.created_at })),
  };
}
```

- [ ] **Step 4: Run it — expect PASS.** `npx vitest run tests/domain/entities-prompt.test.ts`

- [ ] **Step 5: Commit.**

```bash
git add src/domain/entities.ts src/workflows/prompts.ts tests/domain/entities-prompt.test.ts
git commit -m "feat(core): prompt summary/detail views + StepRunView prompt_definition_id"
```

---

### Task 9: `@apm/types` schemas

**Files:**
- Modify: `packages/types/src/views.ts`
- Test: build + the contract test (Task 11) covers runtime

- [ ] **Step 1: Add schemas.** In `packages/types/src/views.ts`:

```ts
export const PromptSummaryViewSchema = z.object({
  name: z.string(), latest_version: z.number(), version_count: z.number(),
  builtin: z.boolean(), summary: z.string(), updated_at: z.string(),
  where_defs: z.number(), where_runs: z.number(),
}).strict();
export type PromptSummaryView = z.infer<typeof PromptSummaryViewSchema>;

export const PromptVersionViewSchema = z.object({ version: z.number(), body: z.string(), created_at: z.string() }).strict();
export const PromptDetailViewSchema = PromptSummaryViewSchema.extend({ versions: z.array(PromptVersionViewSchema) }).strict();
export type PromptDetailView = z.infer<typeof PromptDetailViewSchema>;

// (The served panel schemas — StructuredDispatchSchema + PromptPanelViewSchema — are
//  defined in Revision R1 below and replace the flat next-prompt schema. `NextPromptView`
//  remains only as an INTERNAL TS interface in workPrompt.ts, not a served schema.)
```

Add `prompt_definition_id: z.string().nullable(),` to `StepRunViewSchema`. Also add the **R1** + **R2** schemas (`StructuredDispatchSchema`, `PromptPanelViewSchema`, `WhereUsedRowSchema`) in this same task so all `@apm/types` changes land together before the contract test.

- [ ] **Step 2: Build the package.** Run: `npm run build -w @apm/types` (expect clean tsc). If the workspace flag differs, `cd packages/types && npm run build`.

- [ ] **Step 3: Commit.**

```bash
git add packages/types/src/views.ts
git commit -m "feat(types): prompt summary/detail/next-prompt schemas + StepRunView field"
```

---

### Task 10: Prompt usecases for the API (`listLatest`, `detail`)

**Files:**
- Modify: `src/usecases/prompt.ts`
- Test: `tests/usecases/prompt.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
it('listSummaries returns latest-per-name with where-used counts', () => {
  prompt.create(ctx(), { name: 'a', body: 'A one\nA two' });
  prompt.revise(ctx(), { name: 'a', body: 'A three' });
  const rows = prompt.listSummaries(ctx());
  const a = rows.find((x) => x.name === 'a')!;
  expect(a).toMatchObject({ latest_version: 2, version_count: 2, summary: 'A three' });
});

it('detail returns versions newest-first', () => {
  prompt.create(ctx(), { name: 'a', body: 'v1' });
  prompt.revise(ctx(), { name: 'a', body: 'v2' });
  const d = prompt.detail(ctx(), 'a');
  expect(d.versions.map((v) => v.version)).toEqual([2, 1]);
});
```

- [ ] **Step 2: Run it — expect FAIL.**

Run: `npx vitest run tests/usecases/prompt.test.ts`

- [ ] **Step 3: Implement.** In `src/usecases/prompt.ts`:

```ts
import { toPromptSummaryView, toPromptDetailView, type PromptSummaryView, type PromptDetailView } from '../domain/entities.js';

export function listSummaries(ctx: Ctx): PromptSummaryView[] {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    return r.prompts.listLatest().map((row: any) => {
      const wu = r.prompts.whereUsed(row.name);
      return toPromptSummaryView(row, { versionCount: r.prompts.versionCount(row.name), defs: wu.defs, runs: wu.runs });
    });
  });
}

export function detail(ctx: Ctx, name: string): PromptDetailView {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    const latest = r.prompts.byName(name);
    if (!latest) throw new ApmError('E_NOT_FOUND', `prompt '${name}' not found`);
    const versions = tx.all<any>('SELECT * FROM prompt_definitions WHERE name=? ORDER BY version DESC', name);
    const wu = r.prompts.whereUsed(name);
    return toPromptDetailView(latest, versions, { defs: wu.defs, runs: wu.runs });
  });
}
```

- [ ] **Step 4: Run it — expect PASS.** `npx vitest run tests/usecases/prompt.test.ts`

- [ ] **Step 5: Commit.**

```bash
git add src/usecases/prompt.ts tests/usecases/prompt.test.ts
git commit -m "feat(core): prompt listSummaries + detail usecases for the API"
```

---

### Task 11: Serve routes — prompts list/detail/version

**Files:**
- Modify: `src/server/serve.ts`
- Test: `tests/contract/serve-contract.test.ts`

- [ ] **Step 1: Write the failing contract test.** In `tests/contract/serve-contract.test.ts`, import the new schemas and add (the fixture already seeds at least one prompt via the built-ins; if not, create one in the test setup):

```ts
it('/api/prompts (array of summaries)', () => check('/api/prompts', z.array(PromptSummaryViewSchema)));
it('/api/prompts/:name (detail)', () => check('/api/prompts/brainstorm_feature_v1', PromptDetailViewSchema));
it('/api/prompts/:name/versions/:v', () => check('/api/prompts/brainstorm_feature_v1/versions/1', PromptVersionViewSchema));
```

- [ ] **Step 2: Build types + run — expect FAIL** (404 / unknown route).

Run: `npm run build -w @apm/types && npx vitest run tests/contract/serve-contract.test.ts`

- [ ] **Step 3: Add routes.** In `src/server/serve.ts`, import `* as prompt from '../usecases/prompt.js'`, and add to the routes array (place the static `/api/prompts` BEFORE `/api/prompts/:name`):

```ts
  { method: 'GET', pattern: '/api/prompts', run: ({ ctx }) => prompt.listSummaries(ctx) },
  { method: 'GET', pattern: '/api/prompts/:name', run: ({ ctx, params }) => prompt.detail(ctx, params.name) },
  { method: 'GET', pattern: '/api/prompts/:name/versions/:v', run: ({ ctx, params }) => {
      const v = parseInt(params.v, 10);
      const p = prompt.show(ctx, params.name, v);
      return { version: p.version, body: p.body, created_at: p.created_at };
    } },
```

- [ ] **Step 4: Run it — expect PASS.** `npx vitest run tests/contract/serve-contract.test.ts`

- [ ] **Step 5: Commit.**

```bash
git add src/server/serve.ts tests/contract/serve-contract.test.ts
git commit -m "feat(serve): GET /api/prompts, /:name, /:name/versions/:v"
```

---

### Task 12: Serve route — `/api/work/:id/next-prompt`

**Files:**
- Modify: `src/server/serve.ts`
- Test: `tests/contract/serve-contract.test.ts`

- [ ] **Step 1: Write the failing test.** In the contract test (the fixture work item `wiId` has a workflow attached with a pending `agent_prompt` brainstorm step — ensure the setup attaches `feature_delivery`):

```ts
it('/api/work/:id/prompt-panel (structured panel)', () => check(`/api/work/${wiId}/prompt-panel`, PromptPanelViewSchema));
```
(Per R1 — the route is `prompt-panel` returning `PromptPanelView`, not the flat `next-prompt`.)

- [ ] **Step 2: Run — expect FAIL** (404).

Run: `npx vitest run tests/contract/serve-contract.test.ts`

- [ ] **Step 3: Add the route.** Import `* as workPrompt from '../usecases/workPrompt.js'` and add:

```ts
  { method: 'GET', pattern: '/api/work/:id/prompt-panel', run: ({ ctx, params }) => workPrompt.promptPanel(ctx, params.id) },
```

- [ ] **Step 4: Run it — expect PASS.** `npx vitest run tests/contract/serve-contract.test.ts`

- [ ] **Step 5: Full suite + typecheck.** `npx vitest run && npm run typecheck` — all green.

- [ ] **Step 6: Commit.**

```bash
git add src/server/serve.ts tests/contract/serve-contract.test.ts
git commit -m "feat(serve): GET /api/work/:id/next-prompt preview"
```

---

## Phase 4 — Docs

### Task 13: Document the contract-shape change

**Files:**
- Modify: `docs/CLI Command Specification.md` (Agent Prompt Contract section)
- Modify: `CLAUDE.md` (command surface line for `prompt`)

- [ ] **Step 1:** In `docs/CLI Command Specification.md`, update the Agent Prompt Contract example so the `PROMPT` block reads `PROMPT (name@version):` followed by the inlined body (not just the name), and add a sentence: "On dispatch the resolved stored prompt body is inlined and the exact `prompt_definitions` row is pinned via `workflow_step_runs.prompt_definition_id`; the verbatim composed text is stored in `dispatch_prompt`."

- [ ] **Step 2:** In `CLAUDE.md`, extend the Prompts line: `apm prompt create … · prompt revise <name> --body-file <f> · prompt show <name> [--version N] · prompt list`.

- [ ] **Step 3: Commit.**

```bash
git add "docs/CLI Command Specification.md" CLAUDE.md
git commit -m "docs(core): document inlined prompt body + prompt_definition_id pin"
```

---

## Plan A self-review

- **Spec coverage:** §5.1 (FK migration → T1), §5.1a (render+parse → T5), §5.2 (compose/snapshot/shared composer → T6/T7), §5.4 (CLI create-reject/revise/show-version/name-validation → T3/T4), §5.5 (listLatest/byNameVersion/whereUsed → T2), §5.6 (StepRunView field + endpoints + next-prompt → T8–T12), §5.7 (provenance via versions → T8/T10), §H2 (contract-shape docs → T13). Covered.
- **Deferred to Plan B (viewer):** all of §6. Out of scope here by design.
- **Known integration notes:** the `workflowRuns.*` helper names in T7 (`latestForWorkItem`, `currentPendingStepDef`) must be reconciled with the actual `repos.ts` workflow-run API during implementation — if absent, add them in T7 (called out in the task). The `next.ts` helper names (`startBrainstormRun`, `nextAction`) in tests refer to whatever the existing `prompt-seed-and-dispatch.test.ts` provides.
- **`@apm/types` rebuild:** T9/T11 explicitly rebuild before the contract test (the skew that bit us before).

---

## Revision R1 — structured prompt-panel endpoint (supersedes T12's flat `next-prompt`)

The viewer must render the **Layered** view (scaffold sections + body) for pre-run, active, **and** completed states. Parsing the snapshot text in the viewer would duplicate the grammar. Instead the **server assembles a structured panel** (composer for pre-run, `parseDispatchPrompt` for active/completed snapshots) so the viewer renders from structure and never parses. This matches the hi-fi mock's `dispatch` + `timeline[]` shape.

**T9 addition — schemas** (`packages/types/src/views.ts`):

```ts
export const StructuredDispatchSchema = z.object({
  step_id: z.string(), step_type: z.string(),
  status: z.enum(['preview', 'pending', 'running', 'completed', 'failed', 'skipped']),
  prompt_name: z.string().nullable(), prompt_version: z.number().nullable(), latest_version: z.number().nullable(),
  body: z.string().nullable(),
  scaffold: z.object({
    allowed_action: z.string().nullable(),
    required_context: z.array(z.string()), do_not: z.array(z.string()), when_done: z.array(z.string()),
  }),
  raw: z.string(), at: z.string().nullable(),
}).strict();
export type StructuredDispatch = z.infer<typeof StructuredDispatchSchema>;

export const PromptPanelViewSchema = z.object({
  state: z.enum(['pre-run', 'active', 'completed', 'blocked', 'no-prompt', 'no-workflow']),
  headline: StructuredDispatchSchema.nullable(),
  timeline: z.array(StructuredDispatchSchema),
  provenance: z.object({ name: z.string(), version: z.number(), latest: z.number() }).nullable(),
}).strict();
```

(`NextPromptViewSchema` from T9 is dropped — `PromptPanelView` subsumes it.)

**T7 addition — assembly usecase** (`src/usecases/workPrompt.ts`): add `promptPanel(ctx, workItemId): PromptPanelView`. Algorithm (single `deferred` txn):
1. Resolve the primary run (active run, else latest). None → `{ state:'no-workflow', headline:null, timeline:[], provenance:null }`.
2. Build the **timeline**: for each `agent_prompt` step run of that run in step order, map to a `StructuredDispatch` — parse its `dispatch_prompt` via `parseDispatchPrompt` for `scaffold`+`body`; `prompt_name/version` from the joined `prompt_definitions` row (via `prompt_definition_id`); `latest_version` from `prompts.byName(name).version`; `raw` = the stored `dispatch_prompt`; `status`/`at` from the step run.
3. Determine **state** + **headline** in this **precedence**:
   a. a `running` agent_prompt step exists → `active`, headline = that running dispatch;
   b. else the run is blocked at a human gate → `blocked`, headline = the **last** dispatched agent_prompt (banner points to it);
   c. else there is a **pending** agent_prompt step not yet dispatched → `pre-run`, headline = `nextPromptPreview` composed into a `StructuredDispatch` (status `preview`, `at:null`, parse its composed text for scaffold);
   d. else at least one agent_prompt step was dispatched and all are done → `completed`, headline = the **first / kickoff** dispatch (spec: "Started with …" = the prompt that *started* the item — NOT the last);
   e. else current step isn't agent_prompt and none pending → `no-prompt`.
   The `timeline` always lists every dispatch in run order regardless of which one is the headline.
4. **provenance** = headline's `{ name, version, latest }` or null.

Helper to map composed/snapshot text → `StructuredDispatch`:

```ts
import { parseDispatchPrompt } from '../domain/dispatchGrammar.js';

function toStructured(args: {
  stepId: string; stepType: string; status: string; at: string | null;
  raw: string; promptName: string | null; promptVersion: number | null; latestVersion: number | null;
}): StructuredDispatch {
  const p = parseDispatchPrompt(args.raw);
  return {
    step_id: args.stepId, step_type: args.stepType, status: args.status as any, at: args.at,
    prompt_name: args.promptName ?? p.prompt?.name ?? null,
    prompt_version: args.promptVersion ?? p.prompt?.version ?? null,
    latest_version: args.latestVersion,
    body: p.prompt?.body ?? null,
    scaffold: { allowed_action: p.allowed_action, required_context: p.required_context, do_not: p.do_not, when_done: p.when_done },
    raw: args.raw, at: args.at,
  };
}
```

Test (`tests/usecases/work-prompt.test.ts`): completed run → `state:'completed'`, `timeline.length === <#agent_prompt dispatches>`, `headline.scaffold.do_not` non-empty, `headline.raw === <stored dispatch_prompt>`; pre-run → `state:'pre-run'`, `headline.status === 'preview'`.

**T12 change — route** (`src/server/serve.ts`): replace the `next-prompt` route with:

```ts
  { method: 'GET', pattern: '/api/work/:id/prompt-panel', run: ({ ctx, params }) => workPrompt.promptPanel(ctx, params.id) },
```

Contract test asserts `PromptPanelViewSchema`. The Viewer's **panel (Surface 1)** consumes this; the **step popover (Surface 4)** reuses the matching `timeline[]` entry (by `step_id`) — no separate per-step endpoint.

---

## Revision R2 — where-used drill-down endpoint (detail page needs paginated run rows)

`detail` (T10) returns where-used **counts** only; the Prompt detail page (Surface 3) must drill into the actual dispatched runs, **paginated** (a popular built-in has 120+). Add:

**Repo** (`repos.ts`, `prompts`): 
```ts
      whereUsedRuns(name: string, limit: number, offset: number): { rows: any[]; total: number } {
        const total = (tx.get<{ c: number }>(
          'SELECT COUNT(*) c FROM workflow_step_runs sr JOIN prompt_definitions pd ON pd.id=sr.prompt_definition_id WHERE pd.name=?', name)?.c) ?? 0;
        const rows = tx.all<any>(
          `SELECT sr.workflow_run_id AS run, wr.work_item_id AS work_item, sr.status, sr.started_at AS at, pd.version
           FROM workflow_step_runs sr
           JOIN prompt_definitions pd ON pd.id = sr.prompt_definition_id
           JOIN workflow_runs wr ON wr.id = sr.workflow_run_id
           WHERE pd.name=? ORDER BY sr.started_at DESC LIMIT ? OFFSET ?`, name, limit, offset);
        return { rows, total };
      },
```
**Usecase** (`prompt.ts`): `usage(ctx, name, limit=20, offset=0)` → `{ items: rows.map(r => ({ run:r.run, work_item:r.work_item, version:r.version, status:r.status, at:r.at })), page:{ total, limit, offset, has_more: offset+rows.length<total } }`.
**Types**: `WhereUsedRowSchema = z.object({ run:z.string(), work_item:z.string(), version:z.number(), status:z.string(), at:z.string().nullable() }).strict()`; serve with `pageSchema(WhereUsedRowSchema)`.
**Route**: `{ method:'GET', pattern:'/api/prompts/:name/usage', run:({ctx,params,query}) => prompt.usage(ctx, params.name, num(query,'limit'), num(query,'offset')) }`.
**Contract test**: `check('/api/prompts/brainstorm_feature_v1/usage', pageSchema(WhereUsedRowSchema))`.

---

## Next: Plan B (viewer)
After Plan A's endpoints are green, Plan B will: (1) adopt the design-system CSS (`prompts.css` + shared DS primitives) as the styling substrate, (2) translate `surface_{panel,library,detail,popover}.jsx` + `parts.jsx` into viewer React components reusing the DS class vocabulary, (3) add the `Prompts` nav + routes, (4) wire to the Plan A endpoints, (5) parse the snapshot for the Layered view via the shared grammar, with the security posture (plain-text scaffold, sanitized-Markdown body) and loading/empty/error states.
