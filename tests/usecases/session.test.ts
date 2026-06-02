import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as session from '../../src/usecases/session.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-sess-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('session usecases', () => {
  it('starts a live session for an agent', () => {
    const s = session.start(ctx(), 'claude');
    expect(s.id).toBe('S-1'); expect(s.agent).toBe('claude'); expect(s.status).toBe('active');
  });

  it('start is idempotent while a live session exists (one live per agent)', () => {
    const a = session.start(ctx(), 'claude');
    const b = session.start(ctx(), 'claude');
    expect(b.id).toBe(a.id);
  });

  it('summarize records the context summary', () => {
    session.start(ctx(), 'claude');
    const s = session.summarize(ctx(), 'S-1', 'did stuff');
    expect(s.context_summary).toBe('did stuff');
  });

  it('end closes the session and frees the agent for a new one', () => {
    session.start(ctx(), 'claude');
    session.end(ctx(), 'S-1');
    expect(session.show(ctx(), 'S-1').status).toBe('ended');
    const s2 = session.start(ctx(), 'claude');
    expect(s2.id).toBe('S-2');
  });

  it('resolveCurrent returns the live session or starts one', () => {
    const id = session.resolveCurrent(ctx(), 'claude');
    expect(id).toBe('S-1');
    expect(session.resolveCurrent(ctx(), 'claude')).toBe('S-1');
  });
});
