'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import s from './shell.module.css';
import { TopBar } from './TopBar';
import { StaleBanner } from '@/components/live/StaleBanner';
import { Sidebar } from './Sidebar';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  // Move focus to the main landmark on client-side navigation (a11y). We focus the
  // AppShell-owned <main> (which renders its own tabIndex={-1}) rather than reaching
  // into the page's React-owned <h1> with setAttribute — mutating an element that is
  // still hydrating inside a <Suspense> boundary produces a hydration mismatch.
  // Skip the initial mount so we never mutate during hydration or steal load focus.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    mainRef.current?.focus();
  }, [pathname]);
  return (
    <div className={s.shell}>
      <TopBar />
      <StaleBanner />
      <div className={s.body}>
        <Sidebar />
        <main id="main" ref={mainRef} tabIndex={-1} className={s.main}>
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
