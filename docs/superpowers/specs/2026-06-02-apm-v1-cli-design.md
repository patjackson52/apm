# APM V1 CLI — Design Spec

Date: 2026-06-02
Status: draft (post 3 adversarial review rounds)
Source specs: `docs/PRD Agent Project Manager.md`, `docs/System Architecture Specification.md`, `docs/Initial Database Schema.md`, `docs/Workflow DSL Specification.md`, `docs/CLI Command Specification.md`

## 1. Goal & scope

APM is a CLI-first, local-first durable project-execution state system. It is the source of truth for what work exists, what state it is in, and what an agent is allowed to do next. It provides correctness; external runners (`/loop`, cron, daemons) provide repetition.

**Success criterion (protect above all):** an agent can repeatedly run `apm next --agent claude --session current --format agent` and safely continue work across days, sessions, and context resets without losing state or corrupting the graph under concurrent runners.

**V1 ships:** durable storage; work-item graph; workflows + runs + steps; artifacts (versioned/immutable); decisions/ADRs; blockers + human gates; leases; sessions; policies; `apm next`; the four output formats; built-in `feature_delivery` workflow; test suite.

**V1 excludes:** live GitHub integration (integration steps are manual stubs); conditional `when:` transitions; branching `next:` (validator rejects >1 target); web UI; hosted sync; auth; multi-user; MCP server; `--idempotency-key` (rely on natural idempotency + uniqueness constraints).

## 2. Language & runtime

TypeScript on Node. `commander` for the CLI tree, `better-sqlite3` for storage (synchronous → simple transactions), `yaml` for workflow DSL + yaml output, `vitest` for tests. Distributed as an npm package exposing the `apm` binary.

## 3. Architecture (layered / hexagonal)

```
src/
  domain/      pure, IO-free: entity types, workflow engine, next-resolver, policy eval, id formatting, validators
  storage/     Storage interface (transaction boundary) + sqlite/ adapter, migrations, schema
  usecases/    one function per command; orchestrate domain + storage; own the transaction
  cli/         commander command tree; arg parsing; calls usecases; selects formatter
  format/      renderers: human | json | yaml | agent — all project the SAME canonical data
  workflows/   built-in feature_delivery.yaml + test workflows; loader + validator
```

- **Domain depends on nothing.** The `next` resolver is split: `selectCandidate(snapshot, now)` is pure (clock injected → deterministic tests); `dispatch()` is the impure usecase.
- **Storage abstraction is the transaction boundary, not per-entity CRUD:** `Storage.transaction(mode, tx => …)` where `tx` exposes typed query methods. `mode` is `deferred` (reads) or `immediate` (writes). This is the one abstraction the spec mandates and the only one that can express the atomic multi-statement advance.
- Usecases are the only place a transaction opens. CLI never touches storage directly.

## 4. Storage model

### 4.1 Files & pragmas
- DB: `.apm/apm.db` (created by `apm init`). Tool config: `.apm/config.yaml` (tool settings + capability vocabulary only — **not** policies; policies live in the `policies` table).
- Pragmas on every connection: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- All write sequences run under `BEGIN IMMEDIATE` (write lock acquired up front — closes check-then-act races). Reads run `deferred` and are **released immediately** — never held across agent think-time. The long-lived lock is the *lease row*, never a DB transaction (else WAL grows unbounded).

### 4.2 IDs
Type-prefixed monotonic counters in a `sequences(prefix PK, next_value)` table. Allocation = `UPDATE sequences SET next_value = next_value + 1 WHERE prefix = ? RETURNING next_value`, inside the same immediate txn as the entity insert. Gaps are acceptable (uniqueness, not contiguity, is required).

Prefixes: `WI-` work item, `ART-` artifact, `DEC-` decision, `ADR-` adr (an artifact id of type `adr`), `BLK-` blocker (human gates are blockers — **no separate `HG-`**), `WR-` workflow run, `LEASE-` lease, `S-` session, `WD-` workflow definition, `PD-` prompt definition, `POL-` policy, `EV-` event.

