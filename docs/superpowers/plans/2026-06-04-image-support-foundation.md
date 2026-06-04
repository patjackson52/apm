# Image Support — Plan 1: Foundation + CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make images first-class addressable units (`IMG-N`) backed by a content-addressed blob store, with a full `apm image` CLI for in/out/inspect/embed.

**Architecture:** Images are `type='image'` rows in the existing `artifacts` table (reusing version lineage, work-item linking, events). Bytes live in a content-addressed store at `.apm/blobs/<sha[0:2]>/<sha>.<ext>`, written by a `BlobStore` service *before* the DB transaction so the domain stays pure (IO out of `Storage.transaction`). The image/capture record lives in the previously-unused `artifacts.metadata_json` column.

**Tech Stack:** TypeScript, Node, better-sqlite3, commander, vitest. New dep: `image-size` (pure-JS dimension reader — no native binding).

**Spec:** `docs/superpowers/specs/2026-06-04-image-support-design.md` (sections 3, 4, plus C1/C2/C3/C5, F1/F3, K1/K3, P4).

**Out of scope (follow-on plans):** verification-run evidence docs + capture-gate on steps (Plan 2); `REQUIRED_CONTEXT`/`REQUIRED_CAPTURES` agent-contract fields (Plan 3); viewer serving/zoom/diff + `/api/blob` cache headers (Plan 4). This plan ships a complete, testable CLI on its own; images are already servable via the existing `/api/files?path=.apm/blobs/...` jail.

---

## File Structure

**Create:**
- `src/storage/blobstore.ts` — `putBlob`, `blobRelPath`, `blobAbsPath`, `BlobMeta` (file IO + sha256 + dims; the only new IO unit).
- `src/usecases/image.ts` — `add`, `show`, `list`, `revise`, `find`, `pair` usecases.
- `src/platform/clipboard.ts` — `copyArgs`, `pasteArgs`, `openArgs` (OS command builders) + thin exec wrappers.
- `tests/storage/blobstore.test.ts`, `tests/usecases/image.test.ts`, `tests/cli/image.test.ts`, `tests/platform/clipboard.test.ts`.

**Modify:**
- `src/domain/ids.ts` — add `image: 'IMG'` to `ID_PREFIXES`.
- `src/domain/entities.ts` — add `metadata` to `ArtifactView`/`toArtifactView`; add `ImageView`/`toImageView`.
- `src/storage/schema.sql` — add `blobs` table.
- `src/storage/repos.ts` — extend `artifacts.insert` (metadata + eventType); add `blobs` repo; add `linkedImages`, `imagesByBlob`.
- `src/cli/program.ts` — add `image` command group.
- `src/cli/run.ts` — export `resolveProjectRoot(dir?)` helper.
- `CLAUDE.md` — add `IMG-` to id-prefix list.

---

## Task 1: Plumb `metadata_json` into ArtifactView (C1 — prerequisite)

`metadata_json` exists in schema but `toArtifactView` drops it. Everything image depends on reading it.

**Files:**
- Modify: `src/domain/entities.ts:81-110`
- Test: `tests/domain/entities.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/domain/entities.test.ts
import { describe, it, expect } from 'vitest';
import { toArtifactView } from '../../src/domain/entities.js';

describe('toArtifactView metadata', () => {
  it('parses metadata_json into a metadata object', () => {
    const row = {
      id: 'ART-1', type: 'spec', title: 'T', version: 1, status: 'draft',
      root_artifact_id: 'ART-1', supersedes_artifact_id: null, created_by: 'a',
      created_at: '2026-06-04T00:00:00.000Z', body: null,
      metadata_json: '{"kind":"screenshot","blob":"abc"}',
    };
    const v = toArtifactView(row, 'WI-1');
    expect(v.metadata).toEqual({ kind: 'screenshot', blob: 'abc' });
  });

  it('metadata is null when column is null', () => {
    const row = {
      id: 'ART-2', type: 'spec', title: 'T', version: 1, status: 'draft',
      root_artifact_id: 'ART-2', supersedes_artifact_id: null, created_by: 'a',
      created_at: '2026-06-04T00:00:00.000Z', body: null, metadata_json: null,
    };
    expect(toArtifactView(row).metadata).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/entities.test.ts`
Expected: FAIL — `metadata` is `undefined` (property does not exist).

- [ ] **Step 3: Implement**

In `src/domain/entities.ts`, add to the `ArtifactView` interface (after `work_item`):

```typescript
  // Parsed from metadata_json. null when absent. Holds image/capture records for type='image'.
  metadata: Record<string, unknown> | null;
```

And in `toArtifactView`, add to the returned object (after `work_item: workItem,`):

```typescript
    metadata: row.metadata_json != null ? JSON.parse(row.metadata_json) : null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/entities.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities.ts tests/domain/entities.test.ts
git commit -m "feat(artifacts): plumb metadata_json into ArtifactView"
```

---

## Task 2: `artifacts.insert` accepts metadata + custom event type

**Files:**
- Modify: `src/storage/repos.ts` (artifacts.insert, ~line 176; NewArtifact type)
- Test: `tests/usecases/image.test.ts` (created here, extended later)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/usecases/image.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { fixedClock } from '../../src/domain/clock.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { repos } from '../../src/storage/repos.js';

