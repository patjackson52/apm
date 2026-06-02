export const WORK_ITEM_TYPES = [
  'project', 'goal', 'milestone', 'feature', 'task',
  'subtask', 'bug', 'research', 'human_gate', 'maintenance',
] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

// `active` is NOT stored — it is computed from a live lease. Stored lifecycle only.
export const WORK_ITEM_STATUSES = ['draft', 'ready', 'blocked', 'completed', 'cancelled'] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const ESTIMATES = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type Estimate = (typeof ESTIMATES)[number];

export const ARTIFACT_TYPES = [
  'spec', 'adr', 'decision', 'design', 'plan', 'review', 'handoff', 'work_log', 'status_report',
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const ARTIFACT_STATUSES = ['draft', 'review', 'approved', 'superseded', 'archived'] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export const WORKFLOW_RUN_STATUSES = ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const STEP_RUN_STATUSES = ['pending', 'running', 'completed', 'failed', 'skipped'] as const;
export type StepRunStatus = (typeof STEP_RUN_STATUSES)[number];

export const REVIEW_VERDICTS = ['pass', 'reject', 'abstain'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const SESSION_STATUSES = ['active', 'idle', 'ended'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const LEASE_STATUSES = ['active', 'released', 'expired'] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

export const BLOCKER_STATUSES = ['open', 'resolved', 'cancelled'] as const;
export type BlockerStatus = (typeof BLOCKER_STATUSES)[number];

export const DECISION_STATUSES = ['open', 'recommended', 'decided', 'cancelled'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const WORKFLOW_DEF_STATUSES = ['draft', 'active', 'deprecated', 'archived'] as const;
export type WorkflowDefStatus = (typeof WORKFLOW_DEF_STATUSES)[number];

export const STEP_TYPES = [
  'agent_prompt', 'agent_execution', 'review_gate', 'human_gate',
  'decision', 'decompose', 'integration', 'integration_loop', 'manual', 'terminal',
] as const;
export type StepType = (typeof STEP_TYPES)[number];
