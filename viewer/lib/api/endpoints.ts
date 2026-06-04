import { z } from 'zod';
import {
  envelopeSchema, pageSchema,
  StatusViewSchema, WorkItemViewSchema, RunViewSchema, StepRunViewSchema,
  ArtifactViewSchema, DecisionViewSchema, WorkBlockersSchema, EnrichedBlockerViewSchema,
  LeaseViewSchema, WorkflowDefSummarySchema, WorkflowDefViewSchema, EventViewSchema, SessionViewSchema, ProjectViewSchema, SearchResultViewSchema,
  ImageViewSchema,
} from '@apm/types';

const qs = (params: Record<string, string | number | undefined>): string => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};

export interface WorkFilters { status?: string; type?: string; limit?: number; offset?: number; }

/** The single endpoint→schema contract surface (mirrors the apm-core contract test). */
export const ep = {
  status: { path: () => '/api/status', schema: StatusViewSchema },
  work: { path: (f: WorkFilters = {}) => `/api/work${qs({ status: f.status, type: f.type, limit: f.limit, offset: f.offset })}`, schema: pageSchema(WorkItemViewSchema) },
  workItem: { path: (id: string) => `/api/work/${id}`, schema: WorkItemViewSchema },
  workChildren: { path: (id: string) => `/api/work/${id}/children`, schema: pageSchema(WorkItemViewSchema) },
  workBlockers: { path: (id: string) => `/api/work/${id}/blockers`, schema: WorkBlockersSchema },
  workArtifacts: { path: (id: string) => `/api/work/${id}/artifacts`, schema: pageSchema(ArtifactViewSchema) },
  workRuns: { path: (id: string) => `/api/work/${id}/runs`, schema: z.array(RunViewSchema) },
  runSteps: { path: (runId: string) => `/api/runs/${runId}/steps`, schema: z.array(StepRunViewSchema) },
  artifact: { path: (id: string) => `/api/artifacts/${id}`, schema: ArtifactViewSchema },
  workflows: { path: () => '/api/workflows', schema: z.array(WorkflowDefSummarySchema) },
  workflow: { path: (id: string) => `/api/workflows/${id}`, schema: WorkflowDefViewSchema },
  decisions: { path: (workItem?: string) => `/api/decisions${qs({ 'work-item': workItem })}`, schema: z.array(DecisionViewSchema) },
  adr: { path: () => '/api/adr', schema: pageSchema(ArtifactViewSchema) },
  adrShow: { path: (id: string) => `/api/adr/${id}`, schema: ArtifactViewSchema },
  blockers: { path: (workItem?: string) => `/api/blockers${qs({ 'work-item': workItem })}`, schema: z.array(EnrichedBlockerViewSchema) },
  gates: { path: (workItem?: string) => `/api/gates${qs({ 'work-item': workItem })}`, schema: z.array(EnrichedBlockerViewSchema) },
  leases: { path: (f: { workItem?: string; agent?: string } = {}) => `/api/leases${qs({ 'work-item': f.workItem, agent: f.agent })}`, schema: z.object({ items: z.array(LeaseViewSchema) }).strict() },
  events: { path: (f: EventsFilter = {}) => `/api/events${qs({ 'entity-type': f.entityType, 'entity-id': f.entityId, limit: f.limit, offset: f.offset })}`, schema: pageSchema(EventViewSchema) },
  sessions: { path: () => '/api/sessions', schema: z.array(SessionViewSchema) },
  projects: { path: () => '/api/projects', schema: z.array(ProjectViewSchema) },
  search: { path: (q: string, limit?: number) => `/api/search${qs({ q, limit })}`, schema: z.array(SearchResultViewSchema) },
  workImages: { path: (id: string) => `/api/work/${id}/images`, schema: pageSchema(ImageViewSchema) },
  image: { path: (id: string) => `/api/images/${id}`, schema: ImageViewSchema },
  imageVersions: { path: (id: string) => `/api/images/${id}/versions`, schema: z.object({ items: z.array(ImageViewSchema) }) },
} as const;

export interface EventsFilter { entityType?: string; entityId?: string; limit?: number; offset?: number; }
// envelopeSchema re-exported for hooks/tests convenience
export { envelopeSchema };
