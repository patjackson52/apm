'use client';
import type { ReactNode } from 'react';
import { useHydrated } from '@/lib/hooks/useHydrated';

/**
 * Renders `children` only after hydration; renders `fallback` (default null) on the
 * server and the first client render. Use for widgets whose markup is inherently
 * client-only (e.g. depends on time/connectivity/localStorage) to avoid hydration
 * mismatches without scattering guards through the component.
 */
export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return useHydrated() ? <>{children}</> : <>{fallback}</>;
}
