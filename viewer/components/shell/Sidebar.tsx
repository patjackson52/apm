'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import s from './shell.module.css';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/work', label: 'Work items' },
  { href: '/workflows', label: 'Workflows' },
  { href: '/artifacts', label: 'Artifacts' },
  { href: '/blockers', label: 'Blockers & Gates' },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem('apm-sidebar') === '1'); } catch { /* ignore */ }
  }, []);
  const toggle = () => setCollapsed((c) => {
    const next = !c;
    try { localStorage.setItem('apm-sidebar', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });
  return (
    <nav aria-label="Primary" className={`${s.sidebar} ${collapsed ? s.collapsed : ''}`}>
      <button type="button" className={s.collapseBtn} onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? '»' : '«'}
      </button>
      <ul className={s.navList}>
        {NAV.map((n) => {
          const active = n.href === '/' ? pathname === '/' : pathname.startsWith(n.href);
          return (
            <li key={n.href}>
              <Link href={n.href} className={s.navLink} aria-current={active ? 'page' : undefined}>
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
