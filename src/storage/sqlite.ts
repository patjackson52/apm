import Database from 'better-sqlite3';
import type { Clock } from '../domain/clock.js';
import { formatId, type IdPrefix } from '../domain/ids.js';
import { runMigrations } from './migrations.js';
import type { EventInput, Storage, Tx, TxMode } from './storage.js';

export class SqliteStorage implements Storage {
  private readonly db: Database.Database;

  constructor(path: string, private readonly clock: Clock) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    runMigrations(this.db);
  }

  transaction<T>(mode: TxMode, fn: (tx: Tx) => T): T {
    const tx = this.makeTx();
    const wrapped = this.db.transaction(() => fn(tx));
    return mode === 'immediate' ? wrapped.immediate() : wrapped.deferred();
  }

  close(): void {
    this.db.close();
  }

  private makeTx(): Tx {
    const db = this.db;
    const clock = this.clock;
    const tx: Tx = {
      run: (sql, ...params) => { db.prepare(sql).run(...(params as never[])); },
      get: <R>(sql: string, ...params: unknown[]) => db.prepare(sql).get(...(params as never[])) as R | undefined,
      all: <R>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as never[])) as R[],
      now: () => clock.now(),
      allocateId: (prefix: IdPrefix) => {
        const row = db.prepare(
          `INSERT INTO sequences (prefix, next_value) VALUES (?, 1)
           ON CONFLICT(prefix) DO UPDATE SET next_value = next_value + 1
           RETURNING next_value`,
        ).get(prefix) as { next_value: number };
        return formatId(prefix, row.next_value);
      },
      appendEvent: (input: EventInput) => {
        const id = tx.allocateId('EV');
        db.prepare(
          `INSERT INTO events (id, actor_id, event_type, entity_type, entity_id, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          input.actorId ?? null,
          input.eventType,
          input.entityType,
          input.entityId,
          input.payload === undefined ? null : JSON.stringify(input.payload),
          clock.now(),
        );
        return id;
      },
    };
    return tx;
  }
}
