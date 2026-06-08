import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as wf from '../../src/usecases/workflow.js';
import * as next from '../../src/usecases/next.js';
import * as step from '../../src/usecases/step.js';
import * as prompt from '../../src/usecases/prompt.js';
import { BUILTIN_PROMPTS } from '../../src/workflows/prompts.js';

let dir: string; let storage: SqliteStorage; const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-pd-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('built-in prompt seeding', () => {
  it('seeds every prompt_id the feature_delivery workflow references', () => {
    for (const p of BUILTIN_PROMPTS) {
      const view = prompt.show(ctx(), p.name);
      expect(view.name).toBe(p.name);
      expect(view.body.length).toBeGreaterThan(0);
    }
    // The three referenced by feature_delivery resolve (no more phantom prompt_ids).
    expect(prompt.show(ctx(), 'brainstorm_feature_v1')).toBeTruthy();
    expect(prompt.show(ctx(), 'design_solution_v1')).toBeTruthy();
    expect(prompt.show(ctx(), 'implementation_plan_v1')).toBeTruthy();
  });

  it('is idempotent — re-init does not duplicate prompts', () => {
    initProject(dir, clock);
    const all = prompt.list(ctx());
    for (const p of BUILTIN_PROMPTS) {
      expect(all.filter((x) => x.name === p.name)).toHaveLength(1);
    }
  });
});

describe('register validates prompt_id references', () => {
  const defWith = (promptId: string) => ({
    id: 'wf_prompt_test', version: 1, name: 'Prompt Test', applies_to: ['feature'], status: 'active',
    steps: [
      { id: 's1', type: 'agent_prompt', prompt_id: promptId, outputs: [{ artifact_type: 'spec' }], next: ['done'] },
      { id: 'done', type: 'terminal' },
    ],
  });

  it('rejects a workflow that references a prompt that does not exist', () => {
    expect(() => wf.register(ctx(), defWith('ghost_v1') as any)).toThrow(/prompt 'ghost_v1' not found/);
  });

  it('accepts the workflow once the referenced prompt is created', () => {
    prompt.create(ctx(), { name: 'ghost_v1', body: 'real body' });
    const view = wf.register(ctx(), defWith('ghost_v1') as any);
    expect(view.name).toBe('Prompt Test');
  });
});

describe('next persists the built dispatch prompt', () => {
  it('stores the agent contract on the step run when dispatched with --acquire', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = wf.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    const r = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any', acquire: true });
    expect(r.status).toBe('dispatched');

    const steps = step.listForRun(ctx(), run.id);
    const main = steps.find((s) => s.step_id === 'brainstorm' && s.parent_step_run_id === null)!;
    const text = main.dispatch_prompt!;
    expect(text).toContain('WORK_ITEM:');
    expect(text).toContain(wi.id);
    expect(text).toContain('CURRENT_STEP:\nbrainstorm (agent_prompt)');
    // The composed contract now inlines the stored prompt body under PROMPT (name@version):
    expect(text).toMatch(/PROMPT \(brainstorm_feature_v1@\d+\):/);
    expect(text).toMatch(/brainstorm|approach|propose/i); // the seeded body is inlined, not just the name
    expect(text).toContain('ALLOWED_ACTION:');
    expect(text).toContain('WHEN_DONE:');

    // The exact prompt_definitions row dispatched is pinned for provenance.
    const row = ctx().storage.transaction('deferred', (tx) =>
      tx.get<{ prompt_definition_id: string | null }>('SELECT prompt_definition_id FROM workflow_step_runs WHERE id=?', main.id));
    expect(row!.prompt_definition_id).toBeTruthy();
  });

  it('does NOT persist on a preview (no --acquire) — read-only next must not mutate', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const run = wf.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    const r = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any' });
    expect(r.status).toBe('dispatched');

    const steps = step.listForRun(ctx(), run.id);
    const main = steps.find((s) => s.step_id === 'brainstorm' && s.parent_step_run_id === null)!;
    expect(main.dispatch_prompt).toBeNull();
  });
});
