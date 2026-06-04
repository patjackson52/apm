"use client";
import { createContext, useContext, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

const ActiveProjectContext = createContext<string | null>(null);

/** Provides the active project id from the URL `?project=`. Must be rendered
 *  under a <Suspense> boundary (useSearchParams, Next 15). Default is null
 *  (single/default project) so hooks used without the provider are a no-op. */
export function ActiveProjectProvider({ children }: { children: ReactNode }) {
  const id = useSearchParams().get('project');
  return <ActiveProjectContext.Provider value={id}>{children}</ActiveProjectContext.Provider>;
}

export function useActiveProject(): string | null {
  return useContext(ActiveProjectContext);
}
