# Write Foundation (WI-42) — Brainstorm / Design

**Date:** 2026-06-09
**Status:** brainstorm (gates WI-42 "Write actions from UI"; decisions feed a follow-up ADR-0002)
**Companion:** `docs/superpowers/specs/2026-06-09-ui-foundations-design.md` (P2), `docs/adr/ADR-0001-…`
**Goal:** Decide how the read-only viewer gains a **safe write path** — transport + security model + client mutation layer — so WI-42 can turn the reserved "soon" affordances (Answer gate, Run next, Advance step, …) into live actions, without weakening the daemon's security posture.

---

## 1. Where we are (grounded in code)

- **Domain write logic already exists** as core usecases (exposed today only via the CLI): `step.complete/fail/retry/review`, `gate.answer`, `lease.acquire/release/heartbeat`, `workflow.attachRun`, `work.cancel/update`, `decision.accept/reject`, `blocker.resolve`, `artifact.create/revise/submit/approve/archive`. **No new domain logic is needed** — this is a transport + security + UI problem.
- **The daemon is deliberately read-only:** 31 `GET` routes; any non-GET → **405**; `OPTIONS` → 405 (no CORS); **Host header restricted to `localhost`/`127.0.0.1`** (anti-DNS-rebind, `serve.ts:86`); **bound to `127.0.0.1`**.
- **The viewer reaches the daemon same-origin** via the Next `/api/*` proxy; the client has **no mutation layer** (no `useMutation`/POST).

## 2. Threat model for adding writes

With the daemon loopback-bound + Host-checked, remote network attackers and DNS-rebind are already handled. Adding writes introduces exactly one new risk: **CSRF from a malicious page in the user's own browser.**

- A **"simple" cross-origin `POST`** (form-encoded, no custom header) does **not** trigger a CORS preflight, so it would *reach* the daemon and execute the mutation (the attacker can't read the response, but the write happens). **This is the gap to close.**
- A cross-origin request carrying a **custom header** (or `Content-Type: application/json`) **does** trigger a preflight `OPTIONS` — which the daemon already answers **405** (no CORS). So such requests never execute.

**Implication:** requiring a custom header on every write is, by itself, robust CSRF protection given the no-CORS posture. A per-session token in that header adds defense-in-depth.

## 3. Approaches — write security

**A — Custom-header + per-session CSRF token (recommended).**
Every write must send `X-APM-CSRF: <token>`; the daemon rejects writes lacking a valid token. The token is minted per server start (or per session) and fetched by the viewer via a read endpoint (`GET /api/csrf`). Why it's sufficient + minimal:
- The custom header forces a preflight for any cross-origin caller → preflight denied (no CORS) → write blocked. Same-origin (the viewer, via proxy) sets the header freely.
- The token defends against a same-origin XSS-injected simple-request and makes intent explicit. Keep the existing Host check + loopback bind.
- Small, no cookies, no auth system.

**B — Double-submit cookie token.** Standard CSRF cookie + header compare. Heavier (introduces cookies/SameSite semantics) and unnecessary given no-CORS already blocks preflighted cross-origin. Rejected for V1.

**C — Keep CLI-backed (no real UI writes).** The prompt feature's "Edit via CLI" pattern. No new transport, but not actually interactive. This is the fallback if we choose not to open writes yet. Not the goal of WI-42.

## 4. Approaches — transport shape

**REST-ish action routes (recommended)** — mirror the read routes:
- `POST /api/gates/:blocker/answer` (gate.answer)
- `POST /api/runs/:run/steps/:step/complete | /fail | /retry` (step.*)
- `POST /api/runs/:run/steps/:step/review` (step.review)
- `POST /api/work/:id/next` (run-next: `next --acquire`)
Pros: discoverable, matches `GET` conventions, per-action validation. Cons: more routes.

**Command envelope** — `POST /api/commands` `{ cmd, args }` dispatching to usecases. Pros: one route. Cons: opaque, weaker per-route typing, re-implements a CLI-ish dispatcher. Rejected — REST routes fit the existing contract + `@apm/types` per-response schemas.

All writes return the same `{ok,data,error,meta}` envelope; errors surface domain codes (`E_CONFLICT`, `E_PRECONDITION`, `E_NOT_FOUND`) the UI maps to messages.

## 5. Client mutation layer (viewer)

- `apiMutate<T>(path, body)` in `lib/api/client.ts`: `POST`, sets `X-APM-CSRF`, validates the envelope (reuse `envelopeSchema`).
- TanStack **`useMutation`** hooks per action + **targeted cache invalidation** (pairs with existing polling); **optimistic updates** for snappy state transitions; rollback on error.
- The design-system's reserved **"soon" affordances become live** (Answer gate, Run next, Advance step); error/permission states use existing patterns. Confirm-destructive actions use the **Radix Dialog** primitive from the P1 POC.

## 6. Idempotency / concurrency
Handled by the domain, not re-invented: writes enforce preconditions (lease ownership, step state) and are event-logged; `run-next`/acquire is guarded by the lease `UNIQUE` constraint (double-acquire → `E_CONFLICT`). The API just surfaces 409/precondition errors to the UI; the client refetches to reconcile.

## 7. V1 scope (proposed)
The autonomy-loop controls a human actually needs from the UI:
- **Answer human gate** (`gate.answer`) — highest value (unblocks awaiting-human work).
- **Run next** (`POST /api/work/:id/next` → dispatch/acquire).
- **Step complete / fail / retry** for manual/integration steps.
Defer: workflow create/edit (WI-43), in-UI prompt editing (rides this later), artifact authoring, multi-user/auth (WI-44).

## 8. Non-goals
- Auth / multi-user (WI-44) — the model must not *preclude* it (token swappable for a session/auth token later) but V1 stays single-user/loopback.
- Cookies/sessions infrastructure.
- Exposing every core write — only the V1 scope above.

## 9. Open questions (for the human)
1. **CSRF: custom-header + token (A)** — agreed for V1, or prefer header-only (no token) given no-CORS already blocks cross-origin?
2. **Transport: REST action routes (recommended) vs command envelope?**
3. **V1 scope:** is "Answer gate + Run-next + step complete/fail/retry" the right first cut, or narrower (just Answer gate to start)?
4. Should the daemon also validate the **`Origin` header** (defense-in-depth) in addition to the Host check?

## 10. Recommendation / next step
Adopt **A (custom-header + per-session CSRF token) + REST action routes**, scope V1 to **Answer gate + Run-next + step complete/fail/retry**, build the `apiMutate`/`useMutation` layer with optimistic updates, and reuse the Radix Dialog for confirms. Once the human confirms the open questions, capture the security decision as **ADR-0002 (write transport + CSRF)** and write the WI-42 implementation plan (core serve routes → CSRF middleware → client mutation hooks → wire the "soon" affordances live).
