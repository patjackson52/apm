import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import { repos } from '../../src/storage/repos.js';

function mem() { return new SqliteStorage(':memory:', fixedClock('2026-06-02T12:00:00.000Z')); }

describe('repos', () => {
  it('upserts an agent by name (idempotent) and returns its id', () => {
    const s = mem();
    const [a1, a2] = s.transaction('immediate', (tx) => {
      const r = repos(tx);
      return [r.agents.ensure('claude'), r.agents.ensure('claude')];
    });
    expect(a1).toBe('claude');           // agent id == name for V1
    expect(a2).toBe('claude');
    const count = s.transaction('deferred', (tx) => tx.get<{ c: number }>('SELECT count(*) c FROM agents')!.c);
    expect(count).toBe(1);
    s.close();
  });

  it('inserts and fetches a work item', () => {
    const s = mem();
    const id = s.transaction('immediate', (tx) => {
      const r = repos(tx);
      r.agents.ensure('claude');
      return r.workItems.insert({ type: 'feature', title: 'Offline', description: 'd', priority: 2, estimate: 'M', parentId: null, createdBy: 'claude', dedupKey: null });
    });
    expect(id).toBe('WI-1');
    const row = s.transaction('deferred', (tx) => repos(tx).workItems.byId('WI-1'));
    expect(row!.title).toBe('Offline');
    expect(row!.status).toBe('draft');
    s.close();
  });

  it('records a depends_on link and lists dependency ids', () => {
    const s = mem();
    const deps = s.transaction('immediate', (tx) => {
      const r = repos(tx);
      r.agents.ensure('claude');
      const a = r.workItems.insert({ type: 'feature', title: 'A', description: null, priority: 0, estimate: null, parentId: null, createdBy: 'claude', dedupKey: null });
      const b = r.workItems.insert({ type: 'task', title: 'B', description: null, priority: 0, estimate: null, parentId: null, createdBy: 'claude', dedupKey: null });
      r.links.add(a, b, 'depends_on');
      return r.links.dependsOn(a);
    });
    expect(deps).toEqual(['WI-2']);
    s.close();
  });
});

describe('repos extensions', () => {
  it('artifacts: insert v1 sets root to own id; currentByRoot returns latest version', () => {
    const s = mem();
    const ids = s.transaction('immediate', (tx) => {
      const r = repos(tx); r.agents.ensure('claude');
      const v1 = r.artifacts.insert({ type: 'spec', title: 'Spec', body: 'a', createdBy: 'claude', version: 1 });
      const v2 = r.artifacts.insert({ type: 'spec', title: 'Spec', body: 'b', createdBy: 'claude', version: 2, rootId: v1, supersedes: v1 });
      return { v1, v2 };
    });
    const cur = s.transaction('deferred', (tx) => repos(tx).artifacts.currentByRoot(ids.v1));
    expect(cur.id).toBe(ids.v2); expect(cur.version).toBe(2);
    s.close();
  });

  it('runs: one active run per work item enforced', () => {
    const s = mem();
    expect(() => s.transaction('immediate', (tx) => {
      const r = repos(tx); r.agents.ensure('claude');
      const wi = r.workItems.insert({ type: 'feature', title: 'A', description: null, priority: 0, estimate: null, parentId: null, createdBy: 'claude', dedupKey: null });
      const def = tx.allocateId('WD'); tx.run("INSERT INTO workflow_definitions (id,name,version,definition_json,status,created_at) VALUES (?, 'x', 1, '{}', 'active', ?)", def, tx.now());
      r.runs.insert(wi, def); r.runs.insert(wi, def); // second active run -> UNIQUE violation
    })).toThrowError(/UNIQUE/i);
    s.close();
  });

  it('stepRuns: mainPending returns the single pending main-path step', () => {
    const s = mem();
    const got = s.transaction('immediate', (tx) => {
      const r = repos(tx); r.agents.ensure('claude');
      const wi = r.workItems.insert({ type: 'feature', title: 'A', description: null, priority: 0, estimate: null, parentId: null, createdBy: 'claude', dedupKey: null });
      const def = tx.allocateId('WD'); tx.run("INSERT INTO workflow_definitions (id,name,version,definition_json,status,created_at) VALUES (?, 'x', 1, '{}', 'active', ?)", def, tx.now());
      const run = r.runs.insert(wi, def);
      r.stepRuns.insertPending(run, 'brainstorm');
      return r.stepRuns.mainPending(run);
    });
    expect(got.step_id).toBe('brainstorm');
    s.close();
  });
});
