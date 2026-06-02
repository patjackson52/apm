import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';

let dir: string; const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-seed-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('seeding', () => {
  it('init seeds the built-in feature_delivery workflow and a default policy', () => {
    initProject(dir, clock);
    const s = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
    const def = s.transaction('deferred', (tx) => tx.get<any>("SELECT * FROM workflow_definitions WHERE name='feature_delivery'"));
    expect(def).toBeTruthy(); expect(def.version).toBe(1); expect(def.status).toBe('active');
    const pol = s.transaction('deferred', (tx) => tx.get<any>("SELECT * FROM policies WHERE scope_type='global'"));
    expect(pol).toBeTruthy();
    s.close();
  });

  it('is idempotent — re-init does not duplicate the workflow', () => {
    initProject(dir, clock);
    initProject(dir, clock);
    const s = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
    const count = s.transaction('deferred', (tx) => tx.get<{ c: number }>("SELECT count(*) c FROM workflow_definitions WHERE name='feature_delivery'")!.c);
    expect(count).toBe(1);
    s.close();
  });
});
