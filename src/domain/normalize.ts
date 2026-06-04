/** Canonical dedup key for a work-item title. */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}
