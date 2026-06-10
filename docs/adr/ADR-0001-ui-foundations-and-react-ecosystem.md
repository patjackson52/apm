# ADR-0001 — Viewer UI foundations: strict CSP + the React component ecosystem

- **Status:** Accepted
- **Date:** 2026-06-09
- **Context owners:** APM Viewer (`viewer/`)
- **Related:** PLAN.md security checklist; ADR scope = the viewer's front-end foundation as it heads into interactive features (WI-42 write actions, WI-43 workflow editor). Companion brainstorm: `docs/superpowers/specs/2026-06-09-ui-foundations-design.md`.

## Context

The viewer is a Next.js App Router app (React 19, Webpack) with: design tokens (light/dark + a status color system), TanStack Query for server state, a strict CSP, content sanitization, and a loopback + no-CORS + GET-only read-only daemon. Today complex interactive widgets (the StepPopover focus-trap, etc.) are **hand-rolled** — there is no headless component/primitives library installed. As we move toward interactive/dynamic features we need a clear, recorded answer to: *can we leverage the React component ecosystem, and under what rules?*

A recurring worry is that the **strict CSP walls us off from the npm/React ecosystem**. This ADR records that it does not, and the rules that follow.

## Decision

1. **We can and will use the mainstream React component ecosystem.** The CSP does not block bundled npm component libraries.
2. **Adopt a CSP-safe headless primitives library — Radix UI — layered on the existing design tokens** as the substrate for advanced widgets (dialogs, menus, popovers, tooltips, tabs, comboboxes, etc.), instead of hand-rolling accessibility/focus per widget. No Tailwind is required; Radix is unstyled and styles cleanly against our token CSS.
3. **Per-dependency CSP vetting rule (one line):** a library is admissible iff it does **not** `eval()` / `new Function()` at runtime and does **not** inject inline/external `<script>` at runtime. The mainstream component ecosystem passes; the rare eval-based lib is rejected or sandboxed.
4. **Untrusted *content* stays sanitized** (DOMPurify/rehype-sanitize) — this is orthogonal to component-library choice and unchanged.

## Why the CSP does not block the ecosystem

Production policy: `script-src 'self' 'nonce-…' 'strict-dynamic'`.

- **`strict-dynamic`** propagates trust: a nonce-trusted script (Next's runtime) transitively trusts everything it loads. npm dependencies are **bundled into that trusted graph**, so they are **not** re-checked by `script-src`.
- CSP only intervenes on: (a) inline `<script>` without the nonce, (b) runtime `eval`/`new Function`, (c) loading external/CDN scripts outside the trust chain.
- A normal React component library is **none** of these — it is compiled JS imported into the bundle. **Existence proof: `@xyflow/react` (react-flow), a heavyweight interactive lib, already runs in production under this exact CSP.**
- `style-src 'self' 'unsafe-inline'` ⇒ CSS-in-JS (emotion/styled-components/stitches) also works.

## Consequences

**Positive**
- The full ecosystem is available: Radix UI, TanStack Table/Virtual, framer-motion, Recharts/visx, react-hook-form, downshift/cmdk, dnd-kit, CodeMirror/Monaco, date pickers, etc. — all eval-free, all CSP-compatible.
- Security posture (sanitization + strict CSP) is preserved at zero ecosystem cost.
- Adopting Radix turns "hand-roll each widget + its a11y" into "compose accessible primitives, style with tokens."

**Negative / constraints to honor**
- **Vet each dep** for runtime `eval`/script-injection (rare: some expression/template engines, `mathjs` eval mode, a few legacy charting libs). Reject or isolate those.
- **Mermaid-style content renderers** that emit markup from untrusted input still require sanitization (a content rule, not a CSP-of-the-lib rule).
- **Next App Router rules apply** (standard, not exotic): client widgets need `'use client'`; libs touching `window` at import use `next/dynamic({ ssr: false })`.
- **Hydration discipline:** client-only state (time/connectivity/localStorage/random) must use a mounted-guard (`useHydrated`) pattern — we hit nonce / live-status / setState-in-render bugs without it. A shared helper + lint guidance is a follow-up (see brainstorm).
- Dev mode needs `unsafe-eval` (HMR) — already gated to development only; not a production or third-party-lib concern.

## Alternatives considered

- **Hand-roll all widgets (status quo):** maximal control, but every complex widget re-implements focus/ARIA — does not scale, accessibility risk. Rejected.
- **shadcn/ui:** great DX but assumes Tailwind, which we don't use and don't want to introduce solely for this. We take its underlying choice (Radix) directly and style with our tokens.
- **A full component framework (MUI/AntD):** heavy, opinionated styling that fights the design system, larger bundles. Rejected in favor of unstyled primitives + our tokens.
- **Loosen the CSP to ease lib adoption:** unnecessary (the ecosystem already works) and weakens security. Rejected.

## Follow-ups (tracked in the foundations brainstorm)
1. Add Radix as primitives substrate (proof-of-concept: migrate StepPopover / EditViaCli popover to Radix).
2. A `useHydrated` client-only helper + guidance to kill the hydration footgun.
3. Converge the two styling systems (legacy CSS Modules → design-system global classes).
4. Add virtualization (`@tanstack/react-virtual`), animation (framer-motion), and a light client store (Zustand) **only as specific widgets demand**, each passing the CSP vetting rule.
