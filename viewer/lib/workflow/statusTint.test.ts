import { describe, it, expect } from 'vitest';
import { stepStatusTintKey, STEP_STATUS_LABEL } from './statusTint';

describe('stepStatusTintKey', () => {
  it('maps the 5 statuses to distinct keys', () => {
    const ks = ['pending', 'running', 'completed', 'failed', 'skipped'].map(stepStatusTintKey);
    expect(new Set(ks).size).toBe(5);
    expect(STEP_STATUS_LABEL.failed).toBe('Failed');
  });
  it('falls back to unknown', () => {
    expect(stepStatusTintKey('weird')).toBe('unknown');
  });
});
