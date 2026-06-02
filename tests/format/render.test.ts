import { describe, it, expect } from 'vitest';
import { render } from '../../src/format/render.js';
import { ok, fail, buildMeta } from '../../src/format/envelope.js';
import { ApmError } from '../../src/domain/errors.js';
import { fixedClock } from '../../src/domain/clock.js';
import { parse as parseYaml } from 'yaml';

const clock = fixedClock('2026-06-02T12:00:00.000Z');
const env = ok({ id: 'WI-1', title: 'Offline', status: 'ready' }, buildMeta('work show', clock, 'S-1'));

describe('render', () => {
  it('json round-trips the envelope', () => {
    const s = render('json', env);
    expect(JSON.parse(s)).toEqual(env);
  });

  it('yaml round-trips the envelope', () => {
    const s = render('yaml', env);
    expect(parseYaml(s)).toEqual(env);
  });

  it('agent falls back to json with a note for non-next commands', () => {
    const s = render('agent', env);
    const parsed = JSON.parse(s);
    expect(parsed.meta.note).toMatch(/agent format not applicable/i);
  });

  it('human shows key/value for a single entity', () => {
    const s = render('human', env);
    expect(s).toMatch(/id\s+WI-1/);
    expect(s).toMatch(/title\s+Offline/);
  });

  it('human shows a table for a page', () => {
    const page = ok({ items: [{ id: 'WI-1', status: 'ready', type: 'feature', title: 'Offline' }],
      page: { total: 1, limit: 20, offset: 0, has_more: false } }, buildMeta('work list', clock));
    const s = render('human', page);
    expect(s).toMatch(/WI-1/);
    expect(s).toMatch(/Offline/);
  });

  it('human renders an error line', () => {
    const s = render('human', fail(new ApmError('E_NOT_FOUND', 'WI-9 not found'), buildMeta('work show', clock)));
    expect(s).toMatch(/error: E_NOT_FOUND WI-9 not found/);
  });
});
