"use client";
import { useEffect, useRef } from 'react';
import type { StepOverlay } from '@/lib/workflow/runOverlay';
import { CopyButton } from '@/components/Copy/CopyButton';
import s from './StepPopover.module.css';

/** Run-step detail dialog. All fields plain-text (no markdown/HTML sink). */
export function StepPopover({
  step,
  overlay,
  onClose,
}: {
  step: { id: string; type: string };
  overlay?: StepOverlay;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
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
