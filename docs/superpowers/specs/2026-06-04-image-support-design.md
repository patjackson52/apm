# APM Image / Screenshot Support — Design Spec

**Date:** 2026-06-04
**Status:** Approved (brainstorm) → ready for implementation plan
**Branch:** `worktree-image-support`

## 1. Purpose & Scope

Make images and screenshots first-class citizens in APM. Images enter APM from
outside (runners, humans, tools); **APM is the source-of-truth, versioner, linker,
server, and differ — not the capturer.** Consistent with "APM is not an
orchestrator."

**Primary jobs (chosen):**
- **Verification evidence** — screenshots proving a work item / verification run did
  what it claimed; bound to runs + work items; diffable over time.
- **Design / reference input** — mockups, diagrams, reference screenshots agents
  *consume* as `REQUIRED_CONTEXT`.
- **Bug / issue capture** — screenshots attached to bugs/blockers.

**Explicitly out of scope:** agent-*generated* images as deliverables (APM does not
generate or judge pixels); server-side image transcoding; server-side perceptual
diff/score; thumbnails (deferred milestone).

**Granularity (chosen):** an image is a **standalone addressable unit** (`IMG-N`,
versioned) **and** embeddable by reference inside markdown artifacts.

## 2. Model Decision

**Approach A — image as a new artifact *kind*** (selected over a dedicated `images`
table and over a path-only blob store). Add `type='image'` rows to the existing
`artifacts` table with `IMG-N` ids. Bytes live in a new content-addressed blob
store; the image/capture record lives in `metadata_json`.

**Reused for free:** version chain (`root_artifact_id`/`version`/
`supersedes_artifact_id`), `work_item_artifacts` linking, `output_artifact_id` on
step runs, `events`, and agent `REQUIRED_CONTEXT` surfacing.

Verified safe (no rework): no code branches on the `ART-` id prefix or on a closed
artifact-type set (`render.ts`, `repos.ts`, `enrich.ts` all generic); `allocateId`
+ `sequences` allocate generically per prefix; all link columns are free text.

## 3. Data Foundation

### 3.1 Blob store (bytes)

- Content-addressed: `.apm/blobs/<sha256[0:2]>/<sha256>.<ext>`. Immutable, dedup by
  hash, integrity-verifiable. `.apm/` already gitignored.
- New `blobs` table: `sha256 PK, mime, ext, byte_size, width, height, created_at`.
- Dimensions read at ingest via **`image-size`** (pure-JS, no native dep, no pixel
  processing). SVG dims from `viewBox`; **null dims tolerated, never throws** (C5).
- Accepted formats: `png, jpg/jpeg, webp, gif, svg` (matches existing file-server
  allowlist). **No transcoding** — original bytes stored verbatim.
- Reads verify sha → corruption-safe. Same bytes added twice = one blob, N image
  records.
- **Size cap:** `max_blob_bytes` policy bounds disk + protects context (P4).

### 3.2 Image entity (identity + versioning)

- `type='image'` rows in `artifacts`, allocated `IMG-N` ids — **new prefix
  `image:'IMG'` added to `ID_PREFIXES`** (C2). No migration; FKs are free text.
- Rides existing lineage: `revise` = new version in same root chain → natural
  before/after history. Status lifecycle (`draft→approved→superseded→archived`)
  reused.
- `body` = caption/alt markdown. `metadata_json`:

```json
{
  "kind": "screenshot|mockup|diagram|reference|bug",
  "blob": "<sha256>",
  "mime": "image/png", "width": 1280, "height": 800, "byte_size": 91234,
  "alt": "login screen, error toast visible",
  "capture": {
    "tool": "playwright", "url": "http://localhost:3000/login", "route": "/login",
    "viewport": { "w": 1280, "h": 800 }, "device": "desktop", "dpr": 2,
    "color_scheme": "dark", "os": "darwin", "git_sha": "415f24f",
    "command": "...", "captured_at": "2026-06-04T...", "prompt": "PD-3@2"
  },
  "pair_of": "IMG-4", "pair_kind": "before-after"
}
```

- `capture` = reproducibility block. `pair_of` = optional cross-lineage before/after
  pointer (intra-lineage pairs come free from versions).
- Events reused: `image.created`, `image.linked`, `image.superseded`,
  `image.paired`.

### 3.3 Plumb `metadata_json` (PREREQUISITE — C1)

`metadata_json` currently exists in schema but is **dropped** by `toArtifactView`
(`ArtifactView` has no metadata field). The whole image design routes through it.
**First task:** add `metadata: Record<string, unknown> | null` to `ArtifactView`,
project it in the artifact SELECT/`toArtifactView`. Nothing else works until this
lands.

### 3.4 Write ordering & purity (C3)

