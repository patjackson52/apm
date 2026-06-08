import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import { repos } from '../../src/storage/repos.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-pr-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });

describe('prompts repo queries', () => {
  it('listLatest returns one row per name at the highest version', () => {
    storage.transaction('immediate', (tx) => {
      const r = repos(tx);
      r.prompts.insert('p_a', 'a v1'); r.prompts.insert('p_a', 'a v2'); r.prompts.insert('p_b', 'b v1');
    });
    const rows = storage.transaction('deferred', (tx) => repos(tx).prompts.listLatest());
    const byName = Object.fromEntries(rows.map((x: any) => [x.name, x.version]));
    expect(byName.p_a).toBe(2); // latest version only, not v1
    expect(byName.p_b).toBe(1);
    // one row per name (no duplicate names across versions)
    expect(rows.length).toBe(new Set(rows.map((x: any) => x.name)).size);
  });

  it('byNameVersion fetches an exact historical version', () => {
    storage.transaction('immediate', (tx) => { const r = repos(tx); r.prompts.insert('p', 'one'); r.prompts.insert('p', 'two'); });
    const v1 = storage.transaction('deferred', (tx) => repos(tx).prompts.byNameVersion('p', 1));
    expect(v1.body).toBe('one'); expect(v1.version).toBe(1);
  });

  it('versionCount counts versions per name', () => {
    storage.transaction('immediate', (tx) => { const r = repos(tx); r.prompts.insert('p', '1'); r.prompts.insert('p', '2'); r.prompts.insert('p', '3'); });
    expect(storage.transaction('deferred', (tx) => repos(tx).prompts.versionCount('p'))).toBe(3);
  });

  it('whereUsed returns zero counts for an unreferenced prompt', () => {
    storage.transaction('immediate', (tx) => repos(tx).prompts.insert('lonely', 'x'));
    const wu = storage.transaction('deferred', (tx) => repos(tx).prompts.whereUsed('lonely'));
    expect(wu).toEqual({ defs: 0, runs: 0 });
  });
});
