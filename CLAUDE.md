# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project State

**V1 complete. TypeScript/Node CLI; full work-graph + workflow engine + agent loop. See docs/superpowers/plans/ for the 4 implementation plans.** Specs in `docs/`; design spec in `docs/superpowers/specs/2026-06-02-apm-v1-cli-design.md`; implementation plans in `docs/superpowers/plans/`. `.obsidian/` is editor config; `.apm/` (runtime db) is gitignored.

## Commands

- Install: `npm install`
- Test (all): `npm test`  — single file: `npx vitest run tests/path/to/file.test.ts`  — watch: `npm run test:watch`
- Typecheck: `npm run typecheck`
- Build: `npm run build` (emits `dist/`, binary at `dist/bin/apm.js`)
- Run without building: `npx tsx src/bin/apm.ts <args>` (or `npm run apm -- <args>`)
- Init a project: `apm init` (creates `.apm/apm.db` + `.apm/config.yaml`)
- Work items: `apm work create --type <t> --title <s> --agent <a>` · `work show <id>` · `work list` · `work update <id> --status ready` · `work link <id> --depends-on <id>` · `work children <id>` · `work cancel <id>` · `work complete <id>`
- Sessions: `apm session start --agent <a>` · `session show <id>` · `session summarize <id> --body <s>` · `session end <id>`
- Leases: `apm lease acquire <wi> --agent <a> --ttl 30m` · `lease heartbeat <id> --ttl 30m` · `lease release <id>` · `lease expire-stale` · `lease list --agent <a>`
- Global: `-o, --format human|json|yaml|agent` (default human at TTY, json piped; `APM_FORMAT` to pin)
- Workflows: `apm workflow list` · `workflow show <nameOrId>` · `workflow attach <wi> --workflow <name> --agent <a>` · `workflow register --file <path>` · `workflow runs <wi>`
- Runs: `apm run cancel <runId>`
- Steps: `apm step complete <run> <step> --agent <a> [--artifact <id> | --artifact-type <t> --body-file <f> | --image-file <f> [--image-kind screenshot] [--image-alt <s>]]` · `step fail <run> <step> --reason <r> --agent <a>` · `step retry <run> <step> --agent <a>` · `step review <run> <step> --reviewer <role> --verdict <v> --agent <a> [--artifact <id>]`
- Capture gates: a step may declare `requires.captures: [{ name, kind, route?, viewport?, prompt? }]`; completion is blocked until a linked `evidence` image matches each (matched on image `metadata.kind` + route/viewport). Surfaced to agents as `REQUIRED_CAPTURES:` in `apm next --format agent`; a capture's `prompt:` names an existing prompt (the capture recipe), shown as `recipe=<name>`. `apm step complete --image-file` ingests a screenshot, links it as `evidence`, embeds it in a `review` output doc, and satisfies the gate.
- Image context: when a dispatched step `requires.artifacts: [image]`, `apm next --format agent` renders the image under `REQUIRED_CONTEXT` with a `[image]` tag + `path:` (and `alt:`) — a vision-capable runner `Read`s the path directly (APM never proxies bytes into the contract).
- Image viewer: `apm serve` exposes `/api/blob/:sha` (immutable-cached, content-addressed, raster-only) + `/api/work/:id/images` · `/api/images/:id` · `/api/images/:id/versions`. The Next viewer (`viewer/`) adds a work-item Images gallery, an `/images/[id]` detail page (capture-metadata panel, version dropdown, keyboard-accessible click-to-zoom), and before/after diff overlays (side-by-side / swipe / onion-skin) across versions. Browser images load via the viewer's own `/api/blob/[sha]` proxy.
- Artifacts: `apm artifact create --work-item <wi> --type <t> --title <s> --body-file <f> --agent <a>` · `artifact show <id>` · `artifact revise <id> --body-file <f> --agent <a>` · `artifact list --work-item <wi>` · `artifact submit <id>` · `artifact approve <id>` · `artifact archive <id>`
- Images: `apm image add --work-item <wi> --file <path> [--kind screenshot] [--alt <s>] [--blocker <id>] --agent <a>` · `image show <id>` · `image list --work-item <wi>` · `image revise <id> --file <f> --agent <a>` · `image find --blob <sha>` · `image pair <a> <b>` · `image save <id> --to <p>` · `image embed <id> [--resolve]` · `image copy <id>` · `image open <id>`
- Decisions: `apm decision create --work-item <wi> --question <q> --options <csv> --recommendation <r> --confidence <n> --category <c> --agent <a>` · `decision accept <id> --choice <c> --agent <a>` · `decision reject <id> --agent <a>`
- ADRs: `apm adr create-from-decision <decId> --agent <a>` · `adr list` · `adr show <id>`
- Blockers: `apm blocker create <wi> --type <t> --reason <r> --agent <a>` · `blocker show <id>` (incl. linked bug images) · `blocker resolve <id> --resolution <r> --agent <a>`
- Gates: `apm gate list [--work-item <wi>]` · `gate answer <blockerId> --choice <c> [--note <n>] --agent <a>`
- Policy: `apm policy create --scope-type <t> [--scope-id <id>] --policy-file <f>` · `policy list` · `policy show [--work-item <wi>]`
- Prompts: `apm prompt create --name <n> --body-file <f>` · `prompt list` · `prompt show <name>`
- Work (extended): `apm work current <id>` · `work blockers <id>`
- Agent loop: `apm next --agent <a> --session current --acquire --format agent` — dispatches the next allowed action; exit 0 dispatched, 3 drained, 10 idle/retry, 20 awaiting-human
- Status: `apm status` — global dashboard (counts, active leases, open blockers, awaiting-human, active runs)

