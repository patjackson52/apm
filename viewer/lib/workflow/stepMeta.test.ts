import { describe, it, expect } from 'vitest';
import { STEP_META, STEP_TYPES, metaFor, tintKey } from './stepMeta';

describe('STEP_META', () => {
  it('has an entry for all 10 step types', () => {
    expect(STEP_TYPES).toHaveLength(10);
    for (const t of STEP_TYPES) {
      expect(STEP_META[t]).toBeDefined();
      expect(STEP_META[t].label).toBeTruthy();
    }
  });

  it('resolves the previously-missing types without crashing', () => {
    expect(metaFor('integration_loop').label).toBe('Integration Loop');
    expect(metaFor('manual').label).toBe('Manual');
  });

  it('returns a neutral fallback for unknown types (no throw)', () => {
    expect(() => metaFor('totally_unknown')).not.toThrow();
    expect(metaFor('totally_unknown').label).toBe('Step');
    expect(tintKey('totally_unknown')).toBe('unknown');
    expect(tintKey('review_gate')).toBe('review_gate');
  });
});
