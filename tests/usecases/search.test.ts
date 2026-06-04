import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as artifact from '../../src/usecases/artifact.js';
import * as workflow from '../../src/usecases/workflow.js';
import { query, excerpt, escapeLike } from '../../src/usecases/search.js';

const clock = fixedClock('2026-06-03T12:00:00.000Z');
let dir: string; let ctx: { storage: SqliteStorage; clock: typeof clock };

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm-search-'));
  initProject(dir, clock);
  ctx = { storage: new SqliteStorage(join(dir, '.apm', 'apm.db'), clock), clock };
  const wi = work.create(ctx, { type: 'feature', title: 'Alpha Search Feature', agent: 'claude' });
  artifact.create(ctx, { workItem: wi.id, type: 'spec', title: 'Spec', body: 'this contains a needle to find', agent: 'claude' });
  workflow.attachRun(ctx, { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' }); // creates a run + first step (brainstorm)
});
afterAll(() => { ctx.storage.close(); rmSync(dir, { recursive: true, force: true }); });

describe('search.query', () => {
  it('finds a work item by title', () => {
    const r = query(ctx, { q: 'alpha' });
    expect(r.some((x) => x.kind === 'work_item' && /Alpha/.test(x.title))).toBe(true);
  });
  it('finds an artifact by body, with its work_item via the join', () => {
    const r = query(ctx, { q: 'needle' });
    const art = r.find((x) => x.kind === 'artifact');
    expect(art).toBeTruthy();
    expect(art!.work_item).toMatch(/^WI-/);
    expect(art!.snippet).toContain('needle');
  });
  it('finds a step by step_id with work_item via the run join', () => {
    const r = query(ctx, { q: 'brainstorm' });
    const step = r.find((x) => x.kind === 'step');
    expect(step).toBeTruthy();
    expect(step!.work_item).toMatch(/^WI-/);
  });
  it('blank q returns []', () => {
    expect(query(ctx, { q: '   ' })).toEqual([]);
  });
  it('escapes LIKE wildcards (% / _) so they are literal, not match-all', () => {
    expect(query(ctx, { q: '%' }).length).toBe(0); // no title/body literally contains '%'
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(() => query(ctx, { q: '\\' })).not.toThrow();
  });
  it('excerpt centers on the match', () => {
    expect(excerpt('xxxx needle yyyy', 'needle')).toContain('needle');
  });
});
