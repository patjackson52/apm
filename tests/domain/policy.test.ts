import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import { effectivePolicy } from '../../src/domain/policy.js';
import * as work from '../../src/usecases/work.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-pol-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });

describe('effectivePolicy', () => {
  it('returns global policy when no work-item or def policy', () => {
    const wi = work.create({ storage, clock }, { type: 'feature', title: 'F', agent: 'claude' });
    const pol = storage.transaction('deferred', (tx) => effectivePolicy(tx, wi.id));
    // Global policy seeded by init (DEFAULT_POLICY from seed)
    expect(pol).toMatchObject({ auto_create_work_items: true });
  });

  it('work-item policy overrides global', () => {
    const wi = work.create({ storage, clock }, { type: 'feature', title: 'F', agent: 'claude' });
    // Insert a work-item policy that overrides auto_create_work_items
    storage.transaction('immediate', (tx) => {
      const id = tx.allocateId('POL');
      tx.run(
        "INSERT INTO policies (id, scope_type, scope_id, policy_json, created_at) VALUES (?, 'work_item', ?, ?, ?)",
        id, wi.id, JSON.stringify({ auto_create_work_items: false }), tx.now(),
      );
    });
    const pol = storage.transaction('deferred', (tx) => effectivePolicy(tx, wi.id));
    expect(pol.auto_create_work_items).toBe(false);
    // global key still present where not overridden
    expect((pol as any).adr_policy).toBeTruthy();
  });

  it('returns empty object for work item with no policies at all', () => {
    // Remove global policy to test empty fallback
    storage.transaction('immediate', (tx) => {
      tx.run("DELETE FROM policies");
    });
    const wi = work.create({ storage, clock }, { type: 'feature', title: 'F', agent: 'claude' });
    const pol = storage.transaction('deferred', (tx) => effectivePolicy(tx, wi.id));
    expect(pol).toEqual({});
  });
});
