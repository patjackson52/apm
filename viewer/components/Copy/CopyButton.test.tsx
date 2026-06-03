import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CopyButton } from './CopyButton';

describe('CopyButton', () => {
  it('invokes onCopy and shows Copied with aria-live', async () => {
    const onCopy = vi.fn().mockResolvedValue(undefined);
    render(<CopyButton onCopy={onCopy} label="Copy code" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(onCopy).toHaveBeenCalledTimes(1));
    await screen.findByText('Copied');
    expect(screen.getByText('Copied to clipboard')).toBeTruthy();
  });

  it('is disabled when told so', () => {
    render(<CopyButton onCopy={vi.fn()} disabled label="x" />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
