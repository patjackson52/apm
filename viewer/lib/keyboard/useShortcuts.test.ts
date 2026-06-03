import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useShortcuts } from './useShortcuts';

function press(target: EventTarget, init: KeyboardEventInit) {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
}

describe('useShortcuts', () => {
  it('fires onCopyDoc on Cmd+Shift+C and Ctrl+Shift+C', () => {
    const onCopyDoc = vi.fn();
    renderHook(() => useShortcuts({ onCopyDoc }));
    press(window, { code: 'KeyC', metaKey: true, shiftKey: true });
    press(window, { code: 'KeyC', ctrlKey: true, shiftKey: true });
    expect(onCopyDoc).toHaveBeenCalledTimes(2);
  });

  it('ignores the shortcut while typing in an input', () => {
    const onCopyDoc = vi.fn();
    renderHook(() => useShortcuts({ onCopyDoc }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    press(input, { code: 'KeyC', metaKey: true, shiftKey: true });
    expect(onCopyDoc).not.toHaveBeenCalled();
    input.remove();
  });

  it('removes the listener on unmount', () => {
    const onCopyDoc = vi.fn();
    const { unmount } = renderHook(() => useShortcuts({ onCopyDoc }));
    unmount();
    press(window, { code: 'KeyC', metaKey: true, shiftKey: true });
    expect(onCopyDoc).not.toHaveBeenCalled();
  });
});
