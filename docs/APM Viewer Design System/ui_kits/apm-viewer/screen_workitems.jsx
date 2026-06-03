/* APM Viewer — Work Items: tree + table hybrid. */

function FilterChip({ label, active, onClick, swatch, count }) {
  return (
    <button className={`fchip ${active ? "is-active" : ""}`} onClick={onClick}>
      {swatch && <span className={`fchip__swatch status-${swatch}`} />}
      <span>{label}</span>
      {count != null && <span className="fchip__count mono">{count}</span>}
    </button>
  );
}

function WorkItemRow({ item, depth, expanded, hasKids, onToggle, onOpen, selected }) {
  const run = item.runId;
  return (
    <div className={`wi-row ${selected ? "is-selected" : ""}`} onClick={() => onOpen(item.id)}>
      <div className="wi-cell wi-cell--tree" style={{ paddingLeft: depth * 20 + 8 }}>
        {hasKids ? (
          <button className="wi-twist" onClick={(e) => { e.stopPropagation(); onToggle(item.id); }}>
            <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
          </button>
        ) : <span className="wi-twist wi-twist--leaf" />}
        <TypeIcon type={item.type} size={15} />
        <span className="wi-row__title">{item.title}</span>
      </div>
      <div className="wi-cell wi-cell--id" onClick={(e) => e.stopPropagation()}><IdChip value={item.id} /></div>
      <div className="wi-cell wi-cell--type"><span className="wi-type">{item.type}</span></div>
      <div className="wi-cell wi-cell--status"><StatusBadge status={item.status} size="sm" /></div>
      <div className="wi-cell wi-cell--prio"><PriorityTag priority={item.priority} /></div>
      <div className="wi-cell wi-cell--est"><EstBadge est={item.est} /></div>
      <div className="wi-cell wi-cell--run">{run ? <RunProgress runId={run} compact /> : <span className="subtle">—</span>}</div>
    </div>
  );
}

function WorkItemsScreen({ onOpen }) {
  const A = window.APM;
  const [expanded, setExpanded] = useState(() => new Set(["WI-1", "WI-2", "WI-5", "WI-6", "WI-3"]));
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const toggle = (id) => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const counts = A.statusCounts();
  const passes = (it) => (statusFilter === "all" || it.status === statusFilter) && (typeFilter === "all" || it.type === typeFilter);

  // flatten tree respecting expansion + filter (keep ancestors of matches when filtering)
  const rows = [];
  const filtering = statusFilter !== "all" || typeFilter !== "all";
  const walk = (parentId, depth) => {
    A.childrenOf(parentId).forEach(it => {
      const kids = A.childrenOf(it.id);
      const subHasMatch = (node) => A.childrenOf(node.id).some(c => passes(c) || subHasMatch(c));
      const show = filtering ? (passes(it) || subHasMatch(it)) : true;
      if (show) {
        rows.push({ item: it, depth, hasKids: kids.length > 0 });
        if (filtering || expanded.has(it.id)) walk(it.id, depth + 1);
      }
    });
  };
  walk(null, 0);

  const types = ["project", "goal", "milestone", "feature", "task", "bug", "research"];

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Work items</h1>
          <div className="page__sub">{A.items.length} items · hierarchical project tree</div>
        </div>
        <div className="row">
          <FutureBtn icon="plus" label="New item" />
          <button className="btn btn-default btn-sm"><Icon name="list-collapse" size={14} />Collapse all</button>
        </div>
      </div>

      <div className="wi-toolbar">
        <div className="fchips">
          <span className="eyebrow fchips__label">Status</span>
          <FilterChip label="All" active={statusFilter === "all"} onClick={() => setStatusFilter("all")} count={A.items.length} />
          {["active", "blocked", "ready", "draft", "completed", "cancelled"].map(s => (
            <FilterChip key={s} label={A.STATUS[s].label} swatch={s} count={counts[s]}
              active={statusFilter === s} onClick={() => setStatusFilter(s)} />
          ))}
        </div>
        <label className="field wi-typeselect">
          <Icon name="filter" size={13} className="subtle" />
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      <div className="wi-table">
        <div className="wi-head">
          <div className="wi-cell wi-cell--tree">Item</div>
          <div className="wi-cell wi-cell--id">ID</div>
          <div className="wi-cell wi-cell--type">Type</div>
          <div className="wi-cell wi-cell--status">Status</div>
          <div className="wi-cell wi-cell--prio">Prio</div>
          <div className="wi-cell wi-cell--est">Est</div>
          <div className="wi-cell wi-cell--run">Run</div>
        </div>
        <div className="wi-body">
          {rows.map(r => (
            <WorkItemRow key={r.item.id} item={r.item} depth={r.depth} hasKids={r.hasKids}
              expanded={expanded.has(r.item.id)} onToggle={toggle} onOpen={onOpen} />
          ))}
          {rows.length === 0 && <div className="wi-empty"><Icon name="search-x" size={20} className="subtle" />No items match these filters.</div>}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { WorkItemsScreen });
