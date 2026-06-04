import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { fixedClock } from '../../src/domain/clock.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { repos } from '../../src/storage/repos.js';

const clock = fixedClock('2026-06-04T12:00:00.000Z');
let dir: string;
let storage: SqliteStorage;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm-img-'));
  initProject(dir, clock);
  storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

import { putBlob } from '../../src/storage/blobstore.js';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('artifacts.insert metadata', () => {
  it('persists metadata and emits the given event type', () => {
    storage.transaction('immediate', (tx) => {
      const r = repos(tx);
      r.agents.ensure('agent:claude');
      const id = r.artifacts.insert(
        { type: 'image', title: 'shot', body: null, createdBy: 'agent:claude', version: 1, metadata: { kind: 'screenshot', blob: 'deadbeef' } },
        'image.created',
      );
      const row: any = r.artifacts.byId(id);
      expect(JSON.parse(row.metadata_json)).toEqual({ kind: 'screenshot', blob: 'deadbeef' });
      const ev: any = tx.get("SELECT event_type FROM events WHERE entity_id=? ORDER BY id DESC LIMIT 1", id);
      expect(ev.event_type).toBe('image.created');
    });
  });
});

describe('blobs repo + image queries', () => {
  it('inserts a blob idempotently and reads it back', () => {
    const meta = putBlob(dir, PNG);
    storage.transaction('immediate', (tx) => {
      const r = repos(tx);
      r.blobs.insert(meta);
      r.blobs.insert(meta); // OR IGNORE, no throw
      const row: any = r.blobs.byId(meta.sha256);
      expect(row.mime).toBe('image/png');
      expect(row.width).toBe(1);
    });
  });
});
