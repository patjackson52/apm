// tests/usecases/next-image-context.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as workflow from '../../src/usecases/workflow.js';
import * as image from '../../src/usecases/image.js';
import * as next from '../../src/usecases/next.js';
import { putBlob } from '../../src/storage/blobstore.js';

const clock = fixedClock('2026-06-04T12:00:00.000Z');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let dir: string; let storage: SqliteStorage;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-imgctx-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

const YAML = `
id: ctxwf
version: 1
name: ctxwf
applies_to: [feature]
status: active
steps:
  - id: design
    type: agent_execution
    requires:
      artifacts: [image]
    next: [done]
  - id: done
    type: terminal
`;

describe('image required-context enrichment', () => {
  it('adds path + alt + blob to an image required_context entry', () => {
    workflow.register(ctx(), YAML);
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    const img = image.add(ctx(), { workItem: wi.id, kind: 'reference', alt: 'mockup', relation: 'reference', agent: 'claude', blob: putBlob(dir, PNG) });
    workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'ctxwf', agent: 'claude' });

    const r = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any' });
    const entry = r.data.required_context.find((c: any) => c.id === img.id);
    expect(entry).toBeTruthy();
    expect(entry.type).toBe('image');
    expect(entry.path).toBe(img.path);
    expect(entry.alt).toBe('mockup');
    expect(entry.blob).toBe(img.blob);
  });
});
