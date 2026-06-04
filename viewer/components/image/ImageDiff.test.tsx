import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageDiff } from './ImageDiff';

const A = 'aa'.repeat(32);
const B = 'bb'.repeat(32);

describe('ImageDiff', () => {
  it('renders both images and switches modes', () => {
    render(<ImageDiff beforeBlob={A} afterBlob={B} beforeAlt="v1" afterAlt="v2" />);
    // side-by-side (default): both images visible
    const imgs = screen.getAllByRole('img');
    expect(imgs.some((i) => i.getAttribute('src') === '/api/blob/' + A)).toBe(true);
    expect(imgs.some((i) => i.getAttribute('src') === '/api/blob/' + B)).toBe(true);

    // switch to onion-skin → an opacity slider appears
    fireEvent.click(screen.getByRole('button', { name: /onion/i }));
    expect(screen.getByRole('slider')).toBeTruthy();

    // switch to swipe → a slider appears too
    fireEvent.click(screen.getByRole('button', { name: /swipe/i }));
    expect(screen.getByRole('slider')).toBeTruthy();
  });
});
