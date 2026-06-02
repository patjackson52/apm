import type { Clock } from '../domain/clock.js';
import { ApmError } from '../domain/errors.js';

export interface Meta { api_version: 1; command: string; ts: string; actor_session?: string; note?: string; stale?: boolean; [key: string]: unknown; }
export interface ErrorBody { code: string; message: string; retryable: boolean; issues?: { field: string; problem: string; got?: unknown }[]; }
export interface Envelope<T> { ok: boolean; data: T | null; error: ErrorBody | null; meta: Meta; }

export function buildMeta(command: string, clock: Clock, session?: string): Meta {
  const meta: Meta = { api_version: 1, command, ts: clock.now() };
  if (session) meta.actor_session = session;
  return meta;
}

export function ok<T>(data: T, meta: Meta): Envelope<T> {
  return { ok: true, data, error: null, meta };
}

export function fail(err: ApmError, meta: Meta): Envelope<never> {
  const error: ErrorBody = { code: err.code, message: err.message, retryable: err.retryable };
  if (err.issues) error.issues = err.issues;
  return { ok: false, data: null, error, meta };
}