## Engineering invariants (V1)

- Storage is reached only through `Storage.transaction(mode, fn)`; writes use `'immediate'`, reads `'deferred'` and release immediately.
- Domain code is pure — "now" is injected via `Clock`, never `Date.now()`.
- Every mutation allocates ids from the `sequences` table and appends an `events` row in the same transaction.
- Work-item `active` is computed from a live lease, never stored.

## What APM Is

APM (Agent Project Manager) is a **CLI-first, local-first durable project-execution state system** for autonomous AI development. Source of truth for: work items, workflows, specs, ADRs, decisions, blockers, dependencies, leases, sessions, artifacts, status.

It answers one question: *what work exists, what state is it in, and what is the agent allowed to do next?*

What it is **not**: an AI orchestrator, prompter, coding agent, or memory system. APM provides correctness/state; external runners (Claude Code `/loop`, cron, daemons) provide repetition. MVP is CLI-only — no web UI, sync, auth, multi-user, or built-in AI orchestration.

## Architecture (the big picture)

APM is a **durable project execution graph** built from these primitives (see `docs/System Architecture Specification.md`):

- **WorkItem** — recursive node (project→goal→milestone→feature→task→subtask, plus bug/research/human_gate/maintenance). Has parents, children, dependencies, blockers, artifacts, workflows, leases, sessions. Status: `draft → ready → active → blocked → completed/cancelled`.
- **WorkflowDefinition** — versioned, immutable-once-used template. **WorkflowRun** — an instance attached to a work item (a work item can have many). **WorkflowStepRun** — per-step execution record.
- **Artifact** — APM-owned, **versioned and immutable** document (spec/adr/decision/design/plan/review/handoff/work_log/status_report). New versions supersede old (`supersedes_artifact_id`).
- **Spec** — a versioned artifact with its own lifecycle: `draft → review → approved → superseded → archived`.
- **Decision** — structured record (question/options/recommendation/confidence/decision). Not every decision becomes an **ADR** (ADR auto-creation is policy-driven).
- **Lease** — execution lock on a **work item** (not a step). Has TTL + heartbeat; stale leases expire.
- **Agent** — named actor (e.g. `claude-code`, `security-reviewer`, `human:patrick`). **Session** — an agent's execution context; may span multiple steps.
- **Blocker** — current impediment (dependency incomplete, human gate, missing credential, review disagreement…).
- **Policy** — autonomy rules (auto-create work items/ADRs, confidence thresholds for auto-accept, required human gates, max depth). Scoped via `scope_type`/`scope_id`.

