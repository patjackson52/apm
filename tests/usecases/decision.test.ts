import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as decision from '../../src/usecases/decision.js';
import * as adr from '../../src/usecases/adr.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-dec-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('decision.create', () => {
  it('creates an open decision', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const d = decision.create(ctx(), { workItem: wi.id, question: 'Which DB?', options: ['postgres', 'sqlite'], agent: 'claude' });
    expect(d).toMatchObject({ id: 'DEC-1', question: 'Which DB?', status: 'open', options: ['postgres', 'sqlite'] });
  });

  it('creates a recommended decision when recommendation given', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const d = decision.create(ctx(), {
      workItem: wi.id, question: 'Which DB?', options: ['postgres', 'sqlite'],
      recommendation: 'postgres', confidence: 90, category: 'storage', agent: 'claude',
    });
    expect(d.status).toBe('recommended');
    expect(d.recommendation).toBe('postgres');
  });
});

describe('decision.accept', () => {
  it('sets status to decided', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const d = decision.create(ctx(), { workItem: wi.id, question: 'Q?', options: ['a', 'b'], agent: 'claude' });
    const accepted = decision.accept(ctx(), d.id, 'a', 'claude');
    expect(accepted.status).toBe('decided');
    expect(accepted.decision).toBe('a');
    expect(accepted.decided_at).toBeTruthy();
  });

  it('auto-creates ADR when confidence >= threshold and category matches policy', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    // DEFAULT_POLICY seeded by init: adr_policy.auto_create=true, categories=['architecture','storage',...], threshold=85
    const d = decision.create(ctx(), {
      workItem: wi.id, question: 'Use postgres?', options: ['yes', 'no'],
      recommendation: 'yes', confidence: 90, category: 'storage', agent: 'claude',
    });
    const accepted = decision.accept(ctx(), d.id, 'yes', 'claude');
    expect(accepted.artifact_id).toBeTruthy();
    expect(accepted.artifact_id).toMatch(/^ART-/);

    // The ADR artifact should exist
    const adrView = adr.show(ctx(), accepted.artifact_id!);
    expect(adrView.type).toBe('adr');
  });

  it('does NOT auto-create ADR when confidence < threshold', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const d = decision.create(ctx(), {
      workItem: wi.id, question: 'Use postgres?', options: ['yes', 'no'],
      recommendation: 'yes', confidence: 70, category: 'storage', agent: 'claude',
    });
    const accepted = decision.accept(ctx(), d.id, 'yes', 'claude');
    expect(accepted.artifact_id).toBeNull();
  });

  it('does NOT auto-create ADR when category not in policy', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const d = decision.create(ctx(), {
      workItem: wi.id, question: 'Coffee or tea?', options: ['coffee', 'tea'],
      recommendation: 'coffee', confidence: 99, category: 'beverage', agent: 'claude',
    });
    const accepted = decision.accept(ctx(), d.id, 'coffee', 'claude');
    expect(accepted.artifact_id).toBeNull();
  });

  it('rejects double-accept (E_PRECONDITION)', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const d = decision.create(ctx(), { workItem: wi.id, question: 'Q?', options: ['a'], agent: 'claude' });
    decision.accept(ctx(), d.id, 'a', 'claude');
    expect(() => decision.accept(ctx(), d.id, 'a', 'claude')).toThrowError(/E_PRECONDITION|already decided/i);
  });
});

describe('decision.reject', () => {
  it('cancels the decision', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const d = decision.create(ctx(), { workItem: wi.id, question: 'Q?', options: ['a'], agent: 'claude' });
    const cancelled = decision.reject(ctx(), d.id, 'claude');
    expect(cancelled.status).toBe('cancelled');
  });
});

describe('adr.createFromDecision', () => {
  it('requires decided decision', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const d = decision.create(ctx(), { workItem: wi.id, question: 'Q?', options: ['a'], agent: 'claude' });
    expect(() => adr.createFromDecision(ctx(), d.id, 'claude')).toThrowError(/decided|E_PRECONDITION/i);
  });

  it('creates an ADR artifact from a decided decision', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const d = decision.create(ctx(), { workItem: wi.id, question: 'Use postgres?', options: ['yes', 'no'], agent: 'claude' });
    decision.accept(ctx(), d.id, 'yes', 'claude');

    const adrView = adr.createFromDecision(ctx(), d.id, 'claude');
    expect(adrView.type).toBe('adr');
    expect(adrView.title).toBe('Use postgres?');

    const decView = decision.show(ctx(), d.id);
    expect(decView.artifact_id).toBe(adrView.id);
  });

  it('rejects creating a second ADR when decision already has one (E_CONFLICT)', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const d = decision.create(ctx(), { workItem: wi.id, question: 'Use postgres?', options: ['yes', 'no'], agent: 'claude' });
    decision.accept(ctx(), d.id, 'yes', 'claude');
    adr.createFromDecision(ctx(), d.id, 'claude');
    expect(() => adr.createFromDecision(ctx(), d.id, 'claude')).toThrowError(/E_CONFLICT|already has an ADR/i);
  });
});

describe('adr.list', () => {
  it('lists only adr-type artifacts', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const d = decision.create(ctx(), { workItem: wi.id, question: 'Q?', options: ['a'], agent: 'claude' });
    decision.accept(ctx(), d.id, 'a', 'claude');
    adr.createFromDecision(ctx(), d.id, 'claude');
    const listing = adr.list(ctx());
    expect(listing.items.every((a: any) => a.type === 'adr')).toBe(true);
    expect(listing.items).toHaveLength(1);
  });
});
