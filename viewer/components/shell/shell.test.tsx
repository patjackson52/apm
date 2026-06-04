import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/work' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...p}>{children}</a> }));

import { renderWithClient } from '@/test/renderWithClient';
import { Sidebar } from './Sidebar';
import { ProjectSwitcher } from './ProjectSwitcher';
import { AppShell } from './AppShell';

beforeEach(() => { localStorage.clear(); vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })); });

describe('Sidebar', () => {
  it('renders nav links; active route gets aria-current=page', () => {
    render(<Sidebar />);
    expect(screen.getByRole('link', { name: 'Work items' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });
  it('collapse toggle persists', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }));
    expect(localStorage.getItem('apm-sidebar')).toBe('1');
  });
});

describe('ProjectSwitcher', () => {
  it('shows project name + a disabled "soon" switch (single-project M1)', () => {
    render(<ProjectSwitcher project="apm" />);
    expect(screen.getByText('apm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /multi-project soon/i })).toBeDisabled();
  });
});

describe('AppShell', () => {
  it('renders TopBar + Sidebar + main with children', () => {
    renderWithClient(<AppShell><p>content</p></AppShell>);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });
  it('renders the ErrorBoundary fallback when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Boom = () => { throw new Error('x'); };
    renderWithClient(<AppShell><Boom /></AppShell>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
