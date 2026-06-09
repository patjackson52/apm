import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { useHydrated } from './useHydrated';

describe('useHydrated', () => {
  it('is true after mount (effects flushed)', () => {
    const { result } = renderHook(() => useHydrated());
    expect(result.current).toBe(true);
  });

  it('is false during SSR / first render (effects not run)', () => {
    const Probe = () => createElement('i', null, String(useHydrated()));
    expect(renderToStaticMarkup(createElement(Probe))).toContain('false');
  });
});
