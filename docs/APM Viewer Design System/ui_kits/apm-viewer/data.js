/* APM Viewer — mock domain data. Plain JS, attached to window.APM. */
(function () {
  const projects = [
    { id: "apm-core",     name: "APM Core Platform", path: "~/dev/apm-core", active: true,  items: 42, gates: 2 },
    { id: "apm-viewer",   name: "APM Viewer (api-ui)", path: "~/dev/apm-viewer", active: false, items: 18, gates: 1 },
    { id: "ledger-svc",   name: "Ledger Service",    path: "~/work/ledger-svc", active: false, items: 7,  gates: 0 },
    { id: "infra-bot",    name: "Infra Automation",  path: "~/work/infra-bot",  active: false, items: 23, gates: 4 },
  ];

  // ---- Work items (tree) ----
  const items = [
    { id: "WI-1",  type: "project",   title: "APM Core Platform",                 status: "active",    priority: "P0", est: "XL", parent: null,  depends: [] },
    { id: "WI-2",  type: "goal",      title: "Ship workflow engine v1",           status: "active",    priority: "P0", est: "XL", parent: "WI-1", depends: [] },
    { id: "WI-5",  type: "feature",   title: "Feature-delivery workflow",         status: "active",    priority: "P0", est: "L",  parent: "WI-2", depends: [], runId: "RUN-22" },
    { id: "WI-9",  type: "task",      title: "Implement step transitions",        status: "active",    priority: "P1", est: "M",  parent: "WI-5", depends: ["WI-11"], runId: "RUN-31" },
    { id: "WI-10", type: "task",      title: "Reviewer-verdict aggregation",      status: "ready",     priority: "P1", est: "S",  parent: "WI-5", depends: ["WI-9"] },
    { id: "WI-11", type: "task",      title: "Lease acquisition & renewal",       status: "completed", priority: "P1", est: "M",  parent: "WI-5", depends: [] },
    { id: "WI-6",  type: "feature",   title: "Workflow node-graph visualization", status: "blocked",   priority: "P0", est: "L",  parent: "WI-2", depends: ["WI-5"], runId: "RUN-24" },
    { id: "WI-12", type: "task",      title: "Pan / zoom canvas",                 status: "draft",     priority: "P2", est: "M",  parent: "WI-6", depends: [] },
    { id: "WI-13", type: "task",      title: "Node-detail popover",               status: "draft",     priority: "P2", est: "S",  parent: "WI-6", depends: ["WI-12"] },
    { id: "WI-3",  type: "goal",      title: "Artifact & docs system",            status: "active",    priority: "P1", est: "L",  parent: "WI-1", depends: [] },
    { id: "WI-7",  type: "feature",   title: "Markdown rendering pipeline",       status: "completed", priority: "P1", est: "M",  parent: "WI-3", depends: [] },
    { id: "WI-8",  type: "feature",   title: "Clipboard & copy affordances",      status: "active",    priority: "P1", est: "M",  parent: "WI-3", depends: ["WI-7"], runId: "RUN-28" },
    { id: "WI-14", type: "bug",       title: "Mermaid SVG copy loses fonts",      status: "ready",     priority: "P2", est: "XS", parent: "WI-8", depends: [] },
    { id: "WI-15", type: "research",  title: "Eval syntax-highlight libraries",   status: "cancelled", priority: "P3", est: "S",  parent: "WI-3", depends: [] },
    { id: "WI-4",  type: "milestone", title: "Public beta",                       status: "draft",     priority: "P1", est: "XL", parent: "WI-1", depends: ["WI-2", "WI-3"] },
  ];
  const itemById = Object.fromEntries(items.map(i => [i.id, i]));
  const childrenOf = (id) => items.filter(i => i.parent === id);

  // ---- Status meta ----
  const STATUS = {
    draft:     { label: "Draft",     dot: false },
    ready:     { label: "Ready",     dot: false },
    active:    { label: "Active",    dot: true  },
    blocked:   { label: "Blocked",   dot: false },
    completed: { label: "Completed", dot: false },
    cancelled: { label: "Cancelled", dot: false },
  };
  const TYPE_ICON = {
    project: "box", goal: "target", milestone: "flag", feature: "sparkles",
    task: "square-check-big", subtask: "list-tree", bug: "bug",
    research: "flask-conical", maintenance: "wrench",
  };
  const EST_WEIGHT = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };

  // ---- Workflow definition: feature_delivery ----
  const workflow = {
    id: "WF-feature-delivery",
    name: "feature_delivery",
    title: "Feature Delivery",
    version: "v3",
    steps: [
      { id: "brainstorm",    type: "agent_prompt",     title: "Brainstorm",      x: 0, y: 1, desc: "Agent explores the problem space and drafts candidate approaches.", prompt: "Given the work item and its parent context, propose 2–3 candidate approaches with tradeoffs." },
      { id: "design",        type: "agent_execution",  title: "Design",          x: 1, y: 1, desc: "Agent produces a design artifact (architecture + interfaces).", artifact: "design" },
      { id: "design_review", type: "review_gate",      title: "Design Review",   x: 2, y: 1, desc: "Multi-reviewer gate. All required reviewers must pass.", reviewers: [ {role:"Architect"}, {role:"Product"}, {role:"Security"} ] },
      { id: "approve_dir",   type: "human_gate",       title: "Approve Direction", x: 3, y: 1, desc: "Waits for a human decision before committing engineering time.", question: "Approve the proposed direction?", options: ["Approve", "Request changes", "Reject"] },
      { id: "planning",      type: "decompose",        title: "Planning",        x: 4, y: 1, desc: "Decomposes the feature into child tasks and a sequenced plan." },
      { id: "implementation",type: "agent_execution",  title: "Implementation",  x: 5, y: 1, desc: "Agent implements the plan across child tasks." },
      { id: "pr_create",     type: "integration",      title: "PR Create",       x: 6, y: 0.4, desc: "Opens a pull request integrating the work." },
      { id: "pr_monitor",    type: "agent_execution",  title: "PR Monitor",      x: 7, y: 0.4, desc: "Watches CI + review feedback on the PR." },
      { id: "checks",        type: "decision",         title: "Checks Pass?",    x: 8, y: 1, desc: "Branch on CI / review outcome.", options: ["pass → merge", "fail → implementation"] },
      { id: "merge",         type: "integration",      title: "Merge",           x: 9, y: 1.6, desc: "Squash-merges the PR to the trunk." },
      { id: "complete",      type: "terminal",         title: "Complete",        x: 10, y: 1, desc: "Terminal state — work item marked completed." },
    ],
    edges: [
      ["brainstorm","design"], ["design","design_review"], ["design_review","approve_dir"],
      ["approve_dir","planning"], ["planning","implementation"], ["implementation","pr_create"],
      ["pr_create","pr_monitor"], ["pr_monitor","checks"],
      ["checks","merge","pass"], ["checks","implementation","fail"],
      ["merge","complete"],
    ],
  };

  // ---- Runs (overlay on definition) ----
  const runs = {
    "RUN-22": { // WI-5 feature-delivery — currently implementing
      id: "RUN-22", workItem: "WI-5", workflow: "WF-feature-delivery", current: "implementation",
      steps: {
        brainstorm:     { status: "completed", at: "May 28 09:14" },
        design:         { status: "completed", at: "May 28 14:02" },
        design_review:  { status: "completed", at: "May 29 11:30", verdicts: { Architect: "pass", Product: "pass", Security: "pass" } },
        approve_dir:    { status: "completed", at: "May 29 16:45", answer: "Approve" },
        planning:       { status: "completed", at: "May 30 10:10", produced: 3 },
        implementation: { status: "running",   at: "Jun 02 08:22", lease: "claude-sonnet-4.5" },
        pr_create:      { status: "pending" },
        pr_monitor:     { status: "pending" },
        checks:         { status: "pending" },
        merge:          { status: "pending" },
        complete:       { status: "pending" },
      },
    },
    "RUN-24": { // WI-6 node-graph — blocked at human gate
      id: "RUN-24", workItem: "WI-6", workflow: "WF-feature-delivery", current: "approve_dir",
      steps: {
        brainstorm:     { status: "completed", at: "May 31 13:00" },
        design:         { status: "completed", at: "Jun 01 09:40" },
        design_review:  { status: "completed", at: "Jun 01 15:20", verdicts: { Architect: "pass", Product: "abstain", Security: "reject" } },
        approve_dir:    { status: "running",   at: "Jun 01 16:00", blocked: true },
        planning:       { status: "pending" },
        implementation: { status: "pending" },
        pr_create:      { status: "pending" },
        pr_monitor:     { status: "pending" },
        checks:         { status: "pending" },
        merge:          { status: "pending" },
        complete:       { status: "pending" },
      },
    },
  };

  // ---- Leases ----
  const leases = [
    { id: "LSE-7", actor: "claude-sonnet-4.5", kind: "agent", item: "WI-9",  step: "implementation", since: "08:22", ttl: "27m left" },
    { id: "LSE-8", actor: "gpt-5-codex",       kind: "agent", item: "WI-8",  step: "implementation", since: "07:51", ttl: "11m left" },
    { id: "LSE-9", actor: "you",               kind: "human", item: "WI-6",  step: "review",         since: "09:05", ttl: "—" },
  ];

  // ---- Blockers & gates ----
  const gates = [
    { id: "GATE-3", item: "WI-6", kind: "human_gate", step: "approve_dir", opened: "Jun 01 16:00",
      question: "Approve the proposed conflict-resolution direction?",
      reason: "Security reviewer rejected last-write-wins; needs a product decision before planning can proceed.",
      options: ["Approve CRDT merge", "Approve lock & queue", "Request changes"] },
    { id: "GATE-5", item: "WI-13", kind: "review_gate", step: "design_review", opened: "Jun 02 07:30",
      question: "Design review for node-detail popover",
      reason: "Awaiting Architect + Accessibility reviewers.",
      options: ["pass", "reject", "abstain"] },
  ];
  const blockers = [
    { id: "BLK-2", item: "WI-9", opened: "Jun 01 22:10", state: "open",
      reason: "Blocked on schema migration #418 (lease table) landing in apm-core.", depends: "WI-11" },
  ];

  // ---- Artifacts ----
  const artifacts = [
    { id: "ART-1", ref: "ART-1@2", type: "spec",   title: "Workflow Engine v1 — Technical Spec", version: 2, status: "approved",   item: "WI-5", updated: "May 29", author: "claude-sonnet-4.5", words: 2140 },
    { id: "ART-2", ref: "ART-2@1", type: "plan",   title: "Feature-delivery implementation plan", version: 1, status: "review",     item: "WI-5", updated: "May 30", author: "claude-sonnet-4.5", words: 1320 },
    { id: "ART-3", ref: "ART-3@1", type: "adr",    title: "ADR-004: Lease-based concurrency",     version: 1, status: "approved",   item: "WI-5", updated: "May 27", author: "you",       words: 680 },
    { id: "ART-4", ref: "ART-4@3", type: "design", title: "Node-graph rendering approach",        version: 3, status: "superseded", item: "WI-6", updated: "Jun 01", author: "gpt-5-codex", words: 910 },
    { id: "ART-5", ref: "ART-5@1", type: "decision",title: "Conflict-resolution strategy",        version: 1, status: "draft",      item: "WI-6", updated: "Jun 01", author: "you",       words: 240 },
    { id: "ART-6", ref: "ART-6@4", type: "work_log",title: "WI-9 work log",                       version: 4, status: "approved",   item: "WI-9", updated: "Jun 02", author: "claude-sonnet-4.5", words: 430 },
    { id: "ART-7", ref: "ART-7@1", type: "status_report", title: "Weekly status — workflow engine", version: 1, status: "approved", item: "WI-2", updated: "Jun 01", author: "claude-sonnet-4.5", words: 560 },
    { id: "ART-8", ref: "ART-8@1", type: "prompt",  title: "Implementation prompt — WI-9",        version: 1, status: "approved",   item: "WI-9", updated: "Jun 02", author: "claude-sonnet-4.5", words: 180 },
    { id: "ART-9", ref: "ART-9@2", type: "prompt",  title: "Brainstorm prompt — node-graph",       version: 2, status: "approved",   item: "WI-6", updated: "May 31", author: "claude-sonnet-4.5", words: 140 },
    { id: "ART-10",ref: "ART-10@1",type: "review",  title: "Design review notes — node-graph",     version: 1, status: "review",     item: "WI-6", updated: "Jun 01", author: "Security", words: 320 },
    { id: "ART-11",ref: "ART-11@1",type: "prompt",  title: "Brainstorm prompt — feature delivery",  version: 1, status: "approved",   item: "WI-5", updated: "May 28", author: "claude-sonnet-4.5", words: 150 },
  ];

  // ---- Activity feed ----
  const activity = [
    { t: "08:22", actor: "claude-sonnet-4.5", kind: "agent",  verb: "acquired lease on", target: "WI-9", note: "step: implementation" },
    { t: "07:51", actor: "gpt-5-codex",       kind: "agent",  verb: "started",           target: "WI-8", note: "step: implementation" },
    { t: "Jun 01", actor: "Security",         kind: "review", verb: "rejected",          target: "WI-6", note: "design_review · last-write-wins unsafe" },
    { t: "Jun 01", actor: "claude-sonnet-4.5",kind: "agent",  verb: "produced",          target: "ART-4@3", note: "design artifact" },
    { t: "May 30", actor: "claude-sonnet-4.5",kind: "agent",  verb: "decomposed",        target: "WI-5", note: "→ 3 child tasks" },
    { t: "May 29", actor: "you",              kind: "human",  verb: "answered gate on",  target: "WI-5", note: "Approve direction" },
    { t: "May 29", actor: "Architect",        kind: "review", verb: "passed",            target: "WI-5", note: "design_review" },
  ];

  // ---- Artifact type meta ----
  const ARTIFACT_TYPE = {
    spec:          { icon: "file-text",      label: "Spec",          nav: "specs" },
    plan:          { icon: "map",            label: "Plan",          nav: "plans" },
    adr:           { icon: "scale",          label: "ADR",           nav: "adrs" },
    decision:      { icon: "git-fork",       label: "Decision",      nav: "adrs" },
    prompt:        { icon: "message-square-text", label: "Prompt",   nav: "artifacts" },
    design:        { icon: "pen-tool",       label: "Design",        nav: "artifacts" },
    review:        { icon: "gavel",          label: "Review",        nav: "artifacts" },
    work_log:      { icon: "scroll-text",    label: "Work log",      nav: "artifacts" },
    status_report: { icon: "clipboard-list", label: "Status report", nav: "artifacts" },
  };

  // ---- Version history (immutable snapshots) ----
  const VERSION_DATES = {
    "ART-1": ["May 24", "May 29"], "ART-4": ["May 28", "May 30", "Jun 01"],
    "ART-6": ["Jun 02 08:30", "Jun 02 08:55", "Jun 02 09:10", "Jun 02 09:35"],
    "ART-9": ["May 30", "May 31"],
  };
  function versionHistory(art) {
    const N = art.version;
    const dates = VERSION_DATES[art.id] || [];
    const out = [];
    for (let v = 1; v <= N; v++) {
      const current = v === N;
      out.push({
        v, current,
        status: current ? art.status : "superseded",
        author: art.author,
        at: current ? art.updated : (dates[v - 1] || "earlier"),
      });
    }
    return out.reverse(); // newest first
  }

  // ---- Status counts (dashboard) ----
  function statusCounts() {
    const c = { draft:0, ready:0, active:0, blocked:0, completed:0, cancelled:0 };
    items.forEach(i => c[i.status]++);
    return c;
  }

  window.APM = {
    projects, items, itemById, childrenOf, STATUS, TYPE_ICON, EST_WEIGHT,
    workflow, runs, leases, gates, blockers, artifacts, activity, statusCounts, ARTIFACT_TYPE, versionHistory,
  };
})();
