'use client';
import s from './shell.module.css';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { ProjectSwitcher } from './ProjectSwitcher';
import { LiveIndicator } from '@/components/live/LiveIndicator';

export function TopBar() {
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const [q, setQ] = useState('');
  return (
    <header role="banner" className={s.topbar}>
      <span className={s.logo}>APM Viewer</span>
      <ProjectSwitcher />
      <form role="search" className={s.search} onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }}>
        <input type="search" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
      </form>
      <span className={s.spacer} />
      <LiveIndicator />
      <button type="button" className={s.iconBtn} onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
        {theme === 'dark' ? '☾' : '☀'}
      </button>
      <button type="button" className={s.iconBtn} aria-label="Help">?</button>
    </header>
  );
}
