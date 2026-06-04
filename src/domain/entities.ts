import type {
  WorkItemType, WorkItemStatus, Estimate, SessionStatus, LeaseStatus, ArtifactStatus, ArtifactType,
  StepRunStatus, ReviewVerdict,
} from './types.js';
import type { StepDef } from './workflow.js';
import { blobRelPath } from '../storage/blobstore.js';

export interface Page<T> { items: T[]; page: { total: number; limit: number; offset: number; has_more: boolean }; }

/** A workflow step enriched with viewer layout (x/y/label). */
export type StepView = StepDef & { x: number; y: number; label: string };

/** Full workflow definition view for `workflow show` / apm serve `GET /api/workflows/:id`. */
export interface WorkflowDefView {
  id: string; name: string; version: number; status: string; created_at: string;
  applies_to: WorkItemType[];
  steps: StepView[];
  edges: { from: string; to: string }[];
}

export interface WorkItemView {
  id: string; type: WorkItemType; title: string; description: string | null;
  status: WorkItemStatus | 'active'; priority: number; estimate: Estimate | null;
  parent: string | null; depends_on: string[]; blocker_ids: string[]; artifact_ids: string[];
  active_run: string | null; lease: string | null; created_by: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
}

export interface WorkItemRels {
  dependsOn: string[]; blockerIds: string[]; artifactIds: string[];
  activeRun: string | null; lease: string | null;
}

export function toWorkItemView(row: any, rels: WorkItemRels): WorkItemView {
  return {
    id: row.id, type: row.type, title: row.title, description: row.description ?? null,
    // effective status: a live lease projects to 'active'; else the stored status
    status: rels.lease ? 'active' : row.status,
    priority: row.priority, estimate: row.estimate ?? null, parent: row.parent_id ?? null,
    depends_on: rels.dependsOn, blocker_ids: rels.blockerIds, artifact_ids: rels.artifactIds,
    active_run: rels.activeRun, lease: rels.lease, created_by: row.created_by ?? null,
    created_at: row.created_at, updated_at: row.updated_at, completed_at: row.completed_at ?? null,
  };
}

export interface SessionView {
  id: string; agent: string; status: SessionStatus; context_summary: string | null;
  started_at: string; last_seen_at: string | null; ended_at: string | null;
}
export function toSessionView(row: any): SessionView {
  return {
    id: row.id, agent: row.agent_id, status: row.status, context_summary: row.context_summary ?? null,
    started_at: row.started_at, last_seen_at: row.last_seen_at ?? null, ended_at: row.ended_at ?? null,
  };
}

export interface LeaseView {
  id: string; work_item: string; agent: string; session: string | null;
  status: LeaseStatus; acquired_at: string; expires_at: string; heartbeat_at: string | null;
}
export function toLeaseView(row: any): LeaseView {
  return {
    id: row.id, work_item: row.work_item_id, agent: row.agent_id, session: row.session_id ?? null,
    status: row.status, acquired_at: row.acquired_at, expires_at: row.expires_at, heartbeat_at: row.heartbeat_at ?? null,
  };
}

export interface RunView {
  id: string; work_item: string; workflow: string; status: string;
  current_step: string | null; started_at: string; completed_at: string | null;
}
export function toRunView(row: any, workflowName: string): RunView {
  // Terminal/cancelled runs have no active current step
  const isTerminal = row.status === 'completed' || row.status === 'cancelled';
  return {
    id: row.id, work_item: row.work_item_id, workflow: workflowName,
    status: row.status, current_step: isTerminal ? null : (row.current_step_id ?? null),
    started_at: row.started_at, completed_at: row.completed_at ?? null,
  };
}

export interface ArtifactView {
  id: string; type: ArtifactType; title: string; version: number; status: ArtifactStatus;
  root: string; supersedes: string | null; created_by: string | null; created_at: string;
  // body is RAW agent-authored markdown returned verbatim — APM never sanitizes server-side
  // (would corrupt copy/round-trip). Render-time sanitization is the Viewer's job (WI-28).
  // null on lean reads (e.g. list, which omits the body column).
  body: string | null;
  work_item: string | null;
  // Parsed from metadata_json. null when absent. Holds image/capture records for type='image'.
  metadata: Record<string, unknown> | null;
}
/** Dumb mapper: body comes straight off the row (null if absent); work_item is supplied by the caller. */
export function toArtifactView(row: any, workItem: string | null = null): ArtifactView {
  return {
    id: row.id, type: row.type, title: row.title, version: row.version, status: row.status,
    root: row.root_artifact_id, supersedes: row.supersedes_artifact_id ?? null,
    created_by: row.created_by ?? null, created_at: row.created_at,
    body: row.body ?? null, work_item: workItem,
    metadata: row.metadata_json != null ? JSON.parse(row.metadata_json) : null,
  };
}

