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

  it('agent projects a next dispatched payload to the plaintext contract', () => {
    const data = { status: 'dispatched', work_item: 'WI-1', run: 'WR-1', step: { id: 'design', type: 'agent_prompt' },
      prompt_id: 'design_solution_v1',
      allowed_action: 'Produce the design artifact.', required_context: [{ id: 'ART-1', version: 2, type: 'spec', title: 'Spec', one_line: 'sync model' }],
      do_not: ['write implementation code'], when_done: ['apm step complete WR-1 design --artifact-type design --body-file <path> --agent <agent>'],
      next_actions: [{ cmd: 'apm step complete', args: {} }], lease: null };
    const s = render('agent', ok(data, buildMeta('next', clock, 'S-1')));
    expect(s).toMatch(/WORK_ITEM:\s*\n?WI-1/);
    expect(s).toMatch(/CURRENT_STEP:\s*\n?design/);
    expect(s).toMatch(/PROMPT:\s*\n?design_solution_v1/);
    expect(s).toMatch(/ALLOWED_ACTION:/);
    expect(s).toMatch(/ART-1@2/);
    expect(s).toMatch(/DO_NOT:/);
    expect(s).toMatch(/WHEN_DONE:/);
    expect(s).toMatch(/apm step complete WR-1 design/);
    expect(s).not.toContain('next_actions'); // json-only
    expect(s).not.toContain('2026-06-02'); // no volatile timestamps in the agent body
  });

  it('agent renders a terse idle line', () => {
    const s = render('agent', ok({ status: 'idle', reason: 'all_leased', retry_after: 30 }, buildMeta('next', clock)));
    expect(s.trim()).toMatch(/^status=idle reason=all_leased/);
    expect(s).not.toMatch(/WORK_ITEM/);
  });
});
