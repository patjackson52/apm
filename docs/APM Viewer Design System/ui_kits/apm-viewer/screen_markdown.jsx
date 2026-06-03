/* APM Viewer — rich markdown rendering + copy affordances. MarkdownDoc + MarkdownScreen. */

function useThemeAttr() {
  const [t, setT] = useState(document.documentElement.getAttribute("data-theme") || "dark");
  useEffect(() => {
    const o = new MutationObserver(() => setT(document.documentElement.getAttribute("data-theme")));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => o.disconnect();
  }, []);
  return t;
}

let mermaidReady = false;
function MermaidBlock({ block }) {
  const theme = useThemeAttr();
  const [svg, setSvg] = useState("");
  const push = useToast();
  const [copied, copy] = useCopy(1000);
  useEffect(() => {
    let alive = true;
    const render = () => {
      if (!window.mermaid) { setTimeout(render, 120); return; }
      window.mermaid.initialize({ startOnLoad: false, securityLevel: "loose", fontFamily: "Geist, sans-serif",
        theme: theme === "dark" ? "dark" : "neutral",
        themeVariables: theme === "dark"
          ? { background: "transparent", primaryColor: "#1b1f27", primaryBorderColor: "#353c47", lineColor: "#5c6470", primaryTextColor: "#e8eaee" }
          : { background: "transparent", primaryColor: "#f1f2f5", primaryBorderColor: "#d2d6de", lineColor: "#878d9a", primaryTextColor: "#181b22" } });
      const id = "mmd-" + block.id + "-" + theme;
      window.mermaid.render(id, block.code).then(({ svg }) => { if (alive) setSvg(svg); }).catch(() => {});
    };
    render();
    return () => { alive = false; };
  }, [theme, block.id, block.code]);
  const copySvg = () => { copy(svg); push("Copied diagram SVG"); };
  return (
    <figure className="md-figure md-mermaid" data-block>
      <div className="md-mermaid__canvas" dangerouslySetInnerHTML={{ __html: svg }} />
      {block.caption && <figcaption className="md-caption">{block.caption}</figcaption>}
      <div className="md-block-tools">
        <button className="md-tool" title="Copy diagram source" onClick={() => { copyToClipboard(block.code); push("Copied Mermaid source"); }}>
          <Icon name="code" size={13} />Source</button>
        <button className={`md-tool ${copied ? "is-copied" : ""}`} title="Copy rendered diagram (SVG)" onClick={copySvg}>
          <Icon name={copied ? "check" : "image"} size={13} />Image</button>
      </div>
    </figure>
  );
}