A `BlobStore` **service** (storage layer, not domain) computes sha256 + dims and
writes bytes: **temp file → fsync → atomic rename to sha path, BEFORE the DB
transaction.** Domain receives `{ sha, mime, width, height }` as plain data and
stays pure (no IO, `now` via `Clock`). Failure modes: orphan-blob-on-rollback is
harmless (content-addressed; next add dedups); a dangling DB reference is fatal — so
bytes-first is mandatory.

## 4. CLI Surface (`apm image …`)

All read commands honor `--format human|json|yaml|agent`. **Bytes are never inlined
in any envelope** (F1) — only refs (`id, blob, path, url, mime, w×h, byte_size, alt,
capture`).

**In:**
- `apm image add --work-item <wi> --file <path> [--kind screenshot] [--alt <s>]
  [--capture-file <json>] [--prompt <PD-id>] [--relation evidence|reference|bug]
  --agent <a>` → ingest (BlobStore, C3), create `IMG-N`, link to WI. Prints `IMG-N`.
- `--clipboard` (macOS `pngpaste`/`osascript`; platform adapter, graceful error
  elsewhere) or `--stdin` (CI/agents) in place of `--file`.
- `apm image revise IMG-7 --file <path> …` → new version in same lineage.

**Out:**
- `apm image save IMG-7 --to <path>` → write blob bytes to disk.
- `apm image copy IMG-7` → bytes → clipboard (macOS adapter).
- `apm image open IMG-7` → default OS viewer (`open`/`xdg-open`).

**Inspect:**
- `apm image show IMG-7 [--format …]` → metadata + path + url + capture. `human` adds
  optional iTerm2/kitty inline preview, text fallback (F2).
- `apm image list --work-item <wi>` → gallery via new `linkedImages()` (K1) — ALL
  images, grouped by relation, not just latest-one.
- `apm image find --blob <sha>` → `IMG-N`(s) referencing a blob (reverse lookup).
- `apm image pair IMG-7 IMG-9 --kind before-after` → records `image.paired` event
  (K3, bidirectional source of truth).

**Embed (F3):**
- `apm image embed IMG-7` → `![alt](apm:IMG-7)` (APM-viewer canonical, default).
- `apm image embed IMG-7 --resolve` → `![alt](.apm/blobs/ab/<sha>.png)` real relative
  path for GitHub/Obsidian/external markdown renderers.

## 5. Linking & Verification Runs

**Link relations** (reuse `work_item_artifacts.relation_type`, free text):
`evidence`, `reference`, `bug`, `produced`.

**Verification-run binding (K2).** `output_artifact_id` is single, but a run yields
many screenshots. Resolution via the embed model:
- Each screenshot → its own `IMG-N`, linked to the WI with `relation='evidence'`.
- The step's single output = a `review`/`handoff` artifact that **embeds** the N
  images; that doc id goes in `output_artifact_id`.
- Every shot stays independently addressable / diffable / listable. No new junction.

**Blocker / bug capture.** Bug screenshots link via the blocker's work item with
`relation='bug'`; `image.created`/`image.linked` payloads carry the blocker id so
`apm blocker show` surfaces them. No blocker↔artifact junction.

**Step convenience.** `apm step complete <run> <step> --image-file <path> [--kind]
[--alt] --agent <a>` → ingest image, wrap/append into the step's evidence doc, set
`output_artifact_id`. One command for the "prove this step" path.

**New repo method:** `linkedImages(workItemId)` → all image roots for a WI (via
`linkedRoots` filtered to `type='image'`), since `currentByTypeForWorkItem` returns
only one (K1).

## 6. Capture Specs + Prompt Templates

**Capture prompt templates (reuse `prompt` entity).** A prompt of kind `capture`
holds the reliable-capture recipe (setup, waits, selectors, dynamic-region masking,
expected viewport). Agents fetch by name. Ingested images record
`capture.prompt = 'PD-3@2'` → reproducibility chain closed (recipe + metadata +
bytes).

**Required-capture spec on steps (gate).** Step def gains:

```yaml
requires:
  captures:
    - name: login-dark
      kind: screenshot
      route: /login            # optional matchers
      viewport: { w: 1280, h: 800 }
      prompt: capture-login    # recipe id agents should use
produces:
  captures: [ ... ]            # informational, for downstream requires
```

- Surfaced in `apm next --format agent` under a new `REQUIRED_CAPTURES:` block.
- **Gate:** step completion validates ≥1 linked `evidence` image matching each
  required capture, matched on **`metadata.kind`** + optional `route`/`viewport`
  (K4 — match on kind, never on artifact `type`, which is always `image`).
  Missing/mismatched → completion rejected, listing unmet capture names. Pure domain
  validation (metadata is plain data).

