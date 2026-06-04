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
  useEffect(() => { mainRef.current?.querySelector('h1')?.setAttribute('tabindex', '-1'); mainRef.current?.querySelector('h1')?.focus?.(); }, [pathname]);
  return (
    <div className={s.shell}>
      <TopBar />
      <StaleBanner />
      <div className={s.body}>
        <Sidebar />
        <main id="main" ref={mainRef} className={s.main}>
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
