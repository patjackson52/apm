import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as image from '../../src/usecases/image.js';
import * as blocker from '../../src/usecases/blocker.js';
import { putBlob } from '../../src/storage/blobstore.js';

const clock = fixedClock('2026-06-04T12:00:00.000Z');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let dir: string; let storage: SqliteStorage;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-blkimg-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });

describe('blocker show surfaces bug images', () => {
  it('returns images linked to the blocker', () => {
    const ctx = { storage, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'B', agent: 'agent:claude' });
    const blk = blocker.create(ctx, { workItem: wi.id, type: 'bug', reason: 'broken', agent: 'agent:claude' });
    const img = image.add(ctx, { workItem: wi.id, kind: 'bug', alt: 'broken', blocker: blk.id, agent: 'agent:claude', blob: putBlob(dir, PNG) });
    const shown: any = blocker.show(ctx, blk.id);
    expect(shown.images.map((i: any) => i.id)).toContain(img.id);
  });
});
