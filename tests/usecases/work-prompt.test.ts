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
import * as workPrompt from '../../src/usecases/workPrompt.js';
import { renderDispatchPrompt } from '../../src/domain/dispatchGrammar.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-wp-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('workPrompt.promptPanel', () => {
  it('no-workflow when the item has no run', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    expect(workPrompt.promptPanel(ctx(), wi.id).state).toBe('no-workflow');
  });

  it('pre-run: previews the upcoming agent_prompt without mutating', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    wf.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    const panel = workPrompt.promptPanel(ctx(), wi.id);
    expect(panel.state).toBe('pre-run');
    expect(panel.headline?.status).toBe('preview');
    expect(panel.headline?.prompt_name).toBe('brainstorm_feature_v1');
    expect(panel.headline?.body).toBeTruthy();
    expect(panel.headline?.scaffold.do_not.length).toBeGreaterThan(0);
  });

  it('pre-run headline.raw equals a real next preview for the same item (no drift)', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    wf.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    const fromNext = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any' }); // preview, no acquire
    const composedByNext = renderDispatchPrompt(fromNext.data);
    expect(workPrompt.promptPanel(ctx(), wi.id).headline?.raw).toBe(composedByNext);
  });

  it('active: after --acquire the dispatched step is the headline', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    wf.attachRun(ctx(), { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any', acquire: true });
    const panel = workPrompt.promptPanel(ctx(), wi.id);
    expect(panel.state).toBe('active');
    expect(panel.headline?.prompt_name).toBe('brainstorm_feature_v1');
    expect(panel.timeline.length).toBe(1);
    expect(panel.provenance?.name).toBe('brainstorm_feature_v1');
  });
});
