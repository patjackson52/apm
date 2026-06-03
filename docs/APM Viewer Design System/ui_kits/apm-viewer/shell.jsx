/* APM Viewer — app shell: TopBar, ProjectSwitcher, Sidebar. Exports to window. */

function ProjectSwitcher({ open, setOpen, project, setProject }) {
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [setOpen]);
  return (
    <div className="proj-switch" ref={ref}>
      <button className="proj-switch__trigger" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Icon name="box" size={15} className="proj-switch__glyph" />
        <span className="proj-switch__name">{project.name}</span>
        <Icon name="chevrons-up-down" size={14} className="muted" />
      </button>
      {open && (
        <div className="menu proj-switch__menu" role="menu">
          <div className="menu__label eyebrow">Local projects</div>
          {window.APM.projects.map(p => (
            <button key={p.id} className="menu__item proj-item" role="menuitem"
              onClick={() => { setProject(p); setOpen(false); }}>
              <Icon name={p.id === project.id ? "check" : "box"} size={15}
                className={p.id === project.id ? "" : "muted"} />
              <span className="proj-item__main">
                <span className="proj-item__name">{p.name}</span>
                <span className="proj-item__path mono">{p.path}</span>
              </span>
              <span className="proj-item__meta">
                <span className="mono subtle">{p.items}</span>
                {p.gates > 0 && <span className="nav-badge nav-badge--gate">{p.gates}</span>}
              </span>
            </button>
          ))}
          <div className="menu__sep" />
          <button className="menu__item muted" role="menuitem" disabled>
            <Icon name="folder-plus" size={15} /><span>Open project…</span>
            <span className="future-btn__soon">soon</span>
          </button>
        </div>
      )}
    </div>
  );
}

function TopBar({ project, setProject, switcherOpen, setSwitcherOpen, theme, toggleTheme, onHelp }) {
  return (
    <header className="topbar">
      <div className="topbar__left">
        <a className="app-mark" href="#" onClick={e => e.preventDefault()}>
          <span dangerouslySetInnerHTML={{ __html: window.APM_LOGO || "" }} />
          <span className="app-mark__name">APM Viewer <small>· api-ui</small></span>
        </a>
        <span className="topbar__divider" />
        <ProjectSwitcher open={switcherOpen} setOpen={setSwitcherOpen} project={project} setProject={setProject} />
      </div>
      <div className="topbar__center">
        <label className="search">
          <Icon name="search" size={15} />
          <input placeholder="Search work items, specs, runs…" />
          <span className="kbd">/</span>
        </label>
      </div>
      <div className="topbar__right">
        <button className="icon-btn" title="Keyboard shortcuts (?)" onClick={onHelp}><Icon name="keyboard" size={17} /></button>
        <button className="icon-btn" title={theme === "dark" ? "Light theme" : "Dark theme"} onClick={toggleTheme}>
          <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
        </button>
        <span className="topbar__divider" />
        <button className="icon-btn" title="You"><Avatar name="you" kind="human" size={24} /></button>
      </div>
    </header>
  );
}

const NAV = [
  { id: "dashboard", label: "Dashboard",        icon: "layout-dashboard" },
  { id: "items",     label: "Work items",       icon: "list-tree", count: 15 },
  { id: "artifacts", label: "Artifacts",         icon: "files", count: 11 },
  { id: "specs",     label: "Specs",            icon: "file-text", count: 1 },
  { id: "plans",     label: "Plans",            icon: "map", count: 1 },
  { id: "adrs",      label: "ADRs & Decisions", icon: "scale", count: 2 },
  { id: "workflows", label: "Workflows",        icon: "workflow" },
  { id: "blockers",  label: "Blockers & Gates", icon: "octagon-alert", gate: 3 },
  { id: "states",    label: "States", icon: "shapes" },
];

function Sidebar({ route, setRoute, collapsed, setCollapsed }) {
  return (
    <nav className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="sidebar__section">
        {!collapsed && <div className="sidebar__label eyebrow">Navigate</div>}
        {NAV.map(n => (
          <button key={n.id} className={`nav-item ${route === n.id ? "is-active" : ""}`}
            onClick={() => setRoute(n.id)} title={collapsed ? n.label : undefined}>
            <Icon name={n.icon} size={17} />
            <span className="nav-item__label">{n.label}</span>
            {n.gate != null && <span className="nav-badge nav-badge--gate">{n.gate}</span>}
            {n.count != null && n.gate == null && <span className="nav-badge">{n.count}</span>}
          </button>
        ))}
      </div>
      <div className="sidebar__spacer" />
      <div className="sidebar__section">
        <button className="nav-item" onClick={() => setCollapsed(c => !c)} title="Toggle sidebar">
          <Icon name={collapsed ? "panel-left-open" : "panel-left-close"} size={17} />
          <span className="nav-item__label">Collapse</span>
        </button>
      </div>
    </nav>
  );
}

Object.assign(window, { ProjectSwitcher, TopBar, Sidebar, NAV });
