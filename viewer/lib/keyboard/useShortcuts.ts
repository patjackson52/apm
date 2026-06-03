"use client";
import { useEffect } from 'react';

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/**
 * Global keyboard shortcuts. V1: Cmd/Ctrl+Shift+C copies the current doc.
 * Ignores events originating in editable elements so it never hijacks typing.
 */
export function useShortcuts({ onCopyDoc }: { onCopyDoc: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyC') {
        if (isEditable(e.target)) return;
        e.preventDefault();
        onCopyDoc();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCopyDoc]);
}
