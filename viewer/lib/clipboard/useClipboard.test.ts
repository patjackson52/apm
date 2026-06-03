import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useClipboard } from './useClipboard';

afterEach(() => vi.unstubAllGlobals());

describe('useClipboard', () => {
  it('copies text and reports copied, then resets', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { result } = renderHook(() => useClipboard(20));
    await act(async () => { await result.current.copyText('hi'); });
    expect(writeText).toHaveBeenCalledWith('hi');
    expect(result.current.state).toBe('copied');
    await waitFor(() => expect(result.current.state).toBe('idle'));
  });

  it('copies an image via ClipboardItem when supported', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    class FakeClipboardItem { constructor(public parts: Record<string, Blob>) {} }
    vi.stubGlobal('navigator', { clipboard: { write, writeText: vi.fn() } });
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const { result } = renderHook(() => useClipboard(20));
    expect(result.current.imageSupported).toBe(true);
    const blob = new Blob(['x'], { type: 'image/png' });
    await act(async () => { await result.current.copyImage(blob); });
    expect(write).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('copied');
  });

  it('errors on copyImage when ClipboardItem is unavailable', async () => {
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn(), writeText: vi.fn() } });
    vi.stubGlobal('ClipboardItem', undefined);
    const { result } = renderHook(() => useClipboard(20));
    expect(result.current.imageSupported).toBe(false);
    await act(async () => { await result.current.copyImage(new Blob([''])); });
    expect(result.current.state).toBe('error');
  });

  it('reports unsupported when navigator.clipboard is absent', () => {
    vi.stubGlobal('navigator', {});
    const { result } = renderHook(() => useClipboard());
    expect(result.current.supported).toBe(false);
  });
});
