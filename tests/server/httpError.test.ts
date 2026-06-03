import { describe, it, expect } from 'vitest';
import { CODE_HTTP, httpStatusFor } from '../../src/server/httpError.js';
import { ApmError } from '../../src/domain/errors.js';

describe('httpError', () => {
  it('maps each code to a status', () => {
    expect(CODE_HTTP.E_NOT_FOUND).toBe(404);
    expect(CODE_HTTP.E_VALIDATION).toBe(400);
    expect(CODE_HTTP.E_CONFLICT).toBe(409);
    expect(CODE_HTTP.E_PRECONDITION).toBe(409);
    expect(CODE_HTTP.E_INTERNAL).toBe(500);
  });
  it('httpStatusFor: ApmError → mapped; other → 500', () => {
    expect(httpStatusFor(new ApmError('E_NOT_FOUND', 'x'))).toBe(404);
    expect(httpStatusFor(new Error('boom'))).toBe(500);
  });
});
