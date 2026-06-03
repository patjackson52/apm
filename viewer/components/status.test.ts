import { describe, it, expect } from 'vitest';
import { STORED_STATUSES, STATUS_META, type WorkStatus } from './status';

describe('status vocabulary', () => {
  it('STORED_STATUSES is exactly the 5 apm-core stored statuses', () => {
    expect([...STORED_STATUSES]).toEqual(['draft', 'ready', 'blocked', 'completed', 'cancelled']);
  });
  it('WorkStatus is a superset: all 5 stored are valid + active is a member (not equality)', () => {
    const all: WorkStatus[] = [...STORED_STATUSES, 'active'];
    for (const s of STORED_STATUSES) expect(STATUS_META[s]).toBeTruthy();
    expect(STATUS_META.active).toBeTruthy();
    expect(Object.keys(STATUS_META).sort()).toEqual([...all].sort());
  });
});
