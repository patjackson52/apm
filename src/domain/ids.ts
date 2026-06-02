/** Type-prefixed monotonic ID scheme. Gates are blockers — no HG prefix. */
export const ID_PREFIXES = {
  workItem: 'WI',
  artifact: 'ART',
  decision: 'DEC',
  adr: 'ADR',
  blocker: 'BLK',
  workflowRun: 'WR',
  lease: 'LEASE',
  session: 'S',
  workflowDefinition: 'WD',
  promptDefinition: 'PD',
  policy: 'POL',
  event: 'EV',
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

export function formatId(prefix: IdPrefix, value: number): string {
  return `${prefix}-${value}`;
}

export function parseId(id: string): { prefix: string; value: number } {
  const m = /^([A-Z]+)-(\d+)$/.exec(id);
  if (!m) throw new Error(`invalid id: ${id}`);
  return { prefix: m[1], value: Number(m[2]) };
}

/** Compact artifact version reference, e.g. ART-1@2. */
export function artifactRef(artifactId: string, version: number): string {
  return `${artifactId}@${version}`;
}
