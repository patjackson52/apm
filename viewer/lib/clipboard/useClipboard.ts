"use client";
import { useCallback, useEffect, useRef, useState } from 'react';

export type CopyState = 'idle' | 'copied' | 'error';

export interface ClipboardApi {
  supported: boolean;       // navigator.clipboard present
  imageSupported: boolean;  // window.ClipboardItem present (multi-format / image)
  state: CopyState;
  copyText(text: string): Promise<void>;
  copyImage(blob: Blob): Promise<void>;
}

/**
 * Thin hook over the native async Clipboard API (PLAN: first-class copy, no deps).
 * V1 surfaces only text/plain and image/png — rich text/html is deferred (backlog).
 */
export function useClipboard(resetMs = 1500): ClipboardApi {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const supported = typeof navigator !== 'undefined' && !!navigator.clipboard;
  const imageSupported = supported && typeof globalThis.ClipboardItem !== 'undefined';

  const mark = useCallback(
    (next: CopyState) => {
      setState(next);
      if (timer.current) clearTimeout(timer.current);
      if (next !== 'idle') timer.current = setTimeout(() => setState('idle'), resetMs);
    },
    [resetMs],
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copyText = useCallback(
    async (text: string) => {
      if (!supported) return mark('error');
      try {
        await navigator.clipboard.writeText(text);
        mark('copied');
      } catch {
        mark('error');
      }
    },
    [supported, mark],
  );

  const copyImage = useCallback(
    async (blob: Blob) => {
      if (!imageSupported) return mark('error');
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        mark('copied');
      } catch {
        mark('error');
      }
    },
    [imageSupported, mark],
  );

  return { supported, imageSupported, state, copyText, copyImage };
}
