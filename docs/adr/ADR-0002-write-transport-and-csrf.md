# ADR-0002 — Viewer write transport + CSRF model

- **Status:** Accepted
- **Date:** 2026-06-09
- **Scope:** Adding a write path to the read-only `apm serve` daemon for WI-42 (write actions from the viewer).
- **Related:** `docs/superpowers/specs/2026-06-09-write-foundation-design.md` (brainstorm); ADR-0001.

## Context

The daemon is read-only by charter: 31 `GET` routes, non-GET → 405, `OPTIONS` → 405 (no CORS), Host restricted to `localhost`/`127.0.0.1` (anti-DNS-rebind), bound to `127.0.0.1`. The domain write usecases already exist (exposed only via CLI). WI-42 needs the viewer to perform writes (answer gate, run-next, advance/fail/retry step) without weakening that posture. The one new risk is **CSRF from a page in the user's own browser** (a "simple" cross-origin `POST` is not preflighted and would execute).

## Decision

1. **CSRF: custom header + per-session token.** Every write must carry `X-APM-CSRF: <token>`. The token is minted per listener at startup and fetched by the viewer via `GET /api/csrf`. Rationale: a custom header forces a CORS preflight for any cross-origin caller → the daemon answers `OPTIONS` 405 (no CORS) → the write never executes; the token adds explicit-intent + same-origin-XSS hardening. No cookies.
2. **Transport: REST action routes** mirroring the read routes (e.g. `POST /api/gates/:id/answer`, `POST /api/runs/:run/steps/:step/{complete,fail,retry}`, `POST /api/work/:id/next`). One usecase per route; responses use the existing `{ok,data,error,meta}` envelope + `@apm/types` schemas.
3. **Defense-in-depth:** keep the loopback bind + Host check; additionally validate the `Origin` header when present (must be a localhost origin). Reject writes missing/failing the CSRF header with `403`.
4. **V1 scope:** Answer gate, Run-next, and step complete/fail/retry. Defer workflow create/edit (WI-43), in-UI prompt editing, artifact authoring, and multi-user/auth (WI-44).
5. **Single-user/loopback V1, auth-ready:** the CSRF token is a stand-in that a real session/auth token (WI-44) can replace without changing the transport.

## Consequences

**Positive**
- Interactive writes become possible while preserving the loopback + no-CORS + Host-checked posture; the only added surface is the CSRF guard + the V1 POST routes.
- No new domain logic — routes wire to existing usecases; their preconditions (lease ownership, step state) + event log provide idempotency/concurrency safety (e.g. double-acquire → `E_CONFLICT`).
- Client gains a real mutation layer (TanStack `useMutation` + invalidation + optimistic updates); the design-system "soon" affordances go live; confirms reuse the Radix Dialog (ADR-0001 P1).

**Negative / constraints**
- The daemon handler must now parse request bodies (async) for non-GET and thread a `body` into route handlers — a change to the previously all-sync, all-GET dispatcher.
- The viewer must fetch + cache the CSRF token and attach it on every mutation; token rotation on server restart needs a refetch-on-403 path.
- Writes that mutate must open an `immediate` transaction (the usecases already do); ensure the per-request storage is closed.

## Alternatives considered
- **Custom-header only (no token):** simpler; relies solely on no-CORS. Rejected — the token is cheap and hardens same-origin XSS + makes intent explicit.
- **Double-submit cookie token:** introduces cookie/SameSite machinery, unnecessary given no-CORS already blocks preflighted cross-origin. Rejected.
- **Command envelope (`POST /api/commands`):** one route, but opaque + weak per-route typing. Rejected for REST action routes.
- **Stay CLI-backed (no UI writes):** not interactive; that's the status quo WI-42 replaces.

## Follow-up
Write the WI-42 implementation plan: serve CSRF token + guard + body parsing + the V1 POST routes → `@apm/types` write-response schemas → viewer `apiMutate` + `useMutation` hooks + token handling → wire the "soon" affordances live (confirms via Radix Dialog).
