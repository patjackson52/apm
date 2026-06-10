import { envelopeSchema } from '@apm/types';
import type { ZodType } from 'zod';

// Same-origin by default: the browser hits the Next server, which proxies /api/* to
// the daemon (see next.config.ts). Set NEXT_PUBLIC_APM_API_BASE to target it directly.
export const API_BASE = process.env.NEXT_PUBLIC_APM_API_BASE ?? '';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/** GET + unwrap the {ok,data,error,meta} envelope + runtime-validate data via @apm/types. */
export async function apiGet<T>(path: string, schema: ZodType<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { method: 'GET', credentials: 'omit' });
  } catch (e) {
    throw new ApiError('E_NETWORK', String((e as Error)?.message ?? e));
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError('E_HTTP', `non-JSON response (${res.status})`, res.status);
  }
  const parsed = envelopeSchema(schema).safeParse(json);
  if (!parsed.success) {
    const summary = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ApiError('E_CONTRACT', summary, res.status);
  }
  const env = parsed.data as unknown as { ok: boolean; data: T | null; error: { code: string; message: string } | null };
  if (env.ok === false) {
    throw new ApiError(env.error?.code ?? 'E_UNKNOWN', env.error?.message ?? 'request failed', res.status);
  }
  return env.data as T;
}

/** POST a write + unwrap the envelope + validate via @apm/types. Sends the CSRF token
 *  (`X-APM-CSRF`) the daemon requires on writes. Throws ApiError on transport/contract/
 *  business failure; a 403 maps to code 'E_CSRF' so callers can refetch the token + retry. */
export async function apiMutate<T>(path: string, body: unknown, schema: ZodType<T>, token: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-apm-csrf': token },
      body: JSON.stringify(body ?? {}),
      credentials: 'omit',
    });
  } catch (e) {
    throw new ApiError('E_NETWORK', String((e as Error)?.message ?? e));
  }
  if (res.status === 403) {
    // Write guard rejected the token (stale/rotated daemon). Distinct code → caller refetches + retries.
    throw new ApiError('E_CSRF', 'csrf token rejected', 403);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError('E_HTTP', `non-JSON response (${res.status})`, res.status);
  }
  const parsed = envelopeSchema(schema).safeParse(json);
  if (!parsed.success) {
    const summary = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ApiError('E_CONTRACT', summary, res.status);
  }
  const env = parsed.data as unknown as { ok: boolean; data: T | null; error: { code: string; message: string } | null };
  if (env.ok === false) {
    throw new ApiError(env.error?.code ?? 'E_UNKNOWN', env.error?.message ?? 'write failed', res.status);
  }
  return env.data as T;
}
