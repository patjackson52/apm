import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { buildProgram } from '../../src/cli/program.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as wf from '../../src/usecases/workflow.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';

let dir: string; const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-cmd-')); initProject(dir, clock); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function runCli(args: string[]): { out: string; code: number } {
  const lines: string[] = [];
  const program = buildProgram({ clock, out: (s) => lines.push(s), defaultFormat: 'json' });
  let code = 0;
  const orig = process.exitCode;
  program.parse(['--dir', dir, ...args], { from: 'user' });
  code = (process.exitCode as number) ?? 0;
  process.exitCode = orig;
  return { out: lines.join('\n'), code };
}

describe('cli command groups', () => {
  it('work create -> show -> list round trip', () => {
    const created = JSON.parse(runCli(['work', 'create', '--type', 'feature', '--title', 'Offline', '--agent', 'claude']).out);
    expect(created.ok).toBe(true); expect(created.data.id).toBe('WI-1');
    const shown = JSON.parse(runCli(['work', 'show', 'WI-1']).out);
    expect(shown.data.title).toBe('Offline');
    const listed = JSON.parse(runCli(['work', 'list']).out);
    expect(listed.data.items).toHaveLength(1);
  });

  it('lease acquire reports active and conflict exit code', () => {
    runCli(['work', 'create', '--type', 'task', '--title', 'A', '--agent', 'claude']);
    const ok = runCli(['lease', 'acquire', 'WI-1', '--agent', 'claude', '--ttl', '30m']);
    expect(JSON.parse(ok.out).data.status).toBe('active');
    const conflict = runCli(['lease', 'acquire', 'WI-1', '--agent', 'other', '--ttl', '30m']);
    expect(conflict.code).toBe(10);
    expect(JSON.parse(conflict.out).error.code).toBe('E_LEASE_CONFLICT');
  });

  it('missing project gives E_NOT_FOUND exit 44', () => {
    const lines: string[] = [];
    const program = buildProgram({ clock, out: (s) => lines.push(s), defaultFormat: 'json' });
    program.parse(['--dir', join(dir, 'nope'), 'work', 'list'], { from: 'user' });
    expect((process.exitCode as number)).toBe(44);
    process.exitCode = 0;
  });

  it('apm next --format agent on project with a run prints WORK_ITEM contract and exits 0', () => {
    // Seed data using usecases directly (shares the same db via dir)
    const storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
    const ctx = { storage, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'F', agent: 'claude' });
    wf.attachRun(ctx, { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    storage.close();

    const lines: string[] = [];
    const program = buildProgram({ clock, out: (s) => lines.push(s) });
    const orig = process.exitCode;
    program.parse(['--dir', dir, '--format', 'agent', 'next', '--agent', 'claude'], { from: 'user' });
    const code = (process.exitCode as number) ?? 0;
    process.exitCode = orig;

    const out = lines.join('\n');
    expect(out).toMatch(/WORK_ITEM:/);
    expect(out).toMatch(new RegExp(wi.id));
    expect(code).toBe(0);
  });

  it('apm next (no --acquire) on dispatched step → meta.stale === true, no data.stale', () => {
    const storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
    const ctx = { storage, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'F2', agent: 'claude' });
    wf.attachRun(ctx, { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    storage.close();

    const { out } = runCli(['next', '--agent', 'claude']);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.meta.stale).toBe(true);
    expect(parsed.data.stale).toBeUndefined();
  });

  it('apm next --acquire on dispatched step → no meta.stale, data.lease set', () => {
    const storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
    const ctx = { storage, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'F3', agent: 'claude' });
    wf.attachRun(ctx, { workItem: wi.id, workflow: 'feature_delivery', agent: 'claude' });
    storage.close();

    const { out } = runCli(['next', '--agent', 'claude', '--acquire']);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.meta.stale).toBeUndefined();
    expect(parsed.data.lease).toBeTruthy();
  });

  it('apm next --format agent on empty project prints status=drained and exits 3', () => {
    const lines: string[] = [];
    const program = buildProgram({ clock, out: (s) => lines.push(s) });
    const orig = process.exitCode;
    program.parse(['--dir', dir, '--format', 'agent', 'next', '--agent', 'claude'], { from: 'user' });
    const code = (process.exitCode as number) ?? 0;
    process.exitCode = orig;

    const out = lines.join('\n');
    expect(out.trim()).toBe('status=drained');
    expect(code).toBe(3);
  });

  it('apm status returns counts', () => {
    const storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
    const ctx = { storage, clock };
    work.create(ctx, { type: 'feature', title: 'F1', agent: 'claude' });
    work.create(ctx, { type: 'task', title: 'T1', agent: 'claude' });
    const wi3 = work.create(ctx, { type: 'task', title: 'T2', agent: 'claude' });
    work.update(ctx, wi3.id, { status: 'ready' }, 'claude');
    wf.attachRun(ctx, { workItem: wi3.id, workflow: 'feature_delivery', agent: 'claude' });
    storage.close();

    const r = runCli(['status']);
    const parsed = JSON.parse(r.out);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.work.by_status.draft).toBe(2);
    expect(parsed.data.ready_count).toBe(1);
    expect(parsed.data.active_runs).toHaveLength(1);
  });
});
