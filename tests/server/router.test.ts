import { describe, it, expect } from 'vitest';
import { matchRoute, matchPattern, type Route } from '../../src/server/router.js';

const ROUTES: Route[] = [
  { method: 'GET', pattern: '/api/status', run: () => 'status' },
  { method: 'GET', pattern: '/api/work/:id', run: () => 'work' },
];

describe('router', () => {
  it('matchPattern extracts named params', () => {
    expect(matchPattern('/api/work/:id', '/api/work/WI-1')).toEqual({ id: 'WI-1' });
    expect(matchPattern('/api/status', '/api/status')).toEqual({});
    expect(matchPattern('/api/work/:id', '/api/work')).toBeNull();
  });
  it('matches GET routes with params', () => {
    const m = matchRoute(ROUTES, 'GET', '/api/work/WI-1');
    expect('route' in m && m.params).toEqual({ id: 'WI-1' });
  });
  it('404 for unknown path', () => {
    expect(matchRoute(ROUTES, 'GET', '/api/nope')).toEqual({ status: 404 });
  });
  it('405 for known path, wrong method', () => {
    expect(matchRoute(ROUTES, 'POST', '/api/status')).toEqual({ status: 405 });
  });
});
