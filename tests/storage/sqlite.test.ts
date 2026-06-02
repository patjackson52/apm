import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { fixedClock } from '../../src/domain/clock.js';

function mem() {
  return new SqliteStorage(':memory:', fixedClock('2026-06-02T12:00:00.000Z'));
}

describe('SqliteStorage', () => {
  it('runs migrations on open', () => {
    const s = mem();
    const ok = s.transaction('deferred', (tx) =>
      tx.get<{ c: number }>("SELECT count(*) c FROM sqlite_master WHERE name='work_items'"));
    expect(ok!.c).toBe(1);
    s.close();
  });

  it('allocates gap-free-per-prefix monotonic ids', () => {
    const s = mem();
    const ids = s.transaction('immediate', (tx) => [tx.allocateId('WI'), tx.allocateId('WI'), tx.allocateId('ART')]);
    expect(ids).toEqual(['WI-1', 'WI-2', 'ART-1']);
    s.close();
  });

  it('appends an event with an allocated id and the clock timestamp', () => {
    const s = mem();
    const evId = s.transaction('immediate', (tx) =>
      tx.appendEvent({ actorId: 'A', eventType: 'created', entityType: 'work_item', entityId: 'WI-1', payload: { a: 1 } }));
    expect(evId).toBe('EV-1');
    const ev = s.transaction('deferred', (tx) => tx.get<any>('SELECT * FROM events WHERE id=?', 'EV-1'));
    expect(ev.created_at).toBe('2026-06-02T12:00:00.000Z');
    expect(JSON.parse(ev.payload_json)).toEqual({ a: 1 });
    s.close();
  });

  it('rolls back the whole transaction on throw — no partial id burn visible', () => {
    const s = mem();
    expect(() => s.transaction('immediate', (tx) => { tx.allocateId('WI'); throw new Error('boom'); })).toThrow('boom');
    const next = s.transaction('immediate', (tx) => tx.allocateId('WI'));
    expect(next).toBe('WI-1');
    s.close();
  });
});
