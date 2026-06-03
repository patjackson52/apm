"use client";
import { CopyButton } from '@/components/Copy/CopyButton';

/** Copy a string to the clipboard. Thin wrapper over CopyButton (WI-30). */
export function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const supported = typeof navigator !== 'undefined' && !!navigator.clipboard;
  return (
    <CopyButton
      onCopy={() => navigator.clipboard.writeText(text)}
      label={label}
      disabled={!supported}
    />
  );
}
