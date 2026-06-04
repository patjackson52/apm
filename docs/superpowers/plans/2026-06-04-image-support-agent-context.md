# Image Support — Plan 3: Agent Context (image-consume) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent *consume* images as input — when a dispatched step requires an image artifact, `apm next --format agent` surfaces a resolvable filesystem path (+ alt) so a vision-capable runner can `Read` it.

**Architecture:** Extend `ContextRef` with optional image fields (`path`, `alt`, `blob`). In `next.ts`, when a required-context artifact is `type='image'`, populate them from `toImageView`. In `render.ts`, render image required-context entries with an `[image]` tag and `path:`/`alt:` sub-lines (non-image entries unchanged).

**Tech Stack:** TypeScript, Node, vitest. No new deps, no schema change.

**Spec:** `docs/superpowers/specs/2026-06-04-image-support-design.md` §8 (Agent Access). Built on merged Plan 1 (`IMG-` artifacts, `toImageView`, `blobRelPath`) and Plan 2 (this branch is stacked on `image-plan2-capture-gates`).

**Scope:** the **consume** side of §8 — `REQUIRED_CONTEXT` image enrichment. The **emit** side (`REQUIRED_CAPTURES`, `--image-file`) shipped in Plan 2. The `url:` line in the spec example uses `/api/blob/<sha>` which is a **Plan 4** (viewer) route — Plan 3 emits the filesystem `path` (the real handle the spec's "multimodal hand-off" relies on: "the contract yields a real filesystem path; a vision-capable runner `Read`s the image"); the `url:` line is added in Plan 4 once `/api/blob` exists.

**Already satisfied (no code):** `apm image show IMG-7 --format agent` — the `agent` renderer falls back to the full JSON envelope for a non-dispatch payload, which already contains the resolvable handle (`id, path, blob, mime, width, height, alt, capture, version`). No new rendering needed; the handle is present.

**Out of scope:** relation-filtered context selection (a step requiring `artifacts: ['image']` gets the latest image of that type via the existing `currentByTypeForWorkItem`, relation-agnostic — multiple/relation-specific reference images is a future extension); viewer; `url:` line.

---

## File Structure

**Modify:**
- `src/domain/contract.ts` — `ContextRef` gains `path?`, `alt?`, `blob?`.
- `src/usecases/next.ts` — enrich image required-context entries.
- `src/format/render.ts` — render image entries in `REQUIRED_CONTEXT`.
- `CLAUDE.md` — one-line note.

---

## Task 1: `ContextRef` image fields + `next.ts` enrichment

**Files:**
- Modify: `src/domain/contract.ts:3` (ContextRef), `src/usecases/next.ts:203-208` (requiredContext loop)
- Test: `tests/usecases/next-image-context.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/usecases/next-image-context.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as workflow from '../../src/usecases/workflow.js';
import * as image from '../../src/usecases/image.js';
import * as next from '../../src/usecases/next.js';
import { putBlob } from '../../src/storage/blobstore.js';

const clock = fixedClock('2026-06-04T12:00:00.000Z');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let dir: string; let storage: SqliteStorage;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-imgctx-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

const YAML = `
id: ctxwf
version: 1
name: ctxwf
applies_to: [feature]
status: active
steps:
  - id: design
    type: agent_execution
    requires:
      artifacts: [image]
    next: [done]
  - id: done
    type: terminal
`;

describe('image required-context enrichment', () => {
  it('adds path + alt + blob to an image required_context entry', () => {
    workflow.register(ctx(), YAML);
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const img = image.add(ctx(), { workItem: wi.id, kind: 'reference', alt: 'mockup', relation: 'reference', agent: 'claude', blob: putBlob(dir, PNG) });
    workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'ctxwf', agent: 'claude' });

    const r = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any' });
    const entry = r.data.required_context.find((c: any) => c.id === img.id);
    expect(entry).toBeTruthy();
    expect(entry.type).toBe('image');
    expect(entry.path).toBe(img.path);
    expect(entry.alt).toBe('mockup');
    expect(entry.blob).toBe(img.blob);
  });

  it('leaves non-image required_context entries without image fields', () => {
    // a spec artifact has no path/alt/blob
    const NON_IMG = YAML.replace('artifacts: [image]', 'artifacts: [spec]');
    workflow.register(ctx(), NON_IMG.replace('id: ctxwf', 'id: specwf').replace('name: ctxwf', 'name: specwf'));
    const wi = work.create(ctx(), { type: 'feature', title: 'F2', agent: 'claude' });
    // seed a spec artifact via the artifact usecase
    // (import lazily to keep this test focused)
  });
});
```

> The second `it` is a stub illustrating intent; keep only the first assertion-bearing test if seeding a spec artifact adds noise — the non-image path is covered structurally (fields only set when `art.type==='image'`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/next-image-context.test.ts -t "adds path"`
Expected: FAIL — `entry.path` is `undefined`.

- [ ] **Step 3: Implement**

In `src/domain/contract.ts`, extend `ContextRef`:

```typescript
export interface ContextRef { id: string; version: number; type: string; title: string; one_line: string; path?: string; alt?: string; blob?: string; }
```

In `src/usecases/next.ts`, add the import (top of file, with the other domain imports):

```typescript
import { toImageView } from '../domain/entities.js';
```

Replace the requiredContext loop body (currently pushes a flat ref) so image artifacts are enriched:

```typescript
    const requiredContext: ContextRef[] = [];
    for (const artType of stepDef.requires?.artifacts ?? []) {
      const art = r.artifacts.currentByTypeForWorkItem(workItemId, artType);
      if (!art) continue;
      const ref: ContextRef = { id: art.id, version: art.version, type: art.type, title: art.title, one_line: art.title };
      if (art.type === 'image') {
        const v = toImageView(art, workItemId);
        ref.path = v.path;
        ref.blob = v.blob;
        if (v.alt != null) ref.alt = v.alt;
        ref.one_line = v.alt ?? art.title;
      }
      requiredContext.push(ref);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/usecases/next-image-context.test.ts -t "adds path"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/contract.ts src/usecases/next.ts tests/usecases/next-image-context.test.ts
git commit -m "feat(next): enrich image required-context with path/alt/blob"
```

---

## Task 2: Render image entries in `REQUIRED_CONTEXT`

**Files:**
- Modify: `src/format/render.ts` (the `REQUIRED_CONTEXT` loop in `renderAgent`)
- Test: `tests/format/render-image-context.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/format/render-image-context.test.ts
import { describe, it, expect } from 'vitest';
import { render } from '../../src/format/render.js';

const envelope = {
  ok: true,
  data: {
    status: 'dispatched',
    work_item: 'WI-1',
    step: { id: 'design', type: 'agent_execution' },
    allowed_action: 'design from the mockup',
    required_context: [
      { id: 'IMG-7', version: 1, type: 'image', title: 'mockup', one_line: 'mockup', path: '.apm/blobs/ab/deadbeef.png', alt: 'login mockup', blob: 'deadbeef' },
      { id: 'ART-3', version: 2, type: 'spec', title: 'Tech Spec', one_line: 'the spec' },
    ],
    required_captures: [],
    do_not: [],
    when_done: [],
  },
  error: null,
  meta: {},
};

describe('agent format REQUIRED_CONTEXT images', () => {
  it('renders an image entry with [image] tag + path/alt sub-lines, text entry unchanged', () => {
    const out = render('agent', envelope as any);
    expect(out).toContain('IMG-7@1 "mockup" [image]');
    expect(out).toContain('  path: .apm/blobs/ab/deadbeef.png');
    expect(out).toContain('  alt:  login mockup');
    // non-image entry keeps the dash form
    expect(out).toContain('ART-3@2 "Tech Spec" — the spec');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/format/render-image-context.test.ts`
Expected: FAIL — image entry rendered with the old dash form, no `[image]`/`path:` lines.

- [ ] **Step 3: Implement**

In `src/format/render.ts`, replace the `REQUIRED_CONTEXT` loop body:

```typescript
      lines.push('REQUIRED_CONTEXT:');
      for (const ctx of d.required_context) {
        if (ctx.path) {
          lines.push(`${ctx.id}@${ctx.version} "${ctx.title}" [image]`);
          lines.push(`  path: ${ctx.path}`);
          if (ctx.alt) lines.push(`  alt:  ${ctx.alt}`);
        } else {
          lines.push(`${ctx.id}@${ctx.version} "${ctx.title}" — ${ctx.one_line}`);
        }
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/format/render-image-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format/render.ts tests/format/render-image-context.test.ts
git commit -m "feat(format): render image entries in REQUIRED_CONTEXT (path/alt)"
```

---

## Task 3: Docs + final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update docs**

In `CLAUDE.md`, extend the agent-loop / capture-gates note area with a one-liner:

```
- Image context: when a dispatched step `requires.artifacts: [image]`, `apm next --format agent` renders the image under `REQUIRED_CONTEXT` with a `[image]` tag + `path:` (and `alt:`) — a vision-capable runner `Read`s the path directly (APM never proxies bytes into the contract).
```

- [ ] **Step 2: Commit docs**

```bash
git add CLAUDE.md
git commit -m "docs: image required-context in the agent contract"
```

- [ ] **Step 3: Full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS.
> NOTE: if `serve-contract.test.ts` fails about `metadata`/`SearchResultViewSchema`, that's pre-existing local `@apm/types` dist staleness — run `(cd packages/types && npm run build) && cp packages/types/dist/*.js packages/types/dist/*.d.ts /Users/patrick/workspace/apm/packages/types/dist/` then re-run. Not a code defect.

- [ ] **Step 4: Manual smoke (real binary)**

```bash
TMP=$(mktemp -d)
npx tsx src/bin/apm.ts --dir "$TMP" init
cat > "$TMP/wf.yaml" <<'YAML'
id: ctxwf
version: 1
name: ctxwf
applies_to: [feature]
status: active
steps:
  - id: design
    type: agent_execution
    requires:
      artifacts: [image]
    next: [done]
  - id: done
    type: terminal
YAML
npx tsx src/bin/apm.ts --dir "$TMP" workflow register --file "$TMP/wf.yaml"
npx tsx src/bin/apm.ts --dir "$TMP" work create --type feature --title Ctx --agent claude
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' | base64 -d > "$TMP/m.png"
npx tsx src/bin/apm.ts --dir "$TMP" image add --work-item WI-1 --file "$TMP/m.png" --kind reference --alt mockup --relation reference --agent claude
npx tsx src/bin/apm.ts --dir "$TMP" workflow attach WI-1 --workflow ctxwf --agent claude
npx tsx src/bin/apm.ts --dir "$TMP" next --agent claude --format agent
rm -rf "$TMP"
```
Expected: the `next --format agent` output includes a `REQUIRED_CONTEXT:` entry `IMG-1@1 "mockup" [image]` with a `path: .apm/blobs/...` line.

- [ ] **Step 5: Stop for review.**

---

## Self-Review (author checklist — completed)

**Spec coverage (§8 consume side):** `ContextRef` image fields + `next.ts` enrichment (Task 1) + render (Task 2) deliver the `REQUIRED_CONTEXT … [image] … path:/alt:` block. `apm image show --format agent` handle is already met by the JSON fallback (documented, no task). `url:` line + viewer deferred to Plan 4 (labeled). Emit side (REQUIRED_CAPTURES, --image-file) was Plan 2.

**Placeholder scan:** the second `it` in Task 1 is explicitly marked a stub and optional — the assertion-bearing first test fully covers the behavior; drop the stub if it adds noise. No other placeholders.

**Type consistency:** `ContextRef` optional fields (`path?`/`alt?`/`blob?`) set in `next.ts` and read in `render.ts` (`ctx.path` guard) — names match. `toImageView(art, workItemId)` returns `path`/`blob`/`alt` consumed by the enrichment. No new types.
