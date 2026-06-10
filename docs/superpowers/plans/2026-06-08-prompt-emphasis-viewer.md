# Prompt Emphasis — Plan B: Viewer (DS CSS adoption + the four prompt surfaces)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the prompt first-class in the Viewer by building the four hi-fi surfaces — work-item Prompt panel, Prompts library, Prompt detail, and an enhanced step popover — faithfully to the design system, wired to Plan A's endpoints.

**Architecture:** Adopt the design-system CSS as the styling substrate for these surfaces (copy `prompts.css` + the small set of DS primitives it depends on into the viewer as global CSS, reusing the exact class vocabulary — the fix for the existing fidelity gap). Port the designer's `surface_*.jsx` / `parts.jsx` into viewer React components 1:1 on markup/classes, replacing mock props with API data. The server already returns structured panels (Plan A R1), so the viewer renders — it never parses the contract grammar.

**Tech Stack:** Next.js App Router, React, TanStack Query, the existing `lib/api` layer, `@apm/types` (Plan A schemas), `lucide-react` (new), the existing sanitized `Markdown` renderer (WI-28), Vitest + @testing-library/react + jsdom.

**Prereq:** Plan A merged/available (endpoints `/api/prompts`, `/api/prompts/:name`, `/api/prompts/:name/versions/:v`, `/api/prompts/:name/usage`, `/api/work/:id/prompt-panel`; `@apm/types` schemas built).

**Design source of truth (markup/visuals):** `docs/APM Viewer Design System _with_prompts/prompt-surfaces/` — `Screens Spec.html`, `surface_{panel,library,detail,popover}.jsx`, `parts.jsx`, `prompts.css`, `prompt_data.js`. Spec: `docs/superpowers/specs/2026-06-08-prompt-emphasis-design.md` §6.

---

## Conventions
- Tests run from `viewer/`: `npx vitest run <path>`. Typecheck: `npm run typecheck`. Dev: `npm run dev`.
- Hooks mock pattern: see `components/doc/ArtifactDetail.test.tsx` (vi.mock `@/lib/api/hooks`).
- **Security (PLAN.md, non-negotiable):** the **scaffold** sections render as **plain text** (no markdown/HTML sink); the **stored body** renders through the existing sanitized `Markdown` component; the **Raw** view is verbatim text in a `<pre>`. Never `dangerouslySetInnerHTML` for any prompt/contract text.
- Commit after each task.

## File Structure
| File | Responsibility |
|---|---|
| `viewer/app/ds/prompts.css` | **copy** of the DS `prompts.css` (global) |
| `viewer/app/ds/primitives.css` | extracted DS primitives the surfaces reuse (`.card .btn .chip .mono .subtle .page .page__head .icon-btn .copy-split .raw-snap .cli-btn`) |
| `viewer/app/layout.tsx` | import the two DS stylesheets after tokens/globals |
| `viewer/lib/api/{endpoints,keys,hooks}.ts` | prompt + prompt-panel queries |
| `viewer/lib/prompt/diff.ts` | word-level diff for version compare |
| `viewer/components/prompt/ComposedPrompt.tsx` | layered body-vs-scaffold + Raw toggle (port `parts.jsx` ComposedPrompt/ScafBlock/RawSnapshot) |
| `viewer/components/prompt/StoredBody.tsx` | clampable stored-body card (sanitized Markdown) |
| `viewer/components/prompt/ProvenanceChip.tsx` | `name@version` chip + "newer" amber badge |
| `viewer/components/prompt/EditViaCli.tsx` | the CLI-edit affordance + shared-scope warning |
| `viewer/components/prompt/PromptTimeline.tsx` | dispatch timeline |
| `viewer/components/prompt/PromptPanel.tsx` | Surface 1 (marquee) |
| `viewer/components/prompt/PromptsList.tsx` + `viewer/app/prompts/page.tsx` | Surface 2 |
| `viewer/components/prompt/PromptDetail.tsx` + `viewer/app/prompts/[name]/page.tsx` | Surface 3 |
| `viewer/components/workflow/StepPopover.tsx` | Surface 4 (enhance) |
| `viewer/components/shell/Sidebar.tsx` | add "Prompts" nav |
| `viewer/components/doc/WorkDetailTabs.tsx` | mount `PromptPanel` above the tabs |

---

## Phase 0 — Substrate

