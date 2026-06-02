import type {
  WorkItemType, WorkItemStatus, Estimate, SessionStatus, LeaseStatus, ArtifactStatus, ArtifactType,
} from './types.js';

export interface Page<T> { items: T[]; page: { total: number; limit: number; offset: number; has_more: boolean }; }

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

export interface ArtifactView {
  id: string; type: ArtifactType; title: string; version: number; status: ArtifactStatus;
  root: string; supersedes: string | null; created_by: string | null; created_at: string;
}
export function toArtifactView(row: any): ArtifactView {
  return {
    id: row.id, type: row.type, title: row.title, version: row.version, status: row.status,
    root: row.root_artifact_id, supersedes: row.supersedes_artifact_id ?? null,
    created_by: row.created_by ?? null, created_at: row.created_at,
  };
}
