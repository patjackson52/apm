/* APM Viewer — Dashboard screen. */

function StatusSummary({ counts, total }) {
  const order = ["active", "blocked", "ready", "draft", "completed", "cancelled"];
  return (
    <Card title="Work items by status" action={<span className="mono subtle">{total} total</span>}>
      <div className="summary">
        <div className="summary__bar">
          {order.map(s => counts[s] > 0 && (
            <div key={s} className={`summary__seg status-${s}`} style={{ flex: counts[s] }}
              title={`${window.APM.STATUS[s].label}: ${counts[s]}`}>
              <span className="summary__seg-fill" />
            </div>
          ))}
        </div>
        <div className="summary__legend">
          {order.map(s => (
            <div key={s} className="summary__leg">
              <span className={`summary__swatch status-${s}`} />
              <span className="summary__leg-label">{window.APM.STATUS[s].label}</span>
              <span className="summary__leg-count mono">{counts[s]}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function AwaitingHuman({ gates, onOpen }) {
  return (
    <Card title={<span className="row" style={{ gap: 8 }}><Icon name="user-round-check" size={15} className="gate-ink" />Awaiting human</span>}
      action={<span className="nav-badge nav-badge--gate">{gates.length}</span>}>
      <div className="stack-list">
        {gates.map(g => (
          <div key={g.id} className="gate-row" role="button" tabIndex={0} onClick={() => onOpen(g.item)}>
            <span className="gate-row__icon"><Icon name={g.kind === "human_gate" ? "user-round-check" : "users"} size={16} /></span>
            <span className="gate-row__main">
              <span className="gate-row__q">{g.question}</span>
              <span className="gate-row__meta">
                <span className="mono">{g.item}</span> · <span className="mono subtle">{g.step}</span> · opened {g.opened.split(" ").slice(0,2).join(" ")}
              </span>
            </span>
            <FutureBtn icon="reply" label="Answer" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function ActiveRuns({ onOpen }) {
  const runs = Object.values(window.APM.runs);
  return (
    <Card title={<span className="row" style={{ gap: 8 }}><Icon name="workflow" size={15} className="accent-ink" />Active workflow runs</span>}>
      <div className="stack-list">
        {runs.map(r => {
          const wi = window.APM.itemById[r.workItem];
          const cur = window.APM.workflow.steps.find(s => s.id === r.current);
          return (
            <div key={r.id} className="run-row" role="button" tabIndex={0} onClick={() => onOpen(r.workItem)}>
              <span className="run-row__head">
                <IdChip value={r.workItem} />
                <span className="run-row__title">{wi.title}</span>
                <StatusBadge status={wi.status} size="sm" />
              </span>
              <span className="run-row__foot">
                <RunProgress runId={r.id} />
                <span className="run-row__step">
                  <Icon name={window.STEP_META[cur.type].icon} size={13} className="subtle" />
                  <span className="muted">on</span> <strong>{cur.title}</strong>
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ActiveLeases() {
  return (
    <Card title={<span className="row" style={{ gap: 8 }}><Icon name="key-round" size={15} className="active-ink" />Active leases</span>}
      action={<span className="mono subtle">{window.APM.leases.length}</span>}>
      <div className="lease-list">
        {window.APM.leases.map(l => (
          <div key={l.id} className="lease-row">
            <Avatar name={l.actor} kind={l.kind} size={26} />
            <div className="lease-row__main">
              <div className="row" style={{ gap: 6 }}>
                <span className="lease-row__actor">{l.actor}</span>
                {l.kind === "agent" && <span className="status-badge status-active status-badge--sm"><span className="status-badge__pulse" />live</span>}
              </div>
              <div className="lease-row__meta">
                holds <IdChip value={l.item} /> · <span className="mono subtle">{l.step}</span>
              </div>
            </div>
            <div className="lease-row__ttl mono subtle">{l.ttl}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ActivityFeed() {
  const verbIcon = { agent: "bot", human: "user-round", review: "gavel" };
  return (
    <Card title="Recent activity">
      <div className="feed">
        {window.APM.activity.map((a, i) => (
          <div key={i} className="feed__row">
            <span className={`feed__dot feed__dot--${a.kind}`}><Icon name={verbIcon[a.kind]} size={12} /></span>
            <span className="feed__text">
              <strong>{a.actor}</strong> {a.verb} <IdChip value={a.target} /> <span className="subtle">{a.note}</span>
            </span>
            <span className="feed__time mono subtle">{a.t}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function DashboardScreen({ onOpen }) {
  const counts = window.APM.statusCounts();
  const total = window.APM.items.length;
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Dashboard</h1>
          <div className="page__sub">APM Core Platform · <span className="mono">~/dev/apm-core</span> · synced 12s ago</div>
        </div>
        <div className="row">
          <span className="status-badge status-active status-badge--md"><span className="status-badge__pulse" />2 agents working</span>
          <button className="btn btn-default btn-sm"><Icon name="refresh-cw" size={14} />Refresh</button>
        </div>
      </div>

      <div className="dash-grid">
        <div className="dash-col dash-col--main">
          <StatusSummary counts={counts} total={total} />
          <AwaitingHuman gates={window.APM.gates} onOpen={onOpen} />
          <ActiveRuns onOpen={onOpen} />
        </div>
        <div className="dash-col dash-col--side">
          <ActiveLeases />
          <ActivityFeed />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DashboardScreen });
