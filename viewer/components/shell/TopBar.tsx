'use client';
import s from './shell.module.css';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { ProjectSwitcher } from './ProjectSwitcher';

export function TopBar() {
  const { theme, toggle } = useTheme();
  return (
    <header role="banner" className={s.topbar}>
      <span className={s.logo}>APM Viewer</span>
      <ProjectSwitcher />
      <span className={s.spacer} />
      <button type="button" className={s.iconBtn} onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
        {theme === 'dark' ? '☾' : '☀'}
      </button>
      <button type="button" className={s.iconBtn} aria-label="Help">?</button>
    </header>
  );
}
