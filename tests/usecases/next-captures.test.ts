import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as workflow from '../../src/usecases/workflow.js';
import * as next from '../../src/usecases/next.js';

const clock = fixedClock('2026-06-04T12:00:00.000Z');
let dir: string; let storage: SqliteStorage;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-nextcap-')); initProject(dir, clock); storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock); });
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
          route: /home
          viewport: { w: 1280, h: 800 }
          prompt: capture-home
    next: [done]
  - id: done
    type: terminal
`;

describe('required_captures in next payload', () => {
  it('includes capture specs for the dispatched step', () => {
    workflow.register(ctx(), YAML);
    const wi = work.create(ctx(), { type: 'feature', title: 'F', agent: 'claude' });
    workflow.attachRun(ctx(), { workItem: wi.id, workflow: 'capwf', agent: 'claude' });
    const r = next.next(ctx(), { agent: 'claude', capabilities: [], match: 'any' });
    expect(r.data.required_captures).toEqual([
      { name: 'home-shot', kind: 'screenshot', route: '/home', viewport: { w: 1280, h: 800 }, prompt: 'capture-home' },
    ]);
  });
});
