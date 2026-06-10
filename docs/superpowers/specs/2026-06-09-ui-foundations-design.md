# UI Foundations — Brainstorm / Design

**Date:** 2026-06-09
**Status:** brainstorm (precedes the interactive-features milestone, WI-42/WI-43)
**Companion:** `docs/adr/ADR-0001-ui-foundations-and-react-ecosystem.md`
**Goal:** Decide what foundation work the viewer needs to support a modern, advanced-widget UI/UX and interactive (write) content — and in what order — before building WI-42 (write actions) / WI-43 (workflow editor).

---

## 1. Where the foundation stands today (grounded in code)

| Layer | State | Verdict |
|---|---|---|
| Framework | Next.js App Router 15.5, React 19, Webpack | Modern, capable |
| Server state | TanStack Query + polling (5s/10s), typed envelope contract | **Dynamic reads: solid** |
| Theming | Design tokens (light/dark + status system) | Strong substrate for any widget |
| Advanced viz in prod | `@xyflow/react` (react-flow), mermaid, sanitized markdown | Proves rich interactive libs work here |
| Component primitives | **Hand-rolled** (StepPopover focus-trap, Skeleton, IdChip…); no headless lib | **Doesn't scale** |
| Write transport | **None** — daemon is 31 GET routes, non-GET → 405, no CORS, loopback | **Interactive writes: absent by design** |
| Mutation layer (client) | **None** — no `useMutation`/POST | Absent |
| SPA navigation | **Mixed** — Sidebar + new components use `<Link>`; `IdLink`/`lib/links.ts` + a few anchors + tab changes still full-reload | Partial |
| Styling systems | 23 CSS Modules **+** 2 global DS stylesheets | Coexisting; should converge |
| Hydration | Footgun — hit nonce / live-status / setState-in-render bugs | Needs a guard pattern |
| CSP | `script-src 'self' 'nonce' 'strict-dynamic'`; `style-src 'unsafe-inline'` | Secure; ecosystem-compatible (see ADR) |

**Headline:** reads are ready and dynamic; the *write* foundation and a *primitives* foundation do not exist yet; SPA nav is half-done.

## 2. The ecosystem question (resolved in ADR-0001)

The strict CSP does **not** block the React component ecosystem — `strict-dynamic` trusts the bundled app graph, so any eval-free npm component lib works in prod (react-flow already does). The only rule: **vet each dep for runtime `eval`/script-injection**; sanitize untrusted *content* separately. Conclusion: we keep the whole ecosystem; we just haven't *adopted* a primitives library yet.

## 3. Foundation problems to solve (and proposed approach)

### P1 — Headless primitives library (highest leverage)
**Problem:** every complex widget (dialog, menu, popover, tooltip, tabs, combobox, command palette, date picker) is hand-rolled with bespoke focus/ARIA.
**Proposal:** adopt **Radix UI** primitives, styled with the existing design tokens (no Tailwind). CSP-safe (eval-free). Proof-of-concept: re-implement the `StepPopover` and `EditViaCli` popovers on Radix `Popover`/`Dialog` to validate token styling + a11y + bundle cost, then standardize.
**Open question:** wholesale standard, or introduce per-new-widget and migrate opportunistically? (Lean: introduce now for new widgets; migrate hand-rolled ones only when touched.)

### P2 — Write foundation (the gating item for WI-42)
**Problem:** no write path; the daemon is read-only by charter (loopback, no-CORS, GET-only). The *domain* write usecases (advance step, answer gate, run-next) already exist in core — only the serve layer doesn't expose them.
**Proposal (to brainstorm into its own ADR):** add POST/PUT to the daemon with a deliberate, minimal security model:
- **CSRF** is the real new risk (a malicious local page could POST to `localhost:3000`): mitigate via a per-session CSRF token (served read-only, required on writes) and/or a required custom header (`X-APM-CSRF`) that simple cross-site form posts can't set, plus the existing Host/Origin anti-DNS-rebind guard.
- **Mutation layer (client):** TanStack `useMutation` + targeted cache invalidation (pairs with current polling); optimistic updates for snappy feel; surface the design system's reserved "soon"/disabled affordances as live.
**Open questions:** token vs custom-header vs both; do writes stay loopback-only (single-user V1) or anticipate auth (WI-44)?; idempotency keys for run-next/advance?

### P3 — Finish SPA navigation
**Problem:** content links (`IdLink`/`lib/links.ts`, tab changes via `router.replace`, residual `<a>`) cause full reloads — will feel wrong once state is mutating.
**Proposal:** route internal links through `<Link>` while keeping the prefix allowlist; keep tabs client-side. Low-risk, separable, immediate "feels interactive" payoff. Overlaps WI-45 (relative-time, pagination).

### P4 — Hydration guard
**Problem:** client-only state (time/connectivity/localStorage/random) repeatedly caused SSR↔client mismatches.
**Proposal:** a shared `useHydrated()` (and/or a `<ClientOnly>` wrapper) returning a deterministic pre-mount snapshot; document the pattern; consider an eslint rule discouraging `Date.now()`/`navigator` in render. Cheap insurance for every dynamic widget.

### P5 — Styling convergence (debt)
**Problem:** CSS Modules (legacy) + global DS classes (fidelity direction) coexist.
**Proposal:** treat the **DS global classes + tokens** as the target; migrate Modules opportunistically when files are touched. Not urgent; record the direction so new work doesn't add Modules.

### P6 — Add-as-needed libs (not now)
Virtualization (`@tanstack/react-virtual` — large lists: 171 artifacts, 120+ runs), animation (framer-motion), light client store (Zustand for WI-43's editor). Each adopted only when a specific widget demands it, each passing the P-vet rule.

## 4. Proposed sequencing

1. **P3 SPA-nav cleanup + P4 hydration guard** — small, safe, immediate UX/correctness wins; unblock "feels interactive."
2. **P1 Radix proof-of-concept** (StepPopover/EditViaCli) → standardize primitives.
3. **P2 write-foundation ADR + spike** (CSRF + transport) → *then* WI-42 write features.
4. P5/P6 opportunistically.

## 5. Non-goals / explicitly deferred
- Choosing a CSS utility framework (Tailwind) — not adopting; tokens + Radix cover it.
- Full auth/multi-user (WI-44) — the write model should not *preclude* it but V1 stays single-user/loopback.
- Rewriting existing hand-rolled widgets en masse — migrate on touch.

## 6. Open questions for the human
- **Radix** as the primitives standard — agreed? Any preference for an alternative (react-aria, Ark UI)?
- **Write security:** CSRF token vs custom-header-only for V1? Loopback-only, or design for auth from the start?
- Sequencing: do the SPA-nav + hydration cleanup as a small standalone PR first, or fold into WI-42?
