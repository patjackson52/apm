/* APM Viewer — Artifacts library (list + reader). */

function ArtifactRow({ art, onOpen }) {
  const A = window.APM;
  const meta = A.ARTIFACT_TYPE[art.type] || { icon: "file", label: art.type };
  const wi = A.itemById[art.item];
  return (
    <button className="artrow" onClick={() => onOpen(art.id)}>
      <span className={`art-type art-type--${art.type}`}><Icon name={meta.icon} size={13} />{meta.label}</span>
      <span className="artrow__main">
        <span className="artrow__title">{art.title}</span>
        <span className="artrow__meta">
          <span className="mono">{art.ref}</span> · {art.words} words · {art.author} · {art.updated}
        </span>
      </span>
      {wi && <span className="artrow__wi"><TypeIcon type={wi.type} size={13} /><span className="mono subtle">{wi.id}</span></span>}
      <span className="art-status" data-s={art.status}>{art.status}</span>
      <span className="artrow__read"><Icon name="book-open" size={14} />Read</span>
    </button>
  );
}

function ArtifactReader({ artId, onBack, backLabel, onOpenItem }) {
  const doc = window.APM_DOCS.getDoc(artId);
  const wi = window.APM.itemById[doc.item];
  return (
    <div className="page page--doc">
      <button className="btn btn-ghost btn-sm artreader__back" onClick={onBack}><Icon name="arrow-left" size={15} />{backLabel || "Artifacts"}</button>
      <DocHeader doc={doc} />
      {wi && (
        <button className="artreader__wi" onClick={() => onOpenItem && onOpenItem(wi.id)}>
          <Icon name="link" size={13} className="subtle" />linked to <TypeIcon type={wi.type} size={13} />
          <span className="mono">{wi.id}</span><span className="artreader__wi-title">{wi.title}</span>
          <StatusBadge status={wi.status} size="sm" />
          <Icon name="arrow-up-right" size={13} className="subtle" />
        </button>
      )}
      <MarkdownDoc doc={doc} />
    </div>
  );
}

const KIND_META = {
  artifacts: { title: "Artifacts", sub: "Every document in the project", types: null },
  specs:     { title: "Specs", sub: "Technical specifications", types: ["spec"] },
  plans:     { title: "Plans", sub: "Implementation plans", types: ["plan"] },
  adrs:      { title: "ADRs & Decisions", sub: "Architecture decisions & open decisions", types: ["adr", "decision"] },
};

function ArtifactsScreen({ kind, onOpenItem, initialSel }) {
  const A = window.APM;
  const meta = KIND_META[kind] || KIND_META.artifacts;
  const [sel, setSel] = useState(initialSel || null);
  const [typeFilter, setTypeFilter] = useState("all");

  const pool = A.artifacts.filter(a => !meta.types || meta.types.includes(a.type));
  const typesPresent = [...new Set(pool.map(a => a.type))];
  const rows = pool.filter(a => typeFilter === "all" || a.type === typeFilter);

  if (sel) return <ArtifactReader artId={sel} onBack={() => setSel(null)} backLabel={meta.title} onOpenItem={onOpenItem} />;

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">{meta.title}</h1>
          <div className="page__sub">{pool.length} {pool.length === 1 ? "document" : "documents"} · {meta.sub}</div>
        </div>
        <CopyMenu label="Copy index"
          markdown={`# ${meta.title}\n\n${pool.map(a => `- ${a.ref} — ${a.title} (${a.status})`).join("\n")}`}
          plain={pool.map(a => `${a.ref} ${a.title}`).join("\n")} />
      </div>

      {kind === "artifacts" && typesPresent.length > 1 && (
        <div className="fchips" style={{ marginBottom: "var(--space-4)" }}>
          <button className={`fchip ${typeFilter === "all" ? "is-active" : ""}`} onClick={() => setTypeFilter("all")}>All<span className="fchip__count mono">{pool.length}</span></button>
          {typesPresent.map(t => (
            <button key={t} className={`fchip ${typeFilter === t ? "is-active" : ""}`} onClick={() => setTypeFilter(t)}>
              <Icon name={A.ARTIFACT_TYPE[t].icon} size={13} />{A.ARTIFACT_TYPE[t].label}
              <span className="fchip__count mono">{pool.filter(a => a.type === t).length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="artlist">
        {rows.map(a => <ArtifactRow key={a.id} art={a} onOpen={setSel} />)}
        {rows.length === 0 && <div className="empty-mini"><Icon name="file-x" size={18} className="subtle" />No documents of this type.</div>}
      </div>
    </div>
  );
}

Object.assign(window, { ArtifactsScreen, ArtifactReader, ArtifactRow });
