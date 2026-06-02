import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as artifact from '../../src/usecases/artifact.js';

let dir: string; let storage: SqliteStorage;
const clock = fixedClock('2026-06-02T12:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-art-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

describe('artifact usecases', () => {
  it('creates a v1 artifact linked to a work item', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const a = artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'Spec', body: 'hello', agent: 'claude' });
    expect(a).toMatchObject({ id: 'ART-1', type: 'spec', version: 1, status: 'draft' });
    expect(work.show(ctx(), wi.id).artifact_ids).toEqual(['ART-1']);
  });

  it('revise creates v2 superseding v1; current resolves to v2; link unchanged', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const a = artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'Spec', body: 'v1', agent: 'claude' });
    const b = artifact.revise(ctx(), a.id, 'v2', 'claude');
    expect(b.version).toBe(2);
    expect(artifact.show(ctx(), a.id).status).toBe('superseded');
    expect(work.show(ctx(), wi.id).artifact_ids).toEqual([b.id]); // view shows current version per root
  });

  it('approve transitions draft->review->approved', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const a = artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'S', body: 'x', agent: 'claude' });
    artifact.submit(ctx(), a.id); expect(artifact.show(ctx(), a.id).status).toBe('review');
    artifact.approve(ctx(), a.id); expect(artifact.show(ctx(), a.id).status).toBe('approved');
  });

  it('show returns 404 for missing artifact', () => {
    expect(() => artifact.show(ctx(), 'ART-999')).toThrowError(/not found/i);
  });

  it('list returns current version of each root for the work item', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const a = artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'S', body: 'v1', agent: 'claude' });
    artifact.revise(ctx(), a.id, 'v2', 'claude');
    const page = artifact.list(ctx(), { workItem: wi.id });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].version).toBe(2);
  });

  it('archive transitions any non-archived status to archived', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const a = artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'S', body: 'x', agent: 'claude' });
    const archived = artifact.archive(ctx(), a.id);
    expect(archived.status).toBe('archived');
  });

  it('revise rejects a superseded artifact', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const a = artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'S', body: 'v1', agent: 'claude' });
    artifact.revise(ctx(), a.id, 'v2', 'claude'); // a is now superseded
    expect(() => artifact.revise(ctx(), a.id, 'v3', 'claude')).toThrowError(/superseded/i);
  });

  it('ArtifactView has expected shape', () => {
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const a = artifact.create(ctx(), { workItem: wi.id, type: 'spec', title: 'Spec', body: 'hello', agent: 'claude' });
    expect(a).toMatchObject({
      id: 'ART-1', type: 'spec', title: 'Spec', version: 1, status: 'draft',
      root: 'ART-1', supersedes: null, created_by: 'claude',
    });
    expect(a.created_at).toBeTruthy();
  });
});
