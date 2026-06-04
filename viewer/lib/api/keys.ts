import type { WorkFilters, EventsFilter } from './endpoints';

/** Query-key factory — stable, serializable arrays. */
export const qk = {
  status: () => ['status'] as const,
  work: (f: WorkFilters = {}) => ['work', f] as const,
  workItem: (id: string) => ['work', id] as const,
  workChildren: (id: string) => ['work', id, 'children'] as const,
  workBlockers: (id: string) => ['work', id, 'blockers'] as const,
  workArtifacts: (id: string) => ['work', id, 'artifacts'] as const,
  runs: (id: string) => ['work', id, 'runs'] as const,
  steps: (runId: string) => ['runs', runId, 'steps'] as const,
  artifact: (id: string) => ['artifact', id] as const,
  workflows: () => ['workflows'] as const,
  workflow: (id: string) => ['workflows', id] as const,
  decisions: (wi?: string) => ['decisions', wi ?? null] as const,
  adr: () => ['adr'] as const,
  adrShow: (id: string) => ['adr', id] as const,
  blockers: (wi?: string) => ['blockers', wi ?? null] as const,
  gates: (wi?: string) => ['gates', wi ?? null] as const,
  leases: (f: { workItem?: string; agent?: string } = {}) => ['leases', f] as const,
  events: (f: EventsFilter = {}) => ['events', f] as const,
  sessions: () => ['sessions'] as const,
};
