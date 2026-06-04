import { z } from 'zod';

// Enums mirror apm-core domain/types.ts
export const WorkItemStatusEnum = z.enum(['draft', 'ready', 'blocked', 'completed', 'cancelled']);
export const WorkItemTypeEnum = z.enum([
  'project', 'goal', 'milestone', 'feature', 'task', 'subtask',
  'bug', 'research', 'human_gate', 'maintenance',
]);
export const EstimateEnum = z.enum(['XS', 'S', 'M', 'L', 'XL']);
export const ReviewVerdictEnum = z.enum(['pass', 'reject', 'abstain']);
export const StepRunStatusEnum = z.enum(['pending', 'running', 'completed', 'failed', 'skipped']);

export const WorkItemViewSchema = z.object({
  id: z.string(),
  type: WorkItemTypeEnum,
  title: z.string(),
  description: z.string().nullable(),
  // 'active' is a derived display state (live lease), not a stored status
  status: z.union([WorkItemStatusEnum, z.literal('active')]),
  priority: z.number(),
  estimate: EstimateEnum.nullable(),
  parent: z.string().nullable(),
  depends_on: z.array(z.string()),
  blocker_ids: z.array(z.string()),
  artifact_ids: z.array(z.string()),
  active_run: z.string().nullable(),
  lease: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable(),
}).strict();

export const RunViewSchema = z.object({
  id: z.string(),
  work_item: z.string(),
  workflow: z.string(),
  status: z.string(),
  current_step: z.string().nullable(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
}).strict();

export const EventViewSchema = z.object({
  id: z.string(),
  actor: z.string().nullable(),
  event_type: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  payload: z.unknown(),
  created_at: z.string(),
}).strict();

export const SessionViewSchema = z.object({
  id: z.string(),
  agent: z.string(),
  status: z.enum(['active', 'idle', 'ended']),
  context_summary: z.string().nullable(),
  started_at: z.string(),
  last_seen_at: z.string().nullable(),
  ended_at: z.string().nullable(),
}).strict();

export const StepRunViewSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  step_id: z.string(),
  parent_step_run_id: z.string().nullable(),
  role: z.string().nullable(),
  status: StepRunStatusEnum,
  verdict: ReviewVerdictEnum.nullable(),
  review_round: z.number(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  output_artifact_id: z.string().nullable(),
  failure_reason: z.string().nullable(),
}).strict();

export const ArtifactViewSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  version: z.number(),
  status: z.string(),
  root: z.string(),
  supersedes: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: z.string(),
  body: z.string().nullable(),
  work_item: z.string().nullable(),
}).strict();

export const DecisionViewSchema = z.object({
  id: z.string(),
  work_item: z.string().nullable(),
  question: z.string(),
  options: z.array(z.string()),
  recommendation: z.string().nullable(),
  confidence: z.number().nullable(),
  decision: z.string().nullable(),
  category: z.string().nullable(),
  status: z.string(),
  artifact_id: z.string().nullable(),
  created_at: z.string(),
  decided_at: z.string().nullable(),
}).strict();

// Base blocker (un-enriched) — /api/work/:id/blockers
export const BlockerViewSchema = z.object({
  id: z.string(),
  work_item: z.string(),
  type: z.string(),
  reason: z.string(),
  status: z.string(),
  question: z.string().nullable(),
  options: z.array(z.string()),
  resolution: z.string().nullable(),
  answer: z.string().nullable(),
  choice: z.string().nullable(),
  answered_by: z.string().nullable(),
  answered_at: z.string().nullable(),
  resolved_at: z.string().nullable(),
  created_at: z.string(),
}).strict();

// Enriched blocker (serve adds current_step) — /api/blockers, /api/gates
export const EnrichedBlockerViewSchema = BlockerViewSchema.extend({
  current_step: z.string().nullable(),
}).strict();

// /api/work/:id/blockers wrapper
export const WorkBlockersSchema = z.object({
  open_blockers: z.array(BlockerViewSchema),
  unmet_dependencies: z.array(z.string()),
}).strict();

// Enriched lease (serve always enriches /api/leases)
export const LeaseViewSchema = z.object({
  id: z.string(),
  work_item: z.string(),
  agent: z.string(),
  session: z.string().nullable(),
  status: z.string(),
  acquired_at: z.string(),
  expires_at: z.string(),
  heartbeat_at: z.string().nullable(),
  agent_type: z.string().nullable(),
  current_step: z.string().nullable(),
  ttl: z.string(),
  ttl_seconds: z.number(),
}).strict();

// Lean workflow summary — /api/workflows (list)
export const WorkflowDefSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number(),
  status: z.string(),
  created_at: z.string(),
}).strict();

// Full workflow def — /api/workflows/:id (steps loosely modeled; WI-32 refines)
export const WorkflowDefViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number(),
  status: z.string(),
  created_at: z.string(),
  applies_to: z.array(WorkItemTypeEnum),
  steps: z.array(z.object({ id: z.string(), type: z.string() }).passthrough()),
  edges: z.array(z.object({ from: z.string(), to: z.string() }).strict()),
}).strict();

// /api/status — StatusResult (serve enrichedStatus enriches active_leases + open_blockers)
export const AwaitsHumanSchema = z.object({ id: z.string(), reason: z.string() }).strict();

export const StatusViewSchema = z.object({
  work: z.object({ by_status: z.record(z.string(), z.number()) }).strict(),
  ready_count: z.number(),
  active_leases: z.array(LeaseViewSchema),            // LeaseViewSchema is enriched
  open_blockers: z.array(EnrichedBlockerViewSchema),  // enriched
  awaiting_human: z.array(AwaitsHumanSchema),
  active_runs: z.array(RunViewSchema),
}).strict();
