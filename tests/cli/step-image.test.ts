// tests/cli/step-image.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { fixedClock } from '../../src/domain/clock.js';
import { buildProgram } from '../../src/cli/program.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import * as work from '../../src/usecases/work.js';
import * as workflow from '../../src/usecases/workflow.js';

const clock = fixedClock('2026-06-04T12:00:00.000Z');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let dir: string;
beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'apm-stepimg-'))); initProject(dir, clock); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function runCli(args: string[]): { out: string } {
  const lines: string[] = [];
  const program = buildProgram({ clock, out: (s) => lines.push(s), defaultFormat: 'json' });
  const orig = process.exitCode;
  program.parse(['--dir', dir, ...args], { from: 'user' });
  process.exitCode = orig;
  return { out: lines.join('\n') };
}

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

describe('apm step complete --image-file', () => {
  it('completes a capture-gated step by attaching a screenshot', () => {
    const storage = new SqliteStorage(join(dir, '.apm', 'apm.db'), clock);
    workflow.register({ storage, clock }, YAML);
    const wi = work.create({ storage, clock }, { type: 'feature', title: 'F', agent: 'claude' });
    const run = workflow.attachRun({ storage, clock }, { workItem: wi.id, workflow: 'capwf', agent: 'claude' });
    storage.close();
    const png = join(dir, 'shot.png');
    writeFileSync(png, PNG);

    const res = JSON.parse(runCli(['step', 'complete', run.id, 'shoot', '--image-file', png, '--image-kind', 'screenshot', '--image-alt', 'home', '--agent', 'claude']).out);
    expect(res.ok).toBe(true);
  });
});
