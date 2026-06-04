# Image Support — Plan 4: Viewer (serve + gallery + detail + zoom + diff) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser viewer for images — immutable-cached blob serving, a work-item gallery, an image-detail page with a capture-metadata panel + version dropdown + client-side zoom/pan, and before/after diff overlays (side-by-side / swipe / onion-skin).

**Architecture:** The `apm serve` HTTP server (`src/server/`) gains an `/api/blob/:sha` route (immutable cache + ETag), plus `/api/work/:id/images`, `/api/images/:id`, `/api/images/:id/versions` JSON routes wired to existing image usecases; `ImageView` becomes a `@apm/types` Zod schema. The Next.js viewer (`viewer/`) gains: a browser-facing `/api/blob/[sha]` route (mirrors the existing `/api/files` proxy + immutable cache), react-query hooks, an Images tab + gallery on the work-item page, an image-detail route with a capture panel + version dropdown + a pure-CSS zoom/pan component, and a client-side diff component comparing two versions in three overlay modes.

**Tech Stack:** TypeScript, Node, better-sqlite3 (server); Next.js 15 App Router, React, @tanstack/react-query, zod, CSS Modules, vitest + @testing-library/react + jsdom (viewer). **No new runtime deps** (zoom/diff are hand-rolled CSS/state).

**Spec:** `docs/superpowers/specs/2026-06-04-image-support-design.md` §6 (viewer www/mobile/zoom/diff), §7, plus P2 (immutable cache), P3 (no thumbnails — lazy-load + responsive), K1 (gallery via `linkedImages`), K3 (`image.paired` / version pairs). Built on Plans 1–3 (this branch is stacked on `image-plan3-agent-context`).

**Scope:** the full §6 viewer — serving + gallery + detail + zoom + diff. Diff compares **versions of one image lineage** (queryable: same root, version N vs N−1) via the version dropdown; cross-lineage `image.paired` pairs render the same component once a pairs endpoint exists (a labeled follow-up). No server-side thumbnails (P3) or perceptual diff (viewer overlays only, per the §6 decision).

**Out of scope (labeled):** cross-lineage `image.paired` pairs UI (needs a pairs endpoint — follow-up); `--clipboard` ingestion; server thumbnails; perceptual-diff scoring.

---

## File Structure

**Server (`apm serve`):**
- `src/server/files.ts` — add `serveBlob(projectRoot, sha, res, baseHeaders)` (sha-validated, immutable cache + ETag).
- `src/server/serve.ts` — add routes: `/api/blob/:sha` (raw → serveBlob), `/api/work/:id/images`, `/api/images/:id`, `/api/images/:id/versions`.
- `src/usecases/image.ts` — add `versions(ctx, id)` (all versions of the lineage).
- `src/storage/repos.ts` — add `versionsOfRoot(rootId)`.
- `packages/types/src/views.ts` + `index.ts` — add `ImageViewSchema` + `ImageView` type.

**Viewer (`viewer/`):**
- `viewer/app/api/blob/[sha]/route.ts` — browser blob proxy (immutable cache).
- `viewer/lib/files/resolveBlob.ts` — sha→abs-path resolver (mirrors `resolvePath.ts`).
- `viewer/lib/api/endpoints.ts`, `keys.ts`, `hooks.ts` — `workImages`, `image`, `imageVersions`.
- `viewer/components/image/ImagesGallery.tsx` (+ `.test.tsx`, `image.module.css`) — work-item gallery.
- `viewer/components/image/ImageDetail.tsx` (+ test) — detail: capture panel + version dropdown + zoom + diff toggle.
- `viewer/components/image/ImageZoom.tsx` (+ test) — pure-CSS pan/zoom.
- `viewer/components/image/ImageDiff.tsx` (+ test) — side-by-side / swipe / onion-skin.
- `viewer/app/images/[id]/page.tsx` — detail route.
- `viewer/components/doc/WorkDetailTabs.tsx` — add an Images tab.

---

## Task 1: `ImageView` Zod schema in `@apm/types`

**Files:**
- Modify: `packages/types/src/views.ts`, `packages/types/src/index.ts`
- Test: `tests/types/schemas.test.ts` (append; or `packages/types`'s own test if present — use the repo's existing schema test file)

- [ ] **Step 1: Write the failing test**

Append to `tests/types/schemas.test.ts` (mirror the existing schema tests in that file):

```typescript
import { ImageViewSchema } from '@apm/types';

describe('ImageViewSchema', () => {
  it('accepts a full ImageView', () => {
    const v = {
      id: 'IMG-1', version: 1, status: 'draft', root: 'IMG-1', supersedes: null,
      kind: 'screenshot', blob: 'a'.repeat(64), mime: 'image/png', ext: 'png',
      width: 1280, height: 800, byte_size: 4242, alt: 'home', capture: { route: '/home' },
      path: '.apm/blobs/aa/' + 'a'.repeat(64) + '.png',
      created_by: 'claude', created_at: '2026-06-04T00:00:00.000Z', work_item: 'WI-1',
    };
    expect(ImageViewSchema.safeParse(v).success).toBe(true);
  });
  it('rejects an unknown key (strict)', () => {
    const bad = { id: 'IMG-1', extra: true } as any;
    expect(ImageViewSchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/types/schemas.test.ts -t ImageViewSchema`