const clock = fixedClock('2026-06-04T12:00:00.000Z');
let dir: string;
let storage: SqliteStorage;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm-img-'));
  initProject(dir, clock);
  storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('artifacts.insert metadata', () => {
  it('persists metadata and emits the given event type', () => {
    storage.transaction('immediate', (tx) => {
      const r = repos(tx);
      r.agents.ensure('agent:claude');
      const id = r.artifacts.insert(
        { type: 'image', title: 'shot', body: null, createdBy: 'agent:claude', version: 1, metadata: { kind: 'screenshot', blob: 'deadbeef' } },
        'image.created',
      );
      const row: any = r.artifacts.byId(id);
      expect(JSON.parse(row.metadata_json)).toEqual({ kind: 'screenshot', blob: 'deadbeef' });
      const ev: any = tx.get("SELECT event_type FROM events WHERE entity_id=? ORDER BY id DESC LIMIT 1", id);
      expect(ev.event_type).toBe('image.created');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/image.test.ts`
Expected: FAIL — `insert` ignores `metadata` (metadata_json null) / does not accept an event-type arg.

- [ ] **Step 3: Implement**

In `src/storage/repos.ts`, update the `NewArtifact` type (wherever it is declared — top of file) to add:

```typescript
  metadata?: Record<string, unknown>;
```

Replace the `artifacts.insert` method body with:

```typescript
  insert(a: NewArtifact, eventType: string = 'artifact.created'): string {
    const id = tx.allocateId(a.type === 'image' ? 'IMG' : 'ART');
    const rootId = a.rootId ?? id;
    tx.run(
      "INSERT INTO artifacts (id, type, title, version, status, body, metadata_json, root_artifact_id, created_by, created_at, supersedes_artifact_id) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)",
      id, a.type, a.title, a.version, a.body,
      a.metadata != null ? JSON.stringify(a.metadata) : null,
      rootId, a.createdBy, now, a.supersedes ?? null,
    );
    tx.appendEvent({
      actorId: a.createdBy,
      eventType,
      entityType: 'artifact',
      entityId: id,
      payload: { type: a.type, version: a.version },
    });
    return id;
  },
```

> Note: `revise` reuses `insert`; for an image lineage `a.type` is `'image'`, so the `IMG` prefix is applied to new versions automatically. Existing `artifact.ts` calls pass no `eventType`, keeping `artifact.created`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/usecases/image.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite (no regression on existing artifact tests)**

Run: `npm test`
Expected: PASS (existing artifact/CLI tests still green — `ART-` ids unchanged for non-image types).

- [ ] **Step 6: Commit**

```bash
git add src/storage/repos.ts tests/usecases/image.test.ts
git commit -m "feat(artifacts): insert accepts metadata + event type; IMG prefix for images"
```

---

## Task 3: Register the `IMG` id prefix (C2)

**Files:**
- Modify: `src/domain/ids.ts:2-16`
- Test: `tests/domain/ids.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/domain/ids.test.ts
import { describe, it, expect } from 'vitest';
import { ID_PREFIXES, formatId } from '../../src/domain/ids.js';

describe('IMG prefix', () => {
  it('is registered and formats', () => {
    expect(ID_PREFIXES.image).toBe('IMG');
    expect(formatId(ID_PREFIXES.image, 7)).toBe('IMG-7');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/ids.test.ts`
Expected: FAIL — `ID_PREFIXES.image` is `undefined`.

- [ ] **Step 3: Implement**

In `src/domain/ids.ts`, add to the `ID_PREFIXES` object (after `artifact: 'ART',`):

```typescript
  image: 'IMG',
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/domain/ids.test.ts && npm run typecheck`
Expected: PASS; typecheck clean (`'IMG'` now a member of `IdPrefix`, so `allocateId('IMG')` in Task 2 type-checks).

- [ ] **Step 5: Commit**

```bash
git add src/domain/ids.ts tests/domain/ids.test.ts
git commit -m "feat(ids): register IMG id prefix"
```

---

## Task 4: `blobs` table

**Files:**
- Modify: `src/storage/schema.sql` (after the `artifacts` block, ~line 144)
- Test: covered by Task 6 (blobs repo) round-trip.

- [ ] **Step 1: Add the table**

In `src/storage/schema.sql`, after the `work_item_artifacts` table, add:

```sql
CREATE TABLE blobs (
  sha256 TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  ext TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL
);
```

- [ ] **Step 2: Verify schema applies on init**

Run: `node -e "const{SqliteStorage}=require('./dist/storage/sqlite.js')" 2>/dev/null; npx tsx -e "import {mkdtempSync} from 'node:fs'; import {tmpdir} from 'node:os'; import {join} from 'node:path'; import {initProject} from './src/usecases/init.js'; import {fixedClock} from './src/domain/clock.js'; import {SqliteStorage} from './src/storage/sqlite.js'; const d=mkdtempSync(join(tmpdir(),'apm-blob-')); initProject(d, fixedClock('2026-06-04T00:00:00.000Z')); const s=new SqliteStorage(join(d,'.apm','apm.db'), fixedClock('2026-06-04T00:00:00.000Z')); s.transaction('deferred',(tx)=>{ const r=tx.get(\"SELECT name FROM sqlite_master WHERE type='table' AND name='blobs'\"); console.log(r); }); s.close();"`
Expected: prints `{ name: 'blobs' }` (migration runner applies `schema.sql` on init).

- [ ] **Step 3: Commit**

```bash
git add src/storage/schema.sql
git commit -m "feat(storage): add blobs table for content-addressed image bytes"
```

---

## Task 5: `BlobStore` service (sha256 + dims + atomic write) (C3, C5)

**Files:**
- Create: `src/storage/blobstore.ts`
- Test: `tests/storage/blobstore.test.ts`
- Modify: `package.json` (add `image-size`)

- [ ] **Step 1: Install the dimension reader**

Run: `npm install image-size@^1.1.1`
Expected: `image-size` added to `dependencies`.

- [ ] **Step 2: Write the failing test**

```typescript
// tests/storage/blobstore.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { putBlob, blobAbsPath, blobRelPath } from '../../src/storage/blobstore.js';

// 1x1 transparent PNG
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'apm-bs-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('putBlob', () => {
  it('writes content-addressed bytes and returns metadata', () => {
    const m = putBlob(root, PNG);
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.mime).toBe('image/png');
    expect(m.ext).toBe('png');
    expect(m.byte_size).toBe(PNG.length);
    expect(m.width).toBe(1);
    expect(m.height).toBe(1);
    const abs = blobAbsPath(root, m.sha256, m.ext);
    expect(existsSync(abs)).toBe(true);
    expect(readFileSync(abs).equals(PNG)).toBe(true);
    expect(blobRelPath(m.sha256, m.ext)).toBe(`.apm/blobs/${m.sha256.slice(0, 2)}/${m.sha256}.png`);
  });

  it('dedups identical bytes to the same sha + path (idempotent)', () => {
    const a = putBlob(root, PNG);
    const b = putBlob(root, PNG);
    expect(a.sha256).toBe(b.sha256);
  });

  it('rejects non-image bytes', () => {
    expect(() => putBlob(root, Buffer.from('not an image'))).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/storage/blobstore.test.ts`
Expected: FAIL — module `blobstore.ts` does not exist.

- [ ] **Step 4: Implement**

```typescript
// src/storage/blobstore.ts
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from 'image-size';
import { ApmError } from '../domain/errors.js';

export interface BlobMeta {
  sha256: string;
  mime: string;
  ext: string;
  byte_size: number;
  width: number | null;
  height: number | null;
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};
const EXT: Record<string, string> = {
  png: 'png', jpg: 'jpg', jpeg: 'jpg', gif: 'gif', webp: 'webp', svg: 'svg',
};

/** Relative (project-root) path for a blob. Content-addressed; path IS the hash. */
export function blobRelPath(sha256: string, ext: string): string {
  return path.posix.join('.apm', 'blobs', sha256.slice(0, 2), `${sha256}.${ext}`);
}

/** Absolute path for a blob under `projectRoot`. */
export function blobAbsPath(projectRoot: string, sha256: string, ext: string): string {
  return path.join(projectRoot, '.apm', 'blobs', sha256.slice(0, 2), `${sha256}.${ext}`);
}

/**
 * Compute sha256 + image dims and write bytes content-addressed (temp → atomic rename).
 * IO lives here, OUTSIDE any Storage.transaction. Call BEFORE the DB txn that records the row
 * (orphan-on-failure is harmless + dedups; a dangling DB reference would not be). C5: null dims tolerated.
 */
export function putBlob(projectRoot: string, bytes: Buffer): BlobMeta {
  let dim: { width?: number; height?: number; type?: string };
  try {
    dim = imageSize(bytes);
  } catch {
    throw new ApmError('E_VALIDATION', 'unrecognized image bytes');
  }
  const rawType = (dim.type ?? '').toLowerCase();
  const ext = EXT[rawType];
  const mime = MIME[ext];
  if (!ext || !mime) {
    throw new ApmError('E_VALIDATION', `unsupported image type: ${rawType || 'unknown'}`);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const abs = blobAbsPath(projectRoot, sha256, ext);
  if (!fs.existsSync(abs)) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, abs); // atomic on same filesystem
  }
  return {
    sha256, mime, ext, byte_size: bytes.length,
    width: dim.width ?? null, height: dim.height ?? null,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/storage/blobstore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/storage/blobstore.ts tests/storage/blobstore.test.ts package.json package-lock.json
git commit -m "feat(storage): BlobStore service — sha256, dims, atomic content-addressed write"
```

---

## Task 6: `blobs` repo (insert/get) + image query methods

**Files:**
- Modify: `src/storage/repos.ts` (add `blobs` repo object; add `linkedImages`, `imagesByBlob` to `artifacts`)
- Test: `tests/usecases/image.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/usecases/image.test.ts`:

```typescript
import { putBlob } from '../../src/storage/blobstore.js';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('blobs repo + image queries', () => {
  it('inserts a blob idempotently and reads it back', () => {
    const meta = putBlob(dir, PNG);
    storage.transaction('immediate', (tx) => {
      const r = repos(tx);
      r.blobs.insert(meta);
      r.blobs.insert(meta); // OR IGNORE, no throw
      const row: any = r.blobs.byId(meta.sha256);
      expect(row.mime).toBe('image/png');
      expect(row.width).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/image.test.ts -t "blobs repo"`
Expected: FAIL — `r.blobs` is undefined.

- [ ] **Step 3: Implement**

In `src/storage/repos.ts`, add a new top-level repo object alongside `artifacts` (inside the object returned by `repos(tx)`):

```typescript
    blobs: {
      insert(m: { sha256: string; mime: string; ext: string; byte_size: number; width: number | null; height: number | null }) {
        tx.run(
          'INSERT OR IGNORE INTO blobs (sha256, mime, ext, byte_size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          m.sha256, m.mime, m.ext, m.byte_size, m.width, m.height, now,
        );
      },
      byId(sha256: string): any | undefined {
        return tx.get('SELECT * FROM blobs WHERE sha256=?', sha256);
      },
    },
```

Add two methods inside the existing `artifacts:` object:

```typescript
      linkedImages(workItemId: string): string[] {
        return tx.all<{ r: string }>(
          `SELECT wia.root_artifact_id AS r
           FROM work_item_artifacts wia
           JOIN artifacts a ON a.id = wia.root_artifact_id
           WHERE wia.work_item_id=? AND a.type='image'
           ORDER BY r`,
          workItemId,
        ).map((x) => x.r);
      },
      imagesByBlob(sha256: string): any[] {
        return tx.all(
          "SELECT * FROM artifacts WHERE type='image' AND json_extract(metadata_json,'$.blob')=? ORDER BY id",
          sha256,
        );
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/usecases/image.test.ts -t "blobs repo"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/repos.ts tests/usecases/image.test.ts
git commit -m "feat(storage): blobs repo + linkedImages/imagesByBlob queries"
```

---

## Task 7: `ImageView` + `toImageView`

**Files:**
- Modify: `src/domain/entities.ts` (add interface + mapper)
- Test: `tests/domain/entities.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/domain/entities.test.ts`:

```typescript
import { toImageView } from '../../src/domain/entities.js';

describe('toImageView', () => {
  it('maps an image artifact row + metadata to an ImageView with a blob path', () => {
    const row = {
      id: 'IMG-1', type: 'image', title: 'login', version: 1, status: 'draft',
      root_artifact_id: 'IMG-1', supersedes_artifact_id: null, created_by: 'agent:claude',
      created_at: '2026-06-04T00:00:00.000Z', body: 'login screen',
      metadata_json: JSON.stringify({
        kind: 'screenshot', blob: 'a'.repeat(64), mime: 'image/png', ext: 'png',
        width: 1280, height: 800, byte_size: 4242, alt: 'login screen',
        capture: { route: '/login' },
      }),
    };
    const v = toImageView(row, 'WI-1');
    expect(v.id).toBe('IMG-1');
    expect(v.kind).toBe('screenshot');
    expect(v.blob).toBe('a'.repeat(64));
    expect(v.width).toBe(1280);
    expect(v.alt).toBe('login screen');
    expect(v.path).toBe(`.apm/blobs/aa/${'a'.repeat(64)}.png`);
    expect(v.capture).toEqual({ route: '/login' });
    expect(v.work_item).toBe('WI-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/entities.test.ts -t toImageView`
Expected: FAIL — `toImageView` not exported.

- [ ] **Step 3: Implement**

In `src/domain/entities.ts`, add (import `blobRelPath` at top: `import { blobRelPath } from '../storage/blobstore.js';`):

```typescript
export interface ImageView {
  id: string;
  version: number;
  status: ArtifactStatus;
  root: string;
  supersedes: string | null;
  kind: string;
  blob: string;
  mime: string;
  ext: string;
  width: number | null;
  height: number | null;
  byte_size: number;
  alt: string | null;
  capture: Record<string, unknown> | null;
  path: string; // relative blob path; path IS the content hash
  created_by: string | null;
  created_at: string;
  work_item: string | null;
}

/** Map an image artifact row (type='image') + its metadata_json to an ImageView. */
export function toImageView(row: any, workItem: string | null = null): ImageView {
  const m = row.metadata_json != null ? JSON.parse(row.metadata_json) : {};
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    root: row.root_artifact_id,
    supersedes: row.supersedes_artifact_id ?? null,
    kind: m.kind ?? 'screenshot',
    blob: m.blob,
    mime: m.mime,
    ext: m.ext,
    width: m.width ?? null,
    height: m.height ?? null,
    byte_size: m.byte_size ?? 0,
    alt: m.alt ?? null,
    capture: m.capture ?? null,
    path: blobRelPath(m.blob, m.ext),
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    work_item: workItem,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/entities.test.ts -t toImageView`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities.ts tests/domain/entities.test.ts
git commit -m "feat(domain): ImageView + toImageView mapper"
```

---

## Task 8: `image.add` usecase (P4 size cap)

**Files:**
- Create: `src/usecases/image.ts`
- Test: `tests/usecases/image.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/usecases/image.test.ts`:

```typescript
import * as image from '../../src/usecases/image.js';
import * as work from '../../src/usecases/work.js';

describe('image.add', () => {
  it('ingests a blob, creates an IMG artifact, links to the work item', () => {
    const ctx = { storage, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'F', agent: 'agent:claude' });
    const meta = putBlob(dir, PNG);
    const v = image.add(ctx, {
      workItem: wi.id, kind: 'screenshot', alt: 'home', relation: 'evidence',
      agent: 'agent:claude', blob: meta,
    });
    expect(v.id).toBe('IMG-1');
    expect(v.kind).toBe('screenshot');
    expect(v.blob).toBe(meta.sha256);
    expect(v.work_item).toBe(wi.id);

    // linked + listable
    const list = image.list(ctx, { workItem: wi.id });
    expect(list.items.map((i) => i.id)).toContain('IMG-1');

    // image.created event present
    storage.transaction('deferred', (tx) => {
      const ev: any = tx.get("SELECT event_type FROM events WHERE entity_id='IMG-1' AND event_type='image.created'");
      expect(ev).toBeTruthy();
    });
  });

  it('rejects an oversize blob', () => {
    const ctx = { storage, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'F2', agent: 'agent:claude' });
    const meta = { ...putBlob(dir, PNG), byte_size: 999_999_999 };
    expect(() => image.add(ctx, { workItem: wi.id, kind: 'screenshot', agent: 'agent:claude', blob: meta })).toThrow(/too large/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/image.test.ts -t "image.add"`
Expected: FAIL — `src/usecases/image.js` missing.

- [ ] **Step 3: Implement**

```typescript
// src/usecases/image.ts
import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { toImageView, type ImageView, type Page } from '../domain/entities.js';
import type { BlobMeta } from '../storage/blobstore.js';

/** Hard ceiling on a single image (P4). 25 MiB. */
export const MAX_BLOB_BYTES = 25 * 1024 * 1024;

const IMAGE_KINDS = ['screenshot', 'mockup', 'diagram', 'reference', 'bug'] as const;
const RELATIONS = ['evidence', 'reference', 'bug', 'produced'] as const;

export interface AddArgs {
  workItem: string;
  kind: string;
  alt?: string;
  capture?: Record<string, unknown>;
  relation?: string;
  agent: string;
  blob: BlobMeta;
}

export function add(ctx: Ctx, a: AddArgs): ImageView {
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
  return ctx.storage.transaction('immediate', (tx) => {
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
  });
}

export interface ListArgs { workItem: string; limit?: number; offset?: number }

export function list(ctx: Ctx, a: ListArgs): Page<ImageView> {
  const limit = a.limit ?? 50;
  const offset = a.offset ?? 0;
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    if (!r.workItems.byId(a.workItem)) throw new ApmError('E_NOT_FOUND', `work item ${a.workItem} not found`);
    const roots = r.artifacts.linkedImages(a.workItem);
    const rows = roots.map((root) => r.artifacts.currentByRoot(root)).filter(Boolean);
    const paged = rows.slice(offset, offset + limit);
    return {
      items: paged.map((row: any) => toImageView(row, a.workItem)),
      page: { total: rows.length, limit, offset, has_more: offset + paged.length < rows.length },
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/usecases/image.test.ts -t "image.add"`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/usecases/image.ts tests/usecases/image.test.ts
git commit -m "feat(image): add + list usecases (gallery via linkedImages, size cap)"
```

---

## Task 9: `image.show`, `image.revise`, `image.find`, `image.pair`

**Files:**
- Modify: `src/usecases/image.ts`
- Test: `tests/usecases/image.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/usecases/image.test.ts`:

```typescript
describe('image.show/revise/find/pair', () => {
  it('shows by id, revises into a new version, finds by blob, pairs two images', () => {
    const ctx = { storage, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'F', agent: 'agent:claude' });
    const a = image.add(ctx, { workItem: wi.id, kind: 'screenshot', alt: 'v1', agent: 'agent:claude', blob: putBlob(dir, PNG) });

    expect(image.show(ctx, a.id).alt).toBe('v1');

    // revise -> new version, same lineage
    const rev = image.revise(ctx, a.id, { alt: 'v2', agent: 'agent:claude', blob: putBlob(dir, PNG) });
    expect(rev.version).toBe(2);
    expect(rev.root).toBe(a.root);

    // find by blob (PNG bytes shared -> dedup -> both versions reference same sha)
    const found = image.find(ctx, putBlob(dir, PNG).sha256);
    expect(found.length).toBeGreaterThanOrEqual(1);

    // pair: a second image + pair event
    const b = image.add(ctx, { workItem: wi.id, kind: 'screenshot', alt: 'other', agent: 'agent:claude', blob: putBlob(dir, PNG) });
    image.pair(ctx, { a: a.id, b: b.id, kind: 'before-after', agent: 'agent:claude' });
    storage.transaction('deferred', (tx) => {
      const ev: any = tx.get("SELECT payload_json FROM events WHERE event_type='image.paired' ORDER BY id DESC LIMIT 1");
      expect(JSON.parse(ev.payload_json)).toMatchObject({ a: a.id, b: b.id, kind: 'before-after' });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/image.test.ts -t "image.show/revise/find/pair"`
Expected: FAIL — `image.show/revise/find/pair` not exported.

- [ ] **Step 3: Implement**

Append to `src/usecases/image.ts`:

```typescript
export function show(ctx: Ctx, id: string): ImageView {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    const row = r.artifacts.byId(id);
    if (!row || row.type !== 'image') throw new ApmError('E_NOT_FOUND', `image ${id} not found`);
    const link: any = tx.get('SELECT work_item_id FROM work_item_artifacts WHERE root_artifact_id=? LIMIT 1', row.root_artifact_id);
    return toImageView(row, link?.work_item_id ?? null);
  });
}

export interface ReviseArgs { alt?: string; capture?: Record<string, unknown>; agent: string; blob: BlobMeta }

export function revise(ctx: Ctx, id: string, a: ReviseArgs): ImageView {
  if (a.blob.byte_size > MAX_BLOB_BYTES) throw new ApmError('E_VALIDATION', `image too large`);
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(a.agent);
    const old = r.artifacts.byId(id);
    if (!old || old.type !== 'image') throw new ApmError('E_NOT_FOUND', `image ${id} not found`);
    if (old.status === 'superseded') throw new ApmError('E_PRECONDITION', 'cannot revise a superseded image; revise the current version');
    r.blobs.insert(a.blob);
    const prev = old.metadata_json != null ? JSON.parse(old.metadata_json) : {};
    const metadata = {
      kind: prev.kind ?? 'screenshot',
      blob: a.blob.sha256, mime: a.blob.mime, ext: a.blob.ext,
      width: a.blob.width, height: a.blob.height, byte_size: a.blob.byte_size,
      alt: a.alt ?? prev.alt ?? null,
      capture: a.capture ?? prev.capture ?? null,
    };
    const newId = r.artifacts.insert(
      { type: 'image', title: metadata.alt ?? metadata.kind, body: metadata.alt ?? null, createdBy: a.agent, version: old.version + 1, rootId: old.root_artifact_id, supersedes: old.id, metadata },
      'image.created',
    );
    r.artifacts.setSuperseded(id);
    const link: any = tx.get('SELECT work_item_id FROM work_item_artifacts WHERE root_artifact_id=? LIMIT 1', old.root_artifact_id);
    return toImageView(r.artifacts.byId(newId)!, link?.work_item_id ?? null);
  });
}

export function find(ctx: Ctx, sha256: string): ImageView[] {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    return r.artifacts.imagesByBlob(sha256).map((row: any) => toImageView(row, null));
  });
}

export interface PairArgs { a: string; b: string; kind: string; agent: string }

export function pair(ctx: Ctx, p: PairArgs): void {
  ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(p.agent);
    for (const id of [p.a, p.b]) {
      const row = r.artifacts.byId(id);
      if (!row || row.type !== 'image') throw new ApmError('E_NOT_FOUND', `image ${id} not found`);
    }
    tx.appendEvent({
      actorId: p.agent,
      eventType: 'image.paired',
      entityType: 'artifact',
      entityId: p.a,
      payload: { a: p.a, b: p.b, kind: p.kind },
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/usecases/image.test.ts -t "image.show/revise/find/pair"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/usecases/image.ts tests/usecases/image.test.ts
git commit -m "feat(image): show/revise/find/pair usecases"
```

---

## Task 10: `resolveProjectRoot` helper

CLI image commands write/read blob files, so they need the project root (the dir holding `.apm`) outside `runCommand`.

**Files:**
- Modify: `src/cli/run.ts`
- Test: `tests/cli/image.test.ts` (created here)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/cli/image.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { fixedClock } from '../../src/domain/clock.js';
import { resolveProjectRoot } from '../../src/cli/run.js';

const clock = fixedClock('2026-06-04T12:00:00.000Z');
let dir: string;
beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'apm-cli-img-'))); initProject(dir, clock); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('resolveProjectRoot', () => {
  it('returns the dir containing .apm when --dir is explicit', () => {
    expect(resolveProjectRoot(dir)).toBe(dir);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/image.test.ts -t resolveProjectRoot`
Expected: FAIL — `resolveProjectRoot` not exported.

- [ ] **Step 3: Implement**

In `src/cli/run.ts`, add (reusing the existing `findProjectDb` import and `existsSync`/`join`/`resolve`/`dirname`):

```typescript
import { dirname } from 'node:path';

/** The project root (dir holding .apm) for blob IO, mirroring runCommand's db resolution. */
export function resolveProjectRoot(dir?: string): string {
  if (dir != null) {
    const candidate = join(resolve(dir), '.apm', 'apm.db');
    if (!existsSync(candidate)) throw new ApmError('E_NOT_FOUND', 'no APM project found (run `apm init`)');
    return resolve(dir);
  }
  return dirname(dirname(findProjectDb(process.cwd())));
}
```

> If `dirname` is already imported in `run.ts`, do not duplicate the import.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/image.test.ts -t resolveProjectRoot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/run.ts tests/cli/image.test.ts
git commit -m "feat(cli): resolveProjectRoot helper for blob IO"
```

---

## Task 11: `apm image` CLI — add / show / list / revise / find / pair

**Files:**
- Modify: `src/cli/program.ts` (new `image` command group; imports)
- Test: `tests/cli/image.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/cli/image.test.ts`:

```typescript
import { writeFileSync } from 'node:fs';
import { buildProgram } from '../../src/cli/program.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import * as work from '../../src/usecases/work.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function runCli(args: string[]): { out: string; code: number } {
  const lines: string[] = [];
  const program = buildProgram({ clock, out: (s) => lines.push(s), defaultFormat: 'json' });
  program.parse(['--dir', dir, ...args], { from: 'user' });
  const code = (process.exitCode as number) ?? 0;
  process.exitCode = 0;
  return { out: lines.join('\n'), code };
}

describe('apm image CLI', () => {
  it('add -> show -> list round trip', () => {
    const storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
    const wi = work.create({ storage, clock }, { type: 'feature', title: 'F', agent: 'agent:claude' });
    storage.close();
    const png = join(dir, 'shot.png');
    writeFileSync(png, PNG);

    const added = JSON.parse(runCli(['image', 'add', '--work-item', wi.id, '--file', png, '--kind', 'screenshot', '--alt', 'home', '--agent', 'agent:claude']).out);
    expect(added.ok).toBe(true);
    expect(added.data.id).toBe('IMG-1');

    const shown = JSON.parse(runCli(['image', 'show', 'IMG-1']).out);
    expect(shown.data.path).toMatch(/^\.apm\/blobs\//);

    const listed = JSON.parse(runCli(['image', 'list', '--work-item', wi.id]).out);
    expect(listed.data.items.map((i: any) => i.id)).toContain('IMG-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/image.test.ts -t "apm image CLI"`
Expected: FAIL — `image` is not a known command.

- [ ] **Step 3: Implement**

In `src/cli/program.ts`, add imports near the other usecase imports:

```typescript
import * as image from '../usecases/image.js';
import { putBlob } from '../storage/blobstore.js';
import { resolveProjectRoot } from './run.js';
```

(Confirm `readFileSync` is already imported; it is used by the artifact group.)

Add the command group (place near the `artifact` group):

```typescript
const imageCmd = program.command('image').description('image / screenshot operations');

imageCmd
  .command('add')
  .description('Ingest an image and link it to a work item')
  .requiredOption('--work-item <id>', 'work item id')
  .requiredOption('--file <path>', 'path to the image file')
  .option('--kind <k>', 'screenshot|mockup|diagram|reference|bug', 'screenshot')
  .option('--alt <s>', 'alt / caption text')
  .option('--capture-file <f>', 'path to a JSON file of capture metadata')
  .option('--relation <r>', 'evidence|reference|bug|produced', 'evidence')
  .requiredOption('--agent <name>', 'agent name')
  .action(function (this: Command, o: { workItem: string; file: string; kind: string; alt?: string; captureFile?: string; relation: string; agent: string }) {
    const deps = buildDeps();
    const root = resolveProjectRoot(deps.dir);
    const blob = putBlob(root, readFileSync(o.file)); // IO before the txn (C3)
    const capture = o.captureFile ? JSON.parse(readFileSync(o.captureFile, 'utf8')) : undefined;
    process.exitCode = runCommand(deps, 'image add', (ctx) => ({
      data: image.add(ctx, { workItem: o.workItem, kind: o.kind, alt: o.alt, capture, relation: o.relation, agent: o.agent, blob }),
    }));
  });

imageCmd
  .command('show <id>')
  .description('Show an image (metadata + path; never bytes)')
  .action(function (this: Command, id: string) {
    process.exitCode = runCommand(buildDeps(), 'image show', (ctx) => ({ data: image.show(ctx, id) }));
  });

imageCmd
  .command('list')
  .description('List images linked to a work item')
  .requiredOption('--work-item <id>', 'work item id')
  .action(function (this: Command, o: { workItem: string }) {
    process.exitCode = runCommand(buildDeps(), 'image list', (ctx) => ({ data: image.list(ctx, { workItem: o.workItem }) }));
  });

imageCmd
  .command('revise <id>')
  .description('Revise an image (creates a new version in the same lineage)')
  .requiredOption('--file <path>', 'path to the new image file')
  .option('--alt <s>', 'alt / caption text')
  .option('--capture-file <f>', 'path to a JSON file of capture metadata')
  .requiredOption('--agent <name>', 'agent name')
  .action(function (this: Command, id: string, o: { file: string; alt?: string; captureFile?: string; agent: string }) {
    const deps = buildDeps();
    const blob = putBlob(resolveProjectRoot(deps.dir), readFileSync(o.file));
    const capture = o.captureFile ? JSON.parse(readFileSync(o.captureFile, 'utf8')) : undefined;
    process.exitCode = runCommand(deps, 'image revise', (ctx) => ({ data: image.revise(ctx, id, { alt: o.alt, capture, agent: o.agent, blob }) }));
  });

imageCmd
  .command('find')
  .description('Find image(s) referencing a blob hash')
  .requiredOption('--blob <sha256>', 'blob sha256')
  .action(function (this: Command, o: { blob: string }) {
    process.exitCode = runCommand(buildDeps(), 'image find', (ctx) => ({ data: { items: image.find(ctx, o.blob) } }));
  });

imageCmd
  .command('pair <a> <b>')
  .description('Record a before/after (or other) pairing between two images')
  .option('--kind <k>', 'pair kind', 'before-after')
  .requiredOption('--agent <name>', 'agent name')
  .action(function (this: Command, a: string, b: string, o: { kind: string; agent: string }) {
    process.exitCode = runCommand(buildDeps(), 'image pair', (ctx) => {
      image.pair(ctx, { a, b, kind: o.kind, agent: o.agent });
      return { data: { paired: [a, b], kind: o.kind } };
    });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/image.test.ts -t "apm image CLI"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/program.ts tests/cli/image.test.ts
git commit -m "feat(cli): apm image add/show/list/revise/find/pair"
```

---

## Task 12: `apm image save` + `apm image embed` (F3)

**Files:**
- Modify: `src/cli/program.ts` (add `save`, `embed` subcommands)
- Test: `tests/cli/image.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/cli/image.test.ts`:

```typescript
import { readFileSync as rf, existsSync } from 'node:fs';

describe('apm image save + embed', () => {
  it('saves blob bytes to a path and emits embed snippets', () => {
    const storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
    const wi = work.create({ storage, clock }, { type: 'feature', title: 'F', agent: 'agent:claude' });
    storage.close();
    const png = join(dir, 's.png');
    writeFileSync(png, PNG);
    runCli(['image', 'add', '--work-item', wi.id, '--file', png, '--alt', 'home', '--agent', 'agent:claude']);

    const dest = join(dir, 'out.png');
    runCli(['image', 'save', 'IMG-1', '--to', dest]);
    expect(existsSync(dest)).toBe(true);
    expect(rf(dest).equals(PNG)).toBe(true);

    const embed = JSON.parse(runCli(['image', 'embed', 'IMG-1']).out);
    expect(embed.data.markdown).toBe('![home](apm:IMG-1)');
    const resolved = JSON.parse(runCli(['image', 'embed', 'IMG-1', '--resolve']).out);
    expect(resolved.data.markdown).toMatch(/^!\[home\]\(\.apm\/blobs\//);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/image.test.ts -t "save + embed"`
Expected: FAIL — `save`/`embed` unknown.

- [ ] **Step 3: Implement**

Add imports to `src/cli/program.ts`:

```typescript
import { writeFileSync, copyFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
```

(Use the existing `node:fs`/`node:path` import lines if present; only add the missing named members.)

Add subcommands to `imageCmd`:

```typescript
imageCmd
  .command('save <id>')
  .description('Write an image\'s bytes to a file')
  .requiredOption('--to <path>', 'destination path')
  .action(function (this: Command, id: string, o: { to: string }) {
    const deps = buildDeps();
    const root = resolveProjectRoot(deps.dir);
    process.exitCode = runCommand(deps, 'image save', (ctx) => {
      const v = image.show(ctx, id);
      copyFileSync(pathJoin(root, v.path), o.to);
      return { data: { id: v.id, saved_to: o.to } };
    });
  });

imageCmd
  .command('embed <id>')
  .description('Emit a markdown embed snippet (apm:ID, or --resolve for a real path)')
  .option('--resolve', 'emit a real relative blob path for external markdown renderers')
  .action(function (this: Command, id: string, o: { resolve?: boolean }) {
    process.exitCode = runCommand(buildDeps(), 'image embed', (ctx) => {
      const v = image.show(ctx, id);
      const alt = v.alt ?? v.id;
      const target = o.resolve ? v.path : `apm:${v.id}`;
      return { data: { id: v.id, markdown: `![${alt}](${target})` } };
    });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/image.test.ts -t "save + embed"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/program.ts tests/cli/image.test.ts
git commit -m "feat(cli): apm image save + embed (apm:ID and --resolve)"
```

---

## Task 13: Platform clipboard/open adapter (copy / open / clipboard-add)

OS interaction. The **argument builders are unit-tested**; the `exec` call is the only untested seam (kept to one thin line). macOS first-class; other platforms get a clear `E_UNSUPPORTED`.

**Files:**
- Create: `src/platform/clipboard.ts`
- Test: `tests/platform/clipboard.test.ts`
- Modify: `src/cli/program.ts` (add `copy`, `open` subcommands; `--clipboard` on `add`)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/platform/clipboard.test.ts
import { describe, it, expect } from 'vitest';
import { copyImageArgs, openArgs, pasteImageScript } from '../../src/platform/clipboard.js';

describe('clipboard arg builders', () => {
  it('builds a macOS copy-to-clipboard osascript invocation', () => {
    const { cmd, args } = copyImageArgs('darwin', '/tmp/x.png');
    expect(cmd).toBe('osascript');
    expect(args.join(' ')).toContain('set the clipboard to');
    expect(args.join(' ')).toContain('/tmp/x.png');
  });
  it('builds an open invocation per platform', () => {
    expect(openArgs('darwin', '/tmp/x.png').cmd).toBe('open');
    expect(openArgs('linux', '/tmp/x.png').cmd).toBe('xdg-open');
  });
  it('throws E_UNSUPPORTED on an unknown platform', () => {
    expect(() => copyImageArgs('win32', '/tmp/x.png')).toThrow(/unsupported/i);
    expect(() => pasteImageScript('win32')).toThrow(/unsupported/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/platform/clipboard.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// src/platform/clipboard.ts
import { execFileSync } from 'node:child_process';
import { ApmError } from '../domain/errors.js';

export interface Invocation { cmd: string; args: string[] }

/** osascript to PUT an image file onto the macOS clipboard. */
export function copyImageArgs(platform: string, absPath: string): Invocation {
  if (platform !== 'darwin') throw new ApmError('E_UNSUPPORTED', `clipboard copy unsupported on ${platform}`);
  return { cmd: 'osascript', args: ['-e', `set the clipboard to (read (POSIX file "${absPath}") as «class PNGf»)`] };
}

/** Open a file in the OS default viewer. */
export function openArgs(platform: string, absPath: string): Invocation {
  if (platform === 'darwin') return { cmd: 'open', args: [absPath] };
  if (platform === 'linux') return { cmd: 'xdg-open', args: [absPath] };
  throw new ApmError('E_UNSUPPORTED', `open unsupported on ${platform}`);
}

/** osascript that writes the clipboard image to a destination path. Returns the script string. */
export function pasteImageScript(platform: string): string {
  if (platform !== 'darwin') throw new ApmError('E_UNSUPPORTED', `clipboard paste unsupported on ${platform}`);
  return 'set png to the clipboard as «class PNGf»';
}

/** Thin exec seam (not unit-tested). */
export function run(inv: Invocation): void {
  execFileSync(inv.cmd, inv.args, { stdio: 'ignore' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/platform/clipboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `copy` + `open` into the CLI**

Add to `imageCmd` in `src/cli/program.ts` (import: `import { copyImageArgs, openArgs, run as runPlatform } from '../platform/clipboard.js';`):

```typescript
imageCmd
  .command('copy <id>')
  .description('Copy an image to the OS clipboard (macOS)')
  .action(function (this: Command, id: string) {
    const deps = buildDeps();
    const root = resolveProjectRoot(deps.dir);
    process.exitCode = runCommand(deps, 'image copy', (ctx) => {
      const v = image.show(ctx, id);
      runPlatform(copyImageArgs(process.platform, pathJoin(root, v.path)));
      return { data: { id: v.id, copied: true } };
    });
  });

imageCmd
  .command('open <id>')
  .description('Open an image in the OS default viewer')
  .action(function (this: Command, id: string) {
    const deps = buildDeps();
    const root = resolveProjectRoot(deps.dir);
    process.exitCode = runCommand(deps, 'image open', (ctx) => {
      const v = image.show(ctx, id);
      runPlatform(openArgs(process.platform, pathJoin(root, v.path)));
      return { data: { id: v.id, opened: true } };
    });
  });
```

> `--clipboard` ingestion on `add` (paste an image FROM the clipboard) is deferred to Plan 2: it needs a macOS paste→temp-file step (`osascript` writing PNG bytes) that is environment-dependent and not unit-testable here. The `pasteImageScript` builder is in place for it. File-based `add` covers CI/agents now.

- [ ] **Step 6: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/platform/clipboard.ts tests/platform/clipboard.test.ts src/cli/program.ts
git commit -m "feat(cli): apm image copy/open via platform adapter"
```

---

## Task 14: Docs drift — register `IMG-` prefix (K5)

**Files:**
- Modify: `CLAUDE.md` (ID prefixes line under "CLI Conventions")

- [ ] **Step 1: Update the id-prefix list**

In `CLAUDE.md`, find the line listing id prefixes:

```
- ID prefixes by type: `WI-` work items, `LEASE-`, `S-` sessions, `WR-` workflow runs, `ART-` artifacts, `DEC-` decisions, `ADR-`, `BLK-` blockers, `HG-` human gates.
```

Replace with (add `IMG-`):

```
- ID prefixes by type: `WI-` work items, `LEASE-`, `S-` sessions, `WR-` workflow runs, `ART-` artifacts, `IMG-` images, `DEC-` decisions, `ADR-`, `BLK-` blockers, `HG-` human gates.
```

Add a one-line command summary near the artifact commands block:

```
- Images: `apm image add --work-item <wi> --file <path> [--kind screenshot] [--alt <s>] --agent <a>` · `image show <id>` · `image list --work-item <wi>` · `image revise <id> --file <f> --agent <a>` · `image find --blob <sha>` · `image pair <a> <b>` · `image save <id> --to <p>` · `image embed <id> [--resolve]` · `image copy <id>` · `image open <id>`
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: register IMG- prefix + apm image command summary"
```

---

## Task 15: Final verification

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS; `dist/` emits; `schema.sql` (with `blobs`) copied to `dist/storage/`.

- [ ] **Step 2: Manual smoke (real binary, real db)**

```bash
TMP=$(mktemp -d); npx tsx src/bin/apm.ts --dir "$TMP" init
WI=$(npx tsx src/bin/apm.ts --dir "$TMP" work create --type feature --title Img --agent agent:claude -o json | npx --yes node-jq -r .data.id 2>/dev/null || echo WI-1)
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' | base64 -d > "$TMP/s.png"
npx tsx src/bin/apm.ts --dir "$TMP" image add --work-item WI-1 --file "$TMP/s.png" --kind screenshot --alt home --agent agent:claude
npx tsx src/bin/apm.ts --dir "$TMP" image show IMG-1
npx tsx src/bin/apm.ts --dir "$TMP" image list --work-item WI-1
ls "$TMP/.apm/blobs"
rm -rf "$TMP"
```
Expected: `image add` returns `IMG-1`; `show` prints metadata + a `.apm/blobs/...` path; `list` includes `IMG-1`; the blob file exists under `.apm/blobs/<2>/`.

- [ ] **Step 3: Commit any fixes, then stop for review.**

---

## Self-Review (author checklist — completed)

**Spec coverage (Plan-1 scope):** blob store §3.1 → Tasks 4–6; image entity + versioning §3.2 → Tasks 2,3,7,8,9; metadata_json prereq C1 §3.3 → Task 1; write ordering/purity C3 §3.4 → Task 5 + Task 11 (IO in CLI action before `runCommand`); CLI surface §4 → Tasks 11–13; F1 (never bytes) → `show`/`list` return metadata only; F3 embed → Task 12; K1 gallery → `linkedImages` Task 6/8; K3 pair event → Task 9; P4 size cap → Task 8; C2 IMG prefix → Task 3; C5 null dims → Task 5; K5 docs → Task 14. Deferred items explicitly labeled (verification-run docs/gates, agent-contract fields, viewer) — owned by Plans 2–4.

**Placeholder scan:** none — every code/test step carries complete content.

**Type consistency:** `BlobMeta` (blobstore) ↔ `blobs.insert` arg ↔ `image.add`/`revise` `blob` field all share `{sha256,mime,ext,byte_size,width,height}`. `ImageView` produced by `toImageView` and consumed by every CLI handler. `insert(a, eventType?)` signature matches all callers (image passes `'image.created'`; existing artifact callers pass nothing). `linkedImages`/`imagesByBlob`/`currentByRoot` names consistent across repos and usecases.
