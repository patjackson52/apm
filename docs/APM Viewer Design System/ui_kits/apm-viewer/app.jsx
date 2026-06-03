/* APM Viewer — main app: shell, routing, theme, shortcuts overlay. */

function ShortcutsOverlay({ onClose }) {
  const groups = [
    { title: "Global", rows: [
      ["/", "Focus search"], ["g then d", "Go to Dashboard"], ["g then w", "Go to Work items"],
      ["?", "This help"], ["⌘ ⇧ D", "Toggle theme"], ["Esc", "Close / dismiss"],
    ]},
    { title: "Copy & clipboard", rows: [
      ["⌘ C", "Copy selection"], ["⌘ ⇧ C", "Copy whole doc as Markdown"],
      ["click an ID", "Copy that ID"], ["hover a block", "Reveal section copy"],
      ["select text", "Selection toolbar → Copy / As Markdown"],
    ]},
    { title: "Document", rows: [
      ["t", "Toggle outline / TOC"], ["[ / ]", "Prev / next heading"],
    ]},
  ];
  return (
    <div className="scrim" onClick={onClose}>
      <div className="shortcuts" onClick={e => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
        <header className="shortcuts__head">
          <h2 className="shortcuts__title"><Icon name="keyboard" size={18} />Keyboard shortcuts</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
        </header>
        <div className="shortcuts__grid">
          {groups.map(g => (
            <div key={g.title} className="shortcuts__group">
              <div className="eyebrow shortcuts__group-title">{g.title}</div>
              {g.rows.map(([k, d]) => (
                <div key={d} className="shortcuts__row">
                  <span className="shortcuts__desc">{d}</span>
                  <span className="shortcuts__keys">{k.split(" ").map((p, i) => <kbd key={i} className="kbd">{p}</kbd>)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stub({ title }) {
  return <div className="page"><h1 className="page__title">{title}</h1><p className="muted">Screen coming up next.</p></div>;
}

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("apm-theme") || "dark");
  const [route, setRoute] = useState("dashboard");
  const [project, setProject] = useState(window.APM.projects[0]);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [help, setHelp] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [artifactTarget, setArtifactTarget] = useState(null);

  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); localStorage.setItem("apm-theme", theme); }, [theme]);
  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  useEffect(() => {
    const h = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "?") { setHelp(true); }
      if (e.key === "Escape") { setHelp(false); setSwitcherOpen(false); }
      if (e.key === "D" && e.shiftKey && (e.metaKey || e.ctrlKey)) { e.preventDefault(); toggleTheme(); }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);

  const openDetail = (id) => { setDetailItem(id); setRoute("detail"); };
  const openArtifact = (id) => { setArtifactTarget({ id }); setRoute("artifacts"); };

  let screen;
  switch (route) {
    case "dashboard": screen = <DashboardScreen onOpen={openDetail} />; break;
    case "items":     screen = window.WorkItemsScreen ? <WorkItemsScreen onOpen={openDetail} /> : <Stub title="Work items" />; break;
    case "detail":    screen = window.WorkItemDetailScreen ? <WorkItemDetailScreen itemId={detailItem} onBack={() => setRoute("items")} setRoute={setRoute} /> : <Stub title="Detail" />; break;
    case "workflows": screen = window.WorkflowScreen ? <WorkflowScreen onOpenArtifact={openArtifact} /> : <Stub title="Workflows" />; break;
    case "artifacts": screen = window.ArtifactsScreen ? <ArtifactsScreen key={"artifacts" + (artifactTarget ? artifactTarget.id : "")} kind="artifacts" onOpenItem={openDetail} initialSel={artifactTarget && artifactTarget.id} /> : <Stub title="Artifacts" />; break;
    case "specs":     screen = window.ArtifactsScreen ? <ArtifactsScreen key="specs" kind="specs" onOpenItem={openDetail} /> : <Stub title="Specs" />; break;
    case "plans":     screen = window.ArtifactsScreen ? <ArtifactsScreen key="plans" kind="plans" onOpenItem={openDetail} /> : <Stub title="Plans" />; break;
    case "adrs":      screen = window.ArtifactsScreen ? <ArtifactsScreen key="adrs" kind="adrs" onOpenItem={openDetail} /> : <Stub title="ADRs & Decisions" />; break;
    case "blockers":  screen = window.BlockersScreen ? <BlockersScreen onOpen={openDetail} /> : <Stub title="Blockers & Gates" />; break;
    case "states":    screen = window.StatesScreen ? <StatesScreen /> : <Stub title="States" />; break;
    default: screen = <Stub title="—" />;
  }

  return (
    <ToastHost>
      <div className="app apm-root">
        <TopBar project={project} setProject={setProject} switcherOpen={switcherOpen} setSwitcherOpen={setSwitcherOpen}
          theme={theme} toggleTheme={toggleTheme} onHelp={() => setHelp(true)} />
        <div className="body">
          <Sidebar route={route === "detail" ? "items" : route} setRoute={(r) => { setArtifactTarget(null); setRoute(r); }} collapsed={collapsed} setCollapsed={setCollapsed} />
          <main className="main">{screen}</main>
        </div>
        {help && <ShortcutsOverlay onClose={() => setHelp(false)} />}
      </div>
    </ToastHost>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
