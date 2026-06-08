import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/work', useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...p}>{children}</a> }));

import { renderWithClient } from '@/test/renderWithClient';
vi.mock('@/lib/api/hooks', () => ({ useProjects: () => ({ data: [{ id: 'apm', name: 'apm', path: '/p', current: true }, { id: 'other', name: 'other', path: '/o', current: false }] }) }));

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
  it('renders a project switch dropdown listing registered projects', () => {
    renderWithClient(<ProjectSwitcher />);
    const select = screen.getByRole('combobox', { name: 'Switch project' });
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'apm (current)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'other' })).toBeInTheDocument();
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
  it('makes the main landmark programmatically focusable for route-change focus', () => {
    // tabIndex is rendered in JSX (consistent SSR+client) rather than imperatively
    // set on the page heading, which avoids a hydration mismatch.
    renderWithClient(<AppShell><p>content</p></AppShell>);
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
  });
});
