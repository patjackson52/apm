import './tokens.css';
import './globals.css';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { Providers } from './providers';
import { AppShell } from '@/components/shell';
import { THEME_BOOTSTRAP } from '@/lib/theme/bootstrap';

export const metadata = { title: 'APM Viewer' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Browsers blank the nonce attribute out of the DOM after parsing, so the
            client reads nonce="" while SSR emitted the real value — a hydration
            mismatch that otherwise regenerates the whole tree. The nonce must stay
            in the SSR HTML to satisfy CSP; suppress the diff on this element only. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
