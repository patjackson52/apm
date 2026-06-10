"use client";
import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import type { StructuredDispatch } from '@apm/types';
import type { StepOverlay } from '@/lib/workflow/runOverlay';
import { CopyButton } from '@/components/Copy/CopyButton';
import { ComposedPrompt } from '@/components/prompt/ComposedPrompt';
import s from './StepPopover.module.css';

/**
 * Run-step detail dialog on Radix Dialog — focus trap, Escape/outside-dismiss, focus
 * restore, and ARIA (role=dialog, aria-modal, labelled by the title) come from the
 * primitive; we only style it with the design tokens. All fields are plain text (no
 * markdown/HTML sink). When a structured `dispatch` is available the layered
 * ComposedPrompt is shown (same component as the work-item panel, compact).
 */
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
  const source = `${step.id} (${step.type})`;
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.popover} aria-describedby={undefined}>
          <header className={s.head}>
            <Dialog.Title asChild><strong>{step.id}</strong></Dialog.Title>
            <span className={s.meta}>{step.type}</span>
            <Dialog.Close asChild>
              <button type="button" className={s.close} aria-label="Close">×</button>
            </Dialog.Close>
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
                  <dd><Link href={`/artifacts/${encodeURIComponent(overlay.artifactId)}`}>{overlay.artifactId}</Link></dd>
                </>
              ) : null}
              {dispatch ? (
                <>
                  <dt>Dispatched prompt</dt>
                  <dd>
                    <ComposedPrompt dispatch={dispatch} tight clampBody />
                    {dispatch.prompt_name ? (
                      <Link className={s.openPrompt} href={`/prompts/${encodeURIComponent(dispatch.prompt_name)}`}>Open prompt</Link>
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
