import { describe, it, expect } from 'vitest';
import { toStepRunView, toPromptSummaryView, toPromptDetailView } from '../../src/domain/entities.js';

describe('prompt entity mappers', () => {
  it('toStepRunView carries prompt_definition_id', () => {
    const v = toStepRunView({ id: 'SR-1', workflow_run_id: 'WR-1', step_id: 's', status: 'completed', review_round: 1, prompt_definition_id: 'PD-3' });
    expect(v.prompt_definition_id).toBe('PD-3');
  });

  it('toPromptSummaryView derives builtin + a one-line summary from the body', () => {
    const v = toPromptSummaryView(
      { id: 'PD-9', name: 'brainstorm_feature_v1', version: 2, body: 'Explore 2-3 approaches.\nMore detail.', created_at: '2026-06-01T00:00:00Z' },
      { versionCount: 2, defs: 1, runs: 14 },
    );
    expect(v).toMatchObject({ name: 'brainstorm_feature_v1', latest_version: 2, version_count: 2, builtin: true, where_defs: 1, where_runs: 14 });
    expect(v.summary).toBe('Explore 2-3 approaches.');
  });

  it('toPromptSummaryView marks an unknown name as custom', () => {
    const v = toPromptSummaryView({ id: 'PD-1', name: 'my_custom', version: 1, body: 'x', created_at: 'z' }, { versionCount: 1, defs: 0, runs: 0 });
    expect(v.builtin).toBe(false);
  });

  it('toPromptDetailView includes versions', () => {
    const d = toPromptDetailView(
      { id: 'PD-2', name: 'p', version: 2, body: 'v2', created_at: 'b' },
      [{ version: 2, body: 'v2', created_at: 'b' }, { version: 1, body: 'v1', created_at: 'a' }],
      { defs: 0, runs: 0 },
    );
    expect(d.versions.map((x) => x.version)).toEqual([2, 1]);
    expect(d.version_count).toBe(2);
  });
});
