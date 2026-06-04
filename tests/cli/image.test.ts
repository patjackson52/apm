import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { fixedClock } from '../../src/domain/clock.js';
import { resolveProjectRoot } from '../../src/cli/run.js';

const clock = fixedClock('2026-06-04T12:00:00.000Z');
let dir: string;
beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'apm-cli-img-'))); initProject(dir, clock); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('resolveProjectRoot', () => {
  it('returns the dir containing .apm when --dir is explicit', () => {
    expect(resolveProjectRoot(dir)).toBe(dir);
  });
});
