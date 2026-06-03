# APM Viewer — Plan & Review Synthesis

> **Combined-repo update:** formerly the separate `api-ui` repo; now merged into the apm
> core repo. Frontend code lives in **`viewer/`** (this dir). The APM project DB is the
> **repo-root `.apm/`** — drive the loop from the repo root (`apm --dir <repo-root> next …`),
> not a separate `api-ui` dir. The hi-fi design system is at `../docs/APM Viewer Design System/`.

Source of truth for *work* is the APM project in `.apm/` (run `apm work list`, `apm next`, `apm status`).
This doc records the design, the 2-round review outcome, and the milestone map. Hi-fi design system:
`../apm/docs/APM Viewer Design System/` (tokens, UI kit, screens). Build target: **Next.js App Router**,
read-only V1, local multi-project, served by a new **`apm serve`** read API.

## Architecture (agreed)
- **`apm serve`** (added to the apm repo): thin read-only HTTP API over APM's existing usecases, returning the
  same `{ok,data,error,meta}` envelope. UI never touches SQLite. Per-request `SqliteStorage`; `?project=` routing.
- **api-ui**: Next.js frontend. `@apm/types` shared package (re-export APM domain types → no drift) + Zod contract.
  TanStack Query (polling, since a cron agent mutates state out-of-band). react-flow workflow graph (read-only now,
  editor-ready later). react-markdown + mermaid for docs. Layout A (top bar + sidebar). First-class copy/clipboard.

## Two-round review — actionable outcome

### Security checklist (build must satisfy) — agent markdown is UNTRUSTED
- **Sanitize at render, client-side, every body + every version** (server returns raw markdown as `text/plain`; do not sanitize on the server — would corrupt copy).
- Markdown: rehype-sanitize allowlist (tags `strong/em/code/a/br/span`; `a[href]` https/# only; strip `script/iframe/on*/javascript:/data:`). No raw-HTML passthrough.
- **Mermaid `securityLevel: "strict"`** + DOMPurify the rendered SVG (strip `<foreignObject>`/`<script>`/`on*`). Same before copy-as-image.
- **`/api/files`**: realpath + project-root prefix jail; reject `..`/absolute/symlink-escape; extension allowlist (images only); never serve `.db/.env/.git`; block remote/`data:` image URLs; `nosniff` + CSP-sandbox on responses.
- **`apm serve` daemon**: bind `127.0.0.1` only; validate `Host` header (anti DNS-rebind); no wildcard CORS; ship CSP; GET-only (reject mutations 405); no shadow mutation endpoints behind the disabled "soon" buttons.
- Supply chain: bundle deps (no CDN/Babel-in-browser in prod), SRI on any CDN, pinned lockfile.
- Future-write seam (not V1): CSRF token + local bearer token (`~/.apm/token`); don't foreclose it.

### apm-core read additions required (M0)
- Expose workflow `definition_json`/`steps[]` (+ derived `edges[]`, serve-side auto-layout x/y/label) — `workflow.show` currently strips it.
- `step.listForRun(runId)` → `StepRunView[]` (status/verdict/role/round/timestamps) — none exists; powers run overlay.
- `ArtifactView.body` + `work_item` linkage + body endpoint (`text/plain`) — currently omitted; Spec/Plan tabs need it.
- `events.list`, `prompt.list`, `session.list` read usecases.
- Serve-layer joins (no schema change): lease→`agent_type`+`current_step`+`ttl`; blocker/gate→`current_step`.
- ID/field reconciliation: design RUN-/LSE-/GATE- → real WR-/LEASE-/BLK-; `priority` int→`P{n}`; `depends_on`; `prompt` is a PromptDefinition (NOT an artifact type — don't add to ARTIFACT_TYPES).
- **Workflows stay linear in V1** (validator enforces single `next`). The mock's `pass/fail` branch is corrected to: fail → `step.fail` blocker → `step.retry`. Branching transitions are a post-V1 APM feature.

### Design-kit fixes (reconcile into the build; some are kit edits)
Contrast: cancelled-light (2.89:1), blocked/gate-light (~4.4), dark current-tag (2.72:1), run pending/skipped segments — darken `-fg` tokens. Add `prefers-reduced-motion` gates to live-pulse/seg-pulse/shimmer (README claims it; only pulse-ring is gated). Add `integration_loop`/`manual` to STEP_META (else graph crashes on real data). `agent_prompt` missing from legend; decision edge labels unrendered; `RUN-28/31` dangling in mock; `artrow`/`art-row` dup; RevChip 9px→10px; hardcoded off-token dark colors.

### V1 build must-do (revealed by review, beyond the kit)
URL routing/deep-linking · live-update/out-of-band mutation indicator + stale banner · node-graph keyboard nav · search results UI · loading skeletons for all screens · error boundaries per screen · paused/cancelled run states · ARIA tab pattern · focus management on route change · surface DecisionView structured fields + Sessions.

### Backlog (deferred)
Code-diff view (local-git provider → DiffModel → react-diff-view; GitHub PR provider later; never iframe GitHub; new "Code" detail tab) · write actions + CSRF/auth · workflow create/edit · hosting/multi-user · pagination/print/relative-time.

## Milestone map → APM work items
| Milestone | WI | Contents |
|---|---|---|
| M0 apm serve + core reads | WI-2 | WI-8…15 (8 features, **feature_delivery attached/ready**) + WI-16…22 seed tasks |
| M1 api-ui foundation | WI-3 | WI-23…27 |
| M2 rich docs | WI-4 | WI-28…31 |
| M3 workflow & status viz | WI-5 | WI-32…35 |
| M4 multi-project/search/live/a11y/e2e | WI-6 | WI-36…40 |
| Backlog | WI-7 | WI-41…45 |
Deps: M1→M0, M2→M1, M3→M0+M1, M4→M2+M3.

## Running the build (periodic agents)
M0 features are `ready` with runs. An agent drives them via the loop:
```
apm next --agent <model> --session current --acquire --format agent
# do the dispatched step (create artifacts / step complete / step review), release lease, repeat
```
Automate with the `schedule` skill (cron remote agents) or `/loop`. `apm status` for the dashboard.
