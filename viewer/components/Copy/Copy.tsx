'use client';
import { useState } from 'react';
import s from './Copy.module.css';

export function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const supported = typeof navigator !== 'undefined' && !!navigator.clipboard;
  const onClick = async () => {
    if (!supported) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <span className={s.wrap}>
      <button type="button" className={s.btn} onClick={onClick} disabled={!supported} aria-label={label}>
        {copied ? 'Copied' : label}
      </button>
      <span className={s.sr} aria-live="polite">{copied ? 'Copied to clipboard' : ''}</span>
    </span>
  );
}