function CodeBlock({ block }) {
  const push = useToast();
  const [copied, copy] = useCopy();
  // light token highlighting
  const html = block.code
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/(\/\/.*$)/gm, '<span class="t-comment">$1</span>')
    .replace(/(&quot;|&#39;|`)(.*?)\1/g, '<span class="t-string">$1$2$1</span>')
    .replace(/"([^"]*)"/g, '<span class="t-string">"$1"</span>')
    .replace(/\b(function|return|const|let|if|throw|new|type|interface|import|export|for|while|else)\b/g, '<span class="t-keyword">$1</span>')
    .replace(/\b([A-Z][A-Za-z0-9]+)\b/g, '<span class="t-type">$1</span>')
    .replace(/\b(\d+)\b/g, '<span class="t-number">$1</span>');
  return (
    <div className="md-code" data-block>
      <div className="md-code__bar">
        <span className="md-code__lang mono">{block.lang}</span>
        <button className={`md-tool ${copied ? "is-copied" : ""}`} onClick={() => { copy(block.code); push("Copied code"); }} title="Copy code">
          <Icon name={copied ? "check" : "copy"} size={13} />{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre><code className="mono" dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  );
}

function MdTable({ block }) {
  const push = useToast();
  const csv = [block.head, ...block.rows].map(r => r.join("\t")).join("\n");
  return (
    <div className="md-table-wrap" data-block>
      <div className="md-block-tools md-block-tools--table">
        <button className="md-tool" onClick={() => { copyToClipboard(block.md); push("Copied table as Markdown"); }} title="Copy as Markdown"><Icon name="hash" size={13} />MD</button>
        <button className="md-tool" onClick={() => { copyToClipboard(csv); push("Copied table as TSV"); }} title="Copy as TSV"><Icon name="table" size={13} />TSV</button>
      </div>
      <table className="md-table">
        <thead><tr>{block.head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{block.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j === 1 ? "mono" : ""}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Block({ block }) {
  const push = useToast();
  if (block.type === "h2" || block.type === "h3") {
    const Tag = block.type;
    return (
      <div className={`md-headwrap md-headwrap--${block.type}`} id={block.id} data-block>
        <Tag className="md-head">{block.text}</Tag>
        <SectionCopy markdown={`${block.type === "h2" ? "## " : "### "}${block.text}`} />
      </div>
    );
  }
  if (block.type === "p") return (
    <div className="md-p-wrap" data-block><p className="md-p" dangerouslySetInnerHTML={{ __html: block.html }} /><SectionCopy markdown={block.md} /></div>);
  if (block.type === "ul") return (
    <div className="md-p-wrap" data-block><ul className="md-ul">{block.items.map((it, i) => <li key={i}>{it}</li>)}</ul><SectionCopy markdown={block.md} /></div>);
  if (block.type === "callout") return (
    <div className={`md-callout md-callout--${block.tone}`} data-block>
      <Icon name={block.tone === "warn" ? "triangle-alert" : "info"} size={16} />
      <div dangerouslySetInnerHTML={{ __html: block.html }} />
      <SectionCopy markdown={block.md} className="section-copy--callout" />
    </div>);
  if (block.type === "image") return (
    <figure className="md-figure" data-block>
      <img src={block.src} alt={block.alt} className="md-img" />
      {block.caption && <figcaption className="md-caption">{block.caption}</figcaption>}
      <div className="md-block-tools">
        <button className="md-tool" onClick={() => { copyToClipboard(block.md); push("Copied image markdown"); }} title="Copy image markdown"><Icon name="hash" size={13} />MD</button>
        <button className="md-tool" onClick={() => { copyToClipboard(block.src); push("Copied image path"); }} title="Copy path"><Icon name="link" size={13} />Path</button>
      </div>
    </figure>);
  if (block.type === "mermaid") return <MermaidBlock block={block} />;
  if (block.type === "code") return <CodeBlock block={block} />;
  if (block.type === "table") return <MdTable block={block} />;
  return null;
}

function DocOutline({ doc, active }) {
  const heads = doc.blocks.filter(b => b.type === "h2" || b.type === "h3");
  const go = (id) => { const el = document.getElementById(id); if (el) el.scrollIntoView ? el.parentElement.scrollTop : null; };
  return (
    <aside className="md-outline">
      <div className="eyebrow md-outline__title">On this page</div>
      <nav>
        {heads.map(h => (
          <a key={h.id} href={`#${h.id}`} className={`md-outline__link ${h.type === "h3" ? "is-sub" : ""} ${active === h.id ? "is-active" : ""}`}
            onClick={(e) => { e.preventDefault(); const el = document.getElementById(h.id); const sc = document.querySelector(".md-scroll"); if (el && sc) sc.scrollTo({ top: el.offsetTop - 16, behavior: "smooth" }); }}>
            {h.text}
          </a>
        ))}
      </nav>
    </aside>
  );
}

function MarkdownDoc({ doc, embedded }) {
  const scopeRef = useRef(null);
  const firstHead = doc.blocks.find(b => b.type === "h2" || b.type === "h3");
  const [active, setActive] = useState(firstHead ? firstHead.id : null);
  useEffect(() => {
    const sc = scopeRef.current; if (!sc) return;
    const onScroll = () => {
      const heads = doc.blocks.filter(b => b.type === "h2" || b.type === "h3").map(b => document.getElementById(b.id)).filter(Boolean);
      let cur = heads[0] && heads[0].id;
      heads.forEach(h => { if (h.offsetTop - 80 <= sc.scrollTop) cur = h.id; });
      setActive(cur);
    };
    sc.addEventListener("scroll", onScroll); return () => sc.removeEventListener("scroll", onScroll);
  }, [doc]);

  return (
    <div className={`md-layout ${embedded ? "md-layout--embedded" : ""}`}>
      <div className="md-scroll" ref={scopeRef}>
        <article className="prose md-doc">
          {doc.blocks.map((b, i) => <Block key={b.id || i} block={b} />)}
        </article>
      </div>
      <DocOutline doc={doc} active={active} />
      <SelectionToolbar scopeRef={scopeRef} />
    </div>
  );
}

function VersionMenu({ doc, viewV, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const hist = window.APM.versionHistory(doc);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  if (hist.length <= 1) return (
    <span className="ver-trigger ver-trigger--single"><Icon name="git-commit-vertical" size={13} /> v{doc.version}</span>
  );
  return (
    <span className="ver-menu" ref={ref}>
      <button className="ver-trigger" onClick={() => setOpen(o => !o)} title="Version history">
        <Icon name="git-commit-vertical" size={13} /> v{viewV}<span className="ver-trigger__n">of {doc.version}</span>
        <Icon name="chevron-down" size={12} />
      </button>
      {open && (
        <div className="menu ver-menu__pop" role="menu">
          <div className="menu__label eyebrow">Version history · {doc.ref.split("@")[0]}</div>
          <div className="ver-timeline">
            {hist.map(h => (
              <button key={h.v} className={`ver-row ${h.v === viewV ? "is-active" : ""}`} role="menuitem"
                onClick={() => { onPick(h.v); setOpen(false); }}>
                <span className="ver-row__rail"><span className="ver-row__dot" data-s={h.status} /></span>
                <span className="ver-row__main">
                  <span className="ver-row__top"><span className="mono">v{h.v}</span>
                    <span className="art-status" data-s={h.status}>{h.status}</span>
                    {h.current && <span className="ver-row__cur">current</span>}</span>
                  <span className="ver-row__meta">{h.author} · {h.at}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

function DocHeader({ doc }) {
  const D = window.APM_DOCS;
  const hist = window.APM.versionHistory(doc);
  const [viewV, setViewV] = useState(doc.version);
  useEffect(() => { setViewV(doc.version); }, [doc.id, doc.version]);
  const viewing = hist.find(h => h.v === viewV) || hist[0];
  const isHistorical = viewV !== doc.version;
  return (
    <>
    <div className="doc-header">
      <div className="doc-header__main">
        <div className="row" style={{ gap: 8, marginBottom: 6 }}>
          <span className={`art-type art-type--${doc.type}`}><Icon name="file-text" size={13} />{doc.type}</span>
          <IdChip value={`${doc.ref.split("@")[0]}@${viewV}`} />
          <span className="art-status" data-s={viewing.status}>{viewing.status}</span>
        </div>
        <h1 className="doc-header__title">{doc.title}</h1>
        <div className="doc-header__meta">
          <span><Icon name="bot" size={13} /> {doc.author}</span>
          <VersionMenu doc={doc} viewV={viewV} onPick={setViewV} />
          <span><Icon name="clock" size={13} /> {viewing.at}</span>
          <span><IdChip value={doc.item} /></span>
        </div>
      </div>
      <div className="doc-header__actions">
        <CopyMenu label="Copy doc" markdown={D.toMarkdown(doc)} plain={D.toPlain(doc)} rich={D.toMarkdown(doc)} />
        <FutureBtn icon="pencil" label="Edit" />
      </div>
    </div>
    {isHistorical && (
      <div className="ver-banner">
        <Icon name="history" size={15} />
        <span>Viewing <strong className="mono">v{viewV}</strong> ({viewing.status}) — an immutable historical snapshot.</span>
        <button className="btn btn-default btn-sm" onClick={() => setViewV(doc.version)}>
          <Icon name="arrow-up-to-line" size={13} />View latest v{doc.version}</button>
      </div>
    )}
    </>
  );
}

function MarkdownScreen({ kind }) {
  const doc = window.APM_DOCS.spec;
  return (
    <div className="page page--doc">
      <DocHeader doc={doc} />
      <MarkdownDoc doc={doc} />
    </div>
  );
}

Object.assign(window, { MarkdownDoc, MarkdownScreen, DocHeader, useThemeAttr });
