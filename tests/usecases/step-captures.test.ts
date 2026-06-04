// tests/usecases/step-captures.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as workflow from '../../src/usecases/workflow.js';
import * as step from '../../src/usecases/step.js';
import * as image from '../../src/usecases/image.js';
import { putBlob } from '../../src/storage/blobstore.js';

const clock = fixedClock('2026-06-04T12:00:00.000Z');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let dir: string; let storage: SqliteStorage;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-capgate-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ storage, clock });

const YAML = `
id: capwf
version: 1
name: capwf
applies_to: [feature]
status: active
steps:
  - id: shoot
    type: agent_execution
    requires:
      captures:
        - name: home-shot
          kind: screenshot
    next: [done]
  - id: done
    type: terminal
`;

function setup() {
  workflow.register(ctx(), YAML);
  const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
  const run = workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'capwf', agent: 'claude' });
  return { wi, run };
}

describe('step.complete --image-file evidence binding', () => {
  it('ingests a screenshot, links it as evidence, embeds it in the output doc, and satisfies the gate', () => {
    const { wi, run } = setup();
    const blob = putBlob(dir, PNG);
    const view = step.complete(ctx(), { run: run.id, step: 'shoot', agent: 'claude', imageBlob: blob, imageKind: 'screenshot', imageAlt: 'home' });
    expect(view).toBeTruthy();

    const imgs = image.list(ctx(), { workItem: wi.id });
    expect(imgs.items.length).toBe(1);
    const imgId = imgs.items[0].id;

    const out = storage.transaction('deferred', (tx) => {
      const sr: any = tx.get("SELECT output_artifact_id FROM workflow_step_runs WHERE workflow_run_id=? AND step_id='shoot'", run.id);
      return tx.get('SELECT type, body FROM artifacts WHERE id=?', sr.output_artifact_id);
    }) as any;
    expect(out.type).toBe('review');
    expect(out.body).toContain(`apm:${imgId}`);
  });
});

describe('capture gate on step completion', () => {
  it('blocks completion when a required capture has no evidence image', () => {
    const { run } = setup();
    expect(() => step.complete(ctx(), { run: run.id, step: 'shoot', agent: 'claude' }))
      .toThrow(/missing required captures: home-shot/);
  });

  it('allows completion once a matching evidence image is linked', () => {
    const { wi, run } = setup();
    image.add(ctx(), { workItem: wi.id, kind: 'screenshot', alt: 'home', relation: 'evidence', agent: 'claude', blob: putBlob(dir, PNG) });
    const view = step.complete(ctx(), { run: run.id, step: 'shoot', agent: 'claude' });
    expect(view).toBeTruthy();
  });
});
