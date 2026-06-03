"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import s from './CopyButton.module.css';

type State = 'idle' | 'copied' | 'error';

/**
 * Generic copy button: invokes an async onCopy, shows transient "Copied" with
 * an aria-live announcement, disabled when the capability is unsupported.
 * The single copy-affordance primitive; WI-27 Copy delegates to it.
 */
export function CopyButton({
  onCopy,
  label = 'Copy',
  copiedLabel = 'Copied',
  disabled = false,
}: {
  onCopy: () => Promise<void>;
  label?: string;
  copiedLabel?: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState<State>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onClick = useCallback(async () => {
    try {
      await onCopy();
      setState('copied');
    } catch {
      setState('error');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1500);
  }, [onCopy]);

  return (
    <span className={s.wrap}>
      <button
        type="button"
        className={s.btn}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
      >
        {state === 'copied' ? copiedLabel : label}
      </button>
      <span className={s.sr} aria-live="polite">
        {state === 'copied' ? 'Copied to clipboard' : ''}
      </span>
    </span>
  );
}
