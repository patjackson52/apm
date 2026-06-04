import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadRegistry, ensureRegistered, resolveProjectDir, listProjects } from '../../src/server/registry.js';

let home: string;
let projA: string;
let projB: string;

beforeAll(() => {
  home = realpathSync(mkdtempSync(path.join(tmpdir(), 'apm-home-')));
  projA = realpathSync(mkdtempSync(path.join(tmpdir(), 'apm-projA-')));
  projB = realpathSync(mkdtempSync(path.join(tmpdir(), 'apm-projB-')));
  mkdirSync(path.join(home, '.apm'), { recursive: true });
  writeFileSync(path.join(home, '.apm', 'projects.json'), JSON.stringify([{ id: 'a', name: 'A', path: projA }]));
});
afterAll(() => { for (const d of [home, projA, projB]) rmSync(d, { recursive: true, force: true }); });

describe('registry', () => {
  it('loadRegistry returns [] when the file is absent', () => {
    const empty = realpathSync(mkdtempSync(path.join(tmpdir(), 'apm-empty-')));
    expect(loadRegistry(empty)).toEqual([]);
    rmSync(empty, { recursive: true, force: true });
  });
  it('loadRegistry parses the registry array', () => {
    expect(loadRegistry(home)).toEqual([{ id: 'a', name: 'A', path: projA }]);
  });
  it('ensureRegistered adds the served root, dedupes by realpath', () => {
    const reg = ensureRegistered(loadRegistry(home), projB);
    expect(reg).toHaveLength(2);
    expect(ensureRegistered(reg, projA)).toHaveLength(2); // projA already present -> no-op
  });
  it('resolveProjectDir: known id -> its path; unknown/../null -> default', () => {
    const reg = loadRegistry(home);
    expect(resolveProjectDir(reg, 'a', projB)).toBe(projA);
    expect(resolveProjectDir(reg, 'bogus', projB)).toBe(projB);
    expect(resolveProjectDir(reg, '../etc/passwd', projB)).toBe(projB);
    expect(resolveProjectDir(reg, null, projB)).toBe(projB);
  });
  it('listProjects marks current via realpath of the project root', () => {
    const view = listProjects(loadRegistry(home), projA);
    expect(view.find((p) => p.id === 'a')!.current).toBe(true);
  });
});
