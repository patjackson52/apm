/* APM Viewer — Workflow node-graph (marquee). Reusable WorkflowGraph + WorkflowScreen. */

const NODE_W = 158, NODE_H = 66, COL = 210, ROWH = 150, OX = 40, OY = 30;
const nodePos = (s) => ({ x: OX + s.x * COL, y: OY + s.y * ROWH });
const nodeCenter = (s) => { const p = nodePos(s); return { x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 }; };

function edgePath(a, b, kind) {
  const c1 = nodeCenter(a), c2 = nodeCenter(b);
  // back-edge (target left of source) routes below
  if (b.x < a.x) {
    const y = Math.max(c1.y, c2.y) + 96;
    return `M ${c1.x} ${c1.y + NODE_H / 2 - 4} C ${c1.x} ${y}, ${c2.x} ${y}, ${c2.x} ${c2.y + NODE_H / 2 - 4}`;
  }
  const sx = c1.x + NODE_W / 2, ex = c2.x - NODE_W / 2;
  const mx = (sx + ex) / 2;
  return `M ${sx} ${c1.y} C ${mx} ${c1.y}, ${mx} ${c2.y}, ${ex} ${c2.y}`;
}

function RunStepBadge({ status }) {
  const map = { completed: ["check", "completed"], running: ["loader", "running"], pending: ["circle", "pending"],
    failed: ["x", "failed"], skipped: ["minus", "skipped"] };
  const [icon, cls] = map[status] || map.pending;
  return <span className={`rstep rstep--${cls}`}><Icon name={icon} size={11} />{status}</span>;
}

function GraphNode({ step, run, isCurrent, onSelect, selected }) {
  const meta = window.STEP_META[step.type];
  const pos = nodePos(step);
  const rstep = run && run.steps[step.id];
  const rstatus = rstep ? rstep.status : null;
  const isDiamond = meta.shape === "diamond";
  const cls = [
    "gnode", `gnode--${meta.shape}`, `gnode--type-${step.type}`,
    rstatus ? `gnode--run-${rstatus}` : "",
    isCurrent ? "gnode--current" : "",
    selected ? "gnode--selected" : "",
  ].join(" ");
  return (
    <div className={cls} style={{ left: pos.x, top: pos.y, width: NODE_W, minHeight: NODE_H }}
      onClick={(e) => { e.stopPropagation(); onSelect(step.id); }}>
      {isCurrent && <span className="gnode__current-tag">current</span>}
      <div className="gnode__head">
        <span className="gnode__icon"><Icon name={meta.icon} size={14} /></span>
        <span className="gnode__title">{step.title}</span>
        {rstatus === "running" && <span className="gnode__live" />}
      </div>
      <div className="gnode__type">{meta.label}</div>
      {step.type === "review_gate" && (
        <div className="gnode__reviewers">
          {step.reviewers.map(r => {
            const v = rstep && rstep.verdicts && rstep.verdicts[r.role];
            return <span key={r.role} className={`rev-chip ${v ? `rev-chip--${v}` : ""}`} title={v ? `${r.role}: ${v}` : r.role}>
              <span className="rev-chip__dot" />{r.role}</span>;
          })}
        </div>
      )}
      {step.type === "human_gate" && (
        <div className="gnode__gateq"><Icon name="help-circle" size={11} />{step.question}</div>
      )}
      {rstatus && <div className="gnode__rstatus"><RunStepBadge status={rstatus} /></div>}
    </div>
  );
}