export interface DecisionView {
  id: string; work_item: string | null; question: string; options: string[];
  recommendation: string | null; confidence: number | null; decision: string | null;
  category: string | null; status: string; artifact_id: string | null;
  created_at: string; decided_at: string | null;
}
export function toDecisionView(row: any): DecisionView {
  return {
    id: row.id, work_item: row.work_item_id ?? null, question: row.question,
    options: row.options_json ? JSON.parse(row.options_json) : [],
    recommendation: row.recommendation ?? null, confidence: row.confidence ?? null,
    decision: row.decision ?? null, category: row.category ?? null,
    status: row.status, artifact_id: row.artifact_id ?? null,
    created_at: row.created_at, decided_at: row.decided_at ?? null,
  };
}

export interface BlockerView {
  id: string; work_item: string; type: string; reason: string; status: string;
  question: string | null; options: string[]; resolution: string | null;
  answer: string | null; choice: string | null; answered_by: string | null;
  answered_at: string | null; resolved_at: string | null; created_at: string;
}
export function toBlockerView(row: any): BlockerView {
  return {
    id: row.id, work_item: row.work_item_id, type: row.blocker_type, reason: row.reason,
    status: row.status, question: row.question ?? null,
    options: row.options_json ? JSON.parse(row.options_json) : [],
    resolution: row.resolution ?? null, answer: row.answer ?? null,
    choice: row.choice ?? null, answered_by: row.answered_by ?? null,
    answered_at: row.answered_at ?? null, resolved_at: row.resolved_at ?? null,
    created_at: row.created_at,
  };
}

/** A workflow step-run row projected for reads (the M3 run-state overlay). */
export interface StepRunView {
  id: string;
  run_id: string;
  step_id: string;
  parent_step_run_id: string | null;
  role: string | null;
  status: StepRunStatus;
  verdict: ReviewVerdict | null;
  review_round: number;
  started_at: string | null;
  completed_at: string | null;
  output_artifact_id: string | null;
  failure_reason: string | null;
}

export function toStepRunView(row: any): StepRunView {
  return {
    id: row.id,
    run_id: row.workflow_run_id,
    step_id: row.step_id,
    parent_step_run_id: row.parent_step_run_id ?? null,
    role: row.role ?? null,
    status: row.status,
    verdict: row.verdict ?? null,
    review_round: row.review_round,
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    output_artifact_id: row.output_artifact_id ?? null,
    failure_reason: row.failure_reason ?? null,
  };
}

/** An audit event row projected for the activity feed. */
export interface EventView {
  id: string;
  actor: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: unknown;
  created_at: string;
}
export function toEventView(row: any): EventView {
  return {
    id: row.id,
    actor: row.actor_id ?? null,
    event_type: row.event_type,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    created_at: row.created_at,
  };
}

export interface ImageView {
  id: string;
  version: number;
  status: ArtifactStatus;
  root: string;
  supersedes: string | null;
  kind: string;
  blob: string;
  mime: string;
  ext: string;
  width: number | null;
  height: number | null;
  byte_size: number;
  alt: string | null;
  capture: Record<string, unknown> | null;
  path: string; // relative blob path; path IS the content hash
  created_by: string | null;
  created_at: string;
  work_item: string | null;
}

/** Map an image artifact row (type='image') + its metadata_json to an ImageView. */
export function toImageView(row: any, workItem: string | null = null): ImageView {
  const m = row.metadata_json != null ? JSON.parse(row.metadata_json) : {};
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    root: row.root_artifact_id,
    supersedes: row.supersedes_artifact_id ?? null,
    kind: m.kind ?? 'screenshot',
    blob: m.blob,
    mime: m.mime,
    ext: m.ext,
    width: m.width ?? null,
    height: m.height ?? null,
    byte_size: m.byte_size ?? 0,
    alt: m.alt ?? null,
    capture: m.capture ?? null,
    path: blobRelPath(m.blob, m.ext),
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    work_item: workItem,
  };
}
