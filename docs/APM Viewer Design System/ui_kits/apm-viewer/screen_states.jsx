/* APM Viewer — States: loading / empty / error + copy feedback. */

function SkeletonDash() {
  return (
    <div className="dash-grid">
      <div className="dash-col">
        <div className="card"><div className="card__body">
          <Skeleton w="160px" h={14} /><div style={{ height: 16 }} />
          <Skeleton w="100%" h={30} r={6} /><div style={{ height: 16 }} />
          <div className="row" style={{ gap: 24 }}>{[0,1,2].map(i => <Skeleton key={i} w="120px" h={12} />)}</div>
        </div></div>
        {[0,1].map(c => (
          <div key={c} className="card"><div className="card__body">
            <Skeleton w="140px" h={13} /><div style={{ height: 14 }} />
            {[0,1,2].map(i => <div key={i} className="row" style={{ gap: 12, marginBottom: 14 }}>
              <Skeleton w="32px" h={32} r={8} /><div className="col" style={{ gap: 6, flex: 1 }}><Skeleton w="60%" h={12} /><Skeleton w="40%" h={10} /></div>
            </div>)}
          </div></div>
        ))}
      </div>
      <div className="dash-col">
        <div className="card"><div className="card__body">
          <Skeleton w="100px" h={13} /><div style={{ height: 14 }} />
          {[0,1,2].map(i => <div key={i} className="row" style={{ gap: 10, marginBottom: 14 }}>
            <Skeleton w="26px" h={26} r={13} /><div className="col" style={{ gap: 5, flex: 1 }}><Skeleton w="70%" h={11} /><Skeleton w="50%" h={9} /></div>
          </div>)}
        </div></div>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, body, action }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon"><Icon name={icon} size={26} /></div>
      <h3 className="empty-state__title">{title}</h3>
      <p className="empty-state__body">{body}</p>
      {action}
    </div>
  );
}

function StatesScreen() {
  const [view, setView] = useState("loading");
  const push = useToast();
  const views = [
    { id: "loading", label: "Loading", icon: "loader" },
    { id: "empty-items", label: "Empty · items", icon: "inbox" },
    { id: "empty-proj", label: "Empty · projects", icon: "folder" },
    { id: "empty-doc", label: "Empty · artifact", icon: "file" },
    { id: "error", label: "Error", icon: "server-off" },
    { id: "copied", label: "Copied feedback", icon: "clipboard-check" },
  ];
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">States</h1>
          <div className="page__sub">Loading · empty · error · copy-confirmation patterns</div>
        </div>
      </div>
      <div className="states-switch">
        {views.map(v => (
          <button key={v.id} className={`fchip ${view === v.id ? "is-active" : ""}`} onClick={() => setView(v.id)}>
            <Icon name={v.icon} size={13} />{v.label}
          </button>
        ))}
      </div>

      <div className="states-stage">
        {view === "loading" && <SkeletonDash />}
        {view === "empty-items" && <EmptyState icon="inbox" title="No work items yet"
          body="This project has no work items. Initialize APM and encode your milestones to get started."
          action={<FutureBtn icon="plus" label="New work item" />} />}
        {view === "empty-proj" && <EmptyState icon="folder-open" title="No projects open"
          body="The Viewer reads local APM projects. Open a project directory to begin."
          action={<button className="btn btn-default btn-md" disabled><Icon name="folder-plus" size={15} />Open project… <span className="future-btn__soon" style={{ marginLeft: 6 }}>soon</span></button>} />}
        {view === "empty-doc" && (
          <div className="page--doc-empty">
            <EmptyState icon="file-text" title="Artifact is empty"
              body="ART-5@1 (decision) has no body yet — it's a draft awaiting content from the agent."
              action={<span className="art-status" data-s="draft">draft</span>} />
          </div>)}
        {view === "error" && <EmptyState icon="server-off" title="Server unreachable"
          body="Couldn't reach the APM daemon at localhost:7842. The Viewer is read-only and will reconnect automatically."
          action={<button className="btn btn-default btn-md"><Icon name="refresh-cw" size={15} />Retry connection</button>} />}
        {view === "copied" && (
          <div className="copied-demo">
            <p className="muted">Every copy action confirms with an inline state swap and a toast.</p>
            <div className="copied-demo__row">
              <CopyButton text="WI-5" label="Copy ID" variant="default" size="md" toast="Copied WI-5" />
              <CopyButton text="spec body" label="Copy as Markdown" variant="default" size="md" toast="Copied as Markdown" />
              <button className="btn btn-primary btn-md" onClick={() => push("Saved to clipboard ✓")}><Icon name="clipboard-check" size={15} />Trigger toast</button>
            </div>
            <div className="copied-demo__chips">
              <IdChip value="WI-12" /><IdChip value="ART-1@2" /><IdChip value="RUN-22" /><IdChip value="LSE-7" />
            </div>
            <CopyMenu label="Copy doc" markdown="# doc" plain="doc" align="left" />
          </div>)}
      </div>
    </div>
  );
}

Object.assign(window, { StatesScreen });
