'use client';
import { useEffect, useState } from 'react';

/**
 * False during SSR and the first client render; true after mount.
 *
 * Gate any client-only value behind this so the first client render reproduces the
 * server render and React doesn't report a hydration mismatch. Client-only sources
 * that must NOT be read during render include: `Date.now()` / relative time,
 * `navigator.onLine`, `localStorage`, `window.matchMedia`, and `Math.random()`.
 *
 *   const hydrated = useHydrated();
 *   const label = hydrated ? relTime(at) : ''; // stable before mount
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  return hydrated;
}
