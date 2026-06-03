/* APM Viewer — icons (Lucide) + clipboard/copy affordances.
   Exports to window: Icon, ToastHost, useToast, CopyButton, IdChip, CopyMenu,
   SectionCopy, useCopy, SelectionToolbar. */

const { useState, useEffect, useRef, useCallback, createContext, useContext } = React;

/* ---------- Icon (Lucide) ---------- */
function toPascal(name) {
  return name.split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("");
}
function Icon({ name, size = 16, strokeWidth = 1.75, className = "", style = {} }) {
  const ref = useRef(null);
  useEffect(() => {
    const L = window.lucide;
    const el = ref.current;
    if (!L || !el) return;
    const node = (L.icons && (L.icons[toPascal(name)] || L.icons[name]));
    el.innerHTML = "";
    if (node && L.createElement) {
      const svg = L.createElement(node);
      svg.setAttribute("width", size);
      svg.setAttribute("height", size);
      svg.setAttribute("stroke-width", strokeWidth);
      el.appendChild(svg);
    }
  }, [name, size, strokeWidth]);
  return <span ref={ref} className={"icon " + className}
    style={{ display: "inline-flex", width: size, height: size, flex: "0 0 auto", ...style }} aria-hidden="true" />;
}

/* ---------- Toast host ---------- */
const ToastCtx = createContext(null);
function ToastHost({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, msg, icon: opts.icon || "check" }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), opts.duration || 1700);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className="toast" role="status">
            <Icon name={t.icon} size={14} />{t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
function useToast() { return useContext(ToastCtx) || (() => {}); }

/* ---------- useCopy hook ---------- */
function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else { fallbackCopy(text); }
  } catch (e) { fallbackCopy(text); }
}
function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
}
function useCopy(timeout = 1400) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const copy = useCallback((text) => {
    copyToClipboard(typeof text === "function" ? text() : text);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), timeout);
  }, [timeout]);
  return [copied, copy];
}

/* ---------- CopyButton (icon or labeled) ---------- */
function CopyButton({ text, label, title = "Copy", size = "sm", variant = "ghost", toast }) {
  const [copied, copy] = useCopy();
  const push = useToast();
  const onClick = (e) => {
    e.stopPropagation();
    copy(text);
    if (toast) push(toast);
  };
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} copy-btn ${copied ? "is-copied" : ""}`}
      onClick={onClick} title={copied ? "Copied" : title} aria-label={title}>
      <Icon name={copied ? "check" : "copy"} size={size === "sm" ? 13 : 14} />
      {label && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}

/* ---------- IdChip — click-to-copy id/ref ---------- */
function IdChip({ value, prefix, className = "", onActivate }) {
  const [copied, copy] = useCopy();
  const push = useToast();
  return (
    <button type="button" className={`id-chip ${copied ? "is-copied" : ""} ${className}`}
      onClick={(e) => { e.stopPropagation(); if (onActivate) { onActivate(value); } copy(value); push(`Copied ${value}`); }}
      title={`Click to copy ${value}`}>
      <span className="mono id-chip__val">{value}</span>
      <Icon name={copied ? "check" : "copy"} size={11} className="id-chip__icon" />
    </button>
  );
}

/* ---------- CopyMenu — document-level split menu ---------- */
function CopyMenu({ markdown, plain, rich, label = "Copy", align = "right" }) {
  const [open, setOpen] = useState(false);
  const [copied, copy] = useCopy(1200);
  const push = useToast();
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  const choose = (kind) => {
    const map = { md: markdown, plain, rich: rich || plain };
    copy(map[kind]);
    push(kind === "md" ? "Copied as Markdown" : kind === "plain" ? "Copied as plain text" : "Copied as rich text");
    setOpen(false);
  };
  return (
    <div className="copy-split" ref={ref}>
      <button type="button" className="btn btn-default btn-sm copy-split__main" onClick={() => choose("md")}
        title="Copy as Markdown (⌘⇧C)">
        <Icon name={copied ? "check" : "clipboard-copy"} size={14} />
        <span>{copied ? "Copied" : label}</span>
      </button>
      <button type="button" className="btn btn-default btn-sm copy-split__caret" aria-label="Copy options"
        onClick={() => setOpen(o => !o)}><Icon name="chevron-down" size={13} /></button>
      {open && (
        <div className={`menu copy-split__menu copy-split__menu--${align}`} role="menu">
          <button className="menu__item" onClick={() => choose("md")} role="menuitem">
            <Icon name="hash" size={14} /><span>Copy as Markdown</span><kbd className="kbd">⌘⇧C</kbd>
          </button>
          <button className="menu__item" onClick={() => choose("plain")} role="menuitem">
            <Icon name="type" size={14} /><span>Copy as plain text</span>
          </button>
          <button className="menu__item" onClick={() => choose("rich")} role="menuitem">
            <Icon name="file-text" size={14} /><span>Copy as rich text</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- SectionCopy — hover-reveal block copy ---------- */
function SectionCopy({ markdown, text, kinds = ["md", "text"], className = "" }) {
  const push = useToast();
  const [copied, copy] = useCopy(1000);
  return (
    <div className={`section-copy ${className}`}>
      {kinds.includes("md") && (
        <button type="button" className={`section-copy__btn ${copied ? "is-copied" : ""}`}
          title="Copy section as Markdown"
          onClick={(e) => { e.stopPropagation(); copy(markdown); push("Copied section"); }}>
          <Icon name={copied ? "check" : "copy"} size={13} />
        </button>
      )}
    </div>
  );
}

/* ---------- SelectionToolbar — floats on text highlight ---------- */
function SelectionToolbar({ scopeRef }) {
  const [box, setBox] = useState(null);
  const push = useToast();
  useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) { setBox(null); return; }
      const scope = scopeRef && scopeRef.current;
      if (scope && !scope.contains(sel.anchorNode)) { setBox(null); return; }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      setBox({ top: r.top - 44, left: r.left + r.width / 2, text: sel.toString() });
    };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("selectionchange", () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setBox(null);
    });
    return () => document.removeEventListener("mouseup", onUp);
  }, [scopeRef]);
  if (!box) return null;
  const doCopy = (asMd) => {
    copyToClipboard(box.text);
    push(asMd ? "Copied as Markdown" : "Copied");
    window.getSelection().removeAllRanges();
    setBox(null);
  };
  return (
    <div className="sel-toolbar" style={{ top: box.top, left: box.left }} role="toolbar">
      <button className="sel-toolbar__btn" onClick={() => doCopy(false)}><Icon name="copy" size={13} />Copy</button>
      <span className="sel-toolbar__sep" />
      <button className="sel-toolbar__btn" onClick={() => doCopy(true)}><Icon name="hash" size={13} />As Markdown</button>
    </div>
  );
}

Object.assign(window, {
  Icon, ToastHost, useToast, CopyButton, IdChip, CopyMenu, SectionCopy, useCopy, SelectionToolbar, copyToClipboard,
});
