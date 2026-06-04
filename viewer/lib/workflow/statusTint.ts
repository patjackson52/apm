const KEYS = new Set(['pending', 'running', 'completed', 'failed', 'skipped']);

/** CSS-class key for a step-run status; unknown -> 'unknown' (never throws). */
export function stepStatusTintKey(status: string): string {
  return KEYS.has(status) ? status : 'unknown';
}

export const STEP_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  skipped: 'Skipped',
};
