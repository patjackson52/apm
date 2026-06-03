'use client';
import { createContext, useContext, type ReactNode } from 'react';
// No-op auth seam (read-only V1; future-write: bearer/CSRF). Don't foreclose it.
const Ctx = createContext<{ user: null }>({ user: null });
export function AuthProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={{ user: null }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