Expected: FAIL — `ImageViewSchema` not exported.

- [ ] **Step 3: Implement**

In `packages/types/src/views.ts`, add (mirroring `ArtifactViewSchema` style, `.strict()`):

```typescript
export const ImageViewSchema = z.object({
  id: z.string(),
  version: z.number(),
  status: z.string(),
  root: z.string(),
  supersedes: z.string().nullable(),
  kind: z.string(),
  blob: z.string(),
  mime: z.string(),
  ext: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  byte_size: z.number(),
  alt: z.string().nullable(),
  capture: z.record(z.unknown()).nullable(),
  path: z.string(),
  created_by: z.string().nullable(),
  created_at: z.string(),
  work_item: z.string().nullable(),
}).strict();
```

In `packages/types/src/index.ts`, add the type export (mirror the existing `export type XView = z.infer<...>` lines):

```typescript
export type ImageView = z.infer<typeof V.ImageViewSchema>;
```

- [ ] **Step 4: Build the package + run the test**

Run: `(cd packages/types && npm run build) && cp packages/types/dist/*.js packages/types/dist/*.d.ts /Users/patrick/workspace/apm/packages/types/dist/ && npx vitest run tests/types/schemas.test.ts -t ImageViewSchema`
Expected: PASS.
> The `cp` syncs the gitignored dist into the symlink target the tests resolve (the local main working tree is behind, so its `@apm/types` dist must be refreshed — see the env note at the end).

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/views.ts packages/types/src/index.ts tests/types/schemas.test.ts
git commit -m "feat(types): ImageViewSchema in @apm/types"
```

---

## Task 2: `image.versions` usecase + `versionsOfRoot` repo

**Files:**
- Modify: `src/storage/repos.ts` (artifacts: `versionsOfRoot`), `src/usecases/image.ts` (`versions`)
- Test: `tests/usecases/image.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/usecases/image.test.ts`:

```typescript
describe('image.versions', () => {
  it('returns all versions of an image lineage, newest first', () => {
    const ctx = { storage, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'V', agent: 'agent:claude' });
    const a = image.add(ctx, { workItem: wi.id, kind: 'screenshot', alt: 'v1', agent: 'agent:claude', blob: putBlob(dir, PNG) });
    image.revise(ctx, a.id, { alt: 'v2', agent: 'agent:claude', blob: putBlob(dir, PNG) });
    const vs = image.versions(ctx, a.id);
    expect(vs.map((v) => v.version)).toEqual([2, 1]);
    expect(vs.every((v) => v.root === a.root)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usecases/image.test.ts -t "image.versions"`
Expected: FAIL — `image.versions` not exported.

- [ ] **Step 3: Implement**

In `src/storage/repos.ts`, inside the `artifacts:` object, add:

```typescript
      versionsOfRoot(rootId: string): any[] {
        return tx.all('SELECT * FROM artifacts WHERE root_artifact_id=? ORDER BY version DESC', rootId);
      },
```

In `src/usecases/image.ts`, add:

```typescript
export function versions(ctx: Ctx, id: string): ImageView[] {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    const row = r.artifacts.byId(id);
    if (!row || row.type !== 'image') throw new ApmError('E_NOT_FOUND', `image ${id} not found`);
    const link: any = tx.get('SELECT work_item_id FROM work_item_artifacts WHERE root_artifact_id=? LIMIT 1', row.root_artifact_id);
    return r.artifacts.versionsOfRoot(row.root_artifact_id).map((vr: any) => toImageView(vr, link?.work_item_id ?? null));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/usecases/image.test.ts -t "image.versions"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/repos.ts src/usecases/image.ts tests/usecases/image.test.ts
git commit -m "feat(image): versions usecase (lineage, newest-first)"
```

---

## Task 3: Server routes — `/api/blob/:sha` (immutable cache) + image JSON routes

**Files:**
- Modify: `src/server/router.ts` (raw handlers must receive `params`), `src/server/serve.ts` (pass `params` to raw handlers + 4 routes), `src/server/files.ts` (add `serveBlob`, raster-only)
- Test: `tests/server/blob-route.test.ts` (create), and extend an existing server route test for the JSON routes if one exists.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/server/blob-route.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { serveBlob } from '../../src/server/files.js';

let root: string;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'apm-blobroute-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function fakeRes() {
  return { statusCode: 0, headers: {} as Record<string, string>, body: undefined as Buffer | undefined,
    writeHead(code: number, h?: Record<string, string>) { this.statusCode = code; if (h) Object.assign(this.headers, h); },
    end(b?: Buffer) { this.body = b; } };
}

describe('serveBlob', () => {
  it('serves a content-addressed blob with immutable cache + ETag', () => {
    const sha = createHash('sha256').update(PNG).digest('hex');
    mkdirSync(join(root, '.apm', 'blobs', sha.slice(0, 2)), { recursive: true });
    writeFileSync(join(root, '.apm', 'blobs', sha.slice(0, 2), `${sha}.png`), PNG);
    const res: any = fakeRes();
    serveBlob(root, sha, res, {});
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['ETag']).toBe(`"${sha}"`);
    expect(res.body?.equals(PNG)).toBe(true);
  });
  it('404s a non-hex or missing sha (no traversal)', () => {
    const res: any = fakeRes();
    serveBlob(root, '../../etc/passwd', res, {});
    expect(res.statusCode).toBe(404);
    const res2: any = fakeRes();
    serveBlob(root, 'a'.repeat(64), res2, {});
    expect(res2.statusCode).toBe(404); // valid hex but no file
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/blob-route.test.ts`
Expected: FAIL — `serveBlob` not exported.

- [ ] **Step 3: Implement**

**First, make raw handlers receive `params`** (they currently get only `{ projectRoot, query }`, so `/api/blob/:sha` would never see its sha). In `src/server/router.ts`, update the `RawRun` type to include `params`:

```typescript
export type RawRun = (rc: { projectRoot: string; params: Record<string, string>; query: URLSearchParams }, res: http.ServerResponse) => void;
```

In `src/server/serve.ts`, the raw-dispatch call site (currently `m.route.raw({ projectRoot, query: url.searchParams }, res)`) — add `params` (the matched params `m.params` are already computed by `matchRoute`):

```typescript
        m.route.raw({ projectRoot, params: m.params, query: url.searchParams }, res);
```

Then in `src/server/files.ts`, add `serveBlob` (raster-only — **deliberately excludes `.svg`** for parity with the existing `/api/files` jail, which excludes SVG to avoid its script surface):

```typescript
/** Raster image extensions served from the content-addressed blob store (SVG excluded for parity with the files jail). */
const BLOB_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/** Serve a content-addressed blob by sha256 with immutable caching. sha must be 64 hex chars. */
export function serveBlob(
  projectRoot: string,
  sha: string | null | undefined,
  res: http.ServerResponse,
  baseHeaders: Record<string, string> = {},
): void {
  if (!sha || !/^[0-9a-f]{64}$/.test(sha)) { res.writeHead(404); res.end(); return; }
  const dir = path.join(projectRoot, '.apm', 'blobs', sha.slice(0, 2));
  let file: string | null = null;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(sha + '.') && BLOB_EXT.has(path.extname(name).toLowerCase())) { file = path.join(dir, name); break; }
    }
  } catch { /* dir missing → 404 below */ }
  if (!file || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    ...baseHeaders,
    'Content-Type': contentTypeFor(ext),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: `"${sha}"`,
  });
  res.end(fs.readFileSync(file));
}
```

In `src/server/serve.ts`, add to the `ROUTES` array (import `serveBlob`, `image`):

```typescript
  { method: 'GET', pattern: '/api/blob/:sha', raw: (rc, res) => serveBlob(rc.projectRoot, rc.params.sha, res, SECURITY_HEADERS) },
  { method: 'GET', pattern: '/api/work/:id/images', run: ({ ctx, params, query }) => image.list(ctx, { workItem: params.id, limit: num(query, 'limit'), offset: num(query, 'offset') }) },
  { method: 'GET', pattern: '/api/images/:id', run: ({ ctx, params }) => image.show(ctx, params.id) },
  { method: 'GET', pattern: '/api/images/:id/versions', run: ({ ctx, params }) => ({ items: image.versions(ctx, params.id) }) },
```

> Verify `m.params` is the field name `matchRoute` returns in `serve.ts` (the `run`-handler path already uses it). If `http` isn't imported in `router.ts` for the `RawRun` type, use the existing import or `import type http from 'node:http'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/blob-route.test.ts && npm test`
Expected: PASS; full suite green (refresh `@apm/types` dist first if `serve-contract` complains — see env note).

- [ ] **Step 5: Commit**

```bash
git add src/server/files.ts src/server/serve.ts tests/server/blob-route.test.ts
git commit -m "feat(server): /api/blob/:sha (immutable cache) + image JSON routes"
```

---

## Task 4: Viewer blob proxy route `/api/blob/[sha]`

**Files:**
- Create: `viewer/lib/files/resolveBlob.ts`, `viewer/app/api/blob/[sha]/route.ts`
- Test: `viewer/lib/files/resolveBlob.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// viewer/lib/files/resolveBlob.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBlob } from './resolveBlob';

let root: string;
const SHA = 'a'.repeat(64);
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'vw-blob-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('resolveBlob', () => {
  it('resolves a valid sha to its on-disk blob + content type', async () => {
    mkdirSync(join(root, '.apm', 'blobs', 'aa'), { recursive: true });
    writeFileSync(join(root, '.apm', 'blobs', 'aa', `${SHA}.png`), Buffer.from('x'));
    const r = await resolveBlob(root, SHA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.contentType).toBe('image/png');
  });
  it('rejects a non-hex sha', async () => {
    expect((await resolveBlob(root, '../etc')).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd viewer && npx vitest run lib/files/resolveBlob.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// viewer/lib/files/resolveBlob.ts
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveProjectRoot } from './resolvePath';

// Raster only — SVG deliberately excluded for parity with viewer/lib/files/resolvePath.ts (avoids the SVG script surface).
const EXT_CONTENT_TYPE: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp',
};

export type ResolvedBlob = { ok: true; absPath: string; contentType: string } | { ok: false };

/** Resolve a 64-hex sha to its content-addressed blob under <root>/.apm/blobs/<2>/<sha>.<ext>. */
export async function resolveBlob(root: string, sha: string): Promise<ResolvedBlob> {
  if (!/^[0-9a-f]{64}$/.test(sha)) return { ok: false };
  const dir = path.join(root, '.apm', 'blobs', sha.slice(0, 2));
  let names: string[];
  try { names = await readdir(dir); } catch { return { ok: false }; }
  const name = names.find((n) => n.startsWith(sha + '.') && EXT_CONTENT_TYPE[path.extname(n).toLowerCase()]);
  if (!name) return { ok: false };
  const candidate = path.join(dir, name);
  let real: string;
  try { real = await realpath(candidate); } catch { return { ok: false }; }
  if (real !== candidate && !real.startsWith(path.join(root, '.apm', 'blobs') + path.sep)) return { ok: false };
  if (!(await stat(real)).isFile()) return { ok: false };
  return { ok: true, absPath: real, contentType: EXT_CONTENT_TYPE[path.extname(real).toLowerCase()] };
}

export { resolveProjectRoot };
```

```typescript
// viewer/app/api/blob/[sha]/route.ts
import { readFile } from 'node:fs/promises';
import { resolveBlob, resolveProjectRoot } from '@/lib/files/resolveBlob';

export async function GET(_req: Request, ctx: { params: Promise<{ sha: string }> }): Promise<Response> {
  const { sha } = await ctx.params;
  const root = await resolveProjectRoot();
  const r = await resolveBlob(root, sha);
  if (!r.ok) return new Response(null, { status: 404 });
  const buf = await readFile(r.absPath);
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': r.contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"${sha}"`,
    },
  });
}
```

> Confirm `resolveProjectRoot` is exported from `viewer/lib/files/resolvePath.ts` (the existing `/api/files` route imports it). If its signature differs, mirror the real one.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd viewer && npx vitest run lib/files/resolveBlob.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add viewer/lib/files/resolveBlob.ts viewer/lib/files/resolveBlob.test.ts viewer/app/api/blob/
git commit -m "feat(viewer): /api/blob/[sha] proxy with immutable cache"
```

---

## Task 5: Viewer data layer — endpoints, keys, hooks

**Files:**
- Modify: `viewer/lib/api/endpoints.ts`, `viewer/lib/api/keys.ts`, `viewer/lib/api/hooks.ts`
- Test: `viewer/lib/api/endpoints.test.ts` (create or append)

- [ ] **Step 1: Write the failing test**

```typescript
// viewer/lib/api/endpoints.test.ts
import { describe, it, expect } from 'vitest';
import { ep } from './endpoints';

describe('image endpoints', () => {
  it('builds image endpoint paths', () => {
    expect(ep.workImages.path('WI-1')).toBe('/api/work/WI-1/images');
    expect(ep.image.path('IMG-2')).toBe('/api/images/IMG-2');
    expect(ep.imageVersions.path('IMG-2')).toBe('/api/images/IMG-2/versions');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd viewer && npx vitest run lib/api/endpoints.test.ts`
Expected: FAIL — `ep.workImages` undefined.

- [ ] **Step 3: Implement**

In `viewer/lib/api/endpoints.ts`, **first add `ImageViewSchema` to the existing `@apm/types` import** (the file imports other schemas + `pageSchema` from `@apm/types` and `z` from `zod`, but not `ImageViewSchema` yet), then add to the `ep` object (the versions schema is a small items-wrapper `z.object({ items: z.array(ImageViewSchema) })`):

```typescript
  workImages: { path: (id: string) => `/api/work/${id}/images`, schema: pageSchema(ImageViewSchema) },
  image: { path: (id: string) => `/api/images/${id}`, schema: ImageViewSchema },
  imageVersions: { path: (id: string) => `/api/images/${id}/versions`, schema: z.object({ items: z.array(ImageViewSchema) }) },
```

In `viewer/lib/api/keys.ts`, add:

```typescript
  workImages: (id: string) => ['work', id, 'images'] as const,
  image: (id: string) => ['image', id] as const,
  imageVersions: (id: string) => ['image', id, 'versions'] as const,
```

In `viewer/lib/api/hooks.ts`, add (mirror `useWorkArtifacts`):

```typescript
export const useWorkImages = (id: string, o?: Opt) =>
  useApiQuery(qk.workImages(id), ep.workImages.path(id), ep.workImages.schema, SEMI, o);
export const useImage = (id: string, o?: Opt) =>
  useApiQuery(qk.image(id), ep.image.path(id), ep.image.schema, SEMI, o);
export const useImageVersions = (id: string, o?: Opt) =>
  useApiQuery(qk.imageVersions(id), ep.imageVersions.path(id), ep.imageVersions.schema, SEMI, o);
```

> Ensure `z` and `ImageViewSchema` are imported in `endpoints.ts` (the file already imports schemas from `@apm/types` + `zod`).

- [ ] **Step 4: Run test + typecheck**

Run: `cd viewer && npx vitest run lib/api/endpoints.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add viewer/lib/api/endpoints.ts viewer/lib/api/keys.ts viewer/lib/api/hooks.ts viewer/lib/api/endpoints.test.ts
git commit -m "feat(viewer): image data hooks (workImages/image/imageVersions)"
```

---

## Task 6: `ImagesGallery` + Images tab

**Files:**
- Create: `viewer/components/image/ImagesGallery.tsx`, `viewer/components/image/image.module.css`, `viewer/components/image/ImagesGallery.test.tsx`
- Modify: `viewer/components/doc/WorkDetailTabs.tsx` (add the Images tab)

- [ ] **Step 1: Write the failing test**

```typescript
// viewer/components/image/ImagesGallery.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const useWorkImages = vi.fn();
vi.mock('@/lib/api/hooks', () => ({ useWorkImages: (...a: unknown[]) => useWorkImages(...a) }));

import { ImagesGallery } from './ImagesGallery';

const img = (id: string, blob: string, alt: string) => ({
  id, version: 1, status: 'draft', root: id, supersedes: null, kind: 'screenshot',
  blob, mime: 'image/png', ext: 'png', width: 1, height: 1, byte_size: 1, alt,
  capture: null, path: `.apm/blobs/${blob.slice(0,2)}/${blob}.png`,
  created_by: 'a', created_at: '2026-01-01', work_item: 'WI-1',
});

beforeEach(() => {
  useWorkImages.mockReturnValue({ data: { items: [img('IMG-1', 'aa'.repeat(32), 'home'), img('IMG-2', 'bb'.repeat(32), 'login')] }, isLoading: false, isError: false });
});

describe('ImagesGallery', () => {
  it('renders one lazy <img> per image, src=/api/blob/<sha>, with alt + link to detail', () => {
    render(<ImagesGallery workItemId="WI-1" />);
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute('src')).toBe('/api/blob/' + 'aa'.repeat(32));
    expect(imgs[0].getAttribute('loading')).toBe('lazy');
    expect(screen.getByAltText('home')).toBeTruthy();
    expect(screen.getByRole('link', { name: /home/i }).getAttribute('href')).toBe('/images/IMG-1');
  });

  it('shows an empty state when there are no images', () => {
    useWorkImages.mockReturnValue({ data: { items: [] }, isLoading: false, isError: false });
    render(<ImagesGallery workItemId="WI-1" />);
    expect(screen.getByText(/no images/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd viewer && npx vitest run components/image/ImagesGallery.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```css
/* viewer/components/image/image.module.css */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
.cell { border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; display: block; text-decoration: none; color: inherit; }
.cell img { width: 100%; height: 140px; object-fit: contain; background: var(--bg-muted, #111); display: block; }
.cap { font-size: 12px; padding: 6px 8px; color: var(--fg-muted); }
.empty { color: var(--fg-muted); font-size: 14px; }
.panel { display: grid; gap: 12px; }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; font-size: 13px; }
.kv dt { color: var(--fg-muted); }
.stage { position: relative; overflow: hidden; background: var(--bg-muted, #111); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.stage img { display: block; max-width: 100%; }
.controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13px; }
```

```tsx
// viewer/components/image/ImagesGallery.tsx
'use client';
import Link from 'next/link';
import { useWorkImages } from '@/lib/api/hooks';
import s from './image.module.css';

export function ImagesGallery({ workItemId }: { workItemId: string }) {
  const { data, isLoading, isError } = useWorkImages(workItemId);
  if (isLoading) return <p className={s.empty}>Loading images…</p>;
  if (isError) return <p className={s.empty}>Failed to load images.</p>;
  const items = data?.items ?? [];
  if (items.length === 0) return <p className={s.empty}>No images linked to this work item.</p>;
  return (
    <div className={s.grid}>
      {items.map((img) => (
        <Link key={img.id} href={`/images/${img.id}`} className={s.cell}>
          <img src={`/api/blob/${img.blob}`} alt={img.alt ?? img.id} loading="lazy" referrerPolicy="no-referrer" />
          <div className={s.cap}>{img.alt ?? img.id} · {img.kind}</div>
        </Link>
      ))}
    </div>
  );
}
```

In `viewer/components/doc/WorkDetailTabs.tsx`: add `{ id: 'images', label: 'Images' }` to `TABS`, and in the panel area add `{active === 'images' && <ImagesGallery workItemId={id} />}` (import `ImagesGallery`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd viewer && npx vitest run components/image/ImagesGallery.test.tsx && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add viewer/components/image/ viewer/components/doc/WorkDetailTabs.tsx
git commit -m "feat(viewer): images gallery + Images tab on the work item"
```

---

## Task 7: `ImageZoom` (pure-CSS pan/zoom)

**Files:**
- Create: `viewer/components/image/ImageZoom.tsx`, `viewer/components/image/ImageZoom.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// viewer/components/image/ImageZoom.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageZoom } from './ImageZoom';

describe('ImageZoom', () => {
  it('renders the image and toggles a zoomed class on click', () => {
    render(<ImageZoom blob={'aa'.repeat(32)} alt="shot" />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe('/api/blob/' + 'aa'.repeat(32));
    const before = img.className;
    fireEvent.click(img);
    expect(img.className).not.toBe(before); // zoom toggled
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd viewer && npx vitest run components/image/ImageZoom.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Add to `image.module.css`:

```css
.zoomWrap { overflow: auto; max-height: 70vh; cursor: zoom-in; }
.zoomImg { display: block; max-width: 100%; transition: transform 0.1s ease; transform-origin: top left; }
.zoomed { cursor: zoom-out; max-width: none; transform: scale(2); }
```

```tsx
// viewer/components/image/ImageZoom.tsx
'use client';
import { useState } from 'react';
import s from './image.module.css';

export function ImageZoom({ blob, alt }: { blob: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <div className={s.zoomWrap}>
      <img
        src={`/api/blob/${blob}`}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        className={`${s.zoomImg} ${zoomed ? s.zoomed : ''}`}
        onClick={() => setZoomed((z) => !z)}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd viewer && npx vitest run components/image/ImageZoom.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add viewer/components/image/ImageZoom.tsx viewer/components/image/ImageZoom.test.tsx viewer/components/image/image.module.css
git commit -m "feat(viewer): pure-CSS image zoom/pan"
```

---

## Task 8: `ImageDiff` (side-by-side / swipe / onion-skin)

**Files:**
- Create: `viewer/components/image/ImageDiff.tsx`, `viewer/components/image/ImageDiff.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// viewer/components/image/ImageDiff.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageDiff } from './ImageDiff';

const A = 'aa'.repeat(32);
const B = 'bb'.repeat(32);

describe('ImageDiff', () => {
  it('renders both images and switches modes', () => {
    render(<ImageDiff beforeBlob={A} afterBlob={B} beforeAlt="v1" afterAlt="v2" />);
    // side-by-side (default): both images visible
    const imgs = screen.getAllByRole('img');
    expect(imgs.some((i) => i.getAttribute('src') === '/api/blob/' + A)).toBe(true);
    expect(imgs.some((i) => i.getAttribute('src') === '/api/blob/' + B)).toBe(true);

    // switch to onion-skin → an opacity slider appears
    fireEvent.click(screen.getByRole('button', { name: /onion/i }));
    expect(screen.getByRole('slider')).toBeTruthy();

    // switch to swipe → a slider appears too
    fireEvent.click(screen.getByRole('button', { name: /swipe/i }));
    expect(screen.getByRole('slider')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd viewer && npx vitest run components/image/ImageDiff.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Add to `image.module.css`:

```css
.diffModes { display: flex; gap: 6px; }
.sideBySide { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.overlay { position: relative; }
.overlay img { position: absolute; top: 0; left: 0; width: 100%; }
.overlay .base { position: relative; }
.clip { position: absolute; top: 0; left: 0; height: 100%; overflow: hidden; }
```

```tsx
// viewer/components/image/ImageDiff.tsx
'use client';
import { useState } from 'react';
import s from './image.module.css';

type Mode = 'side' | 'swipe' | 'onion';
const src = (b: string) => `/api/blob/${b}`;

export function ImageDiff({ beforeBlob, afterBlob, beforeAlt, afterAlt }:
  { beforeBlob: string; afterBlob: string; beforeAlt: string; afterAlt: string }) {
  const [mode, setMode] = useState<Mode>('side');
  const [pos, setPos] = useState(50); // swipe split % / onion opacity %

  return (
    <div>
      <div className={s.diffModes}>
        <button type="button" onClick={() => setMode('side')} aria-pressed={mode === 'side'}>Side-by-side</button>
        <button type="button" onClick={() => setMode('swipe')} aria-pressed={mode === 'swipe'}>Swipe</button>
        <button type="button" onClick={() => setMode('onion')} aria-pressed={mode === 'onion'}>Onion-skin</button>
      </div>

      {mode === 'side' && (
        <div className={s.sideBySide}>
          <img src={src(beforeBlob)} alt={beforeAlt} loading="lazy" referrerPolicy="no-referrer" />
          <img src={src(afterBlob)} alt={afterAlt} loading="lazy" referrerPolicy="no-referrer" />
        </div>
      )}

      {mode === 'onion' && (
        <>
          <div className={s.overlay}>
            <img className={s.base} src={src(beforeBlob)} alt={beforeAlt} referrerPolicy="no-referrer" />
            <img src={src(afterBlob)} alt={afterAlt} style={{ opacity: pos / 100 }} referrerPolicy="no-referrer" />
          </div>
          <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="onion opacity" />
        </>
      )}

      {mode === 'swipe' && (
        <>
          <div className={s.overlay}>
            <img className={s.base} src={src(beforeBlob)} alt={beforeAlt} referrerPolicy="no-referrer" />
            <div className={s.clip} style={{ width: `${pos}%` }}>
              <img src={src(afterBlob)} alt={afterAlt} referrerPolicy="no-referrer" />
            </div>
          </div>
          <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="swipe split" />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd viewer && npx vitest run components/image/ImageDiff.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add viewer/components/image/ImageDiff.tsx viewer/components/image/ImageDiff.test.tsx viewer/components/image/image.module.css
git commit -m "feat(viewer): before/after diff (side-by-side/swipe/onion-skin)"
```

---

## Task 9: `ImageDetail` (capture panel + version dropdown + zoom + diff) + route

**Files:**
- Create: `viewer/components/image/ImageDetail.tsx`, `viewer/components/image/ImageDetail.test.tsx`, `viewer/app/images/[id]/page.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// viewer/components/image/ImageDetail.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const useImage = vi.fn();
const useImageVersions = vi.fn();
vi.mock('@/lib/api/hooks', () => ({
  useImage: (...a: unknown[]) => useImage(...a),
  useImageVersions: (...a: unknown[]) => useImageVersions(...a),
}));

import { ImageDetail } from './ImageDetail';

const img = (id: string, version: number, blob: string, alt: string) => ({
  id, version, status: 'draft', root: 'IMG-1', supersedes: null, kind: 'screenshot',
  blob, mime: 'image/png', ext: 'png', width: 1280, height: 800, byte_size: 99, alt,
  capture: { route: '/home', viewport: { w: 1280, h: 800 } },
  path: `.apm/blobs/${blob.slice(0,2)}/${blob}.png`, created_by: 'claude', created_at: '2026-01-01', work_item: 'WI-1',
});

beforeEach(() => {
  useImage.mockReturnValue({ data: img('IMG-2', 2, 'bb'.repeat(32), 'v2'), isLoading: false, isError: false });
  useImageVersions.mockReturnValue({ data: { items: [img('IMG-2', 2, 'bb'.repeat(32), 'v2'), img('IMG-1', 1, 'aa'.repeat(32), 'v1')] }, isLoading: false, isError: false });
});

describe('ImageDetail', () => {
  it('shows the image, capture metadata, and a version selector', () => {
    render(<ImageDetail id="IMG-2" />);
    expect(screen.getByRole('img')).toBeTruthy();
    expect(screen.getByText(/\/home/)).toBeTruthy(); // capture route shown
    expect(screen.getByText(/1280×800|1280x800/)).toBeTruthy(); // dimensions
    expect(screen.getByRole('combobox')).toBeTruthy(); // version dropdown
  });

  it('reveals the diff when a comparison version is chosen', () => {
    render(<ImageDetail id="IMG-2" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'IMG-1' } });
    expect(screen.getByRole('button', { name: /side-by-side/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd viewer && npx vitest run components/image/ImageDetail.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```tsx
// viewer/components/image/ImageDetail.tsx
'use client';
import { useState } from 'react';
import { useImage, useImageVersions } from '@/lib/api/hooks';
import { IdChip } from '@/components/IdChip/IdChip';
import { ImageZoom } from './ImageZoom';
import { ImageDiff } from './ImageDiff';
import s from './image.module.css';

export function ImageDetail({ id }: { id: string }) {
  const { data: img, isLoading, isError } = useImage(id);
  const { data: versionsData } = useImageVersions(id);
  const [compareId, setCompareId] = useState('');

  if (isLoading) return <p className={s.empty}>Loading…</p>;
  if (isError || !img) return <p className={s.empty}>Image not found.</p>;

  const versions = versionsData?.items ?? [];
  const compare = versions.find((v) => v.id === compareId);
  const cap = (img.capture ?? {}) as { route?: string; viewport?: { w: number; h: number }; tool?: string; git_sha?: string };

  return (
    <article className={s.panel}>
      <header className={s.controls}>
        <IdChip id={img.id} />
        <strong>{img.alt ?? img.id}</strong>
        <span>{img.kind} · v{img.version}</span>
        {versions.length > 1 && (
          <label>
            Compare with{' '}
            <select value={compareId} onChange={(e) => setCompareId(e.target.value)}>
              <option value="">— none —</option>
              {versions.filter((v) => v.id !== img.id).map((v) => (
                <option key={v.id} value={v.id}>{v.id} (v{v.version})</option>
              ))}
            </select>
          </label>
        )}
      </header>

      {compare ? (
        <ImageDiff beforeBlob={compare.blob} afterBlob={img.blob} beforeAlt={compare.alt ?? compare.id} afterAlt={img.alt ?? img.id} />
      ) : (
        <ImageZoom blob={img.blob} alt={img.alt ?? img.id} />
      )}

      <dl className={s.kv}>
        {img.width != null && img.height != null && (<><dt>dimensions</dt><dd>{img.width}×{img.height}</dd></>)}
        <dt>bytes</dt><dd>{img.byte_size}</dd>
        {cap.route && (<><dt>route</dt><dd>{cap.route}</dd></>)}
        {cap.viewport && (<><dt>viewport</dt><dd>{cap.viewport.w}×{cap.viewport.h}</dd></>)}
        {cap.tool && (<><dt>tool</dt><dd>{cap.tool}</dd></>)}
        {cap.git_sha && (<><dt>git</dt><dd>{cap.git_sha}</dd></>)}
        <dt>created</dt><dd>{img.created_at}</dd>
      </dl>
    </article>
  );
}
```

```tsx
// viewer/app/images/[id]/page.tsx
import { ImageDetail } from '@/components/image/ImageDetail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ImageDetail id={id} />;
}
```

> The dimensions assertion in the test accepts `1280×800` or `1280x800` — implement with `×` (U+00D7); the test regex matches either.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd viewer && npx vitest run components/image/ImageDetail.test.tsx && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add viewer/components/image/ImageDetail.tsx viewer/components/image/ImageDetail.test.tsx viewer/app/images/
git commit -m "feat(viewer): image detail page (capture panel + versions + zoom + diff)"
```

---

## Task 10: Docs + final verification + PR

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Docs**

In `CLAUDE.md`, add a one-liner near the viewer/serving notes:

```
- Image viewer: `apm serve` exposes `/api/blob/:sha` (immutable-cached, content-addressed) + `/api/work/:id/images` · `/api/images/:id` · `/api/images/:id/versions`. The Next viewer adds a work-item Images gallery, an `/images/[id]` detail page (capture-metadata panel, version dropdown, click-to-zoom), and before/after diff overlays (side-by-side / swipe / onion-skin) across versions.
```

- [ ] **Step 2: Commit docs**

```bash
git add CLAUDE.md
git commit -m "docs: image viewer (blob serving, gallery, detail, diff)"
```

- [ ] **Step 3: Server-side full verify**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS. (Refresh `@apm/types` dist first if `serve-contract` complains — env note.)

- [ ] **Step 4: Viewer full verify**

Run: `cd viewer && npm run typecheck && npm test`
Expected: all PASS (the new component + route + resolver tests included).

- [ ] **Step 5: Stop for review + push + PR (stacked on `image-plan3-agent-context`).**

---

## Environment note (read before running tests)

This worktree resolves `@apm/types` through the main repo's symlinked `packages/types`, whose **local working tree is behind #33** — so its built dist can lack newly-added schema fields (e.g. `metadata`, and now `ImageViewSchema`). If `tests/contract/serve-contract.test.ts` (server) or any viewer test fails with a `@apm/types`/schema error, refresh the shared dist:

```bash
(cd packages/types && npm run build) && cp packages/types/dist/*.js packages/types/dist/*.d.ts /Users/patrick/workspace/apm/packages/types/dist/
```

This is local-only; CI builds the branch fresh.

---

## Self-Review (author checklist — completed)

**Spec coverage (§6 viewer):** serving + immutable cache P2 → Tasks 3 (server `/api/blob`) + 4 (viewer `/api/blob` proxy). Gallery K1 (`linkedImages`) → Tasks 5–6. Image detail + capture panel + version dropdown → Tasks 2 (`versions`) + 5 + 9. Zoom → Task 7. Diff overlays (side-by-side/swipe/onion-skin) → Task 8 + wired in 9. `ImageView` over the wire → Task 1. P3 (no thumbnails: lazy-load + responsive grid) → Task 6 (`loading="lazy"`, `object-fit`, `auto-fill minmax`). Docs → Task 10. Cross-lineage `image.paired` pairs UI labeled as a follow-up (the diff component is pair-agnostic — it takes two blobs — so wiring a pairs endpoint later reuses it).

**Round-1 adversarial fixes applied:** (1) raw handlers now receive `params` — `RawRun` type (router.ts) + the `serve.ts` raw call site pass `params: m.params`, without which `/api/blob/:sha` would 404 every request; (2) `ImageViewSchema` explicitly added to the `endpoints.ts` `@apm/types` import (Task 5 wouldn't compile otherwise); (3) SVG dropped from BOTH blob resolvers (`serveBlob` `BLOB_EXT`, viewer `resolveBlob` `EXT_CONTENT_TYPE`) for parity with the existing `/api/files` jail that deliberately excludes SVG. ImageView↔ImageViewSchema field parity confirmed exact (18 fields, nullability matches); `resolveProjectRoot` + Next async-`params` signatures confirmed against real code.

**Placeholder scan:** none. Remaining "verify `m.params` field name" notes are confirmation reminders next to complete code.

**Type consistency:** `ImageViewSchema`/`ImageView` (Task 1) is the single wire type consumed by every hook (Task 5), gallery (6), detail (9). `serveBlob(projectRoot, sha, res, headers)` (Task 3) and `resolveBlob(root, sha)` (Task 4) signatures match their callers. `image.versions(ctx, id): ImageView[]` (Task 2) ↔ `/api/images/:id/versions` `{ items }` ↔ `imageVersions` schema (Task 5) ↔ `useImageVersions` (9). All image `<img>` `src` use `/api/blob/${blob}` consistently (gallery, zoom, diff). `ImageDiff` props (`beforeBlob/afterBlob/beforeAlt/afterAlt`) match the `ImageDetail` call site.
```
