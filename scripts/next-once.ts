/**
 * Child driver for the multi-process concurrency harness.
 *
 * Opens ONE WAL SQLite db, dispatches exactly one work item via `next.next`
 * (acquire mode → real work-item lease + fleet slot), then prints a single line:
 *   OK <work_item>   — dispatched, lease acquired
 *   IDLE <reason>    — nothing dispatchable for this agent right now
 *   ERR <code>       — an uncaught error (e.g. an SQLITE_BUSY that escaped)
 * and exits. Run as: `npx tsx scripts/next-once.ts <dbPath> <agent>`.
 *
 * Note: `systemClock` is a Clock const here (not a factory), so we use it directly.
 * We pass an explicit `session: S-<agent>` string; next.ts only sets a lease
 * session_id when that session row exists (FK guard), so a non-existent id is
 * tolerated and the lease is recorded with session_id = NULL.
 */
import { SqliteStorage } from '../src/storage/sqlite.js';
import { systemClock } from '../src/domain/clock.js';
import * as next from '../src/usecases/next.js';

const [dbPath, agent] = process.argv.slice(2);
const clock = systemClock;
const storage = new SqliteStorage(dbPath, clock);
try {
  const r = next.next(
    { storage, clock },
    { agent, capabilities: [], match: 'any', acquire: true, session: `S-${agent}` },
  );
  process.stdout.write(
    r.status === 'dispatched'
      ? `OK ${r.data.work_item}\n`
      : `${r.status === 'idle' ? 'IDLE' : r.status.toUpperCase()} ${'reason' in r ? r.reason : r.status}\n`,
  );
} catch (e: any) {
  process.stdout.write(`ERR ${e?.code ?? e?.message}\n`);
  process.exitCode = 1;
} finally {
  storage.close();
}
