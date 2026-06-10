import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { apiGet, apiMutate } from './client';

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

describe('apiMutate', () => {
  const meta = { api_version: 1, command: 'c', ts: 't' };

  it('POSTs with the CSRF header + JSON body and returns typed data', async () => {
    const fetchMock = vi.fn(async () => env({ ok: true, data: { x: 7 }, error: null, meta }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await apiMutate('/p', { y: 1 }, D, 'TOK')).toEqual({ x: 7 });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-apm-csrf']).toBe('TOK');
    expect(init.body).toBe(JSON.stringify({ y: 1 }));
  });

  it('maps a 403 to E_CSRF so callers can refetch + retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({}), status: 403 } as Response)));
    await expect(apiMutate('/p', {}, D, 'STALE')).rejects.toMatchObject({ code: 'E_CSRF', status: 403 });
  });

  it('throws the business code on ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => env({ ok: false, data: null, error: { code: 'E_INVALID_STATE', message: 'no', retryable: false }, meta })));
    await expect(apiMutate('/p', {}, D, 'TOK')).rejects.toMatchObject({ code: 'E_INVALID_STATE' });
  });

  it('throws E_CONTRACT when the response data fails the schema', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => env({ ok: true, data: { x: 'nope' }, error: null, meta })));
    await expect(apiMutate('/p', {}, D, 'TOK')).rejects.toMatchObject({ code: 'E_CONTRACT' });
  });

  it('throws E_NETWORK when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    await expect(apiMutate('/p', {}, D, 'TOK')).rejects.toMatchObject({ code: 'E_NETWORK' });
  });
});
