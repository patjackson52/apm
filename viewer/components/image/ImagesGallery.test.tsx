import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const useWorkImages = vi.fn();
vi.mock('@/lib/api/hooks', () => ({ useWorkImages: (...a: unknown[]) => useWorkImages(...a) }));

import { ImagesGallery } from './ImagesGallery';

const img = (id: string, blob: string, alt: string) => ({
  id, version: 1, status: 'draft', root: id, supersedes: null, kind: 'screenshot',
  blob, mime: 'image/png', ext: 'png', width: 1, height: 1, byte_size: 1, alt,
  capture: null, path: `.apm/blobs/${blob.slice(0,2)}/${blob}.png`,
  created_by: 'a', created_at: '2026-01-01', work_item: 'WI-1',
});

beforeEach(() => {
  useWorkImages.mockReturnValue({ data: { items: [img('IMG-1', 'aa'.repeat(32), 'home'), img('IMG-2', 'bb'.repeat(32), 'login')] }, isLoading: false, isError: false });
});

describe('ImagesGallery', () => {
  it('renders one lazy <img> per image, src=/api/blob/<sha>, with alt + link to detail', () => {
    render(<ImagesGallery workItemId="WI-1" />);
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute('src')).toBe('/api/blob/' + 'aa'.repeat(32));
    expect(imgs[0].getAttribute('loading')).toBe('lazy');
    expect(screen.getByAltText('home')).toBeTruthy();
    expect(screen.getByRole('link', { name: /home/i }).getAttribute('href')).toBe('/images/IMG-1');
  });

  it('shows an empty state when there are no images', () => {
    useWorkImages.mockReturnValue({ data: { items: [] }, isLoading: false, isError: false });
    render(<ImagesGallery workItemId="WI-1" />);
    expect(screen.getByText(/no images/i)).toBeTruthy();
  });
});
