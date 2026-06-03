'use client';
import type { ReactNode } from 'react';
import { ApiProvider } from '@/lib/api/provider';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { AuthProvider } from '@/lib/auth/AuthProvider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ApiProvider>
      <ThemeProvider>
        <AuthProvider>{children}</AuthProvider>
      </ThemeProvider>
    </ApiProvider>
  );
}
