'use client';
import { Suspense, type ReactNode } from 'react';
import { ApiProvider } from '@/lib/api/provider';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { ActiveProjectProvider } from '@/lib/project/ActiveProjectProvider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ApiProvider>
      <Suspense fallback={null}>
        <ActiveProjectProvider>
          <ThemeProvider>
            <AuthProvider>{children}</AuthProvider>
          </ThemeProvider>
        </ActiveProjectProvider>
      </Suspense>
    </ApiProvider>
  );
}