### The autonomy loop (core flow)
```
runner wakes → apm next → agent performs allowed action →
agent records artifact/status → apm advances workflow → repeat until complete/blocked/no work
```
`apm next --format agent` returns a **prompt contract**: WORK_ITEM / CURRENT_STEP / ALLOWED_ACTION / REQUIRED_CONTEXT / DO_NOT / WHEN_DONE. This contract is the agent-facing interface — preserve its shape.

### Storage
Reference impl is **SQLite**, but **must be abstracted behind a provider interface** — do not hardcode SQLite assumptions into business logic. Full schema in `docs/Initial Database Schema.md`. Note the `events` table: APM is event-logged (actor/event_type/entity/payload).

### Workflows
Declarative, versioned, YAML-inspected (see `docs/Workflow DSL Specification.md`). Step types: `agent_prompt`, `agent_execution`, `review_gate`, `human_gate`, `decision`, `decompose`, `integration`, `integration_loop`, `manual`, `terminal`. MVP transitions are simple state-machine `next:` edges (conditional `when:` transitions are a later version). The built-in MVP workflow mirrors the Superpowers flow:
```
brainstorm → decision → spec → design → design_review →
planning → implementation → pr_create → pr_monitor → merge → complete
```

## CLI Conventions

Full command surface in `docs/CLI Command Specification.md`. Key invariants when implementing:

- **Every read command supports `--format human|json|yaml|agent`.** Default `human` interactively, `json` for agent scripts.
- ID prefixes by type: `WI-` work items, `LEASE-`, `S-` sessions, `WR-` workflow runs, `ART-` artifacts, `IMG-` images, `DEC-` decisions, `ADR-`, `BLK-` blockers, `HG-` human gates.
- Command groups: `apm work|next|lease|session|workflow|step|artifact|decision|adr|blocker|gate(s)`.
- Artifacts are revised via `apm artifact revise` (creates a new version), never mutated in place.
  
  ## Required Start-of-Session Routine

At the start of a Claude Code session:

1. Confirm the OpenViking server is available.
2. Load context in this order:
   3. `CLAUDE.md`
   4. `context/product-constitution.md`
   5. `context/goals-and-constraints.md`
   6. Current PRD (`prd/keepqr-v0.md`)
   7. Relevant ADRs
   8. Relevant specs
   9. OpenViking retrieved memory
10. Do not begin implementation until project constraints are loaded.

## Required End-of-Session Routine

At the end of a session:

1. Summarize work completed.
2. Store working memory into OpenViking.
3. Promote durable learnings into repo files (including unresolved items into
   `context/open-questions.md`).
4. Create or update ADRs when a durable decision was made.
5. Update backlog files (`backlog/now.md`, `next.md`, `later.md`).


# Process

When asked to create plans, specs, designs always follow with 2 rounds of adversarial reviews for correctness, optimizations, and simplifications
## Memory Governance

OpenViking may store working memory, but durable product decisions must be
committed to repo Markdown.
- `/openviking-memory` is installed in Claude Code.
- `openviking-server` CLI is available.

Markdown files in this repo remain the reviewed source of truth.
OpenViking is used for:
- session memory
- retrieval
- working context
- cross-session continuity
- agent workflow experimentation

Do not allow automatic memory drift to silently change product direction.

Any memory that affects:
- product scope
- pricing
- legal risk
- abuse policy
- infrastructure architecture
- user privacy
- maintenance burden

must be promoted into an ADR or source-of-truth Markdown file.

## Memory Priority

When working on this project, context priority is:

1. Current user instruction
2. `CLAUDE.md`
3. ADRs in `adr/`
4. Source-of-truth docs in `context/`, `prd/`, `specs/`, and `processes/`
5. OpenViking retrieved memory
6. Agent/session notes

If OpenViking memory conflicts with repo Markdown, trust the repo Markdown.
