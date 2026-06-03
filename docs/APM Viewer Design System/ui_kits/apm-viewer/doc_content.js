/* APM Viewer — sample rich-markdown documents (block model). window.APM_DOCS */
(function () {
  const spec = {
    id: "ART-1", ref: "ART-1@2", type: "spec", title: "Workflow Engine v1 — Technical Spec",
    status: "approved", version: 2, item: "WI-5", author: "claude-sonnet-4.5", updated: "May 29, 2026",
    blocks: [
      { id: "summary", type: "h2", text: "Summary" },
      { type: "p", html: "The workflow engine drives every work item through a typed sequence of <strong>steps</strong> connected by <strong>transitions</strong>. Agents and humans advance a run by completing the current step; the engine persists each transition to an append-only log so the state is fully reconstructable.", md: "The workflow engine drives every work item through a typed sequence of **steps** connected by **transitions**. Agents and humans advance a run by completing the current step; the engine persists each transition to an append-only log so the state is fully reconstructable." },
      { type: "callout", tone: "info", html: "This spec is <em>read-only</em> in the Viewer. Mutations happen out-of-band via the APM CLI and agent loop; the Viewer reflects state.", md: "> ℹ️ This spec is *read-only* in the Viewer. Mutations happen out-of-band via the APM CLI and agent loop; the Viewer reflects state." },

      { id: "goals", type: "h2", text: "Goals & non-goals" },
      { type: "ul", items: [
        "Deterministic, replayable run state from an event log.",
        "Pluggable step types (agent, gate, decision, integration, terminal).",
        "Multi-reviewer gates with explicit pass / reject / abstain verdicts.",
        "Lease-based concurrency so exactly one actor mutates a step at a time.",
      ], md: "- Deterministic, replayable run state from an event log.\n- Pluggable step types (agent, gate, decision, integration, terminal).\n- Multi-reviewer gates with explicit pass / reject / abstain verdicts.\n- Lease-based concurrency so exactly one actor mutates a step at a time." },

      { id: "architecture", type: "h2", text: "Architecture" },
      { type: "p", html: "Two agents may hold leases on different steps concurrently. The <strong>Lease Manager</strong> mediates all writes; the <strong>Work Store</strong> is the source of truth and the <strong>Event Log</strong> records every transition.", md: "Two agents may hold leases on different steps concurrently. The **Lease Manager** mediates all writes; the **Work Store** is the source of truth and the **Event Log** records every transition." },
      { id: "fig1", type: "image", src: "assets/fig-lease-architecture.png", alt: "Lease-based concurrency write path", caption: "Fig 1 — Two agents writing through the Lease Manager.", md: "![Lease-based concurrency write path](assets/fig-lease-architecture.png)" },

      { id: "stepflow", type: "h3", text: "Step lifecycle" },
      { type: "p", html: "Each step moves through <code>pending → running → completed</code> (or <code>failed</code> / <code>skipped</code>). The engine computes the next step from the definition's transitions.", md: "Each step moves through `pending → running → completed` (or `failed` / `skipped`). The engine computes the next step from the definition's transitions." },
      { id: "mermaid-flow", type: "mermaid", caption: "State machine for a single step.",
        code: `stateDiagram-v2\n    [*] --> pending\n    pending --> running: lease acquired\n    running --> completed: success\n    running --> failed: error\n    pending --> skipped: branch not taken\n    failed --> running: retry\n    completed --> [*]` },

      { id: "sequence", type: "h3", text: "Review-gate sequence" },
      { type: "p", html: "A review gate fans out to N reviewers and blocks until every <em>required</em> reviewer returns a verdict.", md: "A review gate fans out to N reviewers and blocks until every *required* reviewer returns a verdict." },
      { id: "mermaid-seq", type: "mermaid", caption: "Review-gate fan-out / fan-in.",
        code: `sequenceDiagram\n    participant E as Engine\n    participant A as Architect\n    participant S as Security\n    E->>A: request review\n    E->>S: request review\n    A-->>E: pass\n    S-->>E: reject\n    Note over E: not all passed → blocked\n    E->>E: open human_gate` },

      { id: "data", type: "h2", text: "Data model" },
      { type: "p", html: "Core tables. Identifiers are human-readable and stable across replays.", md: "Core tables. Identifiers are human-readable and stable across replays." },
      { id: "table1", type: "table",
        head: ["Entity", "ID format", "Mutable?", "Notes"],
        rows: [
          ["work_item", "WI-{n}", "status only", "Tree via parent_id"],
          ["artifact", "ART-{n}@{v}", "no", "Versioned, immutable"],
          ["run", "RUN-{n}", "current step", "One per work item"],
          ["lease", "LSE-{n}", "ttl", "Auto-expires"],
        ],
        md: "| Entity | ID format | Mutable? | Notes |\n|---|---|---|---|\n| work_item | WI-{n} | status only | Tree via parent_id |\n| artifact | ART-{n}@{v} | no | Versioned, immutable |\n| run | RUN-{n} | current step | One per work item |\n| lease | LSE-{n} | ttl | Auto-expires |" },

      { id: "api", type: "h2", text: "Transition function" },
      { type: "p", html: "The reducer is pure: given current state and an event, it returns the next state. This is what makes replay deterministic.", md: "The reducer is pure: given current state and an event, it returns the next state. This is what makes replay deterministic." },
      { id: "code1", type: "code", lang: "typescript",
        code: `function advance(run: Run, ev: StepEvent): Run {\n  const step = run.steps[ev.stepId];\n  if (step.status !== "running") {\n    throw new ConflictError(\`\${ev.stepId} not running\`);\n  }\n  // verdicts must be unanimous for review gates\n  if (step.type === "review_gate" && !allPassed(step)) {\n    return openHumanGate(run, ev.stepId);\n  }\n  return {\n    ...run,\n    current: nextStep(run.def, ev.stepId),\n    steps: { ...run.steps, [ev.stepId]: complete(step) },\n  };\n}` },

      { id: "risks", type: "h2", text: "Open risks" },
      { type: "callout", tone: "warn", html: "<strong>Conflict resolution</strong> on concurrent writes is unresolved — Security rejected last-write-wins. Tracked as <strong>GATE-3</strong> on WI-6.", md: "> ⚠️ **Conflict resolution** on concurrent writes is unresolved — Security rejected last-write-wins. Tracked as **GATE-3** on WI-6." },
    ],
  };

  // raw markdown assembled for doc-level copy
  function toMarkdown(doc) {
    let out = `# ${doc.title}\n\n`;
    doc.blocks.forEach(b => {
      if (b.type === "h2") out += `## ${b.text}\n\n`;
      else if (b.type === "h3") out += `### ${b.text}\n\n`;
      else if (b.type === "mermaid") out += "```mermaid\n" + b.code + "\n```\n\n";
      else if (b.type === "code") out += "```" + b.lang + "\n" + b.code + "\n```\n\n";
      else if (b.md) out += b.md + "\n\n";
    });
    return out.trim();
  }
  function toPlain(doc) {
    return toMarkdown(doc).replace(/[#*`>_]/g, "").replace(/!\[.*?\]\(.*?\)/g, "[image]").replace(/\|/g, " ");
  }

  window.APM_DOCS = { spec, toMarkdown, toPlain };
})();
