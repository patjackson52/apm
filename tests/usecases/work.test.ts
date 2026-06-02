import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-work-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('work usecases', () => {
  it('creates a work item and returns the canonical view', () => {
    const v = work.create(ctx(), { type: 'feature', title: 'Offline', description: 'sync', priority: 1, estimate: 'M', agent: 'claude' });
    expect(v).toMatchObject({ id: 'WI-1', type: 'feature', title: 'Offline', status: 'draft', estimate: 'M', created_by: 'claude' });
  });

  it('rejects an invalid estimate', () => {
    expect(() => work.create(ctx(), { type: 'feature', title: 'X', estimate: 'XXL' as any, agent: 'claude' }))
      .toThrowError(/estimate/i);
  });

  it('rejects an invalid type', () => {
    expect(() => work.create(ctx(), { type: 'widget' as any, title: 'X', agent: 'claude' })).toThrowError(/type/i);
  });

  it('shows a created item; 404s a missing one', () => {
    work.create(ctx(), { type: 'task', title: 'A', agent: 'claude' });
    expect(work.show(ctx(), 'WI-1').id).toBe('WI-1');
    expect(() => work.show(ctx(), 'WI-99')).toThrowError(/not found/i);
  });

  it('lists with pagination metadata', () => {
    for (let i = 0; i < 3; i++) work.create(ctx(), { type: 'task', title: `T${i}`, agent: 'claude' });
    const page = work.list(ctx(), { limit: 2, offset: 0 });
    expect(page.items).toHaveLength(2);
    expect(page.page).toEqual({ total: 3, limit: 2, offset: 0, has_more: true });
  });

  it('lists children of a parent', () => {
    const p = work.create(ctx(), { type: 'feature', title: 'P', agent: 'claude' });
    work.create(ctx(), { type: 'task', title: 'C', parent: p.id, agent: 'claude' });
    const kids = work.children(ctx(), p.id);
    expect(kids.items.map((k) => k.title)).toEqual(['C']);
  });

  it('updates title and estimate', () => {
    work.create(ctx(), { type: 'task', title: 'A', agent: 'claude' });
    const v = work.update(ctx(), 'WI-1', { title: 'A2', estimate: 'L' }, 'claude');
    expect(v.title).toBe('A2'); expect(v.estimate).toBe('L');
  });

  it('rejects an invalid status transition', () => {
    work.create(ctx(), { type: 'task', title: 'A', agent: 'claude' }); // draft
    expect(() => work.update(ctx(), 'WI-1', { status: 'completed' }, 'claude')).toThrowError(/transition/i);
  });

  it('links a dependency and reflects it in the view', () => {
    work.create(ctx(), { type: 'feature', title: 'A', agent: 'claude' });
    work.create(ctx(), { type: 'task', title: 'B', agent: 'claude' });
    work.link(ctx(), 'WI-1', 'WI-2', 'claude');
    expect(work.show(ctx(), 'WI-1').depends_on).toEqual(['WI-2']);
  });

  it('rejects a self-dependency', () => {
    work.create(ctx(), { type: 'task', title: 'A', agent: 'claude' });
    expect(() => work.link(ctx(), 'WI-1', 'WI-1', 'claude')).toThrowError(/self/i);
  });

  it('cancels a parent and cascades to children', () => {
    const p = work.create(ctx(), { type: 'feature', title: 'P', agent: 'claude' });
    work.create(ctx(), { type: 'task', title: 'C', parent: p.id, agent: 'claude' });
    work.cancel(ctx(), p.id, 'claude');
    expect(work.show(ctx(), p.id).status).toBe('cancelled');
    expect(work.show(ctx(), 'WI-2').status).toBe('cancelled');
  });
});