### Task B1: Adopt the design-system CSS + lucide

**Files:** create `viewer/app/ds/prompts.css`, `viewer/app/ds/primitives.css`; modify `viewer/app/layout.tsx`, `viewer/package.json`.

- [ ] **Step 1: Add lucide.** Run in `viewer/`: `npm install lucide-react@^0.544.0`.

- [ ] **Step 2: Copy `prompts.css`.** Copy `docs/APM Viewer Design System _with_prompts/prompt-surfaces/prompts.css` verbatim to `viewer/app/ds/prompts.css`.

- [ ] **Step 3: Extract DS primitives.** From `docs/APM Viewer Design System _with_prompts/ui_kits/apm-viewer/app.css` (+ `screens.css`), copy ONLY these rule-blocks into `viewer/app/ds/primitives.css`: `.card`, `.card__head`, `.card__title`, `.card__action`, `.card__body`, `.btn`, `.chip`, `.mono`, `.subtle`, `.page`, `.page__head`, `.page__title`, `.page__sub`, `.icon-btn`, `.copy-split`, `.raw-snap`, `.cli-btn`, `.cli-btn__tag`, `.board__spacer`. (These are the only DS globals `prompts.css` and the surfaces reference; the rest of the shell stays in the viewer's existing CSS Modules.)

- [ ] **Step 4: Verify tokens exist.** `grep -oE '\-\-[a-z0-9-]+' viewer/app/ds/prompts.css viewer/app/ds/primitives.css | sort -u` and confirm each appears in `viewer/app/tokens.css`. For any missing token (likely candidates: `--bg-subtle`, `--bg-muted`, `--shadow-xs`, `--radius-lg`, `--text-2xs`, `--fg`), copy its definition (both light + `[data-theme="dark"]`) from `docs/APM Viewer Design System _with_prompts/colors_and_type.css` into `viewer/app/tokens.css`.

- [ ] **Step 5: Import globally.** In `viewer/app/layout.tsx`, after `import './globals.css';` add:
```ts
import './ds/primitives.css';
import './ds/prompts.css';
```

- [ ] **Step 6: Smoke.** Run `npm run dev`; the app must still load with no console CSS errors (the new globals don't collide with the Module-hashed shell classes). `npm run typecheck` clean.

- [ ] **Step 7: Commit.**
```bash
git add viewer/app/ds viewer/app/layout.tsx viewer/package.json viewer/package-lock.json viewer/app/tokens.css
git commit -m "feat(viewer): adopt design-system prompt CSS + primitives + lucide"
```

---

### Task B2: API wiring — prompt + prompt-panel queries

**Files:** modify `viewer/lib/api/endpoints.ts`, `keys.ts`, `hooks.ts`. Test: `viewer/lib/api/prompt-endpoints.test.ts` (create).

- [ ] **Step 1: Write the failing test.**
```ts
import { describe, it, expect } from 'vitest';
import { ep } from './endpoints';
it('builds prompt endpoint paths', () => {
  expect(ep.prompts.path()).toBe('/api/prompts');
  expect(ep.prompt.path('brainstorm_feature_v1')).toBe('/api/prompts/brainstorm_feature_v1');
  expect(ep.promptUsage.path('p', { limit: 20, offset: 0 })).toBe('/api/prompts/p/usage?limit=20&offset=0');
  expect(ep.promptPanel.path('WI-1')).toBe('/api/work/WI-1/prompt-panel');
});
```
- [ ] **Step 2: Run — expect FAIL.** `npx vitest run lib/api/prompt-endpoints.test.ts`
- [ ] **Step 3: Implement.** In `endpoints.ts` import the new schemas from `@apm/types` (`PromptSummaryViewSchema, PromptDetailViewSchema, PromptVersionViewSchema, PromptPanelViewSchema, WhereUsedRowSchema`) and add to `ep`:
```ts
  prompts: { path: () => '/api/prompts', schema: z.array(PromptSummaryViewSchema) },
  prompt: { path: (name: string) => `/api/prompts/${encodeURIComponent(name)}`, schema: PromptDetailViewSchema },
  promptVersion: { path: (name: string, v: number) => `/api/prompts/${encodeURIComponent(name)}/versions/${v}`, schema: PromptVersionViewSchema },
  promptUsage: { path: (name: string, f: { limit?: number; offset?: number } = {}) => `/api/prompts/${encodeURIComponent(name)}/usage${qs({ limit: f.limit, offset: f.offset })}`, schema: pageSchema(WhereUsedRowSchema) },
  promptPanel: { path: (id: string) => `/api/work/${id}/prompt-panel`, schema: PromptPanelViewSchema },
```
In `keys.ts`: `prompts: () => ['prompts'] as const, prompt: (n: string) => ['prompts', n] as const, promptUsage: (n: string, f: object = {}) => ['prompts', n, 'usage', f] as const, promptPanel: (id: string) => ['work', id, 'prompt-panel'] as const,`.
In `hooks.ts`:
```ts
export const usePrompts = (o?: Opt) => useApiQuery(qk.prompts(), ep.prompts.path(), ep.prompts.schema, SEMI, o);
export const usePrompt = (n: string, o?: Opt) => useApiQuery(qk.prompt(n), ep.prompt.path(n), ep.prompt.schema, false, o);
export const usePromptUsage = (n: string, f: { limit?: number; offset?: number } = {}, o?: Opt) => useApiQuery(qk.promptUsage(n, f), ep.promptUsage.path(n, f), ep.promptUsage.schema, false, o);
export const usePromptPanel = (id: string, o?: Opt) => useApiQuery(qk.promptPanel(id), ep.promptPanel.path(id), ep.promptPanel.schema, VOLATILE, o);
```
- [ ] **Step 4: Run — expect PASS.** `npx vitest run lib/api/prompt-endpoints.test.ts` + `npm run typecheck`.
- [ ] **Step 5: Commit.** `git add viewer/lib/api && git commit -m "feat(viewer): prompt + prompt-panel API hooks"`

---

## Phase 1 — Shared prompt components (port `parts.jsx`)

### Task B3: ComposedPrompt (layered body-vs-scaffold + Raw) — the core component

**Files:** create `viewer/components/prompt/ComposedPrompt.tsx`. Test: `ComposedPrompt.test.tsx`.

Consumes a `StructuredDispatch` (from `@apm/types`): `{ prompt_name, prompt_version, latest_version, body, scaffold:{allowed_action, required_context[], do_not[], when_done[]}, raw, status, … }`.

- [ ] **Step 1: Write the failing test (security + layering).**
```ts
import { render, screen } from '@testing-library/react';
import { ComposedPrompt } from './ComposedPrompt';
const d = { step_id:'s', step_type:'agent_prompt', status:'completed', prompt_name:'p', prompt_version:2, latest_version:3,
  body:'Stored body text', scaffold:{ allowed_action:'<script>alert(1)</script>', required_context:['SPEC-1@2 "x" — y'], do_not:['write code'], when_done:['apm step complete'] },
  raw:'WORK_ITEM:\nWI-1\n\nPROMPT (p@2):\nStored body text', at:'2026-06-01' };
it('renders scaffold as inert plain text and body separately', () => {
  const { container } = render(<ComposedPrompt dispatch={d as any} />);
  expect(screen.getByText('Stored body text')).toBeTruthy();
  expect(container.querySelector('script')).toBeNull();           // scaffold not executed
  expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy(); // shown as literal text
});
it('Raw toggle shows the verbatim snapshot', () => {
  render(<ComposedPrompt dispatch={d as any} defaultView="raw" />);
  expect(screen.getByText(/WORK_ITEM:/)).toBeTruthy();
});
```
- [ ] **Step 2: Run — expect FAIL.** `npx vitest run components/prompt/ComposedPrompt.test.tsx`
- [ ] **Step 3: Implement.** Port `parts.jsx`'s `ComposedPrompt` + `ScafBlock` + `RawSnapshot` to `ComposedPrompt.tsx`, preserving classes (`.composed`, `.composed__bar`, `.mini-seg`, `.composed__doc`, `.scaf*`, `.stored*`, `.raw-snap`). Use `lucide-react` icons (`Ban` for DO_NOT, `Flag` for WHEN_DONE). Render scaffold section values as **plain text** (`{value}` in a `<div className="scaf__line">`), and the stored body via `<StoredBody … />` (Task B4) at the PROMPT position. `defaultView` prop (`'layered' | 'raw'`), `tight`/`clampBody` props for the popover. Raw view = `<pre className="raw-snap">{dispatch.raw}</pre>` with the body region given the `.raw-body` rail (optional; plain `<pre>` acceptable for V1). Copy split button ("Copy as Markdown / plain"): create `viewer/lib/prompt/compose.ts` with `composeMarkdown(dispatch)` (sections as `## WORK_ITEM`, fenced/quoted body, etc.) — "Copy as Markdown" copies that; "Copy plain" copies `dispatch.raw` verbatim. (The server `raw` is the canonical plain snapshot; the Viewer only adds the Markdown rendering.)
- [ ] **Step 4: Run — expect PASS.** Re-run the test.
- [ ] **Step 5: Commit.** `git add viewer/components/prompt/ComposedPrompt.tsx viewer/components/prompt/ComposedPrompt.test.tsx && git commit -m "feat(viewer): ComposedPrompt — layered scaffold/body + Raw (plain-text safe)"`

---

### Task B4: StoredBody, ProvenanceChip, EditViaCli, PromptTimeline

**Files:** create the four components under `viewer/components/prompt/`. Test: `prompt-parts.test.tsx`.

- [ ] **Step 1: Write the failing tests.**
```ts
import { render, screen } from '@testing-library/react';
import { ProvenanceChip } from './ProvenanceChip';
import { EditViaCli } from './EditViaCli';
it('ProvenanceChip shows newer-version badge in amber when latest > version', () => {
  render(<ProvenanceChip name="p" version={2} latest={3} />);
  expect(screen.getByText(/v3 available/i)).toBeTruthy();
});
it('EditViaCli surfaces the revise command + shared-scope warning', () => {
  render(<EditViaCli name="p" open />);
  expect(screen.getByText(/apm prompt revise p --body-file/i)).toBeTruthy();
  expect(screen.getByText(/future runs/i)).toBeTruthy(); // scope warning
});
```
- [ ] **Step 2: Run — expect FAIL.** `npx vitest run components/prompt/prompt-parts.test.tsx`
- [ ] **Step 3: Implement** by porting from `parts.jsx`:
  - `StoredBody` — header eyebrow "Stored prompt body", `name@version`, pill "Editable · shared", clamp (`is-clamped`), "Copy body". Body rendered via the existing `@/components/markdown/Markdown` (sanitized) — NOT plain — since stored bodies are prose/markdown.
  - `ProvenanceChip({name, version, latest})` — `<a href={\`/prompts/${name}\`}>` chip; if `latest > version`, append amber badge `v{latest} available` (class `.prov-newer`), title "Newer stored version v{latest} exists".
  - `EditViaCli({name, body?, open?})` — click-away popover (mirror `StepPopover`'s outside-mousedown). Command text `apm prompt revise {name} --body-file ./{name}.md`; "Copy current body" + "Copy command"; warning copy verbatim: *"Edits the shared prompt for future runs. This run already snapshotted its dispatched text — that snapshot does not change."* Style with `.cli-btn` (enabled — NOT a "soon" stub).
  - `PromptTimeline({items, currentId, onSelect})` — port the timeline; each node `name@version` + check/loader by status, `is-current` highlight.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.** `git add viewer/components/prompt && git commit -m "feat(viewer): StoredBody, ProvenanceChip, EditViaCli, PromptTimeline"`

---

## Phase 2 — Surfaces

### Task B5: Work-item Prompt panel (Surface 1)

**Files:** create `viewer/components/prompt/PromptPanel.tsx`; modify `viewer/components/doc/WorkDetailTabs.tsx`. Test: `PromptPanel.test.tsx`.

- [ ] **Step 1: Write the failing test (state matrix).**
```ts
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
const usePromptPanel = vi.fn();
vi.mock('@/lib/api/hooks', () => ({ usePromptPanel: (id: string) => usePromptPanel(id) }));
import { PromptPanel } from './PromptPanel';
const mk = (over = {}) => ({ data: { state:'completed', headline:{ step_id:'brainstorm', step_type:'agent_prompt', status:'completed', prompt_name:'brainstorm_feature_v1', prompt_version:1, latest_version:3, body:'Explore approaches', scaffold:{ allowed_action:'Produce a decision', required_context:[], do_not:['write code'], when_done:['apm step complete'] }, raw:'WORK_ITEM:\nWI-1', at:'2026-06-01' }, timeline:[{ step_id:'brainstorm', prompt_name:'brainstorm_feature_v1', prompt_version:1, status:'completed' }], provenance:{ name:'brainstorm_feature_v1', version:1, latest:3 } }, isLoading:false, isError:false, ...over });
it('renders the completed marquee with provenance newer-badge', () => {
  usePromptPanel.mockReturnValue(mk());
  render(<PromptPanel workItemId="WI-1" />);
  expect(screen.getByText('Explore approaches')).toBeTruthy();
  expect(screen.getByText(/v3 available/i)).toBeTruthy();
});
it('shows the no-workflow empty state', () => {
  usePromptPanel.mockReturnValue(mk({ data: { state:'no-workflow', headline:null, timeline:[], provenance:null } }));
  render(<PromptPanel workItemId="WI-1" />);
  expect(screen.getByText(/no workflow/i)).toBeTruthy();
});
```
- [ ] **Step 2: Run — expect FAIL.** `npx vitest run components/prompt/PromptPanel.test.tsx`
- [ ] **Step 3: Implement** by porting `surface_panel.jsx`'s `PromptPanel` (classes `.pp`, `.pp__head`, `.pp__glyph`, `.pp__title`, `.pp__state`, `.pp__headright`, `.pp-banner`, `.pp__divider`). Drive it from `usePromptPanel(workItemId)`:
  - loading → `<Skeleton/>`; error → "Failed to load prompt."
  - headline → `<ComposedPrompt dispatch={data.headline} />`; banner per `state` (`blocked` → `.pp-banner--blocked` "Blocked …"; `no-workflow`/`no-prompt`/`pre-run` → appropriate banner/empty copy from the Screens Spec); state label maps `pre-run→"Will run — preview as of now"`, `active→"Dispatched {rel}"`, `completed→"Started with"`. `{rel}` = a small `viewer/lib/format/relTime.ts` (`at` ISO → "12m ago"/"3d ago"); guard SSR/hydration by computing it in an effect or accepting a stable absolute fallback (avoid `Date.now()` during render — the hydration lesson).
  - timeline → `<PromptTimeline items={data.timeline} currentId={data.headline?.step_id} />`.
  - header right → `<ProvenanceChip {...data.provenance} />` + `<EditViaCli name={data.provenance?.name} />` (when a prompt exists).
- [ ] **Step 4: Mount it.** In `WorkDetailTabs.tsx`, render `<PromptPanel workItemId={id} />` immediately above `<Tabs … />` (persistent, not a tab — spec U1).
- [ ] **Step 5: Run — expect PASS** (panel test) and `npx vitest run components/doc/WorkDetailTabs` if present.
- [ ] **Step 6: Commit.** `git add viewer/components/prompt/PromptPanel.tsx viewer/components/prompt/PromptPanel.test.tsx viewer/components/doc/WorkDetailTabs.tsx && git commit -m "feat(viewer): work-item Prompt panel (marquee) on Overview"`

---

### Task B6: Prompts library (Surface 2) + nav

**Files:** create `viewer/components/prompt/PromptsList.tsx`, `viewer/app/prompts/page.tsx`; modify `viewer/components/shell/Sidebar.tsx`. Test: `PromptsList.test.tsx`.

- [ ] **Step 1: Write the failing test.**
```ts
const usePrompts = vi.fn();
vi.mock('@/lib/api/hooks', () => ({ usePrompts: () => usePrompts() }));
import { PromptsList } from './PromptsList';
it('lists prompts with where-used counts and links to detail', () => {
  usePrompts.mockReturnValue({ data:[{ name:'brainstorm_feature_v1', latest_version:3, version_count:3, builtin:false, summary:'Explore', updated_at:'2026-05-31', where_defs:2, where_runs:14 }], isLoading:false, isError:false });
  render(<PromptsList />);
  expect(screen.getByText('brainstorm_feature_v1')).toBeTruthy();
  expect(screen.getByText(/2 defs · 14 runs/i)).toBeTruthy();
  expect(screen.getByRole('link', { name: /brainstorm_feature_v1/ }).getAttribute('href')).toBe('/prompts/brainstorm_feature_v1');
});
it('filters by built-in/custom and searches by name', () => { /* type in .search, click chip; assert row count */ });
```
- [ ] **Step 2: Run — expect FAIL.** `npx vitest run components/prompt/PromptsList.test.tsx`
- [ ] **Step 3: Implement** by porting `surface_library.jsx` (`.plib`, `.plib__row`, `.plib__name`, `.plib__ver`, `.plib__used`, `.builtin-badge`, `.plib-toolbar`, `.search`, `.chip-row`). Driven by `usePrompts()`; columns Prompt/Latest/Where-used (`{where_defs} defs · {where_runs} runs`)/Updated/Source; filter chips All/Built-in/Custom on `builtin`; search on `name`; empty state "No prompts yet." Page (`app/prompts/page.tsx`): `<><h1>Prompts</h1><PromptsList/></>`.
- [ ] **Step 4: Add nav.** In `Sidebar.tsx` NAV array, add `{ href: '/prompts', label: 'Prompts' }` after Workflows.
- [ ] **Step 5: Run — expect PASS.**
- [ ] **Step 6: Commit.** `git add viewer/components/prompt/PromptsList.tsx viewer/app/prompts/page.tsx viewer/components/prompt/PromptsList.test.tsx viewer/components/shell/Sidebar.tsx && git commit -m "feat(viewer): Prompts library + nav"`

---

### Task B7: Prompt detail (Surface 3) — versions, word-diff, where-used pagination

**Files:** create `viewer/lib/prompt/diff.ts`, `viewer/components/prompt/PromptDetail.tsx`, `viewer/app/prompts/[name]/page.tsx`. Tests: `diff.test.ts`, `PromptDetail.test.tsx`.

- [ ] **Step 1: Write the failing diff test.**
```ts
import { wordDiff } from './diff';
it('marks removed and added words', () => {
  const d = wordDiff('the quick fox', 'the slow fox');
  expect(d.some(x => x.type==='del' && x.text==='quick')).toBe(true);
  expect(d.some(x => x.type==='add' && x.text==='slow')).toBe(true);
  expect(d.some(x => x.type==='eq' && x.text==='fox')).toBe(true);
});
```
- [ ] **Step 2: Run — expect FAIL.** `npx vitest run lib/prompt/diff.test.ts`
- [ ] **Step 3: Implement `wordDiff`** — port the word-level LCS from `surface_detail.jsx` (returns `{type:'eq'|'add'|'del', text}[]`).
- [ ] **Step 4: Write the failing detail test.**
```ts
const usePrompt = vi.fn(); const usePromptUsage = vi.fn();
vi.mock('@/lib/api/hooks', () => ({ usePrompt: (n:string)=>usePrompt(n), usePromptUsage: (n:string,f:object)=>usePromptUsage(n,f) }));
import { PromptDetail } from './PromptDetail';
it('shows version history + summarized where-used + paginated runs', () => {
  usePrompt.mockReturnValue({ data:{ name:'p', builtin:true, latest_version:2, version_count:2, summary:'s', updated_at:'x', where_defs:1, where_runs:120, versions:[{version:2,body:'v2',created_at:'b'},{version:1,body:'v1',created_at:'a'}] }, isLoading:false, isError:false });
  usePromptUsage.mockReturnValue({ data:{ items:[{run:'WR-1',work_item:'WI-1',version:2,status:'completed',at:'x'}], page:{total:120,limit:20,offset:0,has_more:true} }, isLoading:false, isError:false });
  render(<PromptDetail name="p" />);
  expect(screen.getByText(/1 .*def.*120 runs/i)).toBeTruthy();   // summarized
  expect(screen.getByText(/1–1 of 120|of 120/i)).toBeTruthy();   // paginated, not a raw dump
});
```
- [ ] **Step 5: Run — expect FAIL.** `npx vitest run components/prompt/PromptDetail.test.tsx`
- [ ] **Step 6: Implement** by porting `surface_detail.jsx` (`.pd-head`, `.pd-grid`, `.vhist`, `.vrow`, `.cmp`, `.diff-add`, `.diff-del`, `.wu-summary`, `.wu-list`, `.wu-pager`). `usePrompt(name)` for body/versions; `usePromptUsage(name, {limit:20, offset})` for paginated drill-down with prev/next; compare two selected versions via `wordDiff` (client-side, bodies already in `versions[]`); `EditViaCli`; where-used summary line `{where_defs} workflow def(s) · dispatched in {where_runs} runs — summarized`. Page (`app/prompts/[name]/page.tsx`): async params → `<PromptDetail name={id} />`.
- [ ] **Step 7: Run — expect PASS.**
- [ ] **Step 8: Commit.** `git add viewer/lib/prompt viewer/components/prompt/PromptDetail.tsx viewer/app/prompts && git commit -m "feat(viewer): Prompt detail — versions, word-diff, paginated where-used"`

---

### Task B8: Step popover (Surface 4)

**Files:** modify `viewer/components/workflow/StepPopover.tsx` (+ the run graph to pass the structured dispatch). Test: extend `StepPopover.test.tsx`.

- [ ] **Step 1: Write the failing test.**
```ts
it('renders the dispatched prompt (compact ComposedPrompt) for an agent_prompt step', () => {
  const dispatch = { step_id:'brainstorm', step_type:'agent_prompt', status:'completed', prompt_name:'p', prompt_version:1, latest_version:1, body:'Body', scaffold:{ allowed_action:'A', required_context:[], do_not:[], when_done:[] }, raw:'WORK_ITEM:\nWI-1', at:'x' };
  render(<StepPopover step={{ id:'brainstorm', type:'agent_prompt' }} dispatch={dispatch as any} onClose={()=>{}} />);
  expect(screen.getByText('Body')).toBeTruthy();
  expect(screen.getByText(/Dispatched prompt/i)).toBeTruthy();
});
```
- [ ] **Step 2: Run — expect FAIL.** `npx vitest run components/workflow/StepPopover.test.tsx`
- [ ] **Step 3: Implement.** Add an optional `dispatch?: StructuredDispatch` prop to `StepPopover`. When present, render a `<ComposedPrompt dispatch={dispatch} tight clampBody />` section titled "Dispatched prompt" + footer "Copy snapshot" / "Open prompt" (`/prompts/{name}`). The run graph (`RunGraph`/`WorkflowGraphPanel`) already has the work item id — fetch `usePromptPanel(workItemId)` there and pass the `timeline` entry whose `step_id` matches the clicked node into `StepPopover` (fallback: omit the section if no match). Keep the existing plain-text `dispatch_prompt` fallback for legacy/no-match.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.** `git add viewer/components/workflow && git commit -m "feat(viewer): step popover shows the dispatched prompt (compact ComposedPrompt)"`

---

## Phase 3 — Polish & verify

### Task B9: States, a11y, full verification

**Files:** touch components as needed. No new files expected.

- [ ] **Step 1:** Confirm every surface has loading (`Skeleton`), empty, and error states (panel no-workflow/no-prompt/blocked; library empty; detail not-found; usage empty). Add any missing with a test per the README global empty pattern.
- [ ] **Step 2: a11y** — body-vs-scaffold distinction must not be color-only (the CSS uses labels/borders; verify the rendered DOM has the section labels, not just classes). ProvenanceChip "newer" badge uses the amber/gate hue, not red.
- [ ] **Step 3: Full suites + typecheck.** `cd viewer && npx vitest run && npm run typecheck` — all green.
- [ ] **Step 4: Browser verify (Playwright).** With Plan A's daemon serving a project that has a dispatched run + several prompts: load `/prompts`, `/prompts/<name>`, a work item with a completed run, and a workflow node popover. Assert: 0 hydration errors, 0 console errors, the panel renders the layered prompt, the library lists prompts, the detail shows versions + paginated where-used. Capture a screenshot of each.
- [ ] **Step 5: Commit.** `git add -A viewer && git commit -m "feat(viewer): prompt surfaces — states, a11y, verification"`

---

## Plan B self-review
- **Surface coverage:** Panel (B5), Library (B6), Detail (B7), Popover (B8); shared parts (B3/B4); CSS adoption (B1); API (B2). All four §6 surfaces covered.
- **Fidelity decision honored:** B1 adopts the DS CSS + class vocabulary rather than re-deriving in Modules (the original divergence fix).
- **Security:** scaffold plain-text + body sanitized-Markdown + Raw verbatim `<pre>`; tested in B3.
- **No grammar duplication:** the viewer renders the server-assembled structured panel (Plan A R1); no viewer-side contract parser.
- **Known integration notes:** the run graph wiring in B8 (`WorkflowGraphPanel`/`RunGraph` → `StepPopover` dispatch prop) must be reconciled with the actual component names during implementation. `required_context` is shown as scaffold lines (strings), a minor simplification vs the mock's context chips — acceptable for V1; enhance later if desired.
