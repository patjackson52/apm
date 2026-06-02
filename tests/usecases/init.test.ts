import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/usecases/init.js';
import { fixedClock } from '../../src/domain/clock.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('initProject', () => {
  it('creates .apm with a db and config', () => {
    const res = initProject(dir, fixedClock('2026-06-02T12:00:00.000Z'));
    expect(res.created).toBe(true);
    expect(existsSync(join(dir, '.apm', 'apm.db'))).toBe(true);
    expect(existsSync(join(dir, '.apm', 'config.yaml'))).toBe(true);
    expect(readFileSync(join(dir, '.apm', 'config.yaml'), 'utf8')).toMatch(/capabilities:/);
  });

  it('is idempotent — second run reports already-initialized', () => {
    initProject(dir, fixedClock('2026-06-02T12:00:00.000Z'));
    const res = initProject(dir, fixedClock('2026-06-02T12:00:00.000Z'));
    expect(res.created).toBe(false);
  });
});
