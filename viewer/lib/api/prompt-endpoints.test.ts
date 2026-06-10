import { describe, it, expect } from 'vitest';
import { ep } from './endpoints';

describe('prompt endpoint paths', () => {
  it('builds the prompt + panel paths', () => {
    expect(ep.prompts.path()).toBe('/api/prompts');
    expect(ep.prompt.path('brainstorm_feature_v1')).toBe('/api/prompts/brainstorm_feature_v1');
    expect(ep.promptVersion.path('p', 2)).toBe('/api/prompts/p/versions/2');
    expect(ep.promptUsage.path('p', { limit: 20, offset: 0 })).toBe('/api/prompts/p/usage?limit=20&offset=0');
    expect(ep.promptPanel.path('WI-1')).toBe('/api/work/WI-1/prompt-panel');
  });
});
