/* APM Viewer — UI primitives. Exports to window. */

/* ---------- StatusBadge (the core component) ---------- */
function StatusBadge({ status, size = "md", showDot = true }) {
  const meta = (window.APM.STATUS[status]) || { label: status, dot: false };
  return (
    <span className={`status-badge status-${status} status-badge--${size}`} data-status={status}>
      {(meta.dot && showDot) && <span className="status-badge__pulse" />}
      {(!meta.dot && showDot) && <span className="status-badge__dot" />}
      {meta.label}
    </span>
  );
}

/* ---------- TypeIcon + TypeTag ---------- */
function TypeIcon({ type, size = 14 }) {
  const name = window.APM.TYPE_ICON[type] || "circle";
  return <Icon name={name} size={size} className={`type-icon type-icon--${type}`} />;
}
function TypeTag({ type }) {
  return (
    <span className="type-tag" title={type}>
      <TypeIcon type={type} size={13} />
      <span className="type-tag__label">{type}</span>
    </span>
  );
}

/* ---------- Estimate + Priority ---------- */
function EstBadge({ est }) {
  return <span className={`est-badge est-${est}`} title={`Estimate: ${est}`}>{est}</span>;
}
function PriorityTag({ priority }) {
  return <span className={`prio prio-${priority}`} title={`Priority ${priority}`}>{priority}</span>;
}

/* ---------- Avatar ---------- */
function Avatar({ name, kind = "agent", size = 22 }) {
  const initials = name === "you" ? "ME"
    : name.replace(/[^a-z0-9 ]/gi, " ").split(/[ -]/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join("");
  return (
    <span className={`avatar avatar--${kind}`} style={{ width: size, height: size, fontSize: size * 0.4 }}
      title={name}>
      {kind === "agent"
        ? <Icon name="bot" size={size * 0.6} />
        : <span>{initials}</span>}
    </span>
  );
}

/* ---------- RunProgress (mini segmented) ---------- */
function RunProgress({ runId, compact = false }) {
  const run = window.APM.runs[runId];
  if (!run) return <span className="run-progress run-progress--none">—</span>;
  const wf = window.APM.workflow;
  const seq = wf.steps.filter(s => run.steps[s.id]);
  const done = seq.filter(s => run.steps[s.id].status === "completed").length;
  return (
    <span className={`run-progress ${compact ? "run-progress--compact" : ""}`} title={`${done}/${seq.length} steps`}>
      <span className="run-progress__bar">
        {seq.map(s => {
          const st = run.steps[s.id].status;
          return <span key={s.id} className={`run-progress__seg seg-${st}`} />;
        })}
      </span>
      {!compact && <span className="run-progress__count mono">{done}/{seq.length}</span>}
    </span>
  );
}

/* ---------- Tabs ---------- */
function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={active === t.id}
          className={`tab ${active === t.id ? "is-active" : ""}`} onClick={() => onChange(t.id)}>
          {t.icon && <Icon name={t.icon} size={14} />}
          <span>{t.label}</span>
          {t.count != null && <span className="tab__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- Card ---------- */
function Card({ title, action, children, className = "", pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card__head">
          <h3 className="card__title">{title}</h3>
          <div className="card__action">{action}</div>
        </header>
      )}
      <div className={pad ? "card__body" : ""}>{children}</div>
    </section>
  );
}

/* ---------- Disabled action button (future-write preview) ---------- */
function FutureBtn({ icon, label, kbd, full }) {
  return (
    <button type="button" className={`btn btn-default btn-sm future-btn ${full ? "future-btn--full" : ""}`}
      disabled title="Available when write actions ship">
      {icon && <Icon name={icon} size={14} />}<span>{label}</span>
      <span className="future-btn__soon">soon</span>
    </button>
  );
}

/* ---------- Skeleton ---------- */
function Skeleton({ w = "100%", h = 12, r = 5, style = {} }) {
  return <span className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

/* ---------- Step type meta (workflow nodes) ---------- */
const STEP_META = {
  agent_prompt:    { icon: "message-square-text", label: "Agent Prompt",   shape: "rect" },
  agent_execution: { icon: "bot",                 label: "Agent Execution",shape: "rect" },
  review_gate:     { icon: "users",               label: "Review Gate",    shape: "gate" },
  human_gate:      { icon: "user-round-check",     label: "Human Gate",     shape: "gate" },
  decision:        { icon: "git-fork",            label: "Decision",       shape: "diamond" },
  decompose:       { icon: "list-tree",           label: "Decompose",      shape: "rect" },
  integration:     { icon: "git-merge",           label: "Integration",    shape: "rect" },
  terminal:        { icon: "circle-check-big",    label: "Terminal",       shape: "cap" },
};

Object.assign(window, {
  StatusBadge, TypeIcon, TypeTag, EstBadge, PriorityTag, Avatar,
  RunProgress, Tabs, Card, FutureBtn, Skeleton, STEP_META,
});
