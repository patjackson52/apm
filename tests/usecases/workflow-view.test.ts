import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as workflow from '../../src/usecases/workflow.js';

let dir: string;
let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm-wfview-'));
  initProject(dir, clock); // seeds the built-in feature_delivery workflow
  storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});
const ctx = () => ({ storage, clock });

describe('workflow show — full view', () => {
  it('returns steps[] with layout + derived edges[]', () => {
    const v: any = workflow.show(ctx(), 'feature_delivery');
    expect(v.name).toBe('feature_delivery');
    expect(v.steps).toHaveLength(9);
    for (const s of v.steps) {
      expect(typeof s.x).toBe('number');
      expect(s.y).toBe(0);
      expect(typeof s.label).toBe('string');
    }
    const review = v.steps.find((s: any) => s.id === 'design_review');
    expect(review.reviewers).toEqual(['architecture', 'security', 'simplicity']);
    expect(v.edges).toContainEqual({ from: 'brainstorm', to: 'design' });
    expect(v.applies_to).toContain('feature');
  });
});

describe('workflow list — lean view', () => {
  it('omits steps/edges to keep the list payload small', () => {
    const rows: any[] = workflow.list(ctx());
    expect(rows.length).toBeGreaterThan(0);
    const fd = rows.find((r) => r.name === 'feature_delivery');
    expect(fd).toBeTruthy();
    expect(fd.steps).toBeUndefined();
    expect(fd.edges).toBeUndefined();
    expect(fd).toMatchObject({ name: 'feature_delivery', status: 'active' });
  });
});
