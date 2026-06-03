import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as artifact from '../../src/usecases/artifact.js';

let dir: string;
let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm-artbody-'));
  initProject(dir, clock);
  storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});
const ctx = () => ({ storage, clock });

describe('artifact.show — body + work_item', () => {
  it('returns the raw body and linked work_item', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const a = artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'S', body: '# hello\nbody', agent: 'claude' });
    const v = artifact.show(ctx(), a.id);
    expect(v.body).toBe('# hello\nbody');
    expect(v.work_item).toBe(wi.id);
  });

  it('show of a revised artifact returns the current version body; work_item follows the lineage root', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const a = artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'S', body: 'v1', agent: 'claude' });
    const b = artifact.revise(ctx(), a.id, 'v2', 'claude');
    expect(b.body).toBe('v2');
    expect(b.work_item).toBe(wi.id);
    expect(artifact.show(ctx(), b.id).body).toBe('v2');
  });

  it('throws E_NOT_FOUND for an unknown id', () => {
    expect(() => artifact.show(ctx(), 'ART-999')).toThrowError(/not found/i);
  });
});

describe('artifact.list — lean (no body)', () => {
  it('omits body but carries work_item', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'S', body: 'big body text', agent: 'claude' });
    const page = artifact.list(ctx(), { workItem: wi.id });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].body).toBeNull();
    expect(page.items[0].work_item).toBe(wi.id);
  });
});
