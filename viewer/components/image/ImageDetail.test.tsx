import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const useImage = vi.fn();
const useImageVersions = vi.fn();
vi.mock('@/lib/api/hooks', () => ({
  useImage: (...a: unknown[]) => useImage(...a),
  useImageVersions: (...a: unknown[]) => useImageVersions(...a),
}));

import { ImageDetail } from './ImageDetail';

const img = (id: string, version: number, blob: string, alt: string) => ({
  id, version, status: 'draft', root: 'IMG-1', supersedes: null, kind: 'screenshot',
  blob, mime: 'image/png', ext: 'png', width: 1280, height: 800, byte_size: 99, alt,
  capture: { route: '/home', viewport: { w: 1280, h: 800 } },
  path: `.apm/blobs/${blob.slice(0,2)}/${blob}.png`, created_by: 'claude', created_at: '2026-01-01', work_item: 'WI-1',
});

beforeEach(() => {
  useImage.mockReturnValue({ data: img('IMG-2', 2, 'bb'.repeat(32), 'v2'), isLoading: false, isError: false });
  useImageVersions.mockReturnValue({ data: { items: [img('IMG-2', 2, 'bb'.repeat(32), 'v2'), img('IMG-1', 1, 'aa'.repeat(32), 'v1')] }, isLoading: false, isError: false });
});

describe('ImageDetail', () => {
  it('shows the image, capture metadata, and a version selector', () => {
    render(<ImageDetail id="IMG-2" />);
    expect(screen.getByRole('button', { name: /zoom/i })).toBeTruthy(); // the (zoomable) image
    expect(screen.getByText(/\/home/)).toBeTruthy(); // capture route shown
    expect(screen.getByText(/1280×800|1280x800/)).toBeTruthy(); // dimensions
    expect(screen.getByRole('combobox')).toBeTruthy(); // version dropdown
  });

  it('reveals the diff when a comparison version is chosen', () => {
    render(<ImageDetail id="IMG-2" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'IMG-1' } });
    expect(screen.getByRole('button', { name: /side-by-side/i })).toBeTruthy();
  });
});
