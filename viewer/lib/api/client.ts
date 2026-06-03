import { envelopeSchema } from '@apm/types';
import type { ZodType } from 'zod';

export const API_BASE = process.env.NEXT_PUBLIC_APM_API_BASE ?? 'http://127.0.0.1:7842';

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
