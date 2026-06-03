/* APM Viewer — Blockers & Gates. */

function GateCard({ gate, onOpen }) {
  const item = window.APM.itemById[gate.item];
  return (
    <div className="gatecard">
      <div className="gatecard__top">
        <span className={`gatecard__kind gatecard__kind--${gate.kind}`}>
          <Icon name={gate.kind === "human_gate" ? "user-round-check" : "users"} size={14} />
          {gate.kind === "human_gate" ? "Human gate" : "Review gate"}
        </span>
        <IdChip value={gate.id} />
        <div className="gatecard__spacer" />
        <span className="gatecard__age mono subtle">opened {gate.opened}</span>
      </div>
      <h3 className="gatecard__q">{gate.question}</h3>
      <p className="gatecard__reason">{gate.reason}</p>
      <div className="gatecard__ctx" onClick={() => onOpen(gate.item)} role="button" tabIndex={0}>
        <TypeIcon type={item.type} size={14} />
        <IdChip value={item.id} />
        <span className="gatecard__ctx-title">{item.title}</span>
        <StatusBadge status={item.status} size="sm" />
        <Icon name="arrow-up-right" size={14} className="subtle" />
      </div>
      <div className="gatecard__foot">
        <span className="eyebrow">{gate.kind === "human_gate" ? "Options" : "Verdict"}</span>
        <div className="gatecard__opts">
          {gate.options.map((o, i) => (
            <button key={i} className="gate-opt" disabled title="Answering ships with write actions">{o}</button>
          ))}
        </div>
        <span className="gatecard__lock"><Icon name="lock" size={12} />read-only</span>
      </div>
    </div>
  );
}

function BlockerCard({ blk, onOpen }) {
  const item = window.APM.itemById[blk.item];
  return (
    <div className="gatecard gatecard--blocker">
      <div className="gatecard__top">
        <span className="gatecard__kind gatecard__kind--blocker"><Icon name="octagon-x" size={14} />Blocker</span>
        <IdChip value={blk.id} />
        <div className="gatecard__spacer" />
        <span className="status-badge status-blocked status-badge--sm">{blk.state}</span>
      </div>
      <h3 className="gatecard__q">{blk.reason}</h3>
      <div className="gatecard__ctx" onClick={() => onOpen(blk.item)} role="button" tabIndex={0}>
        <TypeIcon type={item.type} size={14} />
        <IdChip value={item.id} />
        <span className="gatecard__ctx-title">{item.title}</span>
        <StatusBadge status={item.status} size="sm" />
        <Icon name="arrow-up-right" size={14} className="subtle" />
      </div>
      <div className="gatecard__foot">
        <span className="muted" style={{ fontSize: "var(--text-xs)" }}>Waiting on <IdChip value={blk.depends} /></span>
        <div className="gatecard__spacer" />
        <FutureBtn icon="check" label="Resolve" />
      </div>
    </div>
  );
}

function BlockersScreen({ onOpen }) {
  const A = window.APM;
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Blockers & Gates</h1>
          <div className="page__sub">{A.gates.length} open gates · {A.blockers.length} blocker awaiting resolution</div>
        </div>
        <div className="seg">
          <button className="seg__btn is-active">All</button>
          <button className="seg__btn">Gates</button>
          <button className="seg__btn">Blockers</button>
        </div>
      </div>
      <div className="bg-section">
        <div className="bg-section__head eyebrow"><Icon name="user-round-check" size={13} className="gate-ink" />Awaiting human · {A.gates.length}</div>
        <div className="gate-grid">
          {A.gates.map(g => <GateCard key={g.id} gate={g} onOpen={onOpen} />)}
        </div>
      </div>
      <div className="bg-section">
        <div className="bg-section__head eyebrow"><Icon name="octagon-x" size={13} className="blocked-ink" />Blockers · {A.blockers.length}</div>
        <div className="gate-grid">
          {A.blockers.map(b => <BlockerCard key={b.id} blk={b} onOpen={onOpen} />)}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { BlockersScreen });
