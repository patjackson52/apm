import { describe, it, expect } from 'vitest';
import { toWorkItemView, toSessionView, toLeaseView, toArtifactView } from '../../src/domain/entities.js';

describe('entity mappers', () => {
  it('maps a work item row to a canonical view with id refs', () => {
    const row = {
      id: 'WI-1', type: 'feature', title: 'Offline', description: null, status: 'ready',
      priority: 0, estimate: 'M', parent_id: 'WI-0', created_by: 'claude',
      created_at: '2026-06-02T00:00:00.000Z', updated_at: '2026-06-02T00:00:00.000Z', completed_at: null,
    };
    const v = toWorkItemView(row, { dependsOn: ['WI-5'], blockerIds: [], artifactIds: ['ART-2'], activeRun: 'WR-1', lease: null });
    expect(v).toEqual({
      id: 'WI-1', type: 'feature', title: 'Offline', description: null, status: 'ready',
      priority: 0, estimate: 'M', parent: 'WI-0', depends_on: ['WI-5'], blocker_ids: [],
      artifact_ids: ['ART-2'], active_run: 'WR-1', lease: null, created_by: 'claude',
      created_at: '2026-06-02T00:00:00.000Z', updated_at: '2026-06-02T00:00:00.000Z', completed_at: null,
    });
  });

  it('maps a session row', () => {
    const v = toSessionView({ id: 'S-1', agent_id: 'claude', status: 'active', context_summary: null,
      started_at: '2026-06-02T00:00:00.000Z', last_seen_at: null, ended_at: null });
    expect(v.id).toBe('S-1'); expect(v.agent).toBe('claude'); expect(v.status).toBe('active');
  });

  it('maps a lease row', () => {
    const v = toLeaseView({ id: 'LEASE-1', work_item_id: 'WI-1', agent_id: 'claude', session_id: 'S-1',
      status: 'active', acquired_at: 'a', expires_at: 'b', heartbeat_at: null });
    expect(v).toMatchObject({ id: 'LEASE-1', work_item: 'WI-1', agent: 'claude', session: 'S-1', status: 'active', expires_at: 'b' });
  });
});

describe('toArtifactView metadata', () => {
  it('parses metadata_json into a metadata object', () => {
    const row = {
      id: 'ART-1', type: 'spec', title: 'T', version: 1, status: 'draft',
      root_artifact_id: 'ART-1', supersedes_artifact_id: null, created_by: 'a',
      created_at: '2026-06-04T00:00:00.000Z', body: null,
      metadata_json: '{"kind":"screenshot","blob":"abc"}',
    };
    const v = toArtifactView(row, 'WI-1');
    expect(v.metadata).toEqual({ kind: 'screenshot', blob: 'abc' });
  });

  it('metadata is null when column is null', () => {
    const row = {
      id: 'ART-2', type: 'spec', title: 'T', version: 1, status: 'draft',
      root_artifact_id: 'ART-2', supersedes_artifact_id: null, created_by: 'a',
      created_at: '2026-06-04T00:00:00.000Z', body: null, metadata_json: null,
    };
    expect(toArtifactView(row).metadata).toBeNull();
  });
});
