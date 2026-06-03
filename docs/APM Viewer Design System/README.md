# APM Viewer — Design System

Hi-fidelity design system + UI kit for **APM Viewer** (`api-ui`): a desktop web app that
visualizes data from **APM**, a local project-execution system that AI coding agents and a
human engineer use as the source of truth for software projects. Think *read-only dashboard +
rich docs reader + workflow visualizer* for a developer's local machine.

> **Provenance:** This system was designed **greenfield** from a product brief — there is no
> upstream codebase, Figma, or screenshots. All tokens, components, and screens here are the
> source of truth. If/when a real `api-ui` codebase exists, reconcile against it and update.

## What APM Viewer is

- **Audience:** a solo engineer, watched over the shoulder by autonomous agents that mutate the
  data. They scan status, read specs/plans, and inspect how a work item moves through its workflow.
- **Read-only V1.** No write flows are designed, but space is reserved for them everywhere as
  **disabled "soon" affordances** (Advance step, Answer gate, Run next, Edit, Add step) so an
  editor can appear later without redesign.
- **Aesthetic:** a precise, calm, information-dense developer tool — closer to Linear / GitHub /
  Vercel dashboards than a consumer app. Monospace for IDs/code; clean sans for prose. No
  marketing fluff. Status legibility is paramount and works in both light and dark.

### Domain objects (modeled in the mock data)
- **Work item** — `WI-12`; a type (project/goal/milestone/feature/task/subtask/bug/research/
  maintenance), title, **status**, priority, t-shirt estimate (XS–XL), parent/children tree,
  dependencies, and an attached workflow run.
- **Status vocabulary** — `draft · ready · active · blocked · completed · cancelled`. This is the
  central color system (see Visual Foundations).
- **Artifact** — versioned immutable docs (`ART-1@2`) of type spec/adr/decision/design/plan/
  review/work_log/status_report, each markdown + a status (draft→review→approved→superseded→archived).
- **Workflow definition** — a typed sequence of **steps** (agent_prompt, agent_execution,
  review_gate, human_gate, decision, decompose, integration, terminal) joined by transitions.
- **Workflow run** — an instance attached to a work item; a current step + per-step status
  (pending/running/completed/failed/skipped); reviewers carry pass/reject/abstain verdicts.
- **Blocker / human-gate** — an impediment with open/resolved state; gates carry a question + options.

---

## Content fundamentals

How copy is written across the product:

- **Voice:** terse, technical, factual. The UI states what *is* — it never sells or cheerleads.
  Labels are nouns or imperative verbs ("Advance step", "Answer gate"), never sentences.
- **Person:** mostly impersonal/system voice. The human is addressed as **"you"** sparingly
  ("Approve the proposed direction?"). Agents are named by their model id (`claude-sonnet-4.5`,
  `gpt-5-codex`); the human is **"you"** / "ME".
- **Casing:** **Sentence case** everywhere for prose and buttons. **UPPERCASE** only for tiny
  eyebrow labels (`STATUS`, `ON THIS PAGE`, `STEP TYPES`) at 11px with wide tracking. Status
  words are **Capitalized** in badges ("Active", "Blocked").
- **IDs & identifiers** are always **monospace** and treated as first-class, copyable values:
  `WI-5`, `ART-1@2`, `RUN-22`, `LSE-7`, `~/dev/apm-core`, `localhost:7842`.
- **Numbers:** tabular monospace; counts shown as bare integers in pill badges.
- **Tone examples:**
  - Empty: *"No work items yet — Initialize APM and encode your milestones to get started."*
  - Error: *"Server unreachable — Couldn't reach the APM daemon at localhost:7842. The Viewer is read-only and will reconnect automatically."*
  - Future affordance: button reads its action + a muted **`soon`** tag.
