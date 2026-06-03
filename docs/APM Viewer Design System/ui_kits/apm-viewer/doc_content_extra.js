/* APM Viewer — additional artifact bodies + registry. Extends window.APM_DOCS. */
(function () {
  const D = window.APM_DOCS;

  const plan = {
    id: "ART-2", ref: "ART-2@1", type: "plan", title: "Feature-delivery implementation plan",
    status: "review", version: 1, item: "WI-5", author: "claude-sonnet-4.5", updated: "May 30, 2026",
    blocks: [
      { id: "objective", type: "h2", text: "Objective" },
      { type: "p", html: "Decompose the feature-delivery workflow into shippable tasks and a sequence the agent loop can execute autonomously, pausing only at gates.", md: "Decompose the feature-delivery workflow into shippable tasks and a sequence the agent loop can execute autonomously, pausing only at gates." },

      { id: "phases", type: "h2", text: "Phases" },
      { id: "phase-table", type: "table",
        head: ["Phase", "Scope", "Est", "Status"],
        rows: [
          ["1 · Engine core", "Step state machine + transitions", "M", "completed"],
          ["2 · Concurrency", "Lease acquire / renew / expire", "M", "completed"],
          ["3 · Gates", "Review + human gate verdicts", "S", "active"],
          ["4 · Surfacing", "Run overlay in Viewer", "S", "ready"],
        ],
        md: "| Phase | Scope | Est | Status |\n|---|---|---|---|\n| 1 · Engine core | Step state machine + transitions | M | completed |\n| 2 · Concurrency | Lease acquire / renew / expire | M | completed |\n| 3 · Gates | Review + human gate verdicts | S | active |\n| 4 · Surfacing | Run overlay in Viewer | S | ready |" },

      { id: "tasks", type: "h2", text: "Task breakdown" },
      { type: "ul", items: [
        "WI-11 — Lease acquisition & renewal · completed",
        "WI-9 — Implement step transitions · active (blocked on schema migration #418)",
        "WI-10 — Reviewer-verdict aggregation · ready",
      ], md: "- WI-11 — Lease acquisition & renewal · completed\n- WI-9 — Implement step transitions · active (blocked on schema migration #418)\n- WI-10 — Reviewer-verdict aggregation · ready" },

      { id: "seq", type: "h3", text: "Sequencing" },
      { id: "plan-mermaid", type: "mermaid", caption: "Task dependency order.",
        code: `flowchart LR\n    WI11[WI-11 Leases] --> WI9[WI-9 Transitions]\n    WI9 --> WI10[WI-10 Verdicts]\n    WI10 --> done([Merge])` },

      { id: "acceptance", type: "h2", text: "Acceptance criteria" },
      { type: "ul", items: [
        "A run replays deterministically from the event log.",
        "Concurrent agents never double-write a step (lease enforced).",
        "Review gate blocks until all required verdicts are in.",
        "The Viewer shows the current step and per-step status live.",
      ], md: "- A run replays deterministically from the event log.\n- Concurrent agents never double-write a step (lease enforced).\n- Review gate blocks until all required verdicts are in.\n- The Viewer shows the current step and per-step status live." },

      { id: "plan-note", type: "callout", tone: "info", html: "Plan is in <strong>review</strong> — Phase 3 is gated on the conflict-resolution decision (GATE-3 on WI-6).", md: "> ℹ️ Plan is in **review** — Phase 3 is gated on the conflict-resolution decision (GATE-3 on WI-6)." },
    ],
  };

  const prompt = {
    id: "ART-8", ref: "ART-8@1", type: "prompt", title: "Implementation prompt — WI-9",
    status: "approved", version: 1, item: "WI-9", author: "claude-sonnet-4.5", updated: "Jun 02, 2026",
    blocks: [
      { id: "p-intro", type: "callout", tone: "info", html: "This prompt is handed <strong>verbatim</strong> to the executing agent when the run enters the <code>implementation</code> step. The agent holds a lease for its duration.", md: "> ℹ️ This prompt is handed **verbatim** to the executing agent when the run enters the `implementation` step. The agent holds a lease for its duration." },

      { id: "p-system", type: "h2", text: "System" },
      { id: "p-system-code", type: "code", lang: "text",
        code: `You are an autonomous implementation agent operating inside APM.\nSource of truth is the work store; never assume state — read it.\nYou hold lease LSE-7 on WI-9. Renew every 30s. Release on completion\nor failure. Emit a work_log artifact for every meaningful action.` },

      { id: "p-task", type: "h2", text: "Task" },
      { type: "p", html: "Implement step transitions for the workflow engine per <strong>ART-1@2 §Transition function</strong>. The reducer must be pure and replay-safe.", md: "Implement step transitions for the workflow engine per **ART-1@2 §Transition function**. The reducer must be pure and replay-safe." },
      { id: "p-task-code", type: "code", lang: "text",
        code: `1. Implement advance(run, event) -> run as specified.\n2. Reject writes to a step that is not "running" (ConflictError).\n3. Route review_gate failures to a human_gate.\n4. Persist every transition to the append-only event log.\n5. Add property tests: replay(log) === final_state.` },

      { id: "p-constraints", type: "h2", text: "Constraints" },
      { type: "ul", items: [
        "Do not modify the artifact schema — blocked on migration #418.",
        "No network calls; the engine is local-only.",
        "Keep the reducer side-effect free; persistence happens at the boundary.",
      ], md: "- Do not modify the artifact schema — blocked on migration #418.\n- No network calls; the engine is local-only.\n- Keep the reducer side-effect free; persistence happens at the boundary." },

      { id: "p-dod", type: "h2", text: "Definition of done" },
      { type: "ul", items: [
        "advance() passes the spec's example and property tests.",
        "A PR is opened and CI is green.",
        "A work_log artifact summarizes the change.",
      ], md: "- advance() passes the spec's example and property tests.\n- A PR is opened and CI is green.\n- A work_log artifact summarizes the change." },
    ],
  };

  const adr = {
    id: "ART-3", ref: "ART-3@1", type: "adr", title: "ADR-004: Lease-based concurrency",
    status: "approved", version: 1, item: "WI-5", author: "you", updated: "May 27, 2026",
    blocks: [
      { id: "adr-status", type: "callout", tone: "info", html: "<strong>Status:</strong> Accepted · <strong>Deciders:</strong> you, claude-sonnet-4.5 · supersedes none.", md: "> ℹ️ **Status:** Accepted · **Deciders:** you, claude-sonnet-4.5 · supersedes none." },
      { id: "adr-context", type: "h2", text: "Context" },
      { type: "p", html: "Multiple agents operate on the same project concurrently. Without coordination, two agents can advance the same step and corrupt run state.", md: "Multiple agents operate on the same project concurrently. Without coordination, two agents can advance the same step and corrupt run state." },
      { id: "adr-decision", type: "h2", text: "Decision" },
      { type: "p", html: "An actor must hold a <strong>time-boxed lease</strong> on a step before mutating it. Leases auto-expire (TTL 30s) and must be renewed; the engine rejects writes from non-holders.", md: "An actor must hold a **time-boxed lease** on a step before mutating it. Leases auto-expire (TTL 30s) and must be renewed; the engine rejects writes from non-holders." },
      { id: "adr-code", type: "code", lang: "typescript",
        code: `const lease = await leases.acquire(stepId, actor, { ttl: 30_000 });\nif (!lease) throw new BusyError(stepId);\ntry { await mutate(stepId); }\nfinally { await lease.release(); }` },
      { id: "adr-consequences", type: "h2", text: "Consequences" },
      { type: "ul", items: [
        "➕ Exactly-one-writer guarantee per step, no global lock.",
        "➕ Crashed agents free their work automatically via TTL expiry.",
        "➖ Adds renewal traffic; long steps must heartbeat.",
      ], md: "- ➕ Exactly-one-writer guarantee per step, no global lock.\n- ➕ Crashed agents free their work automatically via TTL expiry.\n- ➖ Adds renewal traffic; long steps must heartbeat." },
      { id: "adr-alts", type: "h2", text: "Alternatives considered" },
      { id: "adr-alt-table", type: "table",
        head: ["Option", "Why not"],
        rows: [
          ["Global mutex", "Serializes the whole project; kills concurrency"],
          ["Last-write-wins", "Silent data loss; rejected by Security"],
          ["Optimistic CAS", "Thrash under contention on hot steps"],
        ],
        md: "| Option | Why not |\n|---|---|\n| Global mutex | Serializes the whole project; kills concurrency |\n| Last-write-wins | Silent data loss; rejected by Security |\n| Optimistic CAS | Thrash under contention on hot steps |" },
    ],
  };

  const decision = {
    id: "ART-5", ref: "ART-5@1", type: "decision", title: "Conflict-resolution strategy",
    status: "draft", version: 1, item: "WI-6", author: "you", updated: "Jun 01, 2026",
    blocks: [
      { id: "dc-banner", type: "callout", tone: "warn", html: "<strong>Draft · pending human decision.</strong> Tracked as GATE-3 — planning on WI-6 is blocked until resolved.", md: "> ⚠️ **Draft · pending human decision.** Tracked as GATE-3 — planning on WI-6 is blocked until resolved." },
      { id: "dc-q", type: "h2", text: "Question" },
      { type: "p", html: "When two agents concurrently edit the same work item, how do we reconcile? Security rejected last-write-wins.", md: "When two agents concurrently edit the same work item, how do we reconcile? Security rejected last-write-wins." },
      { id: "dc-opts", type: "h2", text: "Options" },
      { id: "dc-table", type: "table",
        head: ["Option", "Pros", "Cons"],
        rows: [
          ["CRDT merge", "No data loss; offline-friendly", "Complex; per-field merge rules"],
          ["Lock & queue", "Simple; predictable", "Latency; head-of-line blocking"],
        ],
        md: "| Option | Pros | Cons |\n|---|---|---|\n| CRDT merge | No data loss; offline-friendly | Complex; per-field merge rules |\n| Lock & queue | Simple; predictable | Latency; head-of-line blocking |" },
      { id: "dc-rec", type: "h2", text: "Recommendation" },
      { type: "callout", tone: "info", html: "Leaning <strong>lock &amp; queue</strong> for V1 (leases already exist); revisit CRDT if contention hurts. <em>Awaiting your call.</em>", md: "> ℹ️ Leaning **lock & queue** for V1 (leases already exist); revisit CRDT if contention hurts. *Awaiting your call.*" },
    ],
  };

  const workLog = {
    id: "ART-6", ref: "ART-6@4", type: "work_log", title: "WI-9 work log",
    status: "approved", version: 4, item: "WI-9", author: "claude-sonnet-4.5", updated: "Jun 02, 2026",
    blocks: [
      { id: "wl-h", type: "h2", text: "Log" },
      { type: "p", html: "Append-only record emitted by the implementing agent while holding lease LSE-7.", md: "Append-only record emitted by the implementing agent while holding lease LSE-7." },
      { id: "wl-table", type: "table",
        head: ["When", "Event"],
        rows: [
          ["Jun 02 08:22", "Acquired lease LSE-7; read ART-1@2"],
          ["Jun 02 08:40", "Implemented advance(); 3 unit tests pass"],
          ["Jun 02 09:05", "Added replay property test"],
          ["Jun 02 09:30", "BLOCKED — schema migration #418 not landed"],
        ],
        md: "| When | Event |\n|---|---|\n| Jun 02 08:22 | Acquired lease LSE-7; read ART-1@2 |\n| Jun 02 08:40 | Implemented advance(); 3 unit tests pass |\n| Jun 02 09:05 | Added replay property test |\n| Jun 02 09:30 | BLOCKED — schema migration #418 not landed |" },
    ],
  };

  const statusReport = {
    id: "ART-7", ref: "ART-7@1", type: "status_report", title: "Weekly status — workflow engine",
    status: "approved", version: 1, item: "WI-2", author: "claude-sonnet-4.5", updated: "Jun 01, 2026",
    blocks: [
      { id: "sr-sum", type: "h2", text: "Summary" },
      { type: "p", html: "Engine core and concurrency landed. Gates in progress. One decision blocking the node-graph feature.", md: "Engine core and concurrency landed. Gates in progress. One decision blocking the node-graph feature." },
      { id: "sr-m", type: "h2", text: "Metrics" },
      { id: "sr-table", type: "table",
        head: ["Metric", "This week", "Δ"],
        rows: [
          ["Items completed", "3", "+2"],
          ["Open gates", "2", "+1"],
          ["Active leases", "2", "0"],
        ],
        md: "| Metric | This week | Δ |\n|---|---|---|\n| Items completed | 3 | +2 |\n| Open gates | 2 | +1 |\n| Active leases | 2 | 0 |" },
      { id: "sr-r", type: "h2", text: "Risks" },
      { type: "ul", items: ["Conflict-resolution decision blocking WI-6.", "Schema migration #418 blocking WI-9."], md: "- Conflict-resolution decision blocking WI-6.\n- Schema migration #418 blocking WI-9." },
    ],
  };

  const design = {
    id: "ART-4", ref: "ART-4@3", type: "design", title: "Node-graph rendering approach",
    status: "superseded", version: 3, item: "WI-6", author: "gpt-5-codex", updated: "Jun 01, 2026",
    blocks: [
      { id: "ds-banner", type: "callout", tone: "warn", html: "<strong>Superseded.</strong> The SVG-edges + absolute-positioned DOM nodes approach replaced this canvas-only draft.", md: "> ⚠️ **Superseded.** The SVG-edges + absolute-positioned DOM nodes approach replaced this canvas-only draft." },
      { id: "ds-a", type: "h2", text: "Approach" },
      { type: "p", html: "Render the whole graph to a single &lt;canvas&gt; for performance; hit-test for interaction.", md: "Render the whole graph to a single <canvas> for performance; hit-test for interaction." },
      { id: "ds-t", type: "h2", text: "Tradeoffs" },
      { type: "ul", items: ["➕ Fast for very large graphs.", "➖ No DOM = harder a11y, text selection, hover popovers.", "➖ Reinvents layout/measure."], md: "- ➕ Fast for very large graphs.\n- ➖ No DOM = harder a11y, text selection, hover popovers.\n- ➖ Reinvents layout/measure." },
    ],
  };

  const brainstormPrompt = {
    id: "ART-9", ref: "ART-9@2", type: "prompt", title: "Brainstorm prompt — node-graph",
    status: "approved", version: 2, item: "WI-6", author: "claude-sonnet-4.5", updated: "May 31, 2026",
    blocks: [
      { id: "bp-intro", type: "callout", tone: "info", html: "Handed to the agent at the <code>brainstorm</code> step to explore approaches before a design is committed.", md: "> ℹ️ Handed to the agent at the `brainstorm` step to explore approaches before a design is committed." },
      { id: "bp-system", type: "h2", text: "System" },
      { id: "bp-system-code", type: "code", lang: "text",
        code: `You are a design-exploration agent inside APM.\nPropose 2–3 candidate approaches with explicit tradeoffs.\nDo not write code. Output a design artifact for review.` },
      { id: "bp-task", type: "h2", text: "Task" },
      { type: "p", html: "Explore how to render a workflow as an <strong>interactive node graph</strong> in the Viewer — step nodes, directed transitions, pan/zoom, and a run overlay coloring nodes by status.", md: "Explore how to render a workflow as an **interactive node graph** in the Viewer — step nodes, directed transitions, pan/zoom, and a run overlay coloring nodes by status." },
      { id: "bp-deliver", type: "h2", text: "Deliverable" },
      { type: "ul", items: [
        "2–3 approaches (e.g. SVG+DOM, canvas, a graph lib) with tradeoffs.",
        "A recommendation and the risks it carries.",
        "A design artifact ready for design_review.",
      ], md: "- 2–3 approaches (e.g. SVG+DOM, canvas, a graph lib) with tradeoffs.\n- A recommendation and the risks it carries.\n- A design artifact ready for design_review." },
    ],
  };

  const reviewNotes = {
    id: "ART-10", ref: "ART-10@1", type: "review", title: "Design review notes — node-graph",
    status: "review", version: 1, item: "WI-6", author: "Security", updated: "Jun 01, 2026",
    blocks: [
      { id: "rv-verdict", type: "callout", tone: "warn", html: "<strong>Verdict: reject (Security)</strong> · Architect: pass · Product: abstain. Blocks the design from advancing.", md: "> ⚠️ **Verdict: reject (Security)** · Architect: pass · Product: abstain. Blocks the design from advancing." },
      { id: "rv-context", type: "h2", text: "Context" },
      { type: "p", html: "Review of <strong>ART-4@3</strong> (node-graph rendering approach) at the <code>design_review</code> gate on WI-6.", md: "Review of **ART-4@3** (node-graph rendering approach) at the `design_review` gate on WI-6." },
      { id: "rv-findings", type: "h2", text: "Findings" },
      { type: "ul", items: [
        "Canvas-only rendering loses keyboard a11y and text selection.",
        "Concurrent edits assume last-write-wins — unsafe (see ADR-004).",
        "No story for copying a node's step source.",
      ], md: "- Canvas-only rendering loses keyboard a11y and text selection.\n- Concurrent edits assume last-write-wins — unsafe (see ADR-004).\n- No story for copying a node's step source." },
      { id: "rv-required", type: "h2", text: "Required changes" },
      { type: "ul", items: [
        "Use a DOM-based node layer for a11y + selection.",
        "Resolve conflict-resolution strategy (GATE-3) before planning.",
      ], md: "- Use a DOM-based node layer for a11y + selection.\n- Resolve conflict-resolution strategy (GATE-3) before planning." },
    ],
  };

  const fdBrainstorm = {
    id: "ART-11", ref: "ART-11@1", type: "prompt", title: "Brainstorm prompt — feature delivery",
    status: "approved", version: 1, item: "WI-5", author: "claude-sonnet-4.5", updated: "May 28, 2026",
    blocks: [
      { id: "fb-intro", type: "callout", tone: "info", html: "Handed to the agent at the <code>brainstorm</code> step of the feature-delivery run (RUN-22).", md: "> ℹ️ Handed to the agent at the `brainstorm` step of the feature-delivery run (RUN-22)." },
      { id: "fb-system", type: "h2", text: "System" },
      { id: "fb-sys-code", type: "code", lang: "text",
        code: `You are a design-exploration agent inside APM.\nRead the parent goal and any sibling work items for context.\nPropose candidate approaches; do not implement.` },
      { id: "fb-task", type: "h2", text: "Task" },
      { type: "p", html: "Frame the <strong>feature-delivery workflow</strong>: what are the typed steps, where do gates belong, and how should a run be surfaced to the human in the Viewer?", md: "Frame the **feature-delivery workflow**: what are the typed steps, where do gates belong, and how should a run be surfaced to the human in the Viewer?" },
      { id: "fb-deliver", type: "h2", text: "Deliverable" },
      { type: "ul", items: [
        "A proposed step sequence with transition rules.",
        "Which steps are gates (review vs human).",
        "A spec artifact ready for design_review.",
      ], md: "- A proposed step sequence with transition rules.\n- Which steps are gates (review vs human).\n- A spec artifact ready for design_review." },
    ],
  };

  const all = [D.spec, plan, prompt, adr, decision, workLog, statusReport, design, brainstormPrompt, reviewNotes, fdBrainstorm];
  const byId = {}; all.forEach(d => { byId[d.id] = d; });

  function getDoc(art) {
    const id = typeof art === "string" ? art : art.id;
    if (byId[id]) return byId[id];
    // fallback stub for any artifact without an authored body
    const meta = (window.APM.artifacts || []).find(a => a.id === id) || {};
    return {
      id, ref: meta.ref || id, type: meta.type || "artifact", title: meta.title || id,
      status: meta.status || "draft", version: meta.version || 1, item: meta.item, author: meta.author || "—", updated: meta.updated || "—",
      blocks: [
        { id: "stub-h", type: "h2", text: meta.title || "Artifact" },
        { id: "stub", type: "callout", tone: "info", html: "This artifact has no rendered body in the mock yet.", md: "> This artifact has no rendered body in the mock yet." },
      ],
    };
  }

  Object.assign(D, { plan, prompt, adr, decision, workLog, statusReport, design, byId, getDoc });
})();
