/** A source of "now" as a UTC ISO-8601 string ending in Z. Always injected. */
export interface Clock {
  now(): string;
}

/** Format epoch milliseconds as zero-padded UTC ISO-8601 with a Z suffix. */
export function isoZ(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** Real clock — the ONLY place argless `new Date()` is permitted. */
export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

/** Deterministic clock for tests. */
export function fixedClock(iso: string): Clock {
  return { now: () => iso };
}
