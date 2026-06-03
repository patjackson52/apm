# APM Viewer (`viewer/`)

The read-only web UI for APM — a Next.js App Router app that visualizes an APM
project (work graph, workflows, artifacts, status) by reading the `apm serve` HTTP API.

## Why it lives here

Formerly a separate `api-ui` repo. Merged into the apm core repo to remove the
two-repo overhead: one remote, one CI pipeline, no split workspace. The apm-core
CLI/server (`/src`) and this frontend now version and ship together.

## Layout

- `viewer/` — the Next.js app (built milestone-by-milestone; see `PLAN.md`).
- `../src` — apm-core (the CLI + `apm serve` HTTP API this UI consumes). Untouched by
  the viewer build (`tsconfig` is `src`-scoped, `vitest` is `tests/**`-scoped).
- The viewer has its own `package.json` / `tsconfig` / test setup, isolated under `viewer/`.

## Plan & milestones

`PLAN.md` (here) is the authoritative plan + 2-round-review constraints + security
checklist + milestone→work-item map. **Read it first.** M0 (apm serve + core reads)
is complete; M1 (foundation: scaffold, types, client, shell, tokens) is next.

## Project management

The APM project that governs this build lives in the repo-root `.apm/` (gitignored
runtime DB). Drive it from the repo root: `apm --dir <repo-root> next …`.
