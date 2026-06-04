import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initProject } from '../../src/usecases/init.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { systemClock, fixedClock } from '../../src/domain/clock.js';
import * as work from '../../src/usecases/work.js';
import * as wf from '../../src/usecases/workflow.js';
import * as policy from '../../src/usecases/policy.js';
import * as next from '../../src/usecases/next.js';

// Repo (worktree) root — where package.json + scripts/ live. Computed from this
// file's URL so the child-process cwd is correct regardless of vitest's cwd.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const execFileAsync = promisify(execFile);

let dir: string;
const clock = systemClock; // real wall-clock — fixedClock cannot model true concurrency

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm-cc-'));
  initProject(dir, clock);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Seed N feature work items each with a running feature_delivery run, and raise
 *  the global fleet cap so N independent agents can each take a slot. */
function seed(n: number): { dbPath: string; ids: string[] } {
  const dbPath = join(dir, '.apm', 'apm.db');
  const s = new SqliteStorage(dbPath, clock);
  const ids: string[] = [];
  try {
    for (let i = 0; i < n; i++) {
      const wi = work.create({ storage: s, clock }, { type: 'feature', title: `F${i}`, agent: 'seed' });
      wf.attachRun({ storage: s, clock }, { workItem: wi.id, workflow: 'feature_delivery', agent: 'seed' });
      ids.push(wi.id);
    }
    // Raise the fleet cap to N via a global policy row so all N agents get a slot.
    policy.create({ storage: s, clock }, {
      scopeType: 'global',
      policyJson: JSON.stringify({ max_parallel_agents: n }),
    });
  } finally {
    s.close();
  }
  return { dbPath, ids };
}

describe('multi-process dispatch', () => {
  // Headline invariants, deterministically: N separate OS processes hit one WAL
  // db; each takes a distinct item, no ERR (no uncaught SQLITE_BUSY), no item
  // taken twice. Sequential execFileSync still proves uniqueness + no-error
  // because each child opens its own connection on the shared WAL file and the
  // claim-walk / slot governor see each other's committed leases.
  it('N agents take M ready items with no double-lease, no uncaught SQLITE_BUSY (sequential)', () => {
    const N = 6;
    const { dbPath } = seed(N);

    const outs: string[] = [];
    for (let i = 0; i < N; i++) {
      const out = execFileSync('npx', ['tsx', 'scripts/next-once.ts', dbPath, `agent-${i}`], {
        encoding: 'utf8',
        cwd: repoRoot,
        timeout: 60000, // tsx cold-start is slow
      });
      outs.push(out.trim());
    }

    const taken = outs.filter((o) => o.startsWith('OK ')).map((o) => o.slice(3));
    expect(outs.some((o) => o.startsWith('ERR'))).toBe(false);
    expect(new Set(taken).size).toBe(taken.length); // no item taken twice
    expect(taken.length).toBe(N); // 6 agents, 6 items, cap 6 → all dispatch
  });

  // Concurrent variant — fires all N children simultaneously (Promise.all) so the
  // claim-walk's SQLITE_BUSY / UNIQUE handling is actually exercised under real
  // contention, not just sequential commits. Same invariants. If this proves
  // flaky on a given machine the sequential test above remains the authority.
  it('N agents racing concurrently take M items with no double-lease, no uncaught SQLITE_BUSY (concurrent)', async () => {
    const N = 6;
    const { dbPath } = seed(N);

    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        execFileAsync('npx', ['tsx', 'scripts/next-once.ts', dbPath, `agent-${i}`], {
          encoding: 'utf8',
          cwd: repoRoot,
          timeout: 60000,
        }).then((r) => r.stdout.trim()),
      ),
    );

    const taken = results.filter((o) => o.startsWith('OK ')).map((o) => o.slice(3));
    expect(results.some((o) => o.startsWith('ERR'))).toBe(false);
    expect(new Set(taken).size).toBe(taken.length); // no item taken twice
    expect(taken.length).toBe(N);
  }, 90000);
});

// Same-process, two distinct SqliteStorage handles on one db file (mirrors the
// plan4-loop "TEST B" pattern). Two distinct ready items → two distinct agents
// must dispatch DIFFERENT items, and exactly two active work_item leases exist.
// Two handles in one process is synchronous, so fixedClock is fine here.
describe('same-process two-handle dispatch', () => {
  const fc = fixedClock('2026-06-02T12:00:00.000Z');
  let h2dir: string;

  beforeEach(() => {
    h2dir = mkdtempSync(join(tmpdir(), 'apm-cc2h-'));
    initProject(h2dir, fc);
  });
  afterEach(() => {
    rmSync(h2dir, { recursive: true, force: true });
  });

  it('two agents on two handles dispatch different items; exactly two active leases', () => {
    const dbPath = join(h2dir, '.apm', 'apm.db');
    const seedS = new SqliteStorage(dbPath, fc);
    try {
      for (let i = 0; i < 2; i++) {
        const wi = work.create({ storage: seedS, clock: fc }, { type: 'feature', title: `H${i}`, agent: 'seed' });
        wf.attachRun({ storage: seedS, clock: fc }, { workItem: wi.id, workflow: 'feature_delivery', agent: 'seed' });
      }
    } finally {
      seedS.close();
    }

    const storageA = new SqliteStorage(dbPath, fc);
    const storageB = new SqliteStorage(dbPath, fc);
    try {
      const r1 = next.next({ storage: storageA, clock: fc }, {
        agent: 'agentA', capabilities: [], match: 'any', acquire: true, session: 'SA',
      });
      const r2 = next.next({ storage: storageB, clock: fc }, {
        agent: 'agentB', capabilities: [], match: 'any', acquire: true, session: 'SB',
      });

      expect(r1.status).toBe('dispatched');
      expect(r2.status).toBe('dispatched');
      if (r1.status === 'dispatched' && r2.status === 'dispatched') {
        expect(r1.data.work_item).not.toBe(r2.data.work_item);
      }

      const activeLeaseCount = storageA.transaction('deferred', (tx) => {
        const row = tx.get<{ c: number }>(
          "SELECT count(*) c FROM leases WHERE resource_type='work_item' AND status='active'",
        );
        return row?.c ?? 0;
      });
      expect(activeLeaseCount).toBe(2);
    } finally {
      storageA.close();
      storageB.close();
    }
  });
});
