import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Copy } from './Copy';

afterEach(() => vi.restoreAllMocks());

describe('Copy', () => {
  it('writes text to the clipboard and shows Copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<Copy text="hello" label="Copy id" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy id' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('hello'));
    await screen.findByText('Copied');
  });
  it('is disabled when clipboard is unavailable', () => {
    vi.stubGlobal('navigator', {});
    render(<Copy text="x" />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
