import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SafeImage } from './SafeImage';

describe('SafeImage', () => {
  it('drops remote, data, protocol-relative, and absolute srcs to alt span', () => {
    for (const src of ['https://e/x.png', 'http://e/x.png', '//host/x.png', 'data:image/png;base64,AA', '/abs.png', 'javascript:alert(1)']) {
      const { container } = render(<SafeImage src={src} alt="cap" />);
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toBe('cap');
    }
  });

  it('routes a local relative src through /api/files', () => {
    const { container } = render(<SafeImage src="assets/x.png" alt="cap" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/api/files?path=assets%2Fx.png');
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img?.getAttribute('loading')).toBe('lazy');
  });
});
