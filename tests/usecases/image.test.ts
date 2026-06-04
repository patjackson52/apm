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

import * as image from '../../src/usecases/image.js';
import * as work from '../../src/usecases/work.js';

describe('image.add', () => {
  it('ingests a blob, creates an IMG artifact, links to the work item', () => {
    const ctx = { storage, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'F', agent: 'agent:claude' });
    const meta = putBlob(dir, PNG);
    const v = image.add(ctx, {
      workItem: wi.id, kind: 'screenshot', alt: 'home', relation: 'evidence',
      agent: 'agent:claude', blob: meta,
    });
    expect(v.id).toBe('IMG-1');
    expect(v.kind).toBe('screenshot');
    expect(v.blob).toBe(meta.sha256);
    expect(v.work_item).toBe(wi.id);

    // linked + listable
    const list = image.list(ctx, { workItem: wi.id });
    expect(list.items.map((i) => i.id)).toContain('IMG-1');

    // image.created event present
    storage.transaction('deferred', (tx) => {
      const ev: any = tx.get("SELECT event_type FROM events WHERE entity_id='IMG-1' AND event_type='image.created'");
      expect(ev).toBeTruthy();
    });
  });

  it('appends an image.linked event with work_item + relation', () => {
    const ctx = { storage, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'L', agent: 'agent:claude' });
    const v = image.add(ctx, { workItem: wi.id, kind: 'screenshot', alt: 'x', relation: 'reference', agent: 'agent:claude', blob: putBlob(dir, PNG) });
    storage.transaction('deferred', (tx) => {
      const ev: any = tx.get("SELECT payload_json FROM events WHERE event_type='image.linked' AND entity_id=?", v.id);
      expect(ev).toBeTruthy();
      expect(JSON.parse(ev.payload_json)).toMatchObject({ work_item: wi.id, relation: 'reference' });
    });
  });

  it('rejects an oversize blob', () => {
    const ctx = { storage, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'F2', agent: 'agent:claude' });
    const meta = { ...putBlob(dir, PNG), byte_size: 999_999_999 };
    expect(() => image.add(ctx, { workItem: wi.id, kind: 'screenshot', agent: 'agent:claude', blob: meta })).toThrow(/too large/);
  });
});

import { addImageTx } from '../../src/usecases/image.js';

describe('addImageTx (in-transaction)', () => {
  it('inserts + links an image within a caller-provided transaction', () => {
    const ctx = { storage, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'TX', agent: 'agent:claude' });
    const meta = putBlob(dir, PNG);
    const v = storage.transaction('immediate', (tx) =>
      addImageTx(tx, { workItem: wi.id, kind: 'screenshot', alt: 'x', relation: 'evidence', agent: 'agent:claude', blob: meta }),
    );
    expect(v.id).toMatch(/^IMG-/);
    expect(v.work_item).toBe(wi.id);
  });
});

describe('image.show/revise/find/pair', () => {
  it('shows by id, revises into a new version, finds by blob, pairs two images', () => {
    const ctx = { storage, clock };
    const wi = work.create(ctx, { type: 'feature', title: 'F', agent: 'agent:claude' });
    const a = image.add(ctx, { workItem: wi.id, kind: 'screenshot', alt: 'v1', agent: 'agent:claude', blob: putBlob(dir, PNG) });

    expect(image.show(ctx, a.id).alt).toBe('v1');

    // revise -> new version, same lineage
    const rev = image.revise(ctx, a.id, { alt: 'v2', agent: 'agent:claude', blob: putBlob(dir, PNG) });
    expect(rev.version).toBe(2);
    expect(rev.root).toBe(a.root);

    // find by blob (PNG bytes shared -> dedup -> both versions reference same sha)
    const found = image.find(ctx, putBlob(dir, PNG).sha256);
    expect(found.length).toBeGreaterThanOrEqual(1);

    // pair: a second image + pair event
    const b = image.add(ctx, { workItem: wi.id, kind: 'screenshot', alt: 'other', agent: 'agent:claude', blob: putBlob(dir, PNG) });
    image.pair(ctx, { a: a.id, b: b.id, kind: 'before-after', agent: 'agent:claude' });
    storage.transaction('deferred', (tx) => {
      const ev: any = tx.get("SELECT payload_json FROM events WHERE event_type='image.paired' ORDER BY id DESC LIMIT 1");
      expect(JSON.parse(ev.payload_json)).toMatchObject({ a: a.id, b: b.id, kind: 'before-after' });
    });
  });
});