Artifact version refs render compactly as `ART-1@2` (artifact `ART-1`, version 2).

### 4.3 Schema (delta over `docs/Initial Database Schema.md`)

Base tables as in the schema doc, with these changes:

**New tables**
- `schema_migrations(version PK, applied_at)` — forward-only numbered migrations run in a txn; `apm init`/startup applies pending.
- `sequences(prefix PK, next_value)`.

**New / changed columns**
- `workflow_runs.current_step_id TEXT` (FK-validated in code against the pinned definition's step ids). Keep `workflow_definition_id` FK (pins the exact immutable definition row → version is derived; **no separate version column**).
- `workflow_step_runs`: add `parent_step_run_id TEXT` (NULL = main path; non-NULL = reviewer child), `role TEXT` (reviewer role; NULL on main path), `verdict TEXT` (reviewer outcome `pass|reject|abstain`; NULL until a reviewer child completes), `review_round INTEGER DEFAULT 1`, `prompt_definition_id TEXT` (snapshot of which prompt actually ran).
- `artifacts.root_artifact_id TEXT NOT NULL` (groups a version lineage; = own id on v1, = parent.root on revise). Current version = `MAX(version) WHERE root_artifact_id = ?`.
- `blockers`: add `answer TEXT`, `choice TEXT`, `question TEXT`, `options_json TEXT`, `answered_by TEXT`, `answered_at TEXT`, `resolution TEXT`. A human gate is a blocker with `blocker_type='human_gate'`.
- `decisions.category TEXT` (free text; validated at app layer against the active `adr_policy.categories`).
- `work_items.created_by`, `artifacts.created_by` → FK `agents(id)`.

**Status enums (enforced via `CHECK`)**
- `work_items.status`: `draft|ready|blocked|completed|cancelled` — **`active` is NOT stored** (it is computed: effective status is `active` iff a live, non-expired lease exists on the item).
- `workflow_runs.status`: `pending|running|paused|completed|failed|cancelled`.
- `workflow_step_runs.status`: `pending|running|completed|failed|skipped`.
- `sessions.status`: `active|idle|ended` (a "live" session = `status IN ('active','idle')`).
- `leases.status`: `active|released|expired`.
- `blockers.status`: `open|resolved|cancelled`.
- `artifacts.status`: `draft|review|approved|superseded|archived`.
- `decisions.status`: `open|recommended|decided|cancelled`.
- `workflow_definitions.status`: `draft|active|deprecated|archived`.

**Integrity CHECKs**
- `workflow_step_runs`: `(parent_step_run_id IS NULL) = (role IS NULL)`; a completed reviewer child must carry a verdict and a non-completed one must not: `(parent_step_run_id IS NULL) OR ((status='completed') = (verdict IS NOT NULL))`.
- `blockers`: `(blocker_type='human_gate') = (question IS NOT NULL AND options_json IS NOT NULL)`; `blocker_type<>'human_gate' OR status<>'resolved' OR (answer IS NOT NULL OR choice IS NOT NULL)` (no gate resolved without an answer).
- `decisions`: `confidence BETWEEN 0 AND 100`; `decided_at IS NOT NULL` iff `status='decided'`.

**Indexes**
- Partial-unique: `leases(work_item_id) WHERE status='active'`; `workflow_runs(work_item_id) WHERE status IN ('pending','running','paused')`; `sessions(agent_id) WHERE status IN ('active','idle')`; `artifacts(supersedes_artifact_id) WHERE supersedes_artifact_id IS NOT NULL`; `artifacts(root_artifact_id, version)`; reviewer one-live-per-role: `workflow_step_runs(workflow_run_id, parent_step_run_id, role) WHERE status IN ('pending','running')`.
- Unique: `work_item_links(source_work_item_id, target_work_item_id, link_type)`; `workflow_definitions(name, version)`; `prompt_definitions(name, version)`.
- Hot-path: `work_items(status)`, `work_items(parent_id)`, `work_item_links(link_type, source_work_item_id, target_work_item_id)`, `workflow_runs(work_item_id, status)`, `workflow_step_runs(workflow_run_id, status)`, `leases(work_item_id, status)`, `leases(status, expires_at)`, `blockers(work_item_id) WHERE status='open'`, `decisions(category)`, `events(entity_type, entity_id, created_at)`.

**FKs / deletes**
- Add the FKs missing from the base schema (all `work_item_id`/`agent_id`/`artifact_id`/`*_run_id` refs). All FKs `ON DELETE RESTRICT`. Nothing is ever row-deleted — soft-delete via status. `events.entity_id` stays polymorphic (no FK).

**Triggers**
- `workflow_definitions` immutability: block `UPDATE` of `definition_json`/`version` (column-scoped — `status` transitions still allowed); block row `DELETE`.

**Timestamps**
- All timestamps are TEXT, strict UTC ISO-8601 with `Z` (`2026-06-02T12:00:00.000Z`), zero-padded → lexical sort = chronological. Ordering tie-breaks use the monotonic sequence id, never the timestamp.

## 5. Workflow engine & state machine

### 5.1 The run invariant (enforced by every transition)
**Every active workflow run is: (a) terminal, OR (b) has exactly one dispatchable pending step on the main path, OR (c) has an open blocker on its work item.** A review_gate main-path step may additionally have N pending reviewer *child* step_runs. The "main-path count" predicate is `parent_step_run_id IS NULL AND status IN ('pending','running')`. This single invariant eliminates all orphan/stuck states.

### 5.2 Runs
- One active workflow run per work item (`workflow attach` rejects a second; enforced by partial-unique index too). The run pins the exact definition row.
- `current_step_id` and the single pending main-path step_run are kept consistent in the same txn. Advancing **eagerly** creates the next step's step_run as `pending` within the completing txn; the resolver reads that pending row and never recomputes "current" from edges.
- Linear only: the loader/`attach` validator **rejects any step whose `next:` has more than one target**.

### 5.3 Step-type semantics
- `agent_prompt` / `agent_execution`: require declared input artifacts present (latest non-superseded artifact of each required type linked to the work item; status threshold not enforced in V1). Completion requires **all** declared `outputs` artifact types to be present.
- `review_gate`: on entry, seed one pending reviewer child step_run per required reviewer role. Reviewers submit via `apm step review`. `pass_policy: all_required` passes iff every required child is `completed` with `verdict='pass'`. Any `reject` verdict (or an `abstain` that drops the required set below all-pass) → create a review-disagreement blocker (item `blocked`); resolving it spawns a fresh child (new `review_round`) for re-review. V1 lets the acting agent submit all reviewer-lens verdicts (self-review) so the canonical workflow completes in a solo setup.
- `human_gate`: create a `human_gate` blocker (carries question + options); item `blocked`. `apm gate answer` records the choice and advances atomically.
- `decision`: requires a Decision record. If `confidence >= effective threshold` → auto-accept: in one txn set `decided`, create the ADR artifact when category ∈ `adr_policy.categories` and `confidence >= adr_policy.threshold`, link `decision.artifact_id`, advance. If below threshold → auto-create a human_gate blocker; `gate answer` writes the decision and advances.
- `decompose`: `may_create_work_items`. Children are independent work items with their own runs. **A parent cannot transition to `completed` while any child or any of its runs is non-terminal** — so `depends_on(parent)` never unblocks prematurely.
- `integration` / `integration_loop`: V1 **manual stub** — emits an instruction ("create the PR, then run `apm step complete …`") and waits for `step complete`. No live external call (sidesteps cross-system transactionality).
- `terminal`: completes the run; completes the work item subject to the child/run guard above.

### 5.4 Non-happy paths (all preserve the invariant)
- `step fail` → step_run `failed`, item `blocked` + blocker. `apm step retry WR-x <step>` (or resolving the fail blocker) opens a fresh pending step_run for the same step_id.
- All step mutations are CAS on `(step_run.status, expected current_step_id)` inside the txn and require the caller to hold the active lease; a mutation on a non-pending/active step → `E_CONFLICT`. `step complete` is naturally idempotent (replaying a completed step → ok, not error).

### 5.5 Sessions & session policy
- `--session current` = the live session for `--agent`; auto-started inside the dispatch txn if none (partial-unique guarantees exactly one live session per agent; sequence-id tiebreak).
- `fresh_session_required` steps are a hard constraint: the resolver will not dispatch them into the session that authored prior steps — it uses/auto-starts a distinct session. `same_session_preferred` is a hint.

## 6. `apm next` resolver

Candidate work items: stored status `ready` (or computed-`active` owned by the caller), **no open blocker**, **all `depends_on` targets `completed`**, has the one active run with a pending main-path step (or a review_gate with pending children), and no **live** lease held by another agent (expired leases are treated as free via WHERE-filter — no write). Capability filter: caller `--capabilities` vs the pending step's `requires.capabilities` (`any` = nonempty intersection, `all` = subset). Rank: priority desc, then created_at, then id.

- Bare `next` = deferred read txn (no writes, no contention), output flagged `meta.stale=true` (a later writer may move the lease — writes re-validate).
- `next --acquire` = single `BEGIN IMMEDIATE` wrapping {ensure session, select candidate, acquire lease}; returns `lease_id`. The loser of a lease race hits the partial-unique index → mapped to retryable `E_LEASE_CONFLICT` (exit 10), never internal error. `--acquire` self-heal **excludes the caller's own session** (never reaps self); reaping stale leases is otherwise the job of `apm lease expire-stale` (cron), off the hot path.
- Re-running `next` is idempotent and fully reloads working state → it doubles as "resume" after a context reset; no separate `resume` command.

## 7. Output contract

### 7.1 Formats
Reads (`list/show/current/runs/status/events`) support `human|json|yaml|agent`. Writes (`create/update/complete/...`) support `human|json|yaml` and **return the full canonical entity** (saves a follow-up `show`). `agent` format is meaningful only for `next` and `work current`; elsewhere it falls back to json with `meta.note`. Default `human` at a TTY, `json` when piped; `APM_FORMAT` env pins it; `-o` is the short flag.

### 7.2 Envelope (json/yaml)
```json
{
  "ok": true,
  "data": { ... },
  "error": null,
  "meta": { "api_version": 1, "command": "next", "ts": "2026-06-02T12:00:00.000Z", "actor_session": "S-7" }
}
```
- All field names **snake_case**.
- `meta.actor_session` is the caller's session (distinct from any entity `session` field).
- `meta.api_version` compatibility: integer, bumped only on breaking change; within a version, **additive-only** — fields are never removed/renamed/repurposed; enum values may be added. Agents must ignore unknown fields and tolerate unknown enum values.

### 7.3 `ok` vs exit code (orthogonal)
`ok` = "command executed correctly." Exit code = "loop-control signal." A nonzero exit with `ok:true` is always a loop status in `data.status`; a nonzero exit with `ok:false` is always a failure in `error.code`.

| `next` data.status | ok | error | exit | loop action |
|---|---|---|---|---|
| dispatched | true | null | 0 | do the work |
| idle | true | null | 10 | sleep `retry_after`, retry |
| drained | true | null | 3 | stop — no work left |
| (lease conflict) | true | null | 10 | backoff, retry |
| awaiting_human | true | null | 20 | stop — wait for human |
| validation error | false | E_VALIDATION | 40 | fix args, don't retry |
| not found | false | E_NOT_FOUND | 44 | don't retry |
| internal | false | E_INTERNAL | 75 | retry w/ backoff, alert |

### 7.4 Error model
```json
"error": { "code": "E_VALIDATION", "message": "2 invalid fields", "retryable": false,
  "issues": [ {"field":"estimate","problem":"must be one of XS|S|M|L|XL","got":"XXL"} ] }
```
Closed code vocab → exit: `E_VALIDATION`(40), `E_NOT_FOUND`(44), `E_LEASE_CONFLICT`(10,retryable), `E_PRECONDITION`(20), `E_BLOCKED`(20), `E_AWAITING_HUMAN`(20), `E_CONFLICT`(40), `E_INTERNAL`(75,retryable). `issues[]` only for `E_VALIDATION`.

### 7.5 Canonical entities
One object shape per entity, reused verbatim in list items, `show`, and mutation returns. References are ids by default (`parent`, `active_run` scalar; `depends_on`, `blocker_ids`, `artifact_ids` arrays). `--expand <field>[,…]` adds sibling expanded objects (the `_ids` array stays). Example `WorkItem`:
```json
{ "id":"WI-123","type":"feature","title":"Offline support","status":"ready","estimate":"M",
  "priority":0,"parent":"WI-100","depends_on":["WI-45"],"blocker_ids":[],"artifact_ids":["ART-9"],
  "active_run":"WR-1","lease":null,"created_by":"claude-code",
  "created_at":"...","updated_at":"..." }
```
Canonical objects are likewise defined for Artifact, Decision, ADR, Blocker (incl. gate fields), Lease, Session, WorkflowRun, StepRun, Event. Lists wrap them: `data = { "items":[...], "page": {"total":142,"limit":20,"offset":0,"has_more":true} }`. Default `--limit 20`; `--offset`.

### 7.6 `next` data object + agent projection
```json
{ "status":"dispatched","work_item":"WI-123","run":"WR-1",
  "step":{"id":"design","type":"agent_prompt"}, "prompt_id":"design_solution_v1",
  "allowed_action":"Create design artifact.",
  "required_context":[ {"id":"ART-7","version":2,"kind":"spec","title":"Offline sync spec","one_line":"sync model + conflict policy"} ],
  "do_not":["write implementation code","open PR"],
  "when_done":["apm step complete WR-1 design --artifact-type design --body-file design.md"],
  "next_actions":[ {"cmd":"apm step complete","args":{"run":"WR-1","step":"design","artifact_type":"design","body_file":"design.md"}} ],
  "lease":{"id":"LEASE-1","expires_at":"..."}, "retry_after":null }
```
Agent (plaintext) projection maps each contract line to a field — `WORK_ITEM:`←work_item, `CURRENT_STEP:`←step.id, `ALLOWED_ACTION:`←allowed_action, `REQUIRED_CONTEXT:`←`required_context[]` (rendered `ART-7@2 "title" — one_line`), `DO_NOT:`←do_not, `WHEN_DONE:`←when_done. `next_actions` is json-only. The plaintext is a strict subset of the data → no drift.

### 7.7 Token discipline (agent format)
- **One-shot dispatch:** `required_context` carries `{id, version, title, one_line}` by default — the agent needs zero follow-up calls before acting. `--expand context` inlines full bodies; `--expand prompt` inlines the PromptDefinition body (off by default — the agent usually knows how). Target dispatched payload ≈ 120–180 tokens.
- **Tiny idle/drained/awaiting_human:** a single `status=` line, no contract skeleton. Empty sections are omitted entirely.
- **Diff-stable:** the agent-format body contains no timestamps/clocks/durations (those live in json `meta`); fixed section order; `required_context` sorted by id → an agent can cheaply detect "nothing changed."
- **`DO_NOT` capped at ≤3 step-relevant lines;** global prohibitions belong in the agent's system prompt, not re-sent each loop.
- Lists in agent format = one line per item (`WI-123 ready feature "Offline support"`).

### 7.8 Human format
Lists → aligned tables; `show` → key-value with indented nested sections (ids + short labels). Absolute ISO timestamps in json/yaml/agent; relative ("3m ago") in human (absolute with `--no-relative`). Color/bold only when stdout isatty and `$NO_COLOR` unset; piped → plain. Long bodies truncated to ~80 chars in human/table; never truncated in machine formats.

## 8. Command surface

`apm init` — create `.apm/`, db, run migrations, seed built-in `feature_delivery` workflow + default policy. Idempotent.

**work**: `create` (`--type --title --description --priority --estimate --parent`), `list`, `show`, `update`, `link --depends-on`, `children`, `current` (re-read current step, read-only, no advance/lease), `blockers` (why blocked), `cancel` (cascades to children/runs/blockers/leases), `complete` (guarded).

**next**: `--agent --session --capabilities --match any|all --acquire --expand --format`.

**lease**: `acquire --agent --session --ttl`, `heartbeat` (`E_LEASE_LOST` if lost/expired), `release`, `expire-stale`, `list --mine`.

**session**: `start --agent`, `show`, `summarize --body`, `end`.

**workflow**: `list`, `show`, `attach`, `register --file` (add a definition; immutable once used), `runs`. **run**: `cancel WR-x`.

**step**: `complete WR-x <step> [--artifact ART-y | --artifact-type T --body-file f]` (the inline form creates the artifact + completes atomically), `fail --reason`, `retry`, `review --reviewer <role> --verdict pass|reject|abstain [--artifact]`.

**artifact**: `create --work-item --type --title --body-file`, `show`, `revise --body-file` (new version; links follow `root_artifact_id`), `list --work-item`, `submit`/`approve`/`archive` (status transitions only — body stays immutable).

**decision**: `create --work-item --question --options --recommendation --confidence [--category]`, `accept --choice`, `reject`.

**adr**: `create-from-decision DEC-x`, `list`, `show`.

**blocker**: `create WI-x --type --reason`, `resolve --resolution`. **gate**: `list`, `answer BLK-x --choice --note` (sugar over blockers filtered to `human_gate`; same `BLK-` id space).

**policy**: `create --scope-type global|work-item --scope-id --policy-file`, `list`, `show` (effective merged: workflow-def < global < work-item).

**prompt**: `create --name --body-file`, `list`, `show`.

**events**: `list [--work-item --actor --limit --offset]`.

**status**: global dashboard — `{ work.by_status counts, ready_count, active_leases[], open_blockers[], awaiting_human[], active_runs[] }`.

## 9. Built-in workflow & validation
- `feature_delivery` (canonical, from the DSL spec): brainstorm(`agent_prompt`, outputs decision+spec) → design → design_review(`review_gate`) → planning(`agent_prompt`, may_create_work_items) → implementation(`agent_execution`) → pr_create/pr_monitor/merge (`integration*` manual stubs) → complete(`terminal`).
- Validation: closed capability vocabulary (config) — unknown capability rejected (no silent no-match); `estimate ∈ {XS,S,M,L,XL}`; `confidence ∈ 0..100`; linear `next:` only.

## 10. Testing (TDD)
- Domain `selectCandidate` + workflow transition logic: pure unit tests with injected clock.
- Usecases: against `:memory:` SQLite via the real adapter, asserting the run invariant holds after every transition.
- End-to-end: drive `feature_delivery` brainstorm→complete through usecases, asserting `apm next --format agent` output at each step.
- Dedicated test workflows exercise every step **type** (incl. `decision`, `human_gate`, `decompose`, review reject + re-review) that `feature_delivery` alone does not.
- Concurrency: spawn two `next --acquire` processes on one db → exactly one dispatch, loser gets `E_LEASE_CONFLICT`.

## 11. Deliverables
Working `apm` binary; the command surface above; built-in workflow + default policy; four formats with the canonical contract; migrations; full test suite; updated root `CLAUDE.md` with real build/lint/test commands.
