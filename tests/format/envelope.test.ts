import { describe, it, expect } from 'vitest';
import { ok, fail, buildMeta } from '../../src/format/envelope.js';
import { ApmError } from '../../src/domain/errors.js';
import { fixedClock } from '../../src/domain/clock.js';

const clock = fixedClock('2026-06-02T12:00:00.000Z');

describe('envelope', () => {
  it('builds an ok envelope', () => {
    const env = ok({ id: 'WI-1' }, buildMeta('work show', clock, 'S-1'));
    expect(env).toEqual({
      ok: true, data: { id: 'WI-1' }, error: null,
      meta: { api_version: 1, command: 'work show', ts: '2026-06-02T12:00:00.000Z', actor_session: 'S-1' },
    });
  });

  it('builds a fail envelope from ApmError with issues', () => {
    const e = new ApmError('E_VALIDATION', 'bad', [{ field: 'x', problem: 'nope' }]);
    const env = fail(e, buildMeta('work create', clock));
    expect(env.ok).toBe(false);
    expect(env.data).toBeNull();
    expect(env.error).toEqual({ code: 'E_VALIDATION', message: 'bad', retryable: false, issues: [{ field: 'x', problem: 'nope' }] });
    expect(env.meta.actor_session).toBeUndefined();
  });

  it('omits issues when absent', () => {
    const env = fail(new ApmError('E_NOT_FOUND', 'missing'), buildMeta('work show', clock));
    expect(env.error).toEqual({ code: 'E_NOT_FOUND', message: 'missing', retryable: false });
  });
});
