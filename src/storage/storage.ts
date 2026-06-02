import type { IdPrefix } from '../domain/ids.js';

export interface EventInput {
  actorId?: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  payload?: unknown;
}

/** Query surface available inside a transaction. */
export interface Tx {
  run(sql: string, ...params: unknown[]): void;
  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined;
  all<T = unknown>(sql: string, ...params: unknown[]): T[];
  /** Allocate the next monotonic id for a prefix (e.g. 'WI' -> 'WI-1'). */
  allocateId(prefix: IdPrefix): string;
  /** Append an audit event; returns the event id. */
  appendEvent(input: EventInput): string;
  /** Current time from the injected clock (UTC ISO-Z). */
  now(): string;
}

export type TxMode = 'deferred' | 'immediate';

export interface Storage {
  transaction<T>(mode: TxMode, fn: (tx: Tx) => T): T;
  close(): void;
}
