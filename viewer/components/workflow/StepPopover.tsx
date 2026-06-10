"use client";
import { useEffect, useRef } from 'react';
import type { StructuredDispatch } from '@apm/types';
import type { StepOverlay } from '@/lib/workflow/runOverlay';
import { CopyButton } from '@/components/Copy/CopyButton';
import { ComposedPrompt } from '@/components/prompt/ComposedPrompt';
import s from './StepPopover.module.css';

/** Run-step detail dialog. All fields plain-text (no markdown/HTML sink). When a
 *  structured `dispatch` is available the layered ComposedPrompt is shown (same
 *  component as the work-item panel, compact); otherwise the raw snapshot. */
export function StepPopover({
  step,
  overlay,
  dispatch,
  onClose,
}: {
  step: { id: string; type: string };
  overlay?: StepOverlay;
  dispatch?: StructuredDispatch;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Capture the element that had focus (the activating node) BEFORE we steal
    // focus into the dialog, and restore it on close (RunGraph holds no node ref,
    // so document.activeElement is the only reliable handle).
    const trigger = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  const source = `${step.id} (${step.type})`;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={`Step ${step.id}`}
      tabIndex={-1}
      className={s.popover}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
          return;
        }
        if (e.key === 'Tab' && ref.current) {
          const f = ref.current.querySelectorAll<HTMLElement>(
            'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])',
          );
          if (f.length === 0) {
            e.preventDefault();
            return;
          }
          const first = f[0]!;
          const last = f[f.length - 1]!;
          const active = document.activeElement;
          if (e.shiftKey && active === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <header className={s.head}>
        <strong>{step.id}</strong>
        <span className={s.meta}>{step.type}</span>
        <button type="button" className={s.close} onClick={onClose} aria-label="Close">×</button>
      </header>
      {overlay ? (
        <dl className={s.fields}>
          <dt>Status</dt><dd>{overlay.status}</dd>
          {overlay.reviewers.length > 0 ? (
            <>
              <dt>Reviewers</dt>
              <dd>
                <ul className={s.reviewers}>
                  {overlay.reviewers.map((r, i) => (
                    <li key={i}>{(r.role ?? 'reviewer')}: {r.verdict ?? 'pending'} (round {r.round})</li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
          {overlay.startedAt ? (<><dt>Started</dt><dd>{overlay.startedAt}</dd></>) : null}
          {overlay.completedAt ? (<><dt>Completed</dt><dd>{overlay.completedAt}</dd></>) : null}
          {overlay.failureReason ? (<><dt>Failure</dt><dd>{overlay.failureReason}</dd></>) : null}
          {overlay.artifactId ? (
            <>
              <dt>Artifact</dt>
              <dd><a href={`/artifacts/${encodeURIComponent(overlay.artifactId)}`}>{overlay.artifactId}</a></dd>
            </>
          ) : null}
          {dispatch ? (
            <>
              <dt>Dispatched prompt</dt>
              <dd>
                <ComposedPrompt dispatch={dispatch} tight clampBody />
                {dispatch.prompt_name ? (
                  <a className={s.openPrompt} href={`/prompts/${encodeURIComponent(dispatch.prompt_name)}`}>Open prompt</a>
                ) : null}
              </dd>
            </>
          ) : overlay.dispatchPrompt ? (
            <>
              <dt>Dispatch prompt</dt>
              <dd>
                <details className={s.prompt}>
                  <summary>Agent contract last dispatched</summary>
                  {/* Plain text only — no markdown/HTML sink. */}
                  <pre className={s.promptBody}>{overlay.dispatchPrompt}</pre>
                  <CopyButton
                    label="Copy dispatch prompt"
                    onCopy={() => navigator.clipboard.writeText(overlay.dispatchPrompt ?? '')}
                    disabled={typeof navigator === 'undefined' || !navigator.clipboard}
                  />
                </details>
              </dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className={s.meta}>No run data for this step.</p>
      )}
      <footer className={s.foot}>
        <CopyButton label="Copy step source" onCopy={() => navigator.clipboard.writeText(source)} disabled={typeof navigator === 'undefined' || !navigator.clipboard} />
      </footer>
    </div>
  );
}
