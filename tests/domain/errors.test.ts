import { describe, it, expect } from 'vitest';
import { ApmError, CODE_EXIT, exitFor } from '../../src/domain/errors.js';

describe('errors', () => {
  it('carries code, message, retryable', () => {
    const e = new ApmError('E_NOT_FOUND', 'WI-9 not found');
    expect(e.code).toBe('E_NOT_FOUND');
    expect(e.retryable).toBe(false);
    expect(e.message).toBe('WI-9 not found');
  });

  it('marks lease conflict retryable', () => {
    expect(new ApmError('E_LEASE_CONFLICT', 'held').retryable).toBe(true);
  });

  it('maps codes to exit codes', () => {
    expect(CODE_EXIT.E_VALIDATION).toBe(40);
    expect(CODE_EXIT.E_NOT_FOUND).toBe(44);
    expect(CODE_EXIT.E_LEASE_CONFLICT).toBe(10);
    expect(CODE_EXIT.E_INTERNAL).toBe(75);
  });

  it('exitFor returns 75 for unknown/non-ApmError', () => {
    expect(exitFor(new Error('boom'))).toBe(75);
    expect(exitFor(new ApmError('E_VALIDATION', 'x'))).toBe(40);
  });

  it('carries validation issues', () => {
    const e = new ApmError('E_VALIDATION', 'bad', [{ field: 'estimate', problem: 'must be XS|S|M|L|XL', got: 'XXL' }]);
    expect(e.issues?.[0].field).toBe('estimate');
  });
});
