import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { apiGet } from './client';

const D = z.object({ x: z.number() });
const env = (body: unknown) => ({ json: async () => body, status: 200 } as Response);

afterEach(() => vi.restoreAllMocks());

describe('apiGet', () => {
  it('returns typed data on a valid envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => env({ ok: true, data: { x: 1 }, error: null, meta: { api_version: 1, command: 'c', ts: 't' } })));
    expect(await apiGet('/p', D)).toEqual({ x: 1 });
  });
  it('throws ApiError with the business error code on ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => env({ ok: false, data: null, error: { code: 'E_NOT_FOUND', message: 'nope', retryable: false }, meta: { api_version: 1, command: 'c', ts: 't' } })));
    await expect(apiGet('/p', D)).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });
  it('throws E_CONTRACT when data fails the schema', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => env({ ok: true, data: { x: 'no' }, error: null, meta: { api_version: 1, command: 'c', ts: 't' } })));
    await expect(apiGet('/p', D)).rejects.toMatchObject({ code: 'E_CONTRACT' });
  });
  it('throws E_NETWORK when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    await expect(apiGet('/p', D)).rejects.toMatchObject({ code: 'E_NETWORK' });
  });
  it('throws E_HTTP on non-JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => { throw new Error('bad'); }, status: 502 } as unknown as Response)));
    await expect(apiGet('/p', D)).rejects.toMatchObject({ code: 'E_HTTP', status: 502 });
  });
  it('surfaces the business code on a non-2xx that still carries an error envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: false, data: null, error: { code: 'E_VALIDATION', message: 'bad', retryable: false }, meta: { api_version: 1, command: 'c', ts: 't' } }), status: 400 } as Response)));
    await expect(apiGet('/p', D)).rejects.toMatchObject({ code: 'E_VALIDATION', status: 400 });
  });
});
