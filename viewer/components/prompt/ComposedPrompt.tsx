"use client";
import { useState } from 'react';
import { Layers, Code, Ban, Flag } from 'lucide-react';
import type { StructuredDispatch } from '@apm/types';
import { StoredBody } from './StoredBody';
import { CopyButton } from '@/components/Copy/CopyButton';
import { composeMarkdown } from '@/lib/prompt/compose';

function ScafBlock({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="scaf">
      <span className="scaf__label">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}

function LayerKey() {
  return (
    <span className="layer-key">
      <span className="layer-key__item">
        <span className="layer-key__sw layer-key__sw--body" />
        Stored body
      </span>
      <span className="layer-key__item">
        <span className="layer-key__sw layer-key__sw--scaf" />
        APM scaffold
      </span>
    </span>
  );
}

/**
 * The marquee render of a dispatched prompt: a layered view that interleaves the
 * APM scaffold sections (WORK_ITEM / CURRENT_STEP / ALLOWED_ACTION /
 * REQUIRED_CONTEXT / DO_NOT / WHEN_DONE) with the distinct StoredBody at the
 * PROMPT position — all as PLAIN TEXT (no HTML sink) — plus a verbatim Raw view.
 * Copy split: "Copy as Markdown" (composeMarkdown) / "Copy plain" (dispatch.raw).
 */
export function ComposedPrompt({
  dispatch,
  defaultView = 'layered',
  tight = false,
  clampBody = false,
}: {
  dispatch: StructuredDispatch;
  defaultView?: 'layered' | 'raw';
  tight?: boolean;
  clampBody?: boolean;
}) {
  const [view, setView] = useState<'layered' | 'raw'>(defaultView);
  const s = dispatch.scaffold;
  const promptName = dispatch.prompt_name ?? 'prompt';
  const promptVersion = dispatch.prompt_version ?? 0;

  return (
    <div className="composed">
      <div className="composed__bar">
        <Layers size={14} className="subtle" aria-hidden />
        <span className="composed__bar-title">Composed prompt</span>
        {view === 'layered' && !tight && <LayerKey />}
        <span className="composed__bar-spacer" />
        <div className="mini-seg">
          <button
            type="button"
            className={`mini-seg__btn ${view === 'layered' ? 'is-active' : ''}`}
            onClick={() => setView('layered')}
            aria-pressed={view === 'layered'}
          >
            <Layers size={12} aria-hidden />
            Layered
          </button>
          <button
            type="button"
            className={`mini-seg__btn ${view === 'raw' ? 'is-active' : ''}`}
            onClick={() => setView('raw')}
            aria-pressed={view === 'raw'}
          >
            <Code size={12} aria-hidden />
            Raw
          </button>
        </div>
        {!tight && (
          <span className="copy-split" style={{ display: 'inline-flex', gap: 4 }}>
            <CopyButton
              label="Copy as Markdown"
              onCopy={() => navigator.clipboard.writeText(composeMarkdown(dispatch))}
            />
            <CopyButton
              label="Copy plain"
              onCopy={() => navigator.clipboard.writeText(dispatch.raw)}
            />
          </span>
        )}
      </div>

      {view === 'layered' ? (
        <div className={`composed__doc ${tight ? 'composed__doc--tight' : ''}`}>
          <ScafBlock label="WORK_ITEM">
            <div className="scaf__val">{dispatch.step_id}</div>
          </ScafBlock>
          <ScafBlock label="CURRENT_STEP">
            <div className="scaf__val">
              {dispatch.step_id} ({dispatch.step_type})
            </div>
          </ScafBlock>

          {/* PROMPT resolves to the stored body, rendered distinctly. */}
          <StoredBody
            name={promptName}
            version={promptVersion}
            body={dispatch.body ?? ''}
            clampBody={clampBody}
          />

          {s.allowed_action != null && (
            <ScafBlock label="ALLOWED_ACTION">
              <div className="scaf__val scaf__val--prose">{s.allowed_action}</div>
            </ScafBlock>
          )}
          {s.required_context.length > 0 && (
            <ScafBlock label="REQUIRED_CONTEXT">
              <div className="scaf__ctx">
                {s.required_context.map((c, i) => (
                  <div key={i} className="scaf__ctx-row">
                    <span className="scaf__ctx-one">{c}</span>
                  </div>
                ))}
              </div>
            </ScafBlock>
          )}
          {s.do_not.length > 0 && (
            <ScafBlock label="DO_NOT" icon={<Ban size={11} aria-hidden />}>
              <ul className="scaf__list">
                {s.do_not.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </ScafBlock>
          )}
          {s.when_done.length > 0 && (
            <ScafBlock label="WHEN_DONE" icon={<Flag size={11} aria-hidden />}>
              {s.when_done.map((x, i) => (
                <div key={i} className="scaf__cmd">
                  {x}
                </div>
              ))}
            </ScafBlock>
          )}
        </div>
      ) : (
        <div className={`composed__doc ${tight ? 'composed__doc--tight' : ''}`}>
          <pre className="raw-snap">{dispatch.raw}</pre>
        </div>
      )}
    </div>
  );
}