function NodePopover({ step, run, pos, onClose, onOpenArtifact }) {
  const meta = window.STEP_META[step.type];
  const rstep = run && run.steps[step.id];
  const push = useToast();
  const src = `step: ${step.id}\ntype: ${step.type}\ntitle: ${step.title}\n${step.desc}`;
  const promptArt = (run && step.type === "agent_prompt")
    ? window.APM.artifacts.find(a => a.type === "prompt" && a.item === run.workItem) : null;
  return (
    <div className="node-pop" style={{ left: pos.x, top: pos.y }} onClick={e => e.stopPropagation()}>
      <div className="node-pop__head">
        <span className="gnode__icon"><Icon name={meta.icon} size={14} /></span>
        <span className="node-pop__title">{step.title}</span>
        <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={onClose}><Icon name="x" size={14} /></button>
      </div>
      <div className="node-pop__body">
        <div className="kv"><span className="kv__k">Type</span><span className="kv__v mono">{step.type}</span></div>
        <div className="kv"><span className="kv__k">Step ID</span><IdChip value={step.id} /></div>
        {rstep && <div className="kv"><span className="kv__k">Run status</span><RunStepBadge status={rstep.status} /></div>}
        {rstep && rstep.lease && <div className="kv"><span className="kv__k">Lease</span><span className="mono">{rstep.lease}</span></div>}
        {rstep && rstep.answer && <div className="kv"><span className="kv__k">Answer</span><span>{rstep.answer}</span></div>}
        {rstep && rstep.at && <div className="kv"><span className="kv__k">At</span><span className="mono subtle">{rstep.at}</span></div>}
        <p className="node-pop__desc">{step.desc}</p>
        {step.prompt && (
          <div className="node-pop__prompt">
            <div className="node-pop__prompt-head"><span className="eyebrow">Prompt</span>
              <button className="md-tool" onClick={() => { copyToClipboard(step.prompt); push("Copied prompt"); }} title="Copy prompt"><Icon name="copy" size={12} />Copy</button>
            </div>
            <p className="node-pop__prompt-text">{step.prompt}</p>
          </div>
        )}
        {promptArt && (
          <button className="node-pop__artlink" onClick={() => onOpenArtifact && onOpenArtifact(promptArt.id)}>
            <span className="art-type art-type--prompt"><Icon name="message-square-text" size={12} />prompt</span>
            <span className="node-pop__artlink-main">
              <span className="node-pop__artlink-title">Prompt artifact</span>
              <span className="mono subtle">{promptArt.ref}</span>
            </span>
            <Icon name="arrow-up-right" size={14} className="subtle" />
          </button>
        )}
        {step.reviewers && (
          <div className="node-pop__reviewers">
            {step.reviewers.map(r => {
              const v = rstep && rstep.verdicts && rstep.verdicts[r.role];
              return <div key={r.role} className="kv"><span className="kv__k">{r.role}</span>
                {v ? <span className={`rstep rstep--${v}`}>{v}</span> : <span className="subtle">awaiting</span>}</div>;
            })}
          </div>
        )}
      </div>
      <div className="node-pop__foot">
        <CopyButton text={src} label="Copy step source" variant="default" toast="Copied step source" />
        <FutureBtn icon="pencil" label="Edit" />
      </div>
    </div>
  );
}

