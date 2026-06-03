import { ApmError, type ErrorCode } from '../domain/errors.js';

/** APM error code → HTTP status for the read API. */
export const CODE_HTTP: Record<ErrorCode, number> = {
  E_VALIDATION: 400,
  E_CONFLICT: 409,
  E_PRECONDITION: 409,
  E_LEASE_CONFLICT: 409,
  E_BLOCKED: 409,
  E_AWAITING_HUMAN: 409,
  E_NOT_FOUND: 404,
  E_INTERNAL: 500,
};

/** HTTP status for any thrown value (non-ApmError → 500). */
export function httpStatusFor(err: unknown): number {
  return err instanceof ApmError ? CODE_HTTP[err.code] : 500;
}
