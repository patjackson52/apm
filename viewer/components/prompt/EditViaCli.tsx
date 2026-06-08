"use client";
import { useEffect, useRef, useState } from 'react';
import { SquarePen, Terminal, Info } from 'lucide-react';
import { CopyButton } from '@/components/Copy/CopyButton';

/**
 * Edit-via-CLI affordance — ENABLED (not a disabled "soon" stub). Reveals a
 * copyable `apm prompt revise` command + the scope warning that editing the
 * shared prompt does NOT change this run's already-snapshotted dispatch text.
 * Closes on outside mousedown (mirrors StepPopover's click-away pattern).
 */
export function EditViaCli({
  name,
  body,
  open: openDefault = false,
}: {
  name: string;
  body?: string;
  open?: boolean;
}) {
  const [open, setOpen] = useState(openDefault);
  const ref = useRef<HTMLSpanElement>(null);
  const cmd = `apm prompt revise ${name} --body-file ./${name}.md`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="cli-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Editing is available via the apm CLI"
      >
        <SquarePen size={14} aria-hidden />
        <span>Edit</span>
        <span className="cli-btn__tag">via CLI</span>
      </button>
      {open && (
        <div className="cli-pop" role="dialog" aria-label="Edit via CLI">
          <div className="cli-pop__head">
            <Terminal size={15} aria-hidden />
            <span className="cli-pop__title">Edit via CLI</span>
          </div>
          <div className="cli-pop__body">
            <p className="cli-pop__note">
              Prompt bodies are edited from the terminal in V1. Running this opens{' '}
              <code className="mono">{name}.md</code>, then stores a new immutable version.
            </p>
            <div className="cli-cmd">
              <span className="cli-cmd__txt">
                <span className="cli-prompt">$ </span>
                <span className="cli-kw">apm prompt revise</span> {name} --body-file ./{name}.md
              </span>
              <CopyButton label="Copy command" onCopy={() => navigator.clipboard.writeText(cmd)} />
            </div>
            <div className="cli-pop__warn">
              <Info size={13} aria-hidden />
              <span>
                <strong>Edits the shared prompt for future runs.</strong> This run already
                snapshotted its dispatched text — that snapshot does not change.
              </span>
            </div>
          </div>
          <div className="cli-pop__foot">
            <CopyButton
              label="Copy current body"
              onCopy={() => navigator.clipboard.writeText(body ?? '')}
            />
          </div>
        </div>
      )}
    </span>
  );
}
