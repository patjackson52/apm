"use client";
import { useState } from 'react';
import { FilePenLine, UsersRound, ChevronDown, ChevronUp } from 'lucide-react';
import { Markdown } from '@/components/markdown/Markdown';
import { CopyButton } from '@/components/Copy/CopyButton';

/**
 * The stored, editable, linkable prompt body — rendered distinctly inside the
 * composed contract. Body is markdown, routed through the sanitized Markdown
 * renderer (no raw HTML sink). `clampBody` enables a 3-line clamp toggle.
 */
export function StoredBody({
  name,
  version,
  body,
  clampBody = false,
}: {
  name: string;
  version: number;
  body: string;
  clampBody?: boolean;
  latest?: number;
}) {
  const [open, setOpen] = useState(!clampBody);
  const clamped = clampBody && !open;
  return (
    <div className="stored">
      <div className="stored__head">
        <span className="stored__eyebrow">
          <FilePenLine size={12} aria-hidden />
          Stored prompt body
        </span>
        <span className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-muted)' }}>
          {name}@{version}
        </span>
        <span className="stored__spacer" />
        <span className="stored__edit-pill">
          <UsersRound size={11} aria-hidden />
          Editable · shared
        </span>
        <CopyButton label="Copy body" onCopy={() => navigator.clipboard.writeText(body)} />
      </div>
      <div className={`stored__body ${clamped ? 'is-clamped' : ''}`}>
        <Markdown body={body} docCopy={false} />
      </div>
      {clampBody && (
        <button type="button" className="stored__more" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
          {open ? 'Collapse body' : 'Show full body'}
        </button>
      )}
    </div>
  );
}
