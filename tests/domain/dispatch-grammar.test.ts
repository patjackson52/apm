import { describe, it, expect } from 'vitest';
import { renderDispatchPrompt, parseDispatchPrompt, type DispatchPayload } from '../../src/domain/dispatchGrammar.js';

const payload: DispatchPayload = {
  work_item: 'WI-1',
  step: { id: 'brainstorm', type: 'agent_prompt' },
  prompt_name: 'brainstorm_feature_v1', prompt_version: 3, prompt_body: 'Explore 2-3 approaches.\nRecommend one.',
  allowed_action: 'Produce a decision + spec.',
  required_context: [], do_not: ['write implementation code'], when_done: ['apm step complete WR-1 brainstorm --agent x'],
};

describe('dispatch grammar', () => {
  it('renders the stored body inline under PROMPT (name@version)', () => {
    const t = renderDispatchPrompt(payload);
    expect(t).toContain('PROMPT (brainstorm_feature_v1@3):');
    expect(t).toContain('Explore 2-3 approaches.');
    expect(t).toContain('Recommend one.');
  });

  it('parses a rendered contract back into sections + body region', () => {
    const parsed = parseDispatchPrompt(renderDispatchPrompt(payload));
    expect(parsed.work_item).toBe('WI-1');
    expect(parsed.prompt?.name).toBe('brainstorm_feature_v1');
    expect(parsed.prompt?.version).toBe(3);
    expect(parsed.prompt?.body).toBe('Explore 2-3 approaches.\nRecommend one.');
    expect(parsed.allowed_action).toBe('Produce a decision + spec.');
    expect(parsed.do_not).toContain('write implementation code');
    expect(parsed.when_done).toContain('apm step complete WR-1 brainstorm --agent x');
  });

  it('omits the PROMPT block when no prompt is set', () => {
    const t = renderDispatchPrompt({ ...payload, prompt_name: null, prompt_body: null });
    expect(t).not.toContain('PROMPT (');
    expect(parseDispatchPrompt(t).prompt).toBeNull();
  });
});
