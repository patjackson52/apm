import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeProvider';

function Probe() {
  const { theme, toggle } = useTheme();
  return <button onClick={toggle}>theme:{theme}</button>;
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
});

describe('ThemeProvider', () => {
  it('defaults to light (no stored, prefers-light) and sets data-theme', async () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(await screen.findByText('theme:light')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
  it('toggle flips theme + persists to localStorage', async () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    await screen.findByText('theme:light');
    act(() => { fireEvent.click(screen.getByRole('button')); });
    expect(screen.getByText('theme:dark')).toBeInTheDocument();
    expect(localStorage.getItem('apm-theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
  it('reads a stored theme on init', async () => {
    localStorage.setItem('apm-theme', 'dark');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(await screen.findByText('theme:dark')).toBeInTheDocument();
  });
});
