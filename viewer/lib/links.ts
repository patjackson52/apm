/**
 * Map an APM id to an opaque same-origin path by id-prefix allowlist.
 * Returns null for ids with no standalone route (or unknown prefix) — the
 * caller renders a plain chip. Never returns an agent-controlled / non-path URL.
 */
const PREFIX_PATH: Record<string, string> = {
  WI: '/work',
  ART: '/artifacts',
  ADR: '/artifacts',
};

export function hrefForId(id: string): string | null {
  const prefix = id.split('-')[0] ?? '';
  const base = PREFIX_PATH[prefix];
  if (!base) return null; // WR-/DEC-/BLK-/HG-/LEASE-/S- and unknown -> plain chip
  return `${base}/${encodeURIComponent(id)}`;
}
