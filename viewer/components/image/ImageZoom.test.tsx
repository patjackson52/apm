import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageZoom } from './ImageZoom';

describe('ImageZoom', () => {
  it('renders the image and toggles a zoomed class on click', () => {
    render(<ImageZoom blob={'aa'.repeat(32)} alt="shot" />);
    const img = screen.getByRole('button', { name: /zoom/i });
    expect(img.getAttribute('src')).toBe('/api/blob/' + 'aa'.repeat(32));
    const before = img.className;
    fireEvent.click(img);
    expect(img.className).not.toBe(before); // zoom toggled
  });

  it('is keyboard-accessible (Enter toggles zoom)', () => {
    render(<ImageZoom blob={'aa'.repeat(32)} alt="shot" />);
    const img = screen.getByRole('button', { name: /zoom/i });
    expect(img.getAttribute('tabindex')).toBe('0');
    const before = img.className;
    fireEvent.keyDown(img, { key: 'Enter' });
    expect(img.className).not.toBe(before);
  });
});
