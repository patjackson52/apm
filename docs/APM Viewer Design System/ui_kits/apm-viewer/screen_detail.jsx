/* APM Viewer — Work Item Detail (tabbed). */

function DepRow({ id }) {
  const it = window.APM.itemById[id];
  if (!it) return null;
  return (
    <div className="dep-row">
      <TypeIcon type={it.type} size={14} />
      <IdChip value={it.id} />
      <span className="dep-row__title">{it.title}</span>
      <StatusBadge status={it.status} size="sm" />
    </div>
  );
}

function ActionsPanel({ item, run }) {
  return (
    <div className="actions-panel">
      <div className="actions-panel__head">
        <span className="eyebrow">Actions</span>
        <span className="actions-panel__ro"><Icon name="lock" size={11} />read-only</span>
      </div>
      <p className="actions-panel__note">Write actions ship in a later version. These are previews of what's coming.</p>
      <div className="actions-panel__btns">
        <FutureBtn icon="chevron-right" label="Advance step" full />
        <FutureBtn icon="reply" label="Answer gate" full />
        <FutureBtn icon="play" label="Run next" full />
        <FutureBtn icon="user-round-plus" label="Assign lease" full />
      </div>
    </div>
  );
}

function DocumentsCard({ item, onRead }) {
  const A = window.APM;
  const arts = A.artifacts.filter(a => a.item === item.id);
  if (arts.length === 0) return null;
  const primary = ["spec", "plan", "prompt"];
  const sorted = [...arts].sort((a, b) => (primary.indexOf(a.type) + 1 || 9) - (primary.indexOf(b.type) + 1 || 9));
  return (
    <Card title={<span className="row" style={{ gap: 8 }}><Icon name="files" size={15} className="accent-ink" />Documents</span>}
      action={<span className="mono subtle">{arts.length}</span>}>
      <div className="doclist">
        {sorted.map(a => {
          const meta = A.ARTIFACT_TYPE[a.type] || { icon: "file", label: a.type };
          return (
            <button key={a.id} className="docitem" onClick={() => onRead(a.id)}>
              <span className={`docitem__ico art-type--${a.type}`}><Icon name={meta.icon} size={15} /></span>
              <span className="docitem__main">
                <span className="docitem__title">{a.title}</span>
                <span className="docitem__meta"><span className="mono">{a.ref}</span> · {meta.label} · {a.words}w</span>
              </span>
              <span className="art-status" data-s={a.status}>{a.status}</span>
              <Icon name="chevron-right" size={15} className="subtle" />
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function OverviewTab({ item, run, onRead }) {
  const A = window.APM;
  const cur = run && A.workflow.steps.find(s => s.id === run.current);
  const curStep = run && run.steps[run.current];
  const lease = A.leases.find(l => l.item === item.id);
  const itemGates = A.gates.filter(g => g.item === item.id);
  const itemBlockers = A.blockers.filter(b => b.item === item.id);
  const dependents = A.items.filter(i => i.depends.includes(item.id));
  const itemActivity = A.activity.filter(a => a.target === item.id || a.note.includes(item.id)).slice(0, 5);

  return (
    <div className="ov-grid">
      <div className="ov-main">
        <div className="ov-statusbar">
          <div className="ov-statusbar__item">
            <span className="eyebrow">Status</span>
            <StatusBadge status={item.status} size="lg" />
          </div>
          {cur && (
            <div className="ov-statusbar__item">
              <span className="eyebrow">Current step</span>
              <span className="ov-step"><Icon name={window.STEP_META[cur.type].icon} size={14} />{cur.title}
                {curStep && <RunStepBadge status={curStep.status} />}</span>
            </div>
          )}
          <div className="ov-statusbar__item">
            <span className="eyebrow">Lease</span>
            {lease ? <span className="ov-lease"><Avatar name={lease.actor} kind={lease.kind} size={20} /><span className="mono">{lease.actor}</span><span className="subtle">· {lease.ttl}</span></span>
              : <span className="subtle">— not leased</span>}
          </div>
          <div className="ov-statusbar__item">
            <span className="eyebrow">Estimate</span>
            <EstBadge est={item.est} />
          </div>
        </div>

        {(itemGates.length > 0 || itemBlockers.length > 0) && (
          <Card title={<span className="row" style={{ gap: 8 }}><Icon name="octagon-alert" size={15} className="blocked-ink" />Blockers & gates</span>}>
            <div className="stack-list">
              {itemGates.map(g => (
                <div key={g.id} className="blk-row blk-row--gate">
                  <span className="blk-row__icon blk-row__icon--gate"><Icon name="user-round-check" size={15} /></span>
                  <div className="blk-row__main"><div className="blk-row__q">{g.question}</div><div className="blk-row__meta">{g.reason}</div></div>
                  <FutureBtn icon="reply" label="Answer" />
                </div>
              ))}
              {itemBlockers.map(b => (
                <div key={b.id} className="blk-row">
                  <span className="blk-row__icon"><Icon name="octagon-x" size={15} /></span>
                  <div className="blk-row__main"><div className="blk-row__q">{b.reason}</div><div className="blk-row__meta"><IdChip value={b.id} /> · opened {b.opened}</div></div>
                  <span className="status-badge status-blocked status-badge--sm">open</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <DocumentsCard item={item} onRead={onRead} />

        <div className="ov-two">
          <Card title={`Dependencies${item.depends.length ? ` (${item.depends.length})` : ""}`}>
            {item.depends.length ? item.depends.map(d => <DepRow key={d} id={d} />) : <span className="subtle">No upstream dependencies.</span>}
            {dependents.length > 0 && <>
              <div className="ov-sublabel eyebrow">Blocks {dependents.length}</div>
              {dependents.map(d => <DepRow key={d.id} id={d.id} />)}
            </>}
          </Card>
          <Card title="Activity">
            <div className="feed">
              {(itemActivity.length ? itemActivity : A.activity.slice(0, 4)).map((a, i) => (
                <div key={i} className="feed__row">
                  <span className={`feed__dot feed__dot--${a.kind}`}><Icon name={a.kind === "agent" ? "bot" : a.kind === "review" ? "gavel" : "user-round"} size={11} /></span>
                  <span className="feed__text"><strong>{a.actor}</strong> {a.verb} <IdChip value={a.target} /> <span className="subtle">{a.note}</span></span>
                  <span className="feed__time mono subtle">{a.t}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      <div className="ov-side"><ActionsPanel item={item} run={run} /></div>
    </div>
  );
}

function ArtifactsTab({ item, onRead }) {
  const A = window.APM;
  const arts = A.artifacts.filter(a => a.item === item.id);
  return (
    <div className="arts-list">
      {arts.length === 0 && <div className="empty-mini"><Icon name="file-x" size={18} className="subtle" />No artifacts linked to this item.</div>}
      {arts.map(a => {
        const meta = A.ARTIFACT_TYPE[a.type] || { icon: "file", label: a.type };
        return (
          <button key={a.id} className="art-row art-row--btn" onClick={() => onRead(a.id)}>
            <span className={`art-type art-type--${a.type}`}><Icon name={meta.icon} size={13} />{meta.label}</span>
            <div className="art-row__main">
              <div className="art-row__title">{a.title}</div>
              <div className="art-row__meta"><span className="mono">{a.ref}</span> · {a.words} words · {a.author} · {a.updated}</div>
            </div>
            <span className="art-status" data-s={a.status}>{a.status}</span>
            <span className="artrow__read"><Icon name="book-open" size={14} />Read</span>
          </button>
        );
      })}
    </div>
  );
}

function WorkItemDetailScreen({ itemId, onBack, setRoute }) {
  const item = window.APM.itemById[itemId] || window.APM.itemById["WI-5"];
  const run = item.runId ? window.APM.runs[item.runId] : null;
  const arts = window.APM.artifacts.filter(a => a.item === item.id);
  const specArt = arts.find(a => a.type === "spec");
  const planArt = arts.find(a => a.type === "plan");
  const [tab, setTab] = useState("overview");
  const [readingArt, setReadingArt] = useState(null);
  const openRead = (id) => setReadingArt(id);

  const tabs = [
    { id: "overview", label: "Overview", icon: "layout-panel-left" },
    ...(specArt ? [{ id: "spec", label: "Spec", icon: "file-text" }] : []),
    ...(planArt ? [{ id: "plan", label: "Plan", icon: "map" }] : []),
    ...(run ? [{ id: "workflow", label: "Workflow", icon: "workflow" }] : []),
    { id: "artifacts", label: "Artifacts", icon: "files", count: arts.length },
  ];
  const D = window.APM_DOCS;

  return (
    <div className="page page--detail">
      <div className="detail-head">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><Icon name="arrow-left" size={15} />Work items</button>
        <div className="detail-head__main">
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <TypeTag type={item.type} />
            <IdChip value={item.id} />
            <PriorityTag priority={item.priority} />
            <EstBadge est={item.est} />
          </div>
          <h1 className="detail-head__title">{item.title}</h1>
        </div>
        <div className="detail-head__right">
          <StatusBadge status={item.status} size="lg" />
          <CopyMenu label="Copy" align="right"
            markdown={`# ${item.id} — ${item.title}\n\n- Type: ${item.type}\n- Status: ${item.status}\n- Estimate: ${item.est}`}
            plain={`${item.id} — ${item.title} (${item.status})`} />
        </div>
      </div>

      <Tabs tabs={tabs} active={readingArt ? "artifacts" : tab} onChange={(t) => { setReadingArt(null); setTab(t); }} />

      <div className="detail-body">
        {readingArt ? (
          <div className="detail-reader">
            <button className="btn btn-ghost btn-sm" onClick={() => setReadingArt(null)}><Icon name="arrow-left" size={15} />All documents</button>
            <DocHeader doc={D.getDoc(readingArt)} />
            <MarkdownDoc doc={D.getDoc(readingArt)} embedded />
          </div>
        ) : (<>
          {tab === "overview" && <OverviewTab item={item} run={run} onRead={openRead} />}
          {tab === "spec" && <MarkdownDoc doc={D.getDoc(specArt.id)} embedded />}
          {tab === "plan" && <MarkdownDoc doc={D.getDoc(planArt.id)} embedded />}
          {tab === "workflow" && <div className="detail-wf"><WorkflowGraph run={run} embedded onOpenArtifact={openRead} /></div>}
          {tab === "artifacts" && <ArtifactsTab item={item} onRead={openRead} />}
        </>)}
      </div>
    </div>
  );
}

Object.assign(window, { WorkItemDetailScreen });
