# APM Viewer — UI Kit

A high-fidelity, click-through recreation of the **APM Viewer** desktop app. Open `index.html`.
React (UMD) + Babel-in-browser; no build step. Components export to `window` and share scope.

## Run it
Open `index.html`. Default theme is **dark** (toggle top-right, persisted to `localStorage`).
Keyboard: `?` shortcuts overlay · `/` search · `⌘⇧D` theme · `Esc` dismiss. Click an ID/ref
anywhere to copy it; hover a doc block for section-copy; select text in a doc for the copy toolbar.

## Screens (all 7 from the brief)
1. **Dashboard** — status summary bar, awaiting-human gates, active runs w/ mini progress, active
   leases, activity feed. (`screen_dashboard.jsx`)
2. **Work items** — tree+table hybrid, expand/collapse, status & type filters, run progress.
   (`screen_workitems.jsx`)
3. **Work item detail** — tabbed (Overview / Spec / Plan / Workflow / Artifacts) with a right-aligned
   read-only **Actions** panel of disabled future affordances. (`screen_detail.jsx`)
4. **Workflow visualization** *(marquee)* — interactive node-graph: pan/zoom, distinct node per step
   type, definition-only **and** run-overlay views (status coloring + current-step highlight +
   reviewer verdicts), legend, node-detail popover with copy-source, disabled edit toolbar.
   (`screen_workflow.jsx`)
5. **Rich markdown** — specs/plans with TOC outline, headings/prose/lists, syntax-highlighted code,
   tables, callouts, **live Mermaid diagrams**, and an image — each with copy affordances; plus a
   highlight-to-copy selection toolbar. (`screen_markdown.jsx` + `doc_content.js`)

**Artifacts** are first-class: the **Artifacts** nav item is a filterable library of every document
(spec/plan/adr/decision/**prompt**/design/review/work_log/status_report); Specs/Plans/ADRs are scoped
views of it. Each row opens a reader. Work items surface their docs in a **Documents** card on the
Overview tab and in the Artifacts tab. Authored bodies live in `doc_content.js` (spec) +
`doc_content_extra.js` (plan, ADR, the agent **prompt**, decision, work log, status report, design);
`screen_artifacts.jsx` is the list + reader. Artifacts are **versioned**: the reader header has a
version-history dropdown (timeline of immutable snapshots) and a historical-snapshot banner when
viewing a past version. **Prompt provenance:** `agent_prompt` nodes in the workflow graph show the
step prompt and link straight to the prompt artifact for that run's work item.
6. **Blockers & Gates** — open gates + blockers, each with context, question/reason, disabled answer
   options. (`screen_blockers.jsx`)
7. **States** — loading skeletons, empty (items/projects/artifact), error, and copy-confirmation
   patterns. The project switcher (top bar) and shortcuts overlay round out the set. (`screen_states.jsx`)

## Architecture
| File | Role |
|---|---|
| `index.html` | Loads React/Babel/Lucide/Mermaid, all CSS, then the JSX modules + `app.jsx`. |
| `data.js` | Mock domain: projects, work-item tree, workflow def + runs, leases, gates, artifacts, activity. `window.APM`. |
| `doc_content.js` | Sample rich-markdown spec as a block model + markdown/plain serializers. `window.APM_DOCS`. |
| `icons.jsx` | `<Icon>` (Lucide) + clipboard system: `ToastHost`, `useCopy`, `CopyButton`, `IdChip`, `CopyMenu`, `SectionCopy`, `SelectionToolbar`. |
| `primitives.jsx` | `StatusBadge`, type/est/priority tags, `Avatar`, `RunProgress`, `Tabs`, `Card`, `FutureBtn`, `Skeleton`, `STEP_META`. |
| `shell.jsx` | `TopBar`, `ProjectSwitcher`, `Sidebar`. |
| `screen_*.jsx` | One file per screen. |
| `app.jsx` | Theme, routing, shortcuts overlay, mounts everything in `<ToastHost>`. |

**CSS:** `../../colors_and_type.css` (tokens) · `app.css` (shell/primitives/copy) · `screens.css`
(dashboard/work-items/detail/blockers/states) · `workflow.css` (node-graph) · `markdown.css` (docs).

## What's deliberately faked
Read-only: write actions are disabled "soon" previews. Search is non-functional. Project switcher
swaps the label only. Mermaid renders for real; syntax highlighting is a lightweight regex pass.
This is a visual/interaction recreation, not production code.
