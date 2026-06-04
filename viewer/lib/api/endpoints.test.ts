import { describe, it, expect } from 'vitest';
import { ep } from './endpoints';
import { StatusViewSchema } from '@apm/types';
import { qk } from './keys';

describe('endpoints', () => {
  it('builds paths incl. query strings', () => {
    expect(ep.work.path({ status: 'ready', limit: 10 })).toBe('/api/work?status=ready&limit=10');
    expect(ep.work.path()).toBe('/api/work');
    expect(ep.workItem.path('WI-1')).toBe('/api/work/WI-1');
    expect(ep.runSteps.path('WR-1')).toBe('/api/runs/WR-1/steps');
    expect(ep.blockers.path('WI-2')).toBe('/api/blockers?work-item=WI-2');
    expect(ep.leases.path()).toBe('/api/leases');
  });
  it('status maps to StatusViewSchema', () => {
    expect(ep.status.schema).toBe(StatusViewSchema);
  });
});

describe('keys', () => {
  it('are stable serializable arrays, distinct per args', () => {
    expect(qk.status()).toEqual(['status']);
    expect(qk.workItem('WI-1')).toEqual(['work', 'WI-1']);
    expect(JSON.stringify(qk.work({ status: 'ready' }))).toBe('["work",{"status":"ready"}]');
    expect(qk.blockers()).toEqual(['blockers', null]);
  });
});

describe('image endpoints', () => {
  it('builds image endpoint paths', () => {
    expect(ep.workImages.path('WI-1')).toBe('/api/work/WI-1/images');
    expect(ep.image.path('IMG-2')).toBe('/api/images/IMG-2');
    expect(ep.imageVersions.path('IMG-2')).toBe('/api/images/IMG-2/versions');
  });
});