- **No emoji** in product chrome. (Markdown *content* authored by agents may contain the
  occasional ℹ️/⚠️ in a callout — that's user content, not UI.)
- **Copy/clipboard language:** actions are "Copy as Markdown / plain text / rich text"; confirmation
  is always **"Copied ✓"** (inline swap) and/or a brief toast like "Copied WI-5".

---

## Visual foundations

**Type.** [Geist](https://vercel.com/font) for everything; **Geist Mono** for IDs, code, numbers,
paths. Compact dev-tool scale (body 13–14px, prose 15px/1.7, page titles 24px). Tight letter-spacing
on headings (`-0.02em`). `font-feature-settings: "cv11","ss01"`. See `colors_and_type.css`.

**Color.** Cool-neutral gray base (not pure gray — a faint blue cast), an **indigo-blue accent
(`#3b66f5` / dark `#5a7dff`)** reserved for *interactive* affordances and focus only. The product's
defining system is the **status palette**, tuned so each status is maximally distinct at a glance:
| status | hue | intent |
|---|---|---|
| draft | slate | unstarted, neutral |
| ready | cyan | queued |
| **active** | **violet + live pulse** | being worked (leased) — feels alive |
| **blocked** | **red** | draws the eye |
| completed | green | calm, done |
| cancelled | muted/faded + strikethrough | abandoned |
Plus an **amber "awaiting human" gate** hue, separate from blocked. Every status has `-fg` / `-bg` /
`-border` tokens in **both** light and dark. Run/step status and reviewer verdicts reuse the same hues.

**Backgrounds.** Flat surfaces — **no gradients** except two purposeful touches: the live-pulse glow
on `active`, and a faint top-tint on the human-gate node. The node-graph canvas uses a subtle **dot
grid** (`radial-gradient` dots over `--bg-app`). No photography, no illustration, no texture.

**Borders & cards.** 1px hairline borders (`--border`) define structure; cards are
`--bg-surface` + 1px border + `--radius-lg` (10px) + the lightest shadow (`--shadow-xs`). Elevation
is restrained — popovers/menus get `--shadow-pop`, modals `--shadow-lg`. Corner radii: inputs/buttons
7px, cards 10px, modals 14px, badges/chips pill.

**Motion.** Minimal and functional. 120ms ease on hover/color transitions. The only looping
animations are the **`active` status pulse-ring** and the **running-step segment shimmer** — both
gated behind `prefers-reduced-motion`. Skeletons shimmer while loading. No bounces, no parallax.

**States.** Hover = subtle `--bg-subtle` fill (never a color shift on neutrals); active/press = no
shrink, just a darker fill. Focus = a 3px translucent accent ring (`--ring`). Disabled = 55% opacity
+ `not-allowed`; "future" actions additionally show a dashed treatment and a `soon` tag.

**Transparency & blur.** Used sparingly — only the modal scrim (`--bg-overlay`) and the selection
toolbar's caret. No glassmorphism.

**Layout rules.** Fixed 48px top bar + collapsible 232px sidebar (→56px). Main pane scrolls. Content
max-width 1500px for dashboards; long-form docs clamp to a **72ch reading measure** with a sticky
right-hand outline/TOC. Desktop-first, min 1280px, graceful to 1024px.

---

## Iconography

- **System:** [**Lucide**](https://lucide.dev) at **1.75 stroke**, sizes 13–19px. Chosen for its
  even, geometric line style that matches the Linear/Vercel register. *(Substitution note: there is
  no bespoke APM icon set — Lucide is the adopted standard. Swap if a house set is introduced.)*
- **Loading:** in the React UI kit via the Lucide UMD global and an `<Icon name="…">` wrapper
  (`ui_kits/apm-viewer/icons.jsx`); in static preview cards via `lucide.createIcons()` on
  `<i data-lucide="…">`. CDN: `unpkg.com/lucide`.
- **Domain mapping:** work-item types map to icons (project→box, goal→target, milestone→flag,
  feature→sparkles, task→square-check-big, bug→bug, research→flask-conical). Step types each get a
  glyph (agent→bot, review_gate→users, human_gate→user-round-check, decision→git-fork,
  integration→git-merge, terminal→circle-check-big).
- **No emoji** as UI icons. **No hand-drawn SVG** except the brand mark (`assets/logo.svg`) — a
  minimal DAG glyph (source node → branch → terminal) that echoes the workflow theme.
- **Unicode** is used only inside content (e.g. `→` in step sequences, `✓` in copied confirmation).

---

## Index / manifest

**Foundations**
- `colors_and_type.css` — all design tokens: fonts, type scale, spacing, radii, light + dark color
  themes, full status system, run/verdict colors, syntax palette, semantic prose defaults.
- `assets/logo.svg` — brand app mark (currentColor, theme-adaptive).
- `assets/fig-lease-architecture.png` — sample architecture figure used in the spec mock.

**Design-system preview cards** — `preview/*.html` (registered in the Design System tab):
Type (display / body / mono), Colors (status / neutral+accent / run+verdict / syntax),
Spacing (scale / radii+elevation), Components (StatusBadge / buttons / copy affordances / tabs /
step nodes / table rows), Brand (logo / iconography).

**UI kit** — `ui_kits/apm-viewer/` — the full click-through prototype and all 7 screens.
See `ui_kits/apm-viewer/README.md` for component breakdown.

**Skill** — `SKILL.md` — makes this folder usable as an Agent Skill in Claude Code.

---

## Caveats / substitutions
- **Fonts:** Geist + Geist Mono are loaded from Google Fonts (CDN). If you need them bundled
  offline, drop the `.woff2` files into `fonts/` and swap the `@import` for `@font-face`.
- **Icons:** Lucide is a substitution for a (non-existent) house icon set — flagged above.
- **Greenfield:** designed from a brief, not an existing product. Treat as the source of truth and
  reconcile if a real implementation diverges.
