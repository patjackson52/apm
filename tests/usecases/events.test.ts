import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as session from '../../src/usecases/session.js';
import * as events from '../../src/usecases/events.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-03T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-events-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('events.list', () => {
  it('returns events for a specific entity with parsed payload', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const page = events.list(ctx(), { entityId: wi.id });
    expect(page.items.length).toBeGreaterThan(0);
    const created = page.items.find((e) => e.event_type === 'work_item.created')!;
    expect(created.entity_id).toBe(wi.id);
    expect(created.payload).toMatchObject({ type: 'feature' }); // payload parsed to object
  });

  it('lists recent events across entities and honors limit/offset', () => {
    work.create(ctx(), { type: 'feature', title: 'A', agent: 'claude' });
    work.create(ctx(), { type: 'task', title: 'B', agent: 'claude' });
    const all = events.list(ctx(), {});
    expect(all.page.total).toBeGreaterThanOrEqual(2);
    const firstPage = events.list(ctx(), { limit: 1, offset: 0 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.page).toMatchObject({ limit: 1, offset: 0, has_more: true });
  });
});

describe('session.list', () => {
  it('lists started sessions', () => {
    session.start(ctx(), 'claude');
    const sessions = session.list(ctx());
    expect(sessions.map((s) => s.agent)).toContain('claude');
    expect(sessions[0].status).toBe('active');
  });
});