**Reliability boundary.** APM enforces *presence + shape*, not visual correctness
(no pixel inspection). The recipe drives capture reliability; a human/review-gate
step judges actual pixels.

## 7. Viewer (www / mobile / zoom / diff)

Extends the existing React viewer + file server.

**Serving (P2).** Resolve blobs by sha (`/api/blob/<sha>` or
`/api/files?path=blobs/…`). sha-addressed bytes are immutable →
`Cache-Control: public, max-age=31536000, immutable` + `ETag: <sha>` (304 on
revalidate). Keep existing `X-Content-Type-Options: nosniff` + SVG CSP sandbox.
Biggest perf lever for mobile/zoom re-fetch.

**Image detail.** Full-bleed view + capture-metadata panel (tool, url, viewport,
dpr, theme, git sha, recipe, captured_at). Version dropdown walks the lineage.

**Zoom.** Client-side pan/zoom (CSS transform / light lib); full-res cached bytes.
No server tiling in V1.

**Diff (pair + serve, viewer overlays).** For a `before-after` pair (adjacent
versions or `image.paired` event): client-side **side-by-side**, **swipe**, and
**onion-skin** modes. Pure CSS/canvas — no server pixel compute, no diff score.

**Gallery.** Work-item image strip via `linkedImages()` (K1), grouped by relation,
lazy-loaded. Mobile: responsive grid, tap → detail. **No thumbnails (P3)** —
lazy-load + immutable cache + responsive `<img>` carry V1; server thumbnails
deferred.

## 8. Agent Access (by ID or path)

**`apm next --format agent`** extends `ContextRef` for `type='image'` (C4):

```
REQUIRED_CONTEXT:
IMG-7@1 "login screen, error toast" [image]
  path: .apm/blobs/ab/<sha>.png
  url:  http://127.0.0.1:7842/api/blob/<sha>
  alt:  login screen, error toast visible

REQUIRED_CAPTURES:
login-dark  kind=screenshot route=/login viewport=1280x800  recipe=capture-login
```

So one contract yields images to consume (path+url+alt) and images to emit
(name+kind+matchers+recipe).

- **By ID:** `apm image show IMG-7 --format agent` → resolvable handle (path, blob,
  url, mime, w×h, alt, capture, version). Never bytes (F1).
- **By path:** content-addressed `.apm/blobs/<2>/<sha>.<ext>` is stable + verifiable
  (path *is* the hash). Agent `Read`s it directly.
- **Producing:** agent captures (own tool, per recipe) → `apm image add …` → `IMG-N`
  → embeds `apm:IMG-N` / passes to `apm step complete --image-file`.
- **Multimodal hand-off:** the contract yields a real filesystem path; a
  vision-capable runner `Read`s the image into its own context. APM stays
  text/state-only — never proxies pixels into the contract.

## 9. Events Summary

- `image.created { kind, blob, version }`
- `image.linked { work_item, relation, blocker? }`
- `image.superseded { from, to }`
- `image.paired { a, b, kind }`

## 10. Engineering Invariants Honored

- Storage only via `Storage.transaction`; blob file IO isolated in `BlobStore`
  service, outside pure domain.
- Domain pure; `now` via `Clock`; sha256/dims/capture passed in as data.
- Every mutation allocates from `sequences` and appends an `events` row in the same
  transaction.
- Artifacts (incl. images) immutable; revisions create new versions.
- No native deps added (image-size is pure JS); no server pixel processing.

## 11. Documentation Drift (housekeeping)

- Add `IMG-` to the id-prefix list in `CLAUDE.md` + CLI Command Specification.
- `apm artifact list` now includes `type='image'` rows; `apm image list` is the
  filtered view. Decide whether `artifact list` hides images by default.

## 12. Milestones (implementation ordering)

1. **Foundation:** plumb `metadata_json` (C1) · `IMG` prefix (C2) · `blobs` table +
   `BlobStore` service + `image-size` dep (C3) · `max_blob_bytes` policy.
2. **Entity + CLI:** `apm image add/revise/show/list/save/copy/open/find/pair/embed`
   · `linkedImages()` (K1) · relations.
3. **Linking + verification:** `step complete --image-file`, evidence-doc embedding
   (K2), blocker payloads.
4. **Capture specs + prompts:** `requires.captures` gate (K4) · capture prompt kind ·
   `REQUIRED_CAPTURES` in agent contract.
5. **Agent access:** `ContextRef` image fields (C4) · `agent` format handles.
6. **Viewer:** blob serving + immutable cache (P2) · detail/zoom/gallery · diff
   overlays.
7. **Deferred:** server thumbnails; perceptual diff/score (revisit only if needed).
