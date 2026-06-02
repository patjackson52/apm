export type ErrorCode =
  | 'E_VALIDATION' | 'E_NOT_FOUND' | 'E_LEASE_CONFLICT'
  | 'E_PRECONDITION' | 'E_BLOCKED' | 'E_AWAITING_HUMAN'
  | 'E_CONFLICT' | 'E_INTERNAL';

export interface Issue { field: string; problem: string; got?: unknown; }

export const CODE_EXIT: Record<ErrorCode, number> = {
  E_LEASE_CONFLICT: 10,
  E_PRECONDITION: 20,
  E_BLOCKED: 20,
  E_AWAITING_HUMAN: 20,
  E_VALIDATION: 40,
  E_CONFLICT: 40,
  E_NOT_FOUND: 44,
  E_INTERNAL: 75,
};

const RETRYABLE: ReadonlySet<ErrorCode> = new Set(['E_LEASE_CONFLICT', 'E_INTERNAL']);

export class ApmError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly issues?: Issue[];
  constructor(code: ErrorCode, message: string, issues?: Issue[]) {
    super(message);
    this.name = 'ApmError';
    this.code = code;
    this.retryable = RETRYABLE.has(code);
    this.issues = issues;
  }
}

/** Exit code for any thrown value (non-ApmError → 75 internal). */
export function exitFor(err: unknown): number {
  return err instanceof ApmError ? CODE_EXIT[err.code] : 75;
}
