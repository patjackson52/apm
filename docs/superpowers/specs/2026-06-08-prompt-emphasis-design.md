# Prompt Emphasis — Design Spec

**Date:** 2026-06-08
**Status:** draft (brainstorming output; precedes hi-fi design + implementation plan)
**Topic:** Make the prompt that drives a work item a first-class, visible, traceable, editable thing in APM + the Viewer.

---

## 1. Problem & intent

When an agent runs a work item, a **prompt** is what it actually receives. Today that prompt is nearly invisible:

- You can't see **which prompt will be used** for a work item before it runs.
- For a running/completed item, the persisted contract references the stored prompt **by name only** — it does not contain the prompt body the agent actually got, so "what exactly started this work item" is not recoverable.
- There's **no way to view a stored prompt** in the Viewer (no API, no screen), and **no way to edit** one.

Intent: make it unmistakable, for any work item, **what prompt will run / did run**, **how that prompt is composed** (stored body vs APM's contract scaffold), **link to the stored prompt**, and provide a path to **edit** it.

## 2. What exists today (grounded in code)

- `prompt_definitions(id, name, version, body, created_at)`. `repos.prompts.insert(name, body)` **already auto-increments `version` per name**; `byName` returns the latest. CLI: `create` / `list` / `show` only.
- Workflow `agent_prompt` steps carry `prompt_id` (a name reference). `apm workflow register` validates referenced prompts exist (PR #38).
- `apm next --acquire` persists `dispatch_prompt` (the rendered **contract**) on `workflow_step_runs` + emits a `workflow_run.dispatched` event (PR #38). The contract renders `PROMPT:\n<name>` — **the body is not inlined**.
- `buildContract` + `renderDispatchPrompt` (`src/domain/contract.ts`) are the single shared composer; `requiredContext` is computed inline in `next.ts`.
- Viewer `StepPopover` shows `dispatch_prompt` as plain text. Viewer is **read-only V1** (daemon: loopback + no-CORS + GET-only; writes are disabled "soon" stubs).

## 3. Gaps

| Layer | Gap |
|---|---|
| Capture | The dispatch contract references a prompt by name; the **body the agent received is never snapshotted**. |
| Provenance | Step runs don't record which prompt **name@version** was used. |
| API | No `/api/prompts*`; no per-work-item "next prompt" preview. |
| Viewer | No prompt surfaces at all; no link from a work item to its prompt. |
| Mutation | No prompt **edit** (create-only); viewer is read-only. |
| Identity | APM's charter says it is **"not a prompter."** Emphasizing/composing/editing prompts nudges that line — **ADR-worthy**. |

## 4. Decisions (this brainstorm)

1. **Composed + snapshotted.** APM resolves the stored prompt body **into** the dispatch contract and snapshots the exact composed text on the run. Completed items show precisely what the agent received.
2. **Design the full edit affordance now; V1 is CLI-backed.** The Viewer stays read-only; "Edit" reveals a copyable `apm prompt revise …` command. Real in-Viewer writes are a later milestone behind the same design.
3. **Edit prompt body only, versioned.** Re-binding which prompt a step uses, and per-work-item overrides, are **out of scope**.
4. **Surfaces:** a prominent work-item **Prompt panel** (marquee) **and** a dedicated **Prompts library** (list + detail w/ version history + where-used).
5. **Architecture A:** extend the existing dispatch machinery (compose into `dispatch_prompt` + record provenance columns) rather than a new snapshot table or re-compose-on-read.

## 5. Core / backend design

### 5.1 Data model
- `workflow_step_runs`: add `prompt_definition_id TEXT NULL` — a single FK to the exact `prompt_definitions` row dispatched (which *is* `name@version`; resolves name/version/body by join). Null for non-`agent_prompt` steps. (Supersedes the earlier two-column `prompt_id`+`prompt_version`; the hi-fi design grounds on this single FK.) `dispatch_prompt` continues to hold the **composed verbatim** text (contract + inlined body) — the snapshot source of truth.
- **Migration v3**: guarded `ALTER ADD COLUMN` ×1 (nullable), mirroring v2. No backfill — legacy rows keep null provenance and a body-less `dispatch_prompt`.

### 5.1a Shared contract grammar (render + parse)
The `renderDispatchPrompt` grammar (`WORK_ITEM`/`CURRENT_STEP`/`PROMPT (name@version)`/`ALLOWED_ACTION`/`REQUIRED_CONTEXT`/`DO_NOT`/`WHEN_DONE`) is APM-controlled and deterministic. To render the Viewer's **Layered** view of a snapshot without storing structure twice, add a **shared parser** that splits a stored `dispatch_prompt` back into its sections + the body region. Render (apm-core) and parse (viewer, or apm-core helper) share one grammar module so they can't drift. The verbatim snapshot stays the single source of truth; "Raw" view shows it directly, "Layered" view renders the parse.

### 5.2 Shared composer (the cohesion requirement)
- Extract from `next.ts` a pure read-only `buildDispatch(tx, workItem, run, stepDef) → DispatchPayload` that owns the `requiredContext` computation now inline at `next.ts`. **Both** `next` (acquire/preview) **and** the work-item preview endpoint call it, so a preview can never drift from the real dispatch.
- `DispatchPayload` gains `prompt_name`, `prompt_version`, `prompt_body`. `renderDispatchPrompt` renders `PROMPT (name@version):\n<body>` instead of just the name.
- At `--acquire`: resolve `prompts.byName(prompt_id)`, store composed text in `dispatch_prompt`, record `prompt_id`/`prompt_version`; `workflow_run.dispatched` payload carries `name@version`.

> **Contract-shape change (intended):** `apm next --format agent` now emits the prompt body inline under `PROMPT (name@version):`. The runner playbook's separate `apm prompt show` becomes redundant (harmless). Document in the CLI Command Specification + CLAUDE.md.

### 5.3 Per-state marquee semantics
- **pre-run** → composed **preview (as of now)** of the next pending `agent_prompt` step (not persisted).
- **active** → currently-dispatched step's snapshot.
- **completed** → last dispatched `agent_prompt` snapshot.
- **blocked** → next agent_prompt + "won't run until unblocked".
- **draft / no workflow attached** → empty CTA.
- **current step not `agent_prompt`** → "no prompt for this step".
- A **prompt timeline** (§6) exposes every `agent_prompt` dispatch of the item's primary run in order, so "what started it" (first) and "what's next" are both reachable. Primary run = active run, else latest.

### 5.4 CLI
- `apm prompt create` — **rejects an existing name (E_CONFLICT)** (today it silently versions).
- `apm prompt revise <name> --body-file <f> | --body <inline>` — explicit versioned bump; inline/stdin supported so short edits skip a file.
- `apm prompt show <name> [--version N]`.
- `apm prompt history <name>` (or `show` lists versions).
- **Name validation** `^[A-Za-z0-9._-]+$` on create/revise (path-safe routing; hardens workflow `prompt_id` refs).

### 5.5 Repo additions
- `prompts.listLatest()` — latest-per-name (`GROUP BY name, MAX(version)`) for the library. `list()` stays full-history for the detail view.
- `prompts.byNameVersion(name, v)` — exact historical version (provenance/snapshot link).
- `prompts.whereUsed(name)` — scan active `workflow_definitions.definition_json` for `steps[].prompt_id == name`, plus `workflow_step_runs WHERE prompt_id=name`. O(defs) JSON parse; fine at local scale.

### 5.6 API (serve, read-only GET)
- `GET /api/prompts` → latest-per-name + version count + where-used count.
- `GET /api/prompts/:name` → latest body + version list + where-used (summarized).
- `GET /api/prompts/:name/versions/:v` → exact historical version.
- `GET /api/work/:id/next-prompt` → **pre-run preview only** (shared composer). Active/completed snapshots ride the existing `/api/runs/:id/steps`.
- `StepRunView` += `prompt_id`, `prompt_version` → ripples to `@apm/types` (strict), `entities.toStepRunView`, viewer overlay, contract test (same plumbing as `dispatch_prompt`; remember the `@apm/types` rebuild).

### 5.7 Provenance / versioning
- Snapshot links resolve to `prompt_version` exactly (`byNameVersion`). "Newer version exists" = snapshot `prompt_version` < latest `byName` version.

## 6. Viewer UX design

> **Hi-fi specs (authoritative for visuals):** `docs/APM Viewer Design System _with_prompts/prompt-surfaces/` — `Screens Spec.html` + `surface_{panel,library,detail,popover}.jsx` + `parts.jsx` + `prompts.css` + `prompt_data.js`. The sections below are the product intent; the hi-fi files are the pixel/markup source of truth.

> **CSS-adoption decision (foundational):** the current viewer uses CSS Modules with **zero** design-system classes — the root cause of the fidelity gap. Implementation must **adopt the design-system CSS** (`prompts.css` + the shared DS primitives it builds on from `app.css`/`screens.css`/`workflow.css`) and translate the mock JSX into viewer React components **reusing the same class vocabulary** (`.pp`, `.composed`, `.scaf`, `.stored`, `.plib`, `.pd-*`, `.cli-btn`, `.mono`, …) — not paraphrase them into new Modules. Honors the `colors_and_type.css` tokens already ported.

### 6.1 Work-item Prompt panel (marquee)
A **persistent panel on the work-item Overview / header** (not a tab — emphasis requires prominence). Contains:

- **Current/next prompt headline** — state-aware per §5.3, labeled "preview (as of now)" pre-run.
- **Prompt timeline** — every `agent_prompt` dispatch of the primary run in order (brainstorm → design → planning); each: `name@version`, dispatched-when, link to the step.
- **Layering** — within any prompt, visually separate the **stored prompt body** (editable, linked, `name@version` chip; sanitized Markdown) from the **contract scaffold** (`WORK_ITEM`/`ALLOWED_ACTION`/`REQUIRED_CONTEXT`/`DO_NOT`/`WHEN_DONE`; monospace, muted, plain text). Distinguish by **label + section + border, not color alone**.
- **Edit via CLI** — a distinct "available-now" affordance (NOT the disabled "soon" stub): "Copy current body" + a prefilled `apm prompt revise <name> …`, with explicit scope copy: *"Edits the shared prompt `<name>`; future runs use the new version — this run's snapshot is unchanged."*
- **Provenance** — `name@version` chip → Prompts detail at that version; "newer version exists" badge when the snapshot lags live.

### 6.2 Prompts library (new top-level nav "Prompts", near Workflows)
Artifacts-index style: latest-per-name rows (name, latest version, where-used count, updated), search/filter, optional built-in badge → detail.

### 6.3 Prompt detail (`/prompts/[name]`)
Rendered body (+ raw/copy), version history (selectable; diff is nice-to-have → V1 side-by-side), **where-used summarized** ("1 workflow def · dispatched in N runs" + paginated drill-down, never a raw list), and the Edit-via-CLI affordance.

### 6.4 StepPopover
Stays the **per-step** detail (one step's dispatched text + layering + provenance link); the panel is the **item-level marquee + timeline**. Complementary, not duplicated. Collapse long bodies.

### 6.5 Cross-cutting
Reuse design tokens; copy/clipboard first-class ("Copy prompt / as Markdown", "Copied ✓"); no emoji in chrome; plain-text (no markdown/HTML sink) for the scaffold; sanitized Markdown (WI-28 renderer) for the body; loading/empty/error on every surface.

## 7. Non-goals
- Prompt delete/archive.
- Re-binding which prompt a step/work-item uses; per-work-item prompt overrides.
- Editing workflow definitions.
- In-Viewer write endpoints (deferred milestone; V1 is CLI-backed).
- Version **diff** rendering (nice-to-have).

## 8. Risks / open items
- **Charter tension** ("not a prompter") → write an **ADR** recording that APM now composes + snapshots the agent prompt and surfaces/edits stored prompts, with the boundary (it stores/composes/snapshots; it does not author or send).
- Composed `dispatch_prompt` grows (bodies can be long) — TEXT column is fine; Viewer collapses.
- Preview is "as of now," not a guarantee of the future dispatch.

## 9. Testing
- **apm-core:** `create` rejects dup name; `revise` versions; `byNameVersion`; `listLatest`; `whereUsed`; `next` composes body + records `prompt_id/version`; **preview composer === dispatch composer** (same function → byte-identical); migration v3 adds columns to a pre-v3 DB.
- **serve/contract:** `/api/prompts`, `/:name`, `/:name/versions/:v`, `/api/work/:id/next-prompt`; `StepRunView` new fields.
- **viewer:** panel state matrix + timeline; layering renders body+scaffold as **plain text** for the scaffold (no script execution); library; detail where-used pagination; popover; loading/empty/error.

## 10. Next steps
1. Recreate **hi-fi specs** for the surfaces in §6 via the `apm-viewer-design` skill (handoff prompt in Appendix A).
2. ADR for the charter-boundary decision.
3. `writing-plans` → implementation plan (core → API → viewer), TDD.

---

## Appendix A — Hi-fi design handoff prompt

> Paste into the `apm-viewer-design` skill (or Claude design) to produce the hi-fi spec. See §6 for the authoritative surface list.

```
Use the apm-viewer-design skill. Read its README.md, colors_and_type.css, the preview/*.html
reference cards, and the ui_kits/apm-viewer kit FIRST — reuse the existing tokens, status color
system, type scale, and class vocabulary. Do not invent new colors or restyle the shell; design
NEW surfaces that drop into the existing APM Viewer.

GOAL — make the *prompt* that drives a work item first-class. Produce hi-fi static HTML mockups
(light AND dark) for four surfaces, plus a short screens-spec describing states and interactions.

CONTEXT you must honor:
- APM Viewer is a read-only, local, desktop developer tool (Linear/GitHub/Vercel register;
  calm, precise, information-dense). Monospace for IDs/code; Geist sans for prose. No emoji in
  chrome. No gradients except the live-pulse. Status legibility is paramount.
- A work item runs through a workflow; its `agent_prompt` steps each dispatch a PROMPT to an
  agent. A prompt = a STORED, VERSIONED body (editable, e.g. `brainstorm_feature_v1@2`) WRAPPED
  in an APM-generated CONTRACT SCAFFOLD (WORK_ITEM / CURRENT_STEP / ALLOWED_ACTION /
  REQUIRED_CONTEXT / DO_NOT / WHEN_DONE). The exact composed text is snapshotted when dispatched.
- The single most important visual idea: in any displayed prompt, make the STORED BODY (the
  editable, linkable part) unmistakably distinct from the SCAFFOLD (system-generated). Use
  label + section + border + type treatment — NOT color alone (a11y).
- V1 is read-only: "Edit" is NOT a live editor — it is an "available via CLI" affordance that
  reveals a copyable `apm prompt revise <name> …` command + "Copy current body", with copy that
  says editing changes the SHARED prompt for FUTURE runs, not this run's snapshot. Treat this as
  a NEW affordance pattern, visually distinct from the existing disabled "soon" write stubs.

SURFACES to design:

1) Work-item Prompt panel (the MARQUEE) — a prominent, persistent panel on the work-item detail
   (header/Overview, NOT hidden in a tab). Show:
   - a state-aware headline prompt: pre-run ("Will run — preview as of now"), active
     ("Dispatched <when>"), completed ("Started with"), plus blocked / draft-no-workflow /
     non-agent_prompt-step empty states.
   - a PROMPT TIMELINE: each agent_prompt dispatch of the run in order (brainstorm → design →
     planning), each a `name@version` chip + time, linking to that step.
   - the layered body-vs-scaffold rendering, collapsible.
   - the Edit-via-CLI affordance + a `name@version` provenance chip with a "newer version exists"
     badge state.

2) Prompts library — a new top-level nav screen ("Prompts", near Workflows). A list of stored
   prompts: name, latest version, where-used count, updated; search/filter; built-in badge.

3) Prompt detail (/prompts/[name]) — rendered body + raw/copy; version history (selectable;
   show a side-by-side two-version compare); WHERE-USED summarized ("1 workflow def · dispatched
   in N runs") with paginated drill-down (never a raw list of hundreds); Edit-via-CLI affordance.

4) Step popover (enhancement) — one step's dispatched composed prompt with the same layering +
   provenance link; long bodies collapsed.

For each surface: light + dark, realistic mock data (use ids like WI-12, RUN-22,
`brainstorm_feature_v1@2`), all key states, and first-class copy affordances ("Copy prompt",
"Copy as Markdown", "Copied ✓"). Deliver static HTML linking colors_and_type.css + the relevant
ui-kit CSS, reusing the existing class vocabulary, plus a brief screens-spec (states + notes).
```