function WorkflowGraph({ run, embedded, onOpenArtifact }) {
  const wf = window.APM.workflow;
  const [tf, setTf] = useState({ x: 20, y: embedded ? 8 : -54, k: embedded ? 0.82 : 1 });
  const [sel, setSel] = useState(null);
  const drag = useRef(null);
  const onDown = (e) => { if (e.target.closest(".gnode") || e.target.closest(".node-pop")) return; drag.current = { x: e.clientX, y: e.clientY, tx: tf.x, ty: tf.y }; setSel(null); };
  const onMove = (e) => { if (!drag.current) return; setTf(t => ({ ...t, x: drag.current.tx + (e.clientX - drag.current.x), y: drag.current.ty + (e.clientY - drag.current.y) })); };
  const onUp = () => { drag.current = null; };
  const onWheel = (e) => { e.preventDefault(); const k = Math.min(1.8, Math.max(0.4, tf.k - e.deltaY * 0.0015)); setTf(t => ({ ...t, k })); };
  const zoom = (d) => setTf(t => ({ ...t, k: Math.min(1.8, Math.max(0.4, t.k + d)) }));
  const fit = () => setTf({ x: 20, y: embedded ? 8 : -54, k: embedded ? 0.82 : 1 });

  const selStep = sel && wf.steps.find(s => s.id === sel);
  const selPos = selStep ? nodePos(selStep) : null;

  return (
    <div className="wfgraph" onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onWheel={onWheel}>
      <div className="wf-canvas" style={{ transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.k})` }}>
        <svg className="wf-edges" width="2400" height="600">
          <defs>
            <marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
              <path d="M1,1 L7,4.5 L1,8" fill="none" stroke="var(--fg-subtle)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>
          {wf.edges.map(([from, to, kind], i) => {
            const a = wf.steps.find(s => s.id === from), b = wf.steps.find(s => s.id === to);
            const done = run && run.steps[from] && run.steps[from].status === "completed" && run.steps[to] && run.steps[to].status !== "pending";
            return <path key={i} d={edgePath(a, b, kind)} className={`wf-edge ${kind ? `wf-edge--${kind}` : ""} ${done ? "wf-edge--done" : ""}`}
              markerEnd="url(#arrow)" fill="none" />;
          })}
        </svg>
        {wf.steps.map(s => (
          <GraphNode key={s.id} step={s} run={run} isCurrent={run && run.current === s.id}
            onSelect={setSel} selected={sel === s.id} />
        ))}
        {selStep && <NodePopover step={selStep} run={run} pos={{ x: selPos.x + NODE_W + 12, y: selPos.y }} onClose={() => setSel(null)} onOpenArtifact={onOpenArtifact} />}
      </div>

      <div className="wf-zoom">
        <button className="icon-btn" onClick={() => zoom(-0.15)} title="Zoom out"><Icon name="minus" size={16} /></button>
        <span className="wf-zoom__val mono">{Math.round(tf.k * 100)}%</span>
        <button className="icon-btn" onClick={() => zoom(0.15)} title="Zoom in"><Icon name="plus" size={16} /></button>
        <span className="topbar__divider" />
        <button className="icon-btn" onClick={fit} title="Reset view"><Icon name="maximize" size={15} /></button>
      </div>

      <WorkflowLegend hasRun={!!run} />
    </div>
  );
}

function WorkflowLegend({ hasRun }) {
  const [open, setOpen] = useState(true);
  const types = ["agent_execution", "review_gate", "human_gate", "decision", "decompose", "integration", "terminal"];
  return (
    <div className={`wf-legend ${open ? "" : "is-collapsed"}`}>
      <button className="wf-legend__toggle" onClick={() => setOpen(o => !o)}>
        <Icon name="list" size={13} /><span>Legend</span><Icon name={open ? "chevron-down" : "chevron-up"} size={13} />
      </button>
      {open && (
        <div className="wf-legend__body">
          <div className="eyebrow">Step types</div>
          <div className="wf-legend__grid">
            {types.map(t => (
              <div key={t} className="wf-legend__item">
                <span className={`wf-legend__node gnode--type-${t}`}><Icon name={window.STEP_META[t].icon} size={11} /></span>
                <span>{window.STEP_META[t].label}</span>
              </div>
            ))}
          </div>
          {hasRun && (<>
            <div className="eyebrow" style={{ marginTop: 10 }}>Run status</div>
            <div className="wf-legend__grid">
              {["completed", "running", "pending", "failed", "skipped"].map(s => (
                <div key={s} className="wf-legend__item">
                  <span className={`wf-legend__dot seg-${s === "running" ? "running" : s}`} style={{ background: `var(--run-${s === "running" ? "active" : s})` }} />
                  <span style={{ textTransform: "capitalize" }}>{s}</span>
                </div>
              ))}
            </div>
          </>)}
        </div>
      )}
    </div>
  );
}

function WorkflowScreen({ onOpenArtifact }) {
  const [mode, setMode] = useState("run");   // 'def' | 'run'
  const [runId, setRunId] = useState("RUN-22");
  const run = mode === "run" ? window.APM.runs[runId] : null;
  const wf = window.APM.workflow;
  const wi = run && window.APM.itemById[run.workItem];

  return (
    <div className="page page--flush">
      <div className="page__head">
        <div>
          <h1 className="page__title">{wf.title}</h1>
          <div className="page__sub">
            <span className="mono">{wf.name}</span> · {wf.version} · {wf.steps.length} steps
            {run && <> · overlaying run <IdChip value={run.id} /> on <IdChip value={run.workItem} /></>}
          </div>
        </div>
        <CopyMenu label="Copy workflow"
          markdown={`# ${wf.title} (${wf.name})\n\nSteps:\n${wf.steps.map(s => `- ${s.title} — ${s.type}`).join("\n")}`}
          plain={wf.steps.map(s => `${s.title} (${s.type})`).join(" → ")} />
      </div>

      <div className="wf-toolbar">
        <div className="seg">
          <button className={`seg__btn ${mode === "def" ? "is-active" : ""}`} onClick={() => setMode("def")}>
            <Icon name="git-branch" size={14} />Definition</button>
          <button className={`seg__btn ${mode === "run" ? "is-active" : ""}`} onClick={() => setMode("run")}>
            <Icon name="circle-play" size={14} />Run overlay</button>
        </div>
        {mode === "run" && (
          <label className="field">
            <Icon name="git-commit-horizontal" size={13} className="subtle" />
            <select value={runId} onChange={e => setRunId(e.target.value)} className="wf-runselect">
              <option value="RUN-22">RUN-22 · WI-5 implementing</option>
              <option value="RUN-24">RUN-24 · WI-6 blocked at gate</option>
            </select>
          </label>
        )}
        {run && <span className={`status-badge status-${wi.status} status-badge--sm`}>{run.current === "approve_dir" ? "blocked at gate" : `on ${wf.steps.find(s=>s.id===run.current).title}`}</span>}
        <div className="wf-toolbar__spacer" />
        <div className="seg seg--disabled" title="Edit mode ships with write actions">
          <span className="seg__lock"><Icon name="lock" size={12} /></span>
          <button className="seg__btn" disabled><Icon name="mouse-pointer-2" size={14} />Select</button>
          <button className="seg__btn" disabled><Icon name="plus" size={14} />Add step</button>
          <button className="seg__btn" disabled><Icon name="spline" size={14} />Connect</button>
        </div>
      </div>

      <WorkflowGraph run={run} onOpenArtifact={onOpenArtifact} />
    </div>
  );
}

Object.assign(window, { WorkflowGraph, WorkflowScreen, RunStepBadge });
